const taskService = require('./taskService');
const videoService = require('./videoService');
const capabilityService = require('./videoModelCapabilities');

const IMAGE_USAGES = new Set(['primary', 'identity', 'environment', 'style', 'prop', 'first_frame', 'last_frame', 'reference']);

function create(db, log, body) {
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new Error('提示词不能为空');
  const input = Array.isArray(body.assets) ? body.assets : [];
  if (input.length > 12) throw new Error('一次创作最多使用 12 个素材');
  const assets = input.map((entry, ordinal) => resolveAsset(db, entry, ordinal));
  const capability = capabilityService.resolve(db, body.model, assets);
  if (!capability.model) throw new Error('请先在 AI 配置中启用视频模型');
  const routed = routeAssets(expandVideoReferences(db, log, assets, capability.supports), capability.supports, body.audio_strategy);
  enforceSd2IdentityAssets(routed, capability);
  const now = new Date().toISOString();
  const task = taskService.createTask(db, log, 'video_generation', '');
  const imageUrls = routed.filter((asset) => asset.send_to_model && asset.type === 'image').map((asset) => asset.model_url || asset.local_path || asset.url).filter(Boolean);
  const first = routed.find((asset) => asset.usage === 'first_frame' && asset.send_to_model);
  const last = routed.find((asset) => asset.usage === 'last_frame' && asset.send_to_model);
  const result = db.prepare(`INSERT INTO video_generations (drama_id, provider, prompt, model, duration, aspect_ratio, resolution, seed, camera_fixed, watermark, image_url, first_frame_url, last_frame_url, reference_image_urls, status, task_id, created_at, updated_at)
    VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)`)
    .run(body.provider || 'chatfire', prompt, capability.model, Number(body.duration) || null, body.aspect_ratio || null, body.resolution || null,
      body.seed != null ? Number(body.seed) : null, body.camera_fixed ? 1 : 0, body.watermark ? 1 : 0,
      imageUrls[0] || null, first?.model_url || first?.local_path || first?.url || null, last?.model_url || last?.local_path || last?.url || null,
      imageUrls.length ? JSON.stringify(imageUrls) : null, task.id, now, now);
  const videoGenerationId = Number(result.lastInsertRowid);
  const postProcess = { keep_original_audio: !!body.keep_original_audio, audio_volume: clamp(body.audio_volume, 0, 2, 1), audio_fade_seconds: clamp(body.audio_fade_seconds, 0, 10, 0) };
  const requestSnapshot = { prompt, negative_prompt: body.negative_prompt || '', model: capability.model, aspect_ratio: body.aspect_ratio || null, duration: body.duration || null, resolution: body.resolution || null, audio_strategy: body.audio_strategy || 'reference_only', post_process: postProcess, assets: routed.map(publicAsset) };
  const job = db.prepare(`INSERT INTO omni_video_jobs (video_generation_id, prompt, negative_prompt, model_requested, model_resolved, capability_snapshot_json, request_snapshot_json, preprocess_snapshot_json, input_summary_json, audio_strategy, sequence_id, shot_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(videoGenerationId, prompt, body.negative_prompt || null, body.model || 'auto', capability.model,
      JSON.stringify({ supports: capability.supports, limits: capability.limits, reason: capability.reason }), JSON.stringify(requestSnapshot),
      JSON.stringify(routed.filter((asset) => asset.strategy !== 'native').map(publicAsset)), JSON.stringify(buildSummary(routed)), body.audio_strategy || 'reference_only',
      body.sequence_id ? Number(body.sequence_id) : null, body.shot_id ? Number(body.shot_id) : null, now, now);
  const jobId = Number(job.lastInsertRowid);
  const insertAsset = db.prepare(`INSERT INTO omni_video_job_assets (omni_job_id, asset_id, ordinal, alias, media_type, role, usage, send_to_model, derived_asset_id, snapshot_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const asset of routed) insertAsset.run(jobId, asset.id, asset.ordinal, asset.alias, asset.type, asset.role, asset.usage, asset.send_to_model ? 1 : 0, null, JSON.stringify(publicAsset(asset)), now);
  if (body.shot_id && body.sequence_id) {
    const shot = db.prepare('SELECT id FROM omni_video_sequence_shots WHERE id = ? AND sequence_id = ? AND deleted_at IS NULL').get(Number(body.shot_id), Number(body.sequence_id));
    if (shot) db.prepare('UPDATE omni_video_sequence_shots SET omni_job_id = ?, prompt = ?, assets_json = ?, settings_json = ?, updated_at = ? WHERE id = ?').run(
      jobId, prompt, JSON.stringify(routed.map(publicAsset)), JSON.stringify({ model: body.model || 'auto', aspect_ratio: body.aspect_ratio || '16:9', duration: Math.min(15, Number(body.duration) || 5), resolution: body.resolution || null, audio_strategy: body.audio_strategy || 'reference_only' }), now, shot.id);
  }
  setImmediate(() => videoService.processVideoGeneration(db, log, videoGenerationId));
  return { omni_job_id: jobId, video_generation_id: videoGenerationId, task_id: task.id, status: 'processing', resolved_model: capability.model, routing_summary: buildSummary(routed) };
}

function resolveAsset(db, input, ordinal) {
  const row = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(input.asset_id));
  if (!row) throw new Error(`素材 ${input.asset_id} 不存在或已删除`);
  if (row.processing_status && row.processing_status !== 'ready') throw new Error(`素材“${row.name || row.id}”尚未准备完成`);
  let seedance2_asset = null; try { seedance2_asset = row.seedance2_asset ? JSON.parse(row.seedance2_asset) : null; } catch (_) {}
  return { ...row, seedance2_asset, id: row.id, type: row.type, ordinal: Number(input.ordinal) || ordinal + 1, alias: String(input.alias || row.name || `素材${row.id}`).slice(0, 80), role: input.role || 'reference', usage: input.usage || 'reference', requested_send: input.send_to_model !== false };
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
    const certified = asset.seedance2_asset && String(asset.seedance2_asset.status || '').toLowerCase() === 'active' && String(asset.seedance2_asset.asset_url || '').startsWith('asset://');
    return { ...asset, model_url: certified ? asset.seedance2_asset.asset_url : (asset.local_path || asset.url), send_to_model: send, strategy };
  });
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
function enforceSd2IdentityAssets(assets, capability) {
  if (!isSeedanceCapability(capability)) return;
  const invalid = assets.filter((asset) => asset.type === 'image' && asset.usage === 'identity' && asset.send_to_model && !(asset.seedance2_asset && String(asset.seedance2_asset.status || '').toLowerCase() === 'active' && String(asset.seedance2_asset.asset_url || '').startsWith('asset://')));
  if (invalid.length) throw new Error(`人物一致性素材必须先完成 SD2 认证：${invalid.map((asset) => asset.alias).join('、')}`);
}
function publicAsset(asset) { return { asset_id: asset.id, alias: asset.alias, type: asset.type, role: asset.role, usage: asset.usage, ordinal: asset.ordinal, local_path: asset.local_path, url: asset.url, model_url: asset.model_url || null, seedance2_asset: asset.seedance2_asset || null, checksum: asset.checksum || null, send_to_model: !!asset.send_to_model, strategy: asset.strategy }; }
function buildSummary(assets) { return { sent_to_model: assets.filter((a) => a.send_to_model).map(publicAsset), post_process_or_preprocess: assets.filter((a) => !a.send_to_model).map(publicAsset) }; }

