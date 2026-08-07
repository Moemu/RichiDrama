const taskService = require('./taskService');
const videoService = require('./videoService');
const capabilityService = require('./videoModelCapabilities');
const SHOT_ASSET_LIMITS = { total: 12, image: 9, video: 3, audio: 3 };

const IMAGE_USAGES = new Set(['primary', 'identity', 'environment', 'style', 'prop', 'first_frame', 'last_frame', 'reference']);

function create(db, log, body) {
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new Error('提示词不能为空');
  const input = Array.isArray(body.assets) ? body.assets : [];
  if (input.length > 12) throw new Error('一次创作最多使用 12 个素材');
  const assets = prioritizePromptReferenceAssets(input.map((entry, ordinal) => resolveAsset(db, entry, ordinal)), body.prompt_document, prompt);
  validateShotAssetLimits(assets);
  const capability = capabilityService.resolve(db, body.model, assets);
  if (!capability.model) throw new Error('请先在 AI 配置中启用视频模型');
  const creationMode = body.creation_mode || body.settings?.creation_mode || 'multi_reference';
  validateCreationMode(creationMode, assets, capability);
  const routed = routeAssets(expandVideoReferences(db, log, assets, capability.supports), capability.supports, body.audio_strategy);
  enforceSd2IdentityAssets(routed, capability, log);
  const modelPrompt = bindPromptReferences(prompt, body.prompt_document, routed);
  const now = new Date().toISOString();
  const task = taskService.createTask(db, log, 'video_generation', '');
  const imageUrls = routed.filter((asset) => asset.send_to_model && asset.type === 'image').map((asset) => asset.model_url || asset.local_path || asset.url).filter(Boolean);
  const first = routed.find((asset) => asset.usage === 'first_frame' && asset.send_to_model);
  const last = routed.find((asset) => asset.usage === 'last_frame' && asset.send_to_model);
  const result = db.prepare(`INSERT INTO video_generations (drama_id, storyboard_id, provider, prompt, model, duration, aspect_ratio, resolution, seed, camera_fixed, watermark, image_url, first_frame_url, last_frame_url, reference_image_urls, status, task_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)`)
    .run(Number(body.drama_id) || 0, body.storyboard_id ? Number(body.storyboard_id) : null, body.provider || 'chatfire', modelPrompt, capability.model, Number(body.duration) || null, body.aspect_ratio || null, body.resolution || null,
      body.seed != null ? Number(body.seed) : null, body.camera_fixed ? 1 : 0, body.watermark ? 1 : 0,
      imageUrls[0] || null, first?.model_url || first?.local_path || first?.url || null, last?.model_url || last?.local_path || last?.url || null,
      imageUrls.length ? JSON.stringify(imageUrls) : null, task.id, now, now);
  const videoGenerationId = Number(result.lastInsertRowid);
  const postProcess = { keep_original_audio: !!body.keep_original_audio, audio_volume: clamp(body.audio_volume, 0, 2, 1), audio_fade_seconds: clamp(body.audio_fade_seconds, 0, 10, 0) };
  const requestSnapshot = { prompt: modelPrompt, original_prompt: prompt, prompt_document: body.prompt_document || null, negative_prompt: body.negative_prompt || '', creation_mode: creationMode, model: capability.model, aspect_ratio: body.aspect_ratio || null, duration: body.duration || null, resolution: body.resolution || null, audio_strategy: body.audio_strategy || 'reference_only', post_process: postProcess, assets: routed.map(publicAsset) };
  const job = db.prepare(`INSERT INTO omni_video_jobs (video_generation_id, prompt, negative_prompt, model_requested, model_resolved, capability_snapshot_json, request_snapshot_json, preprocess_snapshot_json, input_summary_json, audio_strategy, sequence_id, shot_id, storyboard_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(videoGenerationId, modelPrompt, body.negative_prompt || null, body.model || 'auto', capability.model,
      JSON.stringify({ supports: capability.supports, limits: capability.limits, reason: capability.reason }), JSON.stringify(requestSnapshot),
      JSON.stringify(routed.filter((asset) => asset.strategy !== 'native').map(publicAsset)), JSON.stringify(buildSummary(routed)), body.audio_strategy || 'reference_only',
      body.sequence_id ? Number(body.sequence_id) : null, body.shot_id ? Number(body.shot_id) : null, body.storyboard_id ? Number(body.storyboard_id) : null, now, now);
  const jobId = Number(job.lastInsertRowid);
  const insertAsset = db.prepare(`INSERT INTO omni_video_job_assets (omni_job_id, asset_id, ordinal, alias, media_type, role, usage, send_to_model, derived_asset_id, snapshot_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const asset of routed) insertAsset.run(jobId, asset.id, asset.ordinal, asset.alias, asset.type, asset.role, asset.usage, asset.send_to_model ? 1 : 0, null, JSON.stringify(publicAsset(asset)), now);
  if (body.shot_id && body.sequence_id) {
    const shot = db.prepare('SELECT id FROM omni_video_sequence_shots WHERE id = ? AND sequence_id = ? AND deleted_at IS NULL').get(Number(body.shot_id), Number(body.sequence_id));
    if (shot) db.prepare('UPDATE omni_video_sequence_shots SET omni_job_id = ?, prompt = ?, prompt_document_json = ?, assets_json = ?, settings_json = ?, updated_at = ? WHERE id = ?').run(
      jobId, modelPrompt, body.prompt_document ? JSON.stringify(body.prompt_document) : null, JSON.stringify(routed.map(publicAsset)), JSON.stringify({ model: body.model || 'auto', creation_mode: creationMode, aspect_ratio: body.aspect_ratio || '16:9', duration: Math.min(15, Number(body.duration) || 5), resolution: body.resolution || null, audio_strategy: body.audio_strategy || 'reference_only' }), now, shot.id);
  }
  setImmediate(() => videoService.processVideoGeneration(db, log, videoGenerationId));
  return { omni_job_id: jobId, video_generation_id: videoGenerationId, task_id: task.id, status: 'processing', resolved_model: capability.model, routing_summary: buildSummary(routed) };
}

function resolveAsset(db, input, ordinal) {
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
  const maxImages = Number(supports.image_reference?.max || 0);
  let imageCount = 0;
  return assets.map((asset) => {
    let send = asset.requested_send;
    let strategy = 'native';
    if (asset.type === 'image') { send = send && imageCount < maxImages; if (send) imageCount++; if (!send) strategy = 'not_supported'; }
    if (asset.type === 'audio') { send = send && !!supports.audio_reference && audioStrategy !== 'post_mix'; strategy = send ? 'native' : 'post_mix'; }
    if (asset.type === 'video') { send = send && !!supports.video_reference; strategy = send ? 'native' : 'keyframe_or_post'; }
    const certified = asset.type === 'image'
      && asset.requires_sd2_identity
      && asset.seedance2_asset
      && String(asset.seedance2_asset.status || '').toLowerCase() === 'active'
      && String(asset.seedance2_asset.asset_url || '').startsWith('asset://');
    return { ...asset, model_url: certified ? asset.seedance2_asset.asset_url : (asset.local_path || asset.url), send_to_model: send, strategy };
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

function validateShotAssetLimits(assets) {
  const counts = assets.reduce((result, asset) => {
    if (Object.prototype.hasOwnProperty.call(SHOT_ASSET_LIMITS, asset.type)) result[asset.type] += 1;
    return result;
  }, { image: 0, video: 0, audio: 0 });
  for (const type of ['image', 'video', 'audio']) {
    if (counts[type] > SHOT_ASSET_LIMITS[type]) {
      throw new Error(`${type} asset count exceeds the per-shot limit of ${SHOT_ASSET_LIMITS[type]}`);
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

function isSeedanceCapability(capability) { return /seedance|doubao-seedance/i.test(String(capability?.model || '')) && /volc|volces/i.test(String(capability?.provider || '')); }
function enforceSd2IdentityAssets(assets, capability, log) {
  if (!isSeedanceCapability(capability)) return;
  const undeclared = assets.filter((asset) => asset.type === 'image' && asset.usage === 'identity' && asset.send_to_model && !asset.requires_sd2_identity);
  if (undeclared.length) throw new Error(`人物一致性素材请先勾选“含真人／需要身份一致性”：${undeclared.map((asset) => asset.alias).join('、')}`);
  // 勾选了真人身份一致性的图片若 asset 失效（如更换 ARK/项目/组后旧 asset 在火山侧已不存在），
  // 不再硬阻断生成，而是降级为原始图片 URL，避免 400 “asset not found”。
  // 注意：requires_sd2_identity 与 usage 独立判断（真人图可能被编排为 reference/primary 等任意用途）。
  const invalid = assets.filter((asset) => asset.type === 'image' && asset.send_to_model && asset.requires_sd2_identity && !(asset.seedance2_asset && String(asset.seedance2_asset.status || '').toLowerCase() === 'active' && String(asset.seedance2_asset.asset_url || '').startsWith('asset://')));
  if (invalid.length) {
    invalid.forEach((asset) => { asset.seedance2_asset = null; });
    const names = invalid.map((asset) => asset.alias).join('、');
    if (log && typeof log.warn === 'function') log.warn('[SD2] 以下真人素材认证已失效，本次回退原始图（建议在素材库重新认证）：' + names);
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
  const generation = db.prepare('SELECT * FROM video_generations WHERE id = ?').get(job.video_generation_id);
  const assets = db.prepare('SELECT * FROM omni_video_job_assets WHERE omni_job_id = ? ORDER BY ordinal').all(job.id);
  return { ...job, capability_snapshot: parse(job.capability_snapshot_json), request_snapshot: safeSnapshot(parse(job.request_snapshot_json)), input_summary: parse(job.input_summary_json), assets: assets.map((asset) => ({ ...asset, snapshot: safeAssetSummary(parse(asset.snapshot_json)) })), generation };
}
function list(db, query = {}) {
  const storyboardId = Number(query.storyboard_id);
  const shotId = Number(query.shot_id);
  let sql = `SELECT j.*, v.status, v.video_url, v.local_path, v.error_msg
    FROM omni_video_jobs j JOIN video_generations v ON v.id = j.video_generation_id`;
  const params = [];
  if (Number.isInteger(storyboardId) && storyboardId > 0) {
    // Older jobs predate omni_video_jobs.storyboard_id; recover them through
    // their video generation so existing project history remains visible.
    sql += ' WHERE j.storyboard_id = ? OR (j.storyboard_id IS NULL AND v.storyboard_id = ?)';
    params.push(storyboardId, storyboardId);
  } else if (Number.isInteger(shotId) && shotId > 0) {
    sql += ' WHERE j.shot_id = ?';
    params.push(shotId);
  }
  sql += ' ORDER BY j.id DESC LIMIT 100';
  return db.prepare(sql).all(...params).map((item) => ({ ...item, request_snapshot: safeSnapshot(parse(item.request_snapshot_json)) }));
}
function retry(db, log, id) {
  const job = db.prepare('SELECT * FROM omni_video_jobs WHERE id = ?').get(Number(id));
  if (!job) throw new Error('全能视频任务不存在');
  const generation = db.prepare('SELECT status, drama_id, storyboard_id FROM video_generations WHERE id = ?').get(job.video_generation_id);
  if (!generation || generation.status !== 'retryable') throw new Error('只有重启中断且可重试的任务可以重试');
  const snapshot = parse(job.request_snapshot_json);
  if (!snapshot?.prompt || !Array.isArray(snapshot.assets) || !snapshot.assets.length) throw new Error('该任务没有可重试的完整请求快照');
  return create(db, log, {
    prompt: snapshot.prompt, negative_prompt: snapshot.negative_prompt, model: snapshot.model,
    aspect_ratio: snapshot.aspect_ratio, duration: snapshot.duration, resolution: snapshot.resolution,
    creation_mode: snapshot.creation_mode, prompt_document: snapshot.prompt_document, audio_strategy: snapshot.audio_strategy, keep_original_audio: snapshot.post_process?.keep_original_audio,
    audio_volume: snapshot.post_process?.audio_volume, audio_fade_seconds: snapshot.post_process?.audio_fade_seconds,
    drama_id: generation.drama_id || undefined,
    sequence_id: job.sequence_id || undefined, shot_id: job.shot_id || undefined, storyboard_id: job.storyboard_id || generation.storyboard_id || undefined,
    assets: snapshot.assets.map((asset) => ({
      asset_id: asset.asset_id, alias: asset.alias, role: asset.role, usage: asset.usage, ordinal: asset.ordinal, send_to_model: asset.send_to_model,
      // 外部引用条目（场景/角色/道具等非素材库图片）依赖 url / local_path / type 重建
      url: asset.url || null, local_path: asset.local_path || null, type: asset.type || 'image',
    })),
  });
}
function parse(value) { try { return value ? JSON.parse(value) : null; } catch (_) { return null; } }
function clamp(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
module.exports = { create, get, list, retry, validateShotAssetLimits, validateCreationMode, safeAssetSummary, safeSnapshot, promptReferenceEntries, prioritizePromptReferenceAssets, bindPromptReferences, SHOT_ASSET_LIMITS };
