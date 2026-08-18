const fs = require('fs');
const path = require('path');
const taskService = require('./taskService');
const videoService = require('./videoService');
const capabilityService = require('./videoModelCapabilities');
const SHOT_ASSET_LIMITS = { total: 12, image: 9, video: 3, audio: 3 };

const IMAGE_USAGES = new Set(['primary', 'identity', 'environment', 'style', 'prop', 'first_frame', 'last_frame', 'reference']);

// This produces only the local billing reservation. It never changes the
// provider request body, whose fields are built later by videoService.
function buildAuthorizationUsage(meters, billingSettings, duration) {
  const usage = {};
  if (meters.includes('second')) usage.second = Number(duration) || 15;
  if (meters.includes('request')) usage.request = 1;
  if (meters.includes('input_token')) {
    const cap = Number(billingSettings.billing_reserve_input_tokens);
    if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error('视频模型按 token 计费，需在 AI 配置 settings 中设置 billing_reserve_input_tokens 作为单次预授权上限');
    usage.input_token = cap;
  }
  if (meters.includes('output_token')) {
    const cap = Number(billingSettings.billing_reserve_output_tokens ?? billingSettings.billing_reserve_input_tokens);
    if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error('视频模型按 token 计费，需在 AI 配置 settings 中设置 billing_reserve_output_tokens 作为单次预授权上限');
    usage.output_token = cap;
  }
  return usage;
}

function maxDurationForModel(model) {
  return /seedance[-_]?2[-_]?5|2[-_]?5[-_]?260628/i.test(String(model || '')) ? 30 : 15;
}