function get(db, id) {
  const job = db.prepare('SELECT * FROM omni_video_jobs WHERE id = ?').get(Number(id));
  if (!job) return null;
  const generation = db.prepare('SELECT * FROM video_generations WHERE id = ?').get(job.video_generation_id);
  const assets = db.prepare('SELECT * FROM omni_video_job_assets WHERE omni_job_id = ? ORDER BY ordinal').all(job.id);
  return { ...job, capability_snapshot: parse(job.capability_snapshot_json), request_snapshot: parse(job.request_snapshot_json), input_summary: parse(job.input_summary_json), assets: assets.map((asset) => ({ ...asset, snapshot: parse(asset.snapshot_json) })), generation };
}
function list(db) {
  return db.prepare(`SELECT j.*, v.status, v.video_url, v.local_path, v.error_msg
    FROM omni_video_jobs j JOIN video_generations v ON v.id = j.video_generation_id
    ORDER BY j.id DESC LIMIT 100`).all().map((item) => ({ ...item, request_snapshot: parse(item.request_snapshot_json) }));
}
function retry(db, log, id) {
  const job = db.prepare('SELECT * FROM omni_video_jobs WHERE id = ?').get(Number(id));
  if (!job) throw new Error('全能视频任务不存在');
  const generation = db.prepare('SELECT status FROM video_generations WHERE id = ?').get(job.video_generation_id);
  if (!generation || generation.status !== 'retryable') throw new Error('只有重启中断且可重试的任务可以重试');
  const snapshot = parse(job.request_snapshot_json);
  if (!snapshot?.prompt || !Array.isArray(snapshot.assets) || !snapshot.assets.length) throw new Error('该任务没有可重试的完整请求快照');
  return create(db, log, {
    prompt: snapshot.prompt, negative_prompt: snapshot.negative_prompt, model: snapshot.model,
    aspect_ratio: snapshot.aspect_ratio, duration: snapshot.duration, resolution: snapshot.resolution,
    audio_strategy: snapshot.audio_strategy, keep_original_audio: snapshot.post_process?.keep_original_audio,
    audio_volume: snapshot.post_process?.audio_volume, audio_fade_seconds: snapshot.post_process?.audio_fade_seconds,
    assets: snapshot.assets.map((asset) => ({ asset_id: asset.asset_id, alias: asset.alias, role: asset.role, usage: asset.usage, ordinal: asset.ordinal, send_to_model: asset.send_to_model })),
  });
}
function parse(value) { try { return value ? JSON.parse(value) : null; } catch (_) { return null; } }
function clamp(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
module.exports = { create, get, list, retry };