function create(db, log, body, billingUser) {
  body = { ...(body || {}) };
  if (!String(body.model || '').trim() || String(body.model).trim() === 'auto') throw new Error('请选择一个明确的视频模型');
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new Error('提示词不能为空');
  const postprocessPolicy = require('./videoPostprocessPolicy').normalize(body);
  body.resolution = postprocessPolicy.resolution;
  body.upscale_resolution = postprocessPolicy.upscale_resolution;
  body.target_fps = postprocessPolicy.target_fps;
  const input = Array.isArray(body.assets) ? body.assets : [];
  if (input.length > 50) throw new Error('一次创作最多使用 50 个素材');
  const assets = prioritizePromptReferenceAssets(input.map((entry, ordinal) => resolveAsset(db, entry, ordinal, body.owner_user_id)), body.prompt_document, prompt);
  const capability = capabilityService.resolve(db, body.model, assets);
  if (!capability.model) throw new Error('请先在 AI 配置中启用视频模型');
  validateShotAssetLimits(assets, capability);
  body.duration = Math.min(maxDurationForModel(capability.model), Math.max(4, Math.round(Number(body.duration) || 15)));
  const creationMode = body.creation_mode || body.settings?.creation_mode || 'multi_reference';
  validateCreationMode(creationMode, assets, capability);
  const routed = routeAssets(expandVideoReferences(db, log, assets, capability.supports), capability.supports, body.audio_strategy);
  const sd2 = sd2IdentityState(routed, capability);
  if (sd2.invalid.length) enforceSd2IdentityAssets(routed, capability, log);
  const waitingForSd2 = sd2.pending.length > 0;
  applySd2CertifiedAssetReferences(routed, capability);
  const modelPrompt = bindPromptReferences(prompt, body.prompt_document, routed);
  const now = new Date().toISOString();
  const billing = require('./billingService');
  const payer = billingUser || { id: body.owner_user_id, role: 'admin' };
  if (!payer?.id) throw new Error('缺少生成任务所属账号');
  const aiConfigs = require('./aiConfigService');
  const billingTarget = aiConfigs.resolveBillingTarget(db, 'video', capability.model, capability.config_id);
  const config = aiConfigs.getConfig(db, capability.config_id);
  let billingSettings = {}; try { billingSettings = JSON.parse(config?.settings || '{}'); } catch (_) {}
  const upscaleResolution = body.upscale_resolution;
  const targetFps = body.target_fps;
  const meters = billing.activeMeters(db, payer, 'video', billingTarget.billing_key);
  const usage = buildAuthorizationUsage(meters, billingSettings, body.duration);
  if (!Object.keys(usage).length) throw new Error(`视频模型 ${billingTarget.billing_key} 未配置可用计费项，已拒绝调用`);
  const existingWaitingId = Number(body.__sd2_waiting_generation_id) || null;
  const authorization = waitingForSd2 ? null : billing.createAuthorization(db, payer, {
    idempotency_key: body.idempotency_key || (existingWaitingId ? `sd2-wait:${existingWaitingId}` : `omni-video:${payer.id}:${Date.now()}:${Math.random()}`),
    service_type: 'video', model: billingTarget.billing_key, usage,
    pricing_context: { has_video_input: routed.some((asset) => asset.type === 'video' && asset.send_to_model), resolution: body.resolution || '480p', has_audio: routed.some((asset) => asset.type === 'audio' && asset.send_to_model) }, reference_type: 'omni_video_job', reference_id: body.shot_id || body.sequence_id || null,
  });
  let task = null;
  let videoGenerationId = null;
  let jobId = null;
  if (existingWaitingId) {
    const existing = db.prepare('SELECT id, task_id, status, owner_user_id FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(existingWaitingId);
    if (!existing || existing.status !== 'sd2_waiting' || Number(existing.owner_user_id) !== Number(payer.id)) throw new Error('SD2 等待任务不存在或已被处理');
    task = taskService.getTask(db, existing.task_id) || { id: existing.task_id };
    videoGenerationId = existing.id;
  } else task = taskService.createTask(db, log, 'video_generation', '', body.owner_user_id || payer.id);
  const imageUrls = routed.filter((asset) => asset.send_to_model && asset.type === 'image').map((asset) => asset.model_url || asset.local_path || asset.url).filter(Boolean);
  const first = routed.find((asset) => asset.usage === 'first_frame' && asset.send_to_model);
  const last = routed.find((asset) => asset.usage === 'last_frame' && asset.send_to_model);
  if (existingWaitingId) {
    db.prepare(`UPDATE video_generations SET billing_authorization_id = ?, provider = ?, prompt = ?, model = ?, duration = ?, aspect_ratio = ?, resolution = ?, upscale_resolution = ?, target_fps = ?, seed = ?, camera_fixed = ?, watermark = ?, image_url = ?, first_frame_url = ?, last_frame_url = ?, reference_image_urls = ?, status = ?, error_msg = NULL, updated_at = ? WHERE id = ?`)
      .run(authorization.authorization_id, body.provider || 'chatfire', modelPrompt, capability.model, Number(body.duration) || null, body.aspect_ratio || null, body.resolution || null, upscaleResolution, targetFps, body.seed != null ? Number(body.seed) : null, body.camera_fixed ? 1 : 0, body.watermark ? 1 : 0, imageUrls[0] || null, first?.model_url || first?.local_path || first?.url || null, last?.model_url || last?.local_path || last?.url || null, imageUrls.length ? JSON.stringify(imageUrls) : null, 'processing', now, videoGenerationId);
  } else {
    const result = db.prepare(`INSERT INTO video_generations (drama_id, storyboard_id, owner_user_id, billing_authorization_id, provider, prompt, model, duration, aspect_ratio, resolution, upscale_resolution, target_fps, seed, camera_fixed, watermark, image_url, first_frame_url, last_frame_url, reference_image_urls, intermediate_cleanup_enabled, status, task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .run(Number(body.drama_id) || 0, body.storyboard_id ? Number(body.storyboard_id) : null, body.owner_user_id || payer.id, authorization?.authorization_id || null, body.provider || 'chatfire', modelPrompt, capability.model, Number(body.duration) || null, body.aspect_ratio || null, body.resolution || null, upscaleResolution,
        targetFps, body.seed != null ? Number(body.seed) : null, body.camera_fixed ? 1 : 0, body.watermark ? 1 : 0,
        imageUrls[0] || null, first?.model_url || first?.local_path || first?.url || null, last?.model_url || last?.local_path || last?.url || null,
        imageUrls.length ? JSON.stringify(imageUrls) : null, waitingForSd2 ? 'sd2_waiting' : 'processing', task.id, now, now);
    videoGenerationId = Number(result.lastInsertRowid);
  }
  const postProcess = { keep_original_audio: !!body.keep_original_audio, audio_volume: clamp(body.audio_volume, 0, 2, 1), audio_fade_seconds: clamp(body.audio_fade_seconds, 0, 10, 0) };
  const requestSnapshot = { prompt: modelPrompt, original_prompt: prompt, prompt_document: body.prompt_document || null, negative_prompt: body.negative_prompt || '', creation_mode: creationMode, model: capability.model, aspect_ratio: body.aspect_ratio || null, duration: body.duration || null, resolution: body.resolution || null, upscale_resolution: upscaleResolution, target_fps: targetFps, audio_strategy: body.audio_strategy || 'reference_only', post_process: postProcess, assets: routed.map(publicAsset) };
  const job = !existingWaitingId ? db.prepare(`INSERT INTO omni_video_jobs (video_generation_id, owner_user_id, prompt, negative_prompt, model_requested, model_resolved, capability_snapshot_json, request_snapshot_json, preprocess_snapshot_json, input_summary_json, audio_strategy, sequence_id, shot_id, storyboard_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(videoGenerationId, body.owner_user_id || payer.id, modelPrompt, body.negative_prompt || null, body.model || 'auto', capability.model,
      JSON.stringify({ supports: capability.supports, limits: capability.limits, reason: capability.reason }), JSON.stringify(requestSnapshot),
      JSON.stringify(routed.filter((asset) => asset.strategy !== 'native').map(publicAsset)), JSON.stringify(buildSummary(routed)), body.audio_strategy || 'reference_only',
      body.sequence_id ? Number(body.sequence_id) : null, body.shot_id ? Number(body.shot_id) : null, body.storyboard_id ? Number(body.storyboard_id) : null, now, now) : null;
  jobId = existingWaitingId
    ? Number(db.prepare('SELECT id FROM omni_video_jobs WHERE video_generation_id = ? ORDER BY id DESC LIMIT 1').get(videoGenerationId)?.id)
    : Number(job.lastInsertRowid);
  if (existingWaitingId) {
    db.prepare('UPDATE omni_video_jobs SET prompt = ?, negative_prompt = ?, model_resolved = ?, capability_snapshot_json = ?, request_snapshot_json = ?, preprocess_snapshot_json = ?, input_summary_json = ?, updated_at = ? WHERE id = ?')
      .run(modelPrompt, body.negative_prompt || null, capability.model, JSON.stringify({ supports: capability.supports, limits: capability.limits, reason: capability.reason }), JSON.stringify(requestSnapshot), JSON.stringify(routed.filter((asset) => asset.strategy !== 'native').map(publicAsset)), JSON.stringify(buildSummary(routed)), now, jobId);
    db.prepare('DELETE FROM omni_video_job_assets WHERE omni_job_id = ?').run(jobId);
  }
  const insertAsset = db.prepare(`INSERT INTO omni_video_job_assets (omni_job_id, asset_id, ordinal, alias, media_type, role, usage, send_to_model, derived_asset_id, snapshot_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const asset of routed) insertAsset.run(jobId, asset.id, asset.ordinal, asset.alias, asset.type, asset.role, asset.usage, asset.send_to_model ? 1 : 0, null, JSON.stringify(publicAsset(asset)), now);
  if (body.shot_id && body.sequence_id) {
    const shot = db.prepare('SELECT id FROM omni_video_sequence_shots WHERE id = ? AND sequence_id = ? AND deleted_at IS NULL').get(Number(body.shot_id), Number(body.sequence_id));
    if (shot) db.prepare('UPDATE omni_video_sequence_shots SET omni_job_id = ?, prompt = ?, prompt_document_json = ?, assets_json = ?, settings_json = ?, updated_at = ? WHERE id = ?').run(
      jobId, modelPrompt, body.prompt_document ? JSON.stringify(body.prompt_document) : null, JSON.stringify(routed.map(publicAsset)), JSON.stringify({ model: body.model, creation_mode: creationMode, aspect_ratio: body.aspect_ratio || '16:9', duration: body.duration, resolution: body.resolution || null, upscale_resolution: upscaleResolution, target_fps: targetFps, audio_strategy: body.audio_strategy || 'reference_only' }), now, shot.id);
  }
  if (waitingForSd2) {
    // Persist the user-facing stage as well as the generation row.  Without
    // this, a page refresh turns an in-progress certification into a vague
    // storyboard "draft/pending" state.
    if (body.storyboard_id) {
      try { db.prepare("UPDATE storyboards SET active_video_generation_id=?, status='sd2_waiting', error_msg=NULL, updated_at=? WHERE id=? AND deleted_at IS NULL").run(videoGenerationId, now, Number(body.storyboard_id)); } catch (_) {}
    }
    taskService.updateTaskStatus(db, task.id, 'processing', 0, '真人素材认证准备中，完成后将自动开始生成');
    return { omni_job_id: jobId, video_generation_id: videoGenerationId, task_id: task.id, status: 'sd2_waiting', resolved_model: capability.model, routing_summary: buildSummary(routed) };
  }
  if (body.storyboard_id) {
    try { db.prepare("UPDATE storyboards SET active_video_generation_id=?, status='processing', error_msg=NULL, updated_at=? WHERE id=? AND deleted_at IS NULL").run(videoGenerationId, now, Number(body.storyboard_id)); } catch (_) {}
  }
  try {
    if (upscaleResolution) require('./videoUpscaleService').reserveForGeneration(db, videoGenerationId, upscaleResolution);
    if (targetFps) require('./videoInterpolationService').reserveForGeneration(db, videoGenerationId, targetFps);
  } catch (error) {
    videoService.setVideoGenFailed(db, videoGenerationId, error.message, new Date().toISOString());
    taskService.updateTaskError(db, task.id, error.message);
    throw error;
  }
  setImmediate(() => videoService.processVideoGeneration(db, log, videoGenerationId));
  return { omni_job_id: jobId, video_generation_id: videoGenerationId, task_id: task.id, status: 'processing', resolved_model: capability.model, routing_summary: buildSummary(routed) };
}

function resolveAsset(db, input, ordinal, ownerUserId) {
  // 外部引用条目（场景/角色/道具等非素材库图片）：提供 url 或 local_path 即可，无需 assets 行
  const hasAssetId = input.asset_id != null && String(input.asset_id).trim() !== '';
  if (!hasAssetId && (input.url || input.local_path)) {
    const alias = String(input.alias || '参考图').slice(0, 80);
    return {
      id: null, drama_id: null, name: alias, type: String(input.type || 'image').toLowerCase(),
      category: null, url: input.url || null, local_path: input.local_path || null,
      file_size: null, mime_type: null, width: null, height: null, duration: null,
      source_type: 'reference', parent_asset_id: null, thumbnail_local_path: null,
      metadata: null, tags: null, processing_status: 'ready', error_msg: null,
      seedance2_asset: null, requires_sd2_identity: false, image_gen_id: null, video_gen_id: null,
      created_at: null, updated_at: null,
      ordinal: Number(input.ordinal) || ordinal + 1,
      alias, role: input.role || 'reference', usage: input.usage || 'reference',
      requested_send: input.send_to_model !== false,
    };
  }
  const row = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(input.asset_id));
  if (!row) throw new Error(`素材 ${input.asset_id} 不存在或已删除`);
  if (ownerUserId) {
    const owner = db.prepare('SELECT COALESCE(d.owner_user_id, a.owner_user_id) owner_user_id FROM assets a LEFT JOIN dramas d ON d.id = a.drama_id WHERE a.id = ?').get(Number(input.asset_id));
    if (!owner || Number(owner.owner_user_id) !== Number(ownerUserId)) throw new Error(`素材 ${input.asset_id} 不存在或无权访问`);
  }
  if (row.processing_status && row.processing_status !== 'ready') throw new Error(`素材“${row.name || row.id}”尚未准备完成`);
  let seedance2_asset = null; try { seedance2_asset = row.seedance2_asset ? JSON.parse(row.seedance2_asset) : null; } catch (_) {}
  return { ...row, seedance2_asset, id: row.id, type: row.type, ordinal: Number(input.ordinal) || ordinal + 1, alias: String(input.alias || row.name || `素材${row.id}`).slice(0, 80), role: input.role || 'reference', usage: input.usage || 'reference', requested_send: input.send_to_model !== false };
}

function promptReferenceEntries(promptDocument, prompt) {
  const explicit = Array.isArray(promptDocument?.refs) ? promptDocument.refs : [];
  const aliases = [...new Set([...String(prompt || '').matchAll(/@([^\s@]+)/g)].map((match) => match[1]))];
  const byAlias = new Map();
  explicit.forEach((ref) => {
    const alias = String(ref?.alias || '').trim();
    if (alias) byAlias.set(alias, { asset_id: Number(ref.asset_id) || null, alias });
  });
  aliases.forEach((alias) => {
    if (!/^图片\d+$/u.test(alias) && !byAlias.has(alias)) byAlias.set(alias, { asset_id: null, alias });
  });
  return [...byAlias.values()];
}

/** Keep explicitly referenced assets at the front, so model image slots cannot be occupied by unrelated selections. */
function prioritizePromptReferenceAssets(assets, promptDocument, prompt) {
  const refs = promptReferenceEntries(promptDocument, prompt);
  const ordered = [];
  const used = new Set();
  refs.forEach((ref) => {
    const asset = assets.find((item) => !used.has(item.id) && ((ref.asset_id && Number(item.id) === ref.asset_id) || item.alias === ref.alias));
    if (asset) { ordered.push(asset); used.add(asset.id); }
  });
  assets.forEach((asset) => { if (!used.has(asset.id)) ordered.push(asset); });
  return ordered.map((asset, index) => ({ ...asset, ordinal: index + 1 }));
}

/** Provider APIs receive ordered images rather than aliases, so bind known @aliases to @图片N explicitly. */
function bindPromptReferences(prompt, promptDocument, routedAssets) {
  const references = promptReferenceEntries(promptDocument, prompt);
  const images = routedAssets.filter((asset) => asset.type === 'image' && asset.send_to_model);
  const bindings = references.flatMap((ref) => {
    const index = images.findIndex((asset) => (ref.asset_id && Number(asset.id) === ref.asset_id) || asset.alias === ref.alias);
    return index >= 0 ? [{ ...ref, slot: index + 1, usage: images[index].usage || 'reference' }] : [];
  });
  if (!bindings.length) return prompt;
  const slotByAlias = new Map(bindings.map((binding) => [binding.alias, binding.slot]));
  const rewritten = String(prompt || '').replace(/@([^\s@]+)/g, (token, alias) => {
    const slot = slotByAlias.get(alias);
    return slot ? `@图片${slot}` : token;
  });
  const rules = bindings.map((binding, index) => `${index + 1}. @图片${binding.slot}（${binding.alias}）：${referenceRenderRule(binding.usage)}`).join('\n');
  return `${rewritten}\n\n【@引用素材硬约束】\n${rules}\n以上 @图片N 按上传顺序一一对应。不得忽略、替换或弱化被 @ 引用素材的主体内容。`;
}

function referenceRenderRule(usage) {
  if (usage === 'identity' || usage === 'primary') return '人物必须以该参考图的身份、外形与服装出镜，保持身份一致，不得替换为其他人物。';
  if (usage === 'environment') return '场景必须采用该图中的空间、陈设和光线特征，不得用泛化场景替代。';
  if (usage === 'style') return '画面必须继承该图的视觉风格与质感。';
  if (usage === 'prop') return '该道具必须在画面中清晰、可辨认地出现，并保留参考图中的关键文字、图案或外观特征。';
  return '该参考图的主体内容必须在画面中清晰、可辨认地出现；若是人物、场景或道具，分别保持其身份、空间或外观，不得以泛化内容替代。';
}

function routeAssets(assets, supports, audioStrategy) {
  let storage = null;
  try { storage = require('./mediaStorageService'); } catch (_) {}
  let cfg = null;
  try { cfg = require('../config').loadConfig(); } catch (_) {}
  const maxImages = Number(supports.image_reference?.max || 0);
  let imageCount = 0;
  return assets.map((asset) => {
    let send = asset.requested_send;
    let strategy = 'native';
    if (asset.type === 'image') { send = send && imageCount < maxImages; if (send) imageCount++; if (!send) strategy = 'not_supported'; }
    if (asset.type === 'audio') { send = send && !!supports.audio_reference && audioStrategy !== 'post_mix'; strategy = send ? 'native' : 'post_mix'; }
    if (asset.type === 'video') { send = send && !!supports.video_reference; strategy = send ? 'native' : 'keyframe_or_post'; }
    // 真人标记是声明信息，不把供应商认证资源作为生成前置条件。
    // After an OSS migration old local_path values remain unchanged, but their
    // local files may no longer exist. Prefer the CDN object URL so reference
    // media can still be supplied to the model without filesystem access.
    const modelUrl = asset.local_path && storage?.isOss?.(cfg)
      ? storage.objectUrl(cfg, asset.local_path)
      : (asset.local_path || asset.url);
    return { ...asset, model_url: modelUrl, send_to_model: send, strategy };
  });
}

function validateCreationMode(mode, assets, capability) {
  if (!['multi_reference', 'first_last_frame'].includes(mode)) throw new Error('不支持的视频创作模式');
  if (mode !== 'first_last_frame') return;
  const first = assets.filter((asset) => asset.usage === 'first_frame');
  const last = assets.filter((asset) => asset.usage === 'last_frame');
  if (first.length !== 1 || last.length > 1 || first[0].type !== 'image' || (last.length === 1 && last[0].type !== 'image')) throw new Error('首尾帧生视频必须且只能选择一张图片首帧，尾帧可选（最多一张）');
  if (assets.some((asset) => !['first_frame', 'last_frame'].includes(asset.usage))) throw new Error('首尾帧生视频仅支持首帧、尾帧和提示词');
  if (!capability.supports?.first_last_frame) throw new Error(`模型“${capability.model}”不支持首尾帧生视频，请切换模型或创作模式`);
}

function assetLimitsForCapability(capability) {
  if (!/seedance[-_]?2[-_]?5|2[-_]?5[-_]?260628/i.test(String(capability?.model || ''))) return SHOT_ASSET_LIMITS;
  const limits = capability?.limits || {};
  return {
    total: Number(limits.total_reference?.max || 50),
    image: Number(limits.image_reference?.max || 30),
    video: Number(limits.video_reference?.max || 10),
    audio: Number(limits.audio_reference?.max || 10),
  };
}

function validateShotAssetLimits(assets, capability = null) {
  const max = assetLimitsForCapability(capability);
  if (assets.length > max.total) throw new Error(`asset count exceeds the per-shot limit of ${max.total}`);
  const counts = assets.reduce((result, asset) => {
    if (Object.prototype.hasOwnProperty.call(max, asset.type)) result[asset.type] += 1;
    return result;
  }, { image: 0, video: 0, audio: 0 });
  for (const type of ['image', 'video', 'audio']) {
    if (counts[type] > max[type]) {
      throw new Error(`${type} asset count exceeds the per-shot limit of ${max[type]}`);
    }
  }
}

function expandVideoReferences(db, log, assets, supports) {
  if (supports.video_reference) return assets;
  const output = [];
  for (const asset of assets) {
    output.push(asset);
    if (asset.type !== 'video' || !asset.requested_send || !['motion', 'keyframes', 'reference'].includes(asset.usage)) continue;
    if (!Number(supports.image_reference?.max || 0)) continue;
    const process = require('./omniMediaProcessService');
    const frames = process.extractKeyframes(db, log, asset, 3);
    frames.forEach((frame, index) => output.push({ ...frame, ordinal: asset.ordinal + (index + 1) / 10, alias: `${asset.alias} · 关键帧 ${index + 1}`, role: 'derived_reference', usage: 'reference', requested_send: true, derived_from_asset_id: asset.id }));
  }
  return output;
}

function isSeedanceCapability(capability) {
  return /seedance|doubao-seedance/i.test(String(capability?.model || ''));
}

function hasActiveSd2Certification(asset) {
  return !!(asset?.seedance2_asset
    && String(asset.seedance2_asset.status || '').toLowerCase() === 'active'
    && String(asset.seedance2_asset.asset_url || '').startsWith('asset://'));
}

function sd2IdentityState(assets, capability) {
  if (!isSeedanceCapability(capability)) return { pending: [], invalid: [] };
  const declared = assets.filter((asset) => asset.type === 'image' && asset.send_to_model && asset.requires_sd2_identity);
  return {
    pending: declared.filter((asset) => String(asset.seedance2_asset?.status || '').toLowerCase() === 'processing'),
    invalid: declared.filter((asset) => !hasActiveSd2Certification(asset) && String(asset.seedance2_asset?.status || '').toLowerCase() !== 'processing'),
  };
}

function enforceSd2IdentityAssets(assets, capability, log) {
  if (!isSeedanceCapability(capability)) return;
  // "contains real person" is a declaration. Once declared, Seedance calls
  // must not silently downgrade it to an unregistered raw image.
  const invalid = assets.filter((asset) => asset.type === 'image' && asset.send_to_model && asset.requires_sd2_identity && !hasActiveSd2Certification(asset));
  if (invalid.length) {
    const names = invalid.map((asset) => asset.alias).join('、');
    if (log && typeof log.warn === 'function') log.warn('[SD2] rejected request with inactive declared-real-person assets', { assets: names });
    throw new Error(`以下含真人素材尚未完成或已失效 SD2 认证，请刷新或重新认证后再生成：${names}`);
  }
}

function applySd2CertifiedAssetReferences(assets, capability) {
  if (!isSeedanceCapability(capability)) return;
  for (const asset of assets) {
    if (asset.type === 'image' && asset.send_to_model && hasActiveSd2Certification(asset)) {
      asset.model_url = asset.seedance2_asset.asset_url;
      asset.strategy = 'sd2_certified_asset';
    }
  }
}
// Keep retry snapshots server-side and complete, but never return raw file paths,
// signed URLs, or provider asset URLs through the job APIs.
function publicAsset(asset) { return { asset_id: asset.id, alias: asset.alias, type: asset.type, role: asset.role, usage: asset.usage, ordinal: asset.ordinal, local_path: asset.local_path, url: asset.url, model_url: asset.model_url || null, seedance2_asset: asset.seedance2_asset || null, checksum: asset.checksum || null, send_to_model: !!asset.send_to_model, strategy: asset.strategy }; }
function safeAssetSummary(asset) {
  if (!asset) return null;
  return {
    asset_id: asset.asset_id ?? asset.id ?? null,
    alias: asset.alias || null,
    type: asset.type || null,
    role: asset.role || null,
    usage: asset.usage || null,
    ordinal: asset.ordinal ?? null,
    source: asset.local_path ? 'local' : (asset.url ? 'remote' : 'asset_library'),
    derived_from_asset_id: asset.derived_from_asset_id || null,
    send_to_model: !!asset.send_to_model,
    strategy: asset.strategy || null,
  };
}
function safeSnapshot(snapshot) {
  if (!snapshot) return null;
  return { ...snapshot, assets: Array.isArray(snapshot.assets) ? snapshot.assets.map(safeAssetSummary) : [] };
}
function buildSummary(assets) { return { sent_to_model: assets.filter((a) => a.send_to_model).map(safeAssetSummary), post_process_or_preprocess: assets.filter((a) => !a.send_to_model).map(safeAssetSummary) }; }

function get(db, id) {
  const job = db.prepare('SELECT * FROM omni_video_jobs WHERE id = ?').get(Number(id));
  if (!job) return null;
  const generation = db.prepare(`SELECT v.*, t.progress AS task_progress, t.message AS task_message, t.updated_at AS task_updated_at
    FROM video_generations v LEFT JOIN async_tasks t ON t.id=v.task_id AND t.deleted_at IS NULL WHERE v.id = ?`).get(job.video_generation_id);
  const assets = db.prepare('SELECT * FROM omni_video_job_assets WHERE omni_job_id = ? ORDER BY ordinal').all(job.id);
  const safeGeneration = generation ? { ...generation, video_url: videoService.publicVideoUrl(generation.video_url, generation.local_path) } : null;
  let isCurrent = false;
  if (generation?.storyboard_id) {
    try {
      const storyboard = db.prepare('SELECT active_video_generation_id, local_path FROM storyboards WHERE id=? AND deleted_at IS NULL').get(generation.storyboard_id);
      isCurrent = Number(storyboard?.active_video_generation_id) === Number(generation.id)
        || (!storyboard?.active_video_generation_id && String(storyboard?.local_path || '') === String(generation.local_path || ''));
    } catch (_) {}
  }
  return { ...job, is_current: isCurrent, capability_snapshot: parse(job.capability_snapshot_json), request_snapshot: safeSnapshot(parse(job.request_snapshot_json)), input_summary: parse(job.input_summary_json), assets: assets.map((asset) => ({ ...asset, snapshot: safeAssetSummary(parse(asset.snapshot_json)) })), generation: safeGeneration };
}
function list(db, query = {}) {
  const storyboardId = Number(query.storyboard_id);
  const shotId = Number(query.shot_id);
  let sql = `SELECT j.*, v.status, v.video_url, v.local_path, v.source_local_path, v.upscale_local_path,
    v.resolution, v.aspect_ratio, v.upscale_resolution, v.target_fps, v.upscale_status, v.interpolation_status,
    v.output_width, v.output_height, v.output_resolution, v.output_fps, v.output_duration_ms, v.error_msg, v.task_id, t.progress AS task_progress, t.message AS task_message, t.updated_at AS task_updated_at,
    s.active_video_generation_id, s.local_path AS storyboard_local_path
    FROM omni_video_jobs j JOIN video_generations v ON v.id = j.video_generation_id
    LEFT JOIN async_tasks t ON t.id=v.task_id AND t.deleted_at IS NULL
    LEFT JOIN storyboards s ON s.id = v.storyboard_id AND s.deleted_at IS NULL`;
  const params = [];
  const filters = [];
  if (query.owner_user_id) { filters.push('j.owner_user_id = ?'); params.push(Number(query.owner_user_id)); }
  if (Number.isInteger(storyboardId) && storyboardId > 0) {
    // Older jobs predate omni_video_jobs.storyboard_id; recover them through
    // their video generation so existing project history remains visible.
    filters.push('(j.storyboard_id = ? OR (j.storyboard_id IS NULL AND v.storyboard_id = ?))');
    params.push(storyboardId, storyboardId);
  } else if (Number.isInteger(shotId) && shotId > 0) {
    filters.push('j.shot_id = ?');
    params.push(shotId);
  }
  if (filters.length) sql += ' WHERE ' + filters.join(' AND ');
  sql += ' ORDER BY j.id DESC LIMIT 100';
  return db.prepare(sql).all(...params).map((item) => ({
    ...item,
    is_current: item.active_video_generation_id != null
      ? Number(item.active_video_generation_id) === Number(item.video_generation_id)
      : Boolean(item.storyboard_local_path && item.local_path && item.storyboard_local_path === item.local_path),
    video_url: videoService.publicVideoUrl(item.video_url, item.local_path),
    postprocess_chain: `${require('./videoPostprocessPolicy').describe(item)} → 本地规范 ${item.aspect_ratio || '原画幅'}`,
    request_snapshot: safeSnapshot(parse(item.request_snapshot_json)),
  }));
}

function assertOwnedJob(db, omniJobId, actor) {
  const job = db.prepare(`SELECT j.id AS omni_job_id, j.owner_user_id AS job_owner_user_id, v.id AS video_generation_id, v.* FROM omni_video_jobs j
    JOIN video_generations v ON v.id=j.video_generation_id
    WHERE j.id=? AND v.deleted_at IS NULL`).get(Number(omniJobId));
  if (!job || (Number(job.job_owner_user_id) !== Number(actor?.id) && actor?.role !== 'admin')) throw new Error('视频任务不存在或无权操作');
  return job;
}

function postprocessStoragePath() {
  const cfg = require('../config').loadConfig();
  return path.isAbsolute(cfg.storage?.local_path) ? cfg.storage.local_path : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
}

function retryPostprocess(db, log, omniJobId, actor, requestedStage) {
  const job = assertOwnedJob(db, omniJobId, actor);
  if (job.status !== 'failed') throw new Error('只有失败的后处理任务可进行阶段重试');
  let stage = String(requestedStage || '').toLowerCase();
  if (!stage) stage = job.upscale_status === 'failed' ? 'upscale' : job.interpolation_status === 'failed' ? 'interpolation' : '';
  if (!['upscale', 'interpolation'].includes(stage)) throw new Error('该任务不是可阶段重试的超分或插帧失败');
  if (stage === 'upscale') {
    if (job.upscale_status !== 'failed' || !job.source_local_path) throw new Error('超分原片不存在，不能只重试超分');
    require('./videoUpscaleService').retryFromSource(db, job.video_generation_id);
    setImmediate(async () => {
      const result = await require('./videoUpscaleService').process(db, log, job.video_generation_id, postprocessStoragePath());
      if (result?.local_path) await videoService.resumePostprocessVideoGeneration(db, log, job.video_generation_id);
    });
  } else {
    if (job.interpolation_status !== 'failed' || !(job.upscale_local_path || job.source_local_path)) throw new Error('插帧输入视频不存在，不能只重试插帧');
    require('./videoInterpolationService').retryFromSource(db, job.video_generation_id);
    setImmediate(async () => {
      const result = await require('./videoInterpolationService').process(db, log, job.video_generation_id, postprocessStoragePath());
      if (result?.local_path) await videoService.resumePostprocessVideoGeneration(db, log, job.video_generation_id);
    });
  }
  return get(db, job.omni_job_id);
}

/**
 * Explicit opt-in fallback for a failed paid post-process stage. The provider
 * video has already been generated and downloaded; this publishes precisely
 * those local bytes as the completed version without submitting any new AI
 * request or pretending that the requested upscale/fps was achieved.
 */
function adoptSourceVideo(db, log, omniJobId, actor, options = {}) {
  const job = assertOwnedJob(db, omniJobId, actor);
  if (job.status !== 'failed') throw new Error('只有后处理失败且保留原片的任务可以采用原片');
  if (!job.source_local_path) throw new Error('原始视频不存在，无法采用');
  if (!['failed', 'cancelled', 'reconciliation_required'].includes(String(job.upscale_status || ''))
    && !['failed', 'cancelled', 'reconciliation_required'].includes(String(job.interpolation_status || ''))) {
    throw new Error('该任务没有可采用原片的后处理失败阶段');
  }

  const storageRoot = path.resolve(options.storagePath || postprocessStoragePath());
  const sourceKey = require('./mediaStorageService').normalizeKey(job.source_local_path);
  const sourcePath = path.resolve(storageRoot, sourceKey);
  if (!(sourcePath === storageRoot || sourcePath.startsWith(storageRoot + path.sep)) || !fs.statSync(sourcePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('原始视频文件不可读，无法采用');
  }
  const probe = (options.probeVideoMedia || require('./videoMediaProbeService').probeVideoMedia)(sourcePath);
  const now = new Date().toISOString();
  const fallbackMessage = `后处理失败，已按用户请求采用原始 ${probe.resolution} / ${probe.fps}fps 视频`;
  const archiveStatus = require('./mediaStorageService').isOss(require('../config').loadConfig()) ? 'pending' : 'local';
  const apply = db.transaction(() => {
    db.prepare(`UPDATE video_generations SET status='completed', video_url=?, local_path=?,
      output_width=?, output_height=?, output_resolution=?, output_fps=?, output_duration_ms=?,
      upscale_status=?, interpolation_status=?, error_msg=?, archive_status=?, archive_error=NULL,
      completed_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL`)
      .run(`/static/${sourceKey}`, sourceKey, probe.width, probe.height, probe.resolution, probe.fps, probe.duration_ms,
        job.upscale_resolution ? 'source_fallback' : (job.upscale_status || 'skipped'),
        job.target_fps ? 'source_fallback' : (job.interpolation_status || 'skipped'),
        fallbackMessage, archiveStatus, now, now, job.video_generation_id);
    if (job.storyboard_id) {
      db.prepare(`UPDATE storyboards SET active_video_generation_id=?, video_url=?, local_path=?, status='completed',
        error_msg=?, updated_at=? WHERE id=? AND deleted_at IS NULL`)
        .run(job.video_generation_id, `/static/${sourceKey}`, sourceKey, fallbackMessage, now, job.storyboard_id);
    }
    if (job.task_id) taskService.updateTaskStatus(db, job.task_id, 'completed', 100, fallbackMessage);
  });
  apply();
  const archive = options.archiveCompletedVideo || videoService.archiveCompletedVideo;
  setImmediate(() => Promise.resolve(archive(db, log, job.video_generation_id)).catch((error) => {
    log.warn('Source-video fallback archive deferred', { video_generation_id: job.video_generation_id, error: error.message });
  }));
  return get(db, job.omni_job_id);
}

function adoptCompletedVersion(db, omniJobId, actor) {
  const job = assertOwnedJob(db, omniJobId, actor);
  if (!job.storyboard_id || job.status !== 'completed' || !job.local_path) throw new Error('只有已完成并已本地归档的分镜历史版本可设为当前成片');
  const now = new Date().toISOString();
  const videoUrl = `/static/${String(job.local_path).replace(/^\/+/, '')}`;
  const result = db.prepare(`UPDATE storyboards SET active_video_generation_id=?, video_url=?, local_path=?, status='completed',
    error_msg=NULL, updated_at=? WHERE id=? AND deleted_at IS NULL`).run(job.video_generation_id, videoUrl, job.local_path, now, job.storyboard_id);
  if (!result.changes) throw new Error('分镜不存在或已删除');
  return get(db, job.omni_job_id);
}
function retry(db, log, id, billingUser) {
  const job = db.prepare('SELECT * FROM omni_video_jobs WHERE id = ?').get(Number(id));
  if (!job) throw new Error('全能视频任务不存在');
  const generation = db.prepare('SELECT status, drama_id, storyboard_id FROM video_generations WHERE id = ?').get(job.video_generation_id);
  if (!generation || generation.status !== 'retryable') throw new Error('只有重启中断且可重试的任务可以重试');
  const snapshot = parse(job.request_snapshot_json);
  if (!snapshot?.prompt || !Array.isArray(snapshot.assets) || !snapshot.assets.length) throw new Error('该任务没有可重试的完整请求快照');
  return create(db, log, {
    prompt: snapshot.prompt, negative_prompt: snapshot.negative_prompt, model: snapshot.model,
    aspect_ratio: snapshot.aspect_ratio, duration: snapshot.duration, resolution: snapshot.resolution,
    upscale_resolution: snapshot.upscale_resolution, target_fps: snapshot.target_fps,
    creation_mode: snapshot.creation_mode, prompt_document: snapshot.prompt_document, audio_strategy: snapshot.audio_strategy, keep_original_audio: snapshot.post_process?.keep_original_audio,
    audio_volume: snapshot.post_process?.audio_volume, audio_fade_seconds: snapshot.post_process?.audio_fade_seconds,
    drama_id: generation.drama_id || undefined,
    sequence_id: job.sequence_id || undefined, shot_id: job.shot_id || undefined, storyboard_id: job.storyboard_id || generation.storyboard_id || undefined,
    assets: snapshot.assets.map((asset) => ({
      asset_id: asset.asset_id, alias: asset.alias, role: asset.role, usage: asset.usage, ordinal: asset.ordinal, send_to_model: asset.send_to_model,
      // 外部引用条目（场景/角色/道具等非素材库图片）依赖 url / local_path / type 重建
      url: asset.url || null, local_path: asset.local_path || null, type: asset.type || 'image',
    })),
    owner_user_id: job.owner_user_id,
  }, billingUser);
}
function resumeSd2WaitingGenerations(db, log) {
  let rows = [];
  try { rows = db.prepare(`SELECT j.*, v.id video_generation_id, v.drama_id, v.storyboard_id, v.status generation_status, u.role user_role
    FROM omni_video_jobs j JOIN video_generations v ON v.id = j.video_generation_id LEFT JOIN users u ON u.id = j.owner_user_id
    WHERE v.status = 'sd2_waiting' AND v.deleted_at IS NULL`).all(); } catch (_) { return; }
  const MAX_WAIT_MS = 10 * 60 * 1000;
  for (const job of rows) {
    let snapshot; try { snapshot = parse(job.request_snapshot_json); } catch (_) { snapshot = null; }
    if (!snapshot?.original_prompt || !Array.isArray(snapshot.assets)) {
      const message = '真人素材认证任务缺少可恢复的请求快照，未提交生成模型；请重新生成。';
      const now = new Date().toISOString();
      db.prepare('UPDATE video_generations SET status=?, error_msg=?, updated_at=? WHERE id=?').run('invalid', message, now, job.video_generation_id);
      if (job.storyboard_id) {
        try { db.prepare("UPDATE storyboards SET status='invalid', error_msg=?, updated_at=? WHERE id=? AND deleted_at IS NULL").run(message, now, job.storyboard_id); } catch (_) {}
      }
      const task = db.prepare('SELECT task_id FROM video_generations WHERE id=?').get(job.video_generation_id);
      if (task?.task_id) taskService.updateTaskError(db, task.task_id, message);
      log.warn('Marked SD2 waiting generation invalid: missing request snapshot', { video_generation_id: job.video_generation_id });
      continue;
    }
    try {
      create(db, log, {
        prompt: snapshot.original_prompt, negative_prompt: snapshot.negative_prompt, model: snapshot.model,
        aspect_ratio: snapshot.aspect_ratio, duration: snapshot.duration, resolution: snapshot.resolution,
        upscale_resolution: snapshot.upscale_resolution, target_fps: snapshot.target_fps,
        creation_mode: snapshot.creation_mode, prompt_document: snapshot.prompt_document, audio_strategy: snapshot.audio_strategy,
        keep_original_audio: snapshot.post_process?.keep_original_audio, audio_volume: snapshot.post_process?.audio_volume, audio_fade_seconds: snapshot.post_process?.audio_fade_seconds,
        drama_id: job.drama_id || undefined, sequence_id: job.sequence_id || undefined, shot_id: job.shot_id || undefined, storyboard_id: job.storyboard_id || undefined,
        assets: snapshot.assets.map((asset) => ({ asset_id: asset.asset_id, alias: asset.alias, role: asset.role, usage: asset.usage, ordinal: asset.ordinal, send_to_model: asset.send_to_model, url: asset.url || null, local_path: asset.local_path || null, type: asset.type || 'image' })),
        owner_user_id: job.owner_user_id, __sd2_waiting_generation_id: job.video_generation_id,
      }, { id: job.owner_user_id, role: job.user_role || 'user' });
    } catch (error) {
      // Still processing is normal; only terminal certification failures should
      // surface to the user, and never create a billing authorization.  A
      // non-terminal recovery error used to be logged forever every five
      // seconds, leaving a user permanently "generating".  Bound recovery
      // time and make the next user action explicit instead.
      const ageMs = Date.now() - Date.parse(job.created_at || job.updated_at || 0);
      if (/SD2/.test(String(error.message || '')) || Number.isNaN(ageMs) || ageMs >= MAX_WAIT_MS) {
        const status = /SD2/.test(String(error.message || '')) ? 'failed' : 'retryable';
        const message = status === 'retryable'
          ? `真人素材认证准备超过 10 分钟仍未恢复：${String(error.message || '未知错误').slice(0, 350)}。原请求未提交模型，可重新生成。`
          : error.message;
        const now = new Date().toISOString();
        db.prepare('UPDATE video_generations SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?').run(status, message, now, job.video_generation_id);
        if (job.storyboard_id) {
          try { db.prepare('UPDATE storyboards SET status=?, error_msg=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(status, message, now, job.storyboard_id); } catch (_) {}
        }
        const task = db.prepare('SELECT task_id FROM video_generations WHERE id = ?').get(job.video_generation_id);
        if (task?.task_id) taskService.updateTaskError(db, task.task_id, message);
        log.warn('Marked SD2 waiting generation terminal', { video_generation_id: job.video_generation_id, status, error: error.message });
      } else log.warn('SD2 waiting generation resume failed', { video_generation_id: job.video_generation_id, error: error.message });
    }
  }
}
function startSd2WaitingGenerationRecovery(db, log) {
  const run = () => resumeSd2WaitingGenerations(db, log);
  setImmediate(run);
  const timer = setInterval(run, 5_000); if (typeof timer.unref === 'function') timer.unref();
  return { runNow: run, stop: () => clearInterval(timer) };
}
function parse(value) { try { return value ? JSON.parse(value) : null; } catch (_) { return null; } }
function clamp(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
module.exports = { create, get, list, retry, retryPostprocess, adoptSourceVideo, adoptCompletedVersion, resumeSd2WaitingGenerations, startSd2WaitingGenerationRecovery, buildAuthorizationUsage, validateShotAssetLimits, assetLimitsForCapability, validateCreationMode, enforceSd2IdentityAssets, applySd2CertifiedAssetReferences, sd2IdentityState, safeAssetSummary, safeSnapshot, promptReferenceEntries, prioritizePromptReferenceAssets, bindPromptReferences, SHOT_ASSET_LIMITS };
