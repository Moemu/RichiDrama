const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { resolveStorageFile } = require('../utils/storagePath');
const assets = require('./assetService');
const billing = require('./billingService');
const operator = require('./lasOperatorClient');
const tos = require('./lasTosBridge');
// 复用视频本地化的 LAS/TOS 专用服务配置与 ffprobe；任务与计费模型保持独立。
const shared = require('./lasMediaJobService');

const running = new Set();
const now = () => new Date().toISOString();
const LEASE_MS = 120_000;
const LEASE_HEARTBEAT_MS = 15_000;
const leaseUntil = () => new Date(Date.now() + LEASE_MS).toISOString();

const BILLING = { service_type: 'video_postprocess', model: 'las-viral-clip-gen', provider: 'las' };
// MVP 小批量上限：官方允许 100 集/2 小时/300 条，第二批验证后再放宽。
const CAPS = Object.freeze({
  max_episodes: 10,
  max_total_input_ms: 30 * 60_000,
  max_total_bytes: 10 * 1024 ** 3,
  max_clip_count: 10,
  min_output_seconds: 5,
  max_output_seconds: 300,
});
const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv']);
const CONTENT_TYPES = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska' };

const PROVIDER_ERRORS = {
  'Parameter.Invalid': '参数不合法', 'Parameter.Missing': '缺少必需参数',
  'Url.Invalid': '视频 URL 无法访问', 'Video.Invalid': '视频文件无效', 'Video.DownloadFailed': '视频下载失败',
  'Video.FormatUnsupported': '视频格式不支持', 'Video.DurationTooShort': '视频时长过短', 'Video.DurationExceeded': '视频时长超限',
  'Video.FileTooLarge': '视频文件过大', 'Video.Timeout': '视频处理超时', 'Video.UploadFailed': '视频上传失败',
  'Video.ClipFailed': '视频剪辑提取失败', 'Video.ModelFailed': '视觉模型调用失败', 'Video.FrameExtractionFailed': '视频帧提取失败',
  'Tos.AccessFailed': 'TOS 路径访问失败', 'Connection.TooMany': '供应商并发限流',
  'ViralClipGen.AsrFailed': '语音识别失败', 'ViralClipGen.SceneFailed': '场景检测失败', 'ViralClipGen.ScriptFailed': '剧本生成失败',
  'ViralClipGen.BoundaryFailed': '剧集边界检测失败', 'ViralClipGen.SubtitleFailed': '内嵌字幕 OCR 失败',
  'ViralClipGen.ReviewFailed': '片段审核失败', 'ViralClipGen.JumpcutFailed': '跳剪方案生成失败', 'ViralClipGen.RenderFailed': '片段渲染上传失败',
  'Authorization.Missing': '缺少鉴权', 'ApiKey.InValid': 'API Key 无效', 'InternalError': '供应商内部错误',
};

function translateProviderError(businessCode, errorMsg) {
  const label = PROVIDER_ERRORS[String(businessCode || '')] || '';
  return [businessCode && String(businessCode), label, errorMsg && String(errorMsg).slice(0, 200)].filter(Boolean).join(' ');
}

// 输出分辨率与输入一致；码率按官方分档取中值，由实测短边映射，不让运营猜数。
function bitrateFor(width, height) {
  const shortEdge = Math.min(width, height);
  if (shortEdge <= 360) return 650;
  if (shortEdge <= 480) return 1000;
  if (shortEdge <= 720) return 2000;
  return 4000;
}

function integerInRange(value, min, max, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`LAS 投流剪辑：${label}须在 ${min}–${max} 之间`);
  return number;
}

function validateParams(body = {}) {
  const mode = String(body.mode || '');
  if (!['sequential', 'jump_cut'].includes(mode)) throw new Error('LAS 投流剪辑：剪辑模式仅支持顺剪（sequential）或跳剪（jump_cut）');
  const minClip = integerInRange(body.min_clip_duration, CAPS.min_output_seconds, CAPS.max_output_seconds, '单条最短时长（秒）');
  const maxClip = integerInRange(body.max_clip_duration, CAPS.min_output_seconds, CAPS.max_output_seconds, '单条最长时长（秒）');
  if (maxClip < minClip) throw new Error('LAS 投流剪辑：单条时长上限不能小于下限');
  const count = integerInRange(body.max_clip_count, 1, CAPS.max_clip_count, '目标素材条数');
  if (body.preset_intro != null && typeof body.preset_intro !== 'boolean') throw new Error('LAS 投流剪辑：精彩前置开关无效');
  const aspectRatio = body.aspect_ratio == null || body.aspect_ratio === '' ? null : String(body.aspect_ratio);
  if (aspectRatio != null && aspectRatio !== '9:16') throw new Error('LAS 投流剪辑：输出画幅当前仅支持 9:16');
  return { mode, min_clip_duration: minClip, max_clip_duration: maxClip, max_clip_count: count, preset_intro: body.preset_intro === true, aspect_ratio: aspectRatio };
}

// 输入硬校验：官方约束 + MVP 上限，全部基于 ffprobe 与落盘字节实测。
function validateInputs(episodes) {
  if (!episodes.length || episodes.length > CAPS.max_episodes) throw new Error(`投流剪辑需要 1–${CAPS.max_episodes} 集（MVP 上限）已归档视频`);
  const seen = new Set(episodes.map((episode) => episode.asset_id));
  if (seen.size !== episodes.length) throw new Error('同一素材不能重复作为输入剧集');
  let totalMs = 0;
  let totalBytes = 0;
  for (const episode of episodes) {
    if (episode.durationMs < 1_000 || episode.durationMs > 600_000) throw new Error(`第 ${episode.seq} 集时长须在第 1 秒至 10 分钟之间`);
    const shortEdge = Math.min(episode.width, episode.height);
    const longEdge = Math.max(episode.width, episode.height);
    if (shortEdge < 360 || shortEdge > 1080 || longEdge > 1920) throw new Error(`第 ${episode.seq} 集分辨率不在 360x640 至 1080x1920 支持范围内`);
    totalMs += episode.durationMs;
    totalBytes += Number(episode.bytes || 0);
  }
  const { width, height } = episodes[0];
  if (episodes.some((episode) => episode.width !== width || episode.height !== height)) throw new Error('所有输入剧集的分辨率必须完全一致');
  if (totalMs > CAPS.max_total_input_ms) throw new Error(`投流剪辑输入总时长不能超过 ${CAPS.max_total_input_ms / 60_000} 分钟（MVP 上限）`);
  if (totalBytes > CAPS.max_total_bytes) throw new Error('投流剪辑输入总大小不能超过 10GB');
  return { total_input_ms: totalMs, total_bytes: totalBytes, resolution: { width, height }, video_bitrate_kbps: bitrateFor(width, height) };
}

function reservedUsage(totals, params) {
  // 冻结额取最坏情况：全部输入按分析价 + count×max_duration 按合成价。
  return { millisecond: totals.total_input_ms, second: params.max_clip_count * params.max_clip_duration };
}

function plannedInputKeys(jobId, count) {
  return Array.from({ length: count }, (_, index) => tos.objectKey(jobId, 'input', `ep${index + 1}.mp4`));
}

// 官方 schema 把 storyboard_json_path 放在 script 下，返回示例又出现在 data 顶层，两处都要接受。
function parseViralResult(data, outputPrefix) {
  const clips = Array.isArray(data?.clips) ? data.clips : [];
  const parsed = clips.map((clip, index) => {
    const tosPath = String(clip.url || '');
    if (!tosPath.startsWith(outputPrefix) || tosPath.includes('?')) throw new Error('LAS 投流剪辑输出不在本任务的 TOS 前缀内，等待人工对账');
    return {
      clip_index: index + 1,
      provider_clip_id: String(clip.id || `clip_${String(index + 1).padStart(3, '0')}`).slice(0, 80),
      tos_path: tosPath,
      provider_duration_sec: Number.isFinite(Number(clip.duration)) ? Number(clip.duration) : null,
      segment_count: Number.isFinite(Number(clip.segment_count)) ? Number(clip.segment_count) : null,
      timeline: Array.isArray(clip.timeline) ? clip.timeline : [],
    };
  });
  const storyboardPath = String(data?.script?.storyboard_json_path || data?.storyboard_json_path || '');
  return {
    total_clips: Number(data?.total_clips) || parsed.length,
    clips: parsed,
    storyboard_path: storyboardPath.startsWith('tos://') ? storyboardPath : null,
    segments: Array.isArray(data?.storyboard) ? data.storyboard : [],
    videos: Array.isArray(data?.videos) ? data.videos : [],
  };
}

function summarizeClipRating(clip, segments) {
  const byId = new Map(segments.map((segment) => [String(segment.id), segment]));
  const counts = { S: 0, A: 0, B: 0, C: 0 };
  const tags = new Map();
  const scores = [];
  const used = new Set();
  for (const ref of clip.timeline || []) {
    const segment = byId.get(String(ref.ref));
    if (!segment || used.has(String(ref.ref))) continue;
    used.add(String(ref.ref));
    if (counts[segment.rating] != null) counts[segment.rating] += 1;
    if (Number.isFinite(Number(segment.highlight_score))) scores.push(Number(segment.highlight_score));
    for (const tag of Array.isArray(segment.function_tags) ? segment.function_tags : []) tags.set(String(tag), (tags.get(String(tag)) || 0) + 1);
  }
  const top = [...used].map((id) => byId.get(id))
    .sort((left, right) => Number(right.highlight_score || 0) - Number(left.highlight_score || 0))
    .slice(0, 3)
    .map((segment) => ({ id: String(segment.id), rating: segment.rating || null, highlight_score: Number(segment.highlight_score ?? null), content_desc: String(segment.content_desc || '').slice(0, 120) }));
  return {
    rating_counts: counts,
    avg_highlight_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    top_tags: [...tags.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6).map(([tag]) => tag),
    top_segments: top,
  };
}

// 分镜评级随时间线条目一起落库：列表接口不必再回带整份 storyboard。
function enrichTimeline(timeline, segments) {
  const byId = new Map(segments.map((segment) => [String(segment.id), segment]));
  return (timeline || []).map((ref) => {
    const segment = byId.get(String(ref.ref));
    return {
      ...ref,
      ...(segment ? {
        rating: segment.rating || null,
        highlight_score: Number.isFinite(Number(segment.highlight_score)) ? Number(segment.highlight_score) : null,
        content_desc: String(segment.content_desc || '').slice(0, 120),
      } : {}),
    };
  });
}

function serviceConfig(db) {
  return shared.serviceConfig(db);
}

function storageRoot(cfg) {
  return shared.storageRoot(cfg);
}

function publicJob(row) {
  return {
    id: row.id, drama_id: row.drama_id, status: row.status,
    params: JSON.parse(row.params_json),
    input: JSON.parse(row.input_json),
    storyboard_url: row.storyboard_local_path ? `/static/${row.storyboard_local_path}` : null,
    error_msg: row.error_msg, created_at: row.created_at, updated_at: row.updated_at,
    authorization_id: row.authorization_id || null,
    provider_task_id: row.provider_task_id || null,
    submitted_at: row.submitted_at || null, completed_at: row.completed_at || null,
    tos: { policy: row.tos_policy || null, cleanup_at: row.tos_cleanup_at || null, cleanup_attempts: Number(row.tos_cleanup_attempts || 0) },
  };
}

const CREDITS_PER_MICRO = 10000;

function billingState(row, ledger) {
  if (ledger.settlement != null) return 'settled';
  if (ledger.void != null) return 'released';
  if (row.status === 'reconciliation') return 'reconciling';
  return 'frozen';
}

function billingLedgers(db, rows) {
  const authIds = [...new Set(rows.map((row) => row.authorization_id).filter(Boolean))];
  const byAuth = new Map();
  if (!authIds.length) return byAuth;
  const placeholders = authIds.map(() => '?').join(',');
  const charged = db.prepare(`SELECT authorization_id, SUM(charged_micro) AS charged_micro FROM billing_usage_logs
    WHERE authorization_id IN (${placeholders}) GROUP BY authorization_id`).all(...authIds);
  for (const row of db.prepare(`SELECT authorization_id, type, amount_micro FROM billing_transactions
    WHERE authorization_id IN (${placeholders}) AND type IN ('authorization', 'settlement', 'void')`).all(...authIds)) {
    const entry = byAuth.get(row.authorization_id) || {};
    entry[row.type] = row.amount_micro;
    byAuth.set(row.authorization_id, entry);
  }
  for (const row of charged) {
    const entry = byAuth.get(row.authorization_id) || {};
    entry.charged_micro = row.charged_micro;
    byAuth.set(row.authorization_id, entry);
  }
  return byAuth;
}

function decorate(db, rows) {
  if (!rows.length) return [];
  const ledgers = billingLedgers(db, rows);
  const jobIds = rows.map((row) => row.id);
  const outputs = db.prepare(`SELECT * FROM viral_edit_outputs WHERE job_id IN (${jobIds.map(() => '?').join(',')}) ORDER BY job_id, clip_index`).all(...jobIds);
  const byJob = new Map();
  for (const output of outputs) {
    const list = byJob.get(output.job_id) || [];
    list.push(outputToItem(output, db));
    byJob.set(output.job_id, list);
  }
  const assetIds = [...new Set(rows.flatMap((row) => JSON.parse(row.input_json).episodes.map((episode) => episode.asset_id)))];
  const names = new Map(assetIds.length
    ? db.prepare(`SELECT id, name FROM assets WHERE id IN (${assetIds.map(() => '?').join(',')})`).all(...assetIds).map((asset) => [asset.id, asset.name])
    : []);
  return rows.map((row) => {
    const ledger = ledgers.get(row.authorization_id) || {};
    const state = billingState(row, ledger);
    const input = JSON.parse(row.input_json);
    return {
      ...publicJob(row),
      episodes: input.episodes.map((episode) => ({ ...episode, asset_name: names.get(episode.asset_id) || null })),
      outputs: byJob.get(row.id) || [],
      billing: {
        state,
        reserved_credits: ledger.authorization != null ? ledger.authorization / CREDITS_PER_MICRO : null,
        charged_credits: state === 'settled' && ledger.charged_micro != null ? ledger.charged_micro / CREDITS_PER_MICRO : null,
      },
    };
  });
}

function outputToItem(output, db) {
  let assetName = null;
  if (output.asset_id && db) assetName = db.prepare('SELECT name FROM assets WHERE id=?').get(output.asset_id)?.name || null;
  return {
    clip_index: output.clip_index, provider_clip_id: output.provider_clip_id, status: output.status,
    url: output.local_path ? `/static/${output.local_path}` : null,
    duration_ms: output.duration_ms, provider_duration_sec: output.provider_duration_sec,
    file_size: output.file_size, width: output.width, height: output.height,
    timeline: JSON.parse(output.timeline_json || '[]'),
    rating_summary: JSON.parse(output.rating_summary_json || '{}'),
    asset_id: output.asset_id || null, asset_name: assetName,
  };
}

function get(db, ownerId, id) {
  const row = db.prepare('SELECT * FROM viral_edit_jobs WHERE id=? AND owner_user_id=?').get(id, ownerId);
  return row ? decorate(db, [row])[0] : null;
}

function list(db, ownerId, dramaId) {
  return decorate(db, db.prepare('SELECT * FROM viral_edit_jobs WHERE owner_user_id=? AND drama_id=? ORDER BY created_at DESC LIMIT 100').all(ownerId, dramaId));
}

async function loadValidatedInputs(db, cfg, ownerId, dramaId, assetIds) {
  const access = require('./projectAccessService').access(db, dramaId, ownerId);
  if (!access?.can_edit) throw new Error('项目不存在或没有编辑权限');
  const root = storageRoot(cfg);
  const episodes = [];
  for (const [index, rawId] of assetIds.entries()) {
    const assetId = Number(rawId);
    if (!Number.isInteger(assetId) || assetId <= 0) throw new Error('视频素材 ID 必填');
    const source = assets.getByIdForOwner(db, assetId, ownerId);
    if (!source || source.drama_id !== dramaId || source.type !== 'video' || !source.local_path) throw new Error(`第 ${index + 1} 集：请选择该项目已本地归档的视频素材`);
    const extension = path.extname(String(source.local_path)).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`第 ${index + 1} 集：仅支持 mp4/mov/avi/mkv 格式`);
    const localFile = resolveStorageFile(root, source.local_path);
    const bytes = fs.statSync(localFile).size;
    if (bytes > 5 * 1024 ** 3) throw new Error(`第 ${index + 1} 集：单文件超过 5GB，TOS 中转不支持`);
    const media = await shared.probe(localFile);
    episodes.push({
      seq: index + 1, asset_id: assetId, name: source.name,
      local_path: source.local_path, extension,
      durationMs: media.durationMs, width: media.width, height: media.height, bytes,
    });
  }
  const totals = validateInputs(episodes);
  return { episodes, totals };
}

async function quote(db, cfg, ownerId, body) {
  const dramaId = Number(body?.drama_id);
  if (!Number.isInteger(dramaId) || dramaId <= 0) throw new Error('项目 ID 必填');
  if (!Array.isArray(body?.asset_ids)) throw new Error('请选择用于投流剪辑的剧集视频');
  const params = validateParams(body);
  const { episodes, totals } = await loadValidatedInputs(db, cfg, ownerId, dramaId, body.asset_ids);
  const priced = billing.quote(db, { id: ownerId }, {
    ...BILLING, usage: reservedUsage(totals, params), pricing_context: { mode: params.mode },
  });
  return {
    episodes: episodes.map(({ seq, asset_id, name, durationMs }) => ({ seq, asset_id, name, duration_ms: durationMs })),
    totals, params, quote: priced,
  };
}

function readTosObjects(row) {
  try { return JSON.parse(row.tos_objects_json || '{}'); } catch (_) { return {}; }
}

async function create(db, log, cfg, ownerId, body) {
  const key = String(body?.idempotency_key || '').trim();
  if (!key || key.length > 100) throw new Error('请提供有效幂等键');
  const dramaId = Number(body?.drama_id);
  if (!Number.isInteger(dramaId) || dramaId <= 0 || !Array.isArray(body?.asset_ids)) throw new Error('项目和剧集视频列表必填');
  const params = validateParams(body);
  const existing = db.prepare('SELECT * FROM viral_edit_jobs WHERE owner_user_id=? AND idempotency_key=?').get(ownerId, key);
  if (existing) {
    const previous = JSON.parse(existing.input_json);
    const sameEpisodes = previous.episodes.length === body.asset_ids.length
      && previous.episodes.every((episode, index) => Number(body.asset_ids[index]) === episode.asset_id);
    const previousParams = JSON.parse(existing.params_json);
    if (dramaId !== existing.drama_id || !sameEpisodes || JSON.stringify({ ...previousParams, aspect_ratio: previousParams.aspect_ratio || null }) !== JSON.stringify({ ...params, aspect_ratio: params.aspect_ratio || null })) {
      throw new Error('幂等键已用于不同任务');
    }
    return decorate(db, [existing])[0];
  }
  const { episodes, totals } = await loadValidatedInputs(db, cfg, ownerId, dramaId, body.asset_ids);
  const { clientConfig, tosConfig } = serviceConfig(db);
  const id = randomUUID();
  operator.submitPayload(clientConfig, 'viral', {
    job_id: id,
    video_urls: plannedInputKeys(id, episodes.length).map((objectKey) => `tos://${tosConfig.bucket}/${objectKey}`),
    ...params, video_bitrate_kbps: totals.video_bitrate_kbps,
  });
  const input = {
    operator: operator.OPERATORS.viral, episodes, totals,
    media: { durationMs: totals.total_input_ms },
  };
  const actor = { id: ownerId };
  const usage = reservedUsage(totals, params);
  billing.quote(db, actor, { ...BILLING, usage, pricing_context: { mode: params.mode } });
  const at = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO viral_edit_jobs(id,owner_user_id,drama_id,idempotency_key,input_assets_json,params_json,input_json,tos_policy,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?, 'queued',?,?)`).run(
      id, ownerId, dramaId, key,
      JSON.stringify(episodes.map(({ seq, asset_id, local_path, durationMs, bytes, width, height }) => ({ seq, asset_id, local_path, duration_ms: durationMs, bytes, width, height }))),
      JSON.stringify(params), JSON.stringify(input), 'cleanup', at, at,
    );
    const authorization = billing.createAuthorization(db, actor, {
      idempotency_key: `viral:${ownerId}:${key}`, ...BILLING, usage, pricing_context: { mode: params.mode }, drama_id: dramaId,
      reference_type: 'viral_edit_job', reference_id: id, source_kind: 'viral_edit_job', source_id: id,
    });
    db.prepare('UPDATE viral_edit_jobs SET authorization_id=? WHERE id=?').run(authorization.authorization_id, id);
  })();
  setImmediate(() => processJob(db, log, cfg, id).catch((error) => log.error('投流剪辑任务失败', { id, error: error.message })));
  return get(db, ownerId, id);
}

function record(db, id, patch) {
  const allowed = ['status', 'provider_task_id', 'result_json', 'storyboard_local_path', 'error_msg', 'submitted_at', 'completed_at', 'tos_objects_json', 'tos_cleanup_at', 'tos_cleanup_attempts'];
  const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
  if (!entries.length) return;
  const at = now();
  db.prepare(`UPDATE viral_edit_jobs SET ${entries.map(([key]) => `${key}=?`).join(',')}, updated_at=? WHERE id=?`).run(...entries.map(([, value]) => value), at, id);
}

function upsertOutput(db, row) {
  db.prepare(`INSERT INTO viral_edit_outputs(id,job_id,clip_index,owner_user_id,drama_id,provider_clip_id,provider_duration_sec,local_path,file_size,width,height,duration_ms,status,timeline_json,rating_summary_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(job_id,clip_index) DO UPDATE SET provider_clip_id=excluded.provider_clip_id, provider_duration_sec=excluded.provider_duration_sec,
      local_path=excluded.local_path, file_size=excluded.file_size, width=excluded.width, height=excluded.height, duration_ms=excluded.duration_ms,
      status=CASE WHEN viral_edit_outputs.status='saved' THEN 'saved' ELSE excluded.status END,
      timeline_json=excluded.timeline_json, rating_summary_json=excluded.rating_summary_json, updated_at=excluded.updated_at`)
    .run(row.id, row.job_id, row.clip_index, row.owner_user_id, row.drama_id, row.provider_clip_id, row.provider_duration_sec, row.local_path,
      row.file_size, row.width, row.height, row.duration_ms, row.status, row.timeline_json, row.rating_summary_json, now(), now());
}

// 只清理本任务精确登记过的中转对象；历史任务（tos_policy 为 NULL）不动。
// completed 要求本地成片与 storyboard 已落地才能删中转；failed 没有要保护的结果，
// 预授权要么已释放要么经对账处置终结，回收登记清单即可（reconciliation 不删——
// 提交不确定的任务供应商可能仍在读取输入对象）。清理失败不改任务终态。
async function cleanupTransit(db, log, cfg, id) {
  const row = db.prepare('SELECT * FROM viral_edit_jobs WHERE id=?').get(id);
  if (!row || row.tos_policy !== 'cleanup' || row.tos_cleanup_at) return null;
  if (!['completed', 'failed'].includes(row.status)) return null;
  if (Number(row.tos_cleanup_attempts || 0) >= 5) return null;
  const objects = readTosObjects(row);
  const root = storageRoot(cfg);
  const localReady = (relative) => relative && fs.existsSync(resolveStorageFile(root, relative));
  if (row.status === 'completed') {
    const outputs = db.prepare('SELECT * FROM viral_edit_outputs WHERE job_id=? ORDER BY clip_index').all(id);
    if (!outputs.length && Number(JSON.parse(row.result_json || '{}')?.clips?.length || 0)) return null;
    if (outputs.some((output) => !localReady(output.local_path))) return null;
    if (row.storyboard_local_path && !localReady(row.storyboard_local_path)) return null;
  }
  const paths = [
    ...(objects.inputs || []).map((input) => input.path),
    ...(objects.outputs || []).map((output) => output.path),
    objects.storyboard?.path || null,
  ].filter(Boolean);
  if (!paths.length) {
    record(db, id, { tos_cleanup_at: now() });
    return { cleaned: 0 };
  }
  let { tosConfig } = serviceConfig(db);
  let failures = 0;
  for (const objectPath of paths) {
    try { await tos.remove(tosConfig, objectPath); }
    catch (error) { failures += 1; log.warn('投流剪辑中转对象清理失败，等待重试', { id, path: objectPath, error: error.message }); }
  }
  if (!failures) {
    record(db, id, { tos_cleanup_at: now() });
    log.info('投流剪辑中转对象已清理', { id, objects: paths.length });
    return { cleaned: paths.length };
  }
  db.prepare('UPDATE viral_edit_jobs SET tos_cleanup_attempts=tos_cleanup_attempts+1, updated_at=? WHERE id=?').run(now(), id);
  return { failed: failures };
}

function reconcile(db, row, reason, providerRequestId = null) {
  billing.markPendingReconciliation(db, { id: row.owner_user_id }, row.authorization_id, {
    provider_request_id: row.provider_task_id || providerRequestId,
    reason,
  });
  record(db, row.id, { status: 'reconciliation', error_msg: reason.slice(0, 500) });
}

async function processJob(db, log, cfg, id) {
  if (running.has(id)) return;
  const token = randomUUID();
  const claimed = db.prepare("UPDATE viral_edit_jobs SET lease_token=?,lease_until=? WHERE id=? AND status IN ('queued','processing','finalizing') AND (lease_until IS NULL OR lease_until<?)")
    .run(token, leaseUntil(), id, now()).changes;
  if (!claimed) return;
  running.add(id);
  const renewLease = () => db.prepare("UPDATE viral_edit_jobs SET lease_until=? WHERE id=? AND lease_token=? AND status IN ('queued','submitting','processing','finalizing')")
    .run(leaseUntil(), id, token).changes === 1;
  const heartbeat = setInterval(() => {
    try { if (!renewLease()) clearInterval(heartbeat); }
    catch (error) { clearInterval(heartbeat); log.error('投流剪辑任务租约续期失败', { id, error: error.message }); }
  }, LEASE_HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    let row = db.prepare('SELECT * FROM viral_edit_jobs WHERE id=?').get(id);
    if (!row || !['queued', 'processing', 'finalizing'].includes(row.status)) return;
    const input = JSON.parse(row.input_json);
    const params = JSON.parse(row.params_json);
    const { clientConfig, tosConfig } = serviceConfig(db);
    if (row.status === 'queued') {
      let inputs;
      try {
        const keys = plannedInputKeys(id, input.episodes.length);
        inputs = [];
        for (const [index, episode] of input.episodes.entries()) {
          const file = resolveStorageFile(storageRoot(cfg), episode.local_path);
          const objectPath = await tos.upload(tosConfig, keys[index], file, CONTENT_TYPES[episode.extension] || 'application/octet-stream');
          if (!renewLease()) return;
          inputs.push({ path: objectPath, bytes: episode.bytes });
          // 逐集登记：中途失败转 failed 时，已上传的对象必须已在清理清单里，不能等全批完成。
          record(db, id, { tos_objects_json: JSON.stringify({ ...readTosObjects(row), inputs }) });
        }
        record(db, id, { status: 'submitting', tos_objects_json: JSON.stringify({ inputs }) });
        row = db.prepare('SELECT * FROM viral_edit_jobs WHERE id=?').get(id);
      } catch (error) {
        billing.voidAuthorization(db, { id: row.owner_user_id }, row.authorization_id, '投流剪辑输入未提交供应商');
        record(db, id, { status: 'failed', error_msg: error.message.slice(0, 500) });
        return;
      }
      try {
        if (!renewLease()) return;
        const payload = operator.submitPayload(clientConfig, 'viral', {
          job_id: id, video_urls: inputs.map((entry) => entry.path), ...params, video_bitrate_kbps: input.totals.video_bitrate_kbps,
        });
        const accepted = await operator.request(clientConfig, 'submit', payload);
        record(db, id, { provider_task_id: accepted.task_id, status: 'processing', error_msg: null, submitted_at: now() });
      } catch (error) {
        reconcile(db, row, `LAS 投流剪辑提交结果不确定：${error.message}`, error.providerRequestId || null);
        return;
      }
      row = db.prepare('SELECT * FROM viral_edit_jobs WHERE id=?').get(id);
    }
    if (row.status === 'processing') {
      try {
        const result = await operator.request(clientConfig, 'poll', operator.pollPayload('viral', row.provider_task_id));
        if (result.status === 'FAILED' || result.status === 'TIMEOUT') {
          reconcile(db, row, `LAS 投流剪辑任务${result.status === 'TIMEOUT' ? '超时' : '失败'}：${translateProviderError(result.business_code, result.error_msg)}`);
          return;
        }
        if (result.status !== 'COMPLETED') return;
        record(db, id, { status: 'finalizing', result_json: JSON.stringify(result.data), error_msg: null });
      } catch (error) {
        record(db, id, { error_msg: `LAS 投流剪辑查询暂失败：${error.message}`.slice(0, 500) });
        return;
      }
      row = db.prepare('SELECT * FROM viral_edit_jobs WHERE id=?').get(id);
    }
    if (row.status !== 'finalizing') return;
    try {
      const prefix = operator.outputPath(clientConfig, id, 'viral');
      const data = JSON.parse(row.result_json || '{}');
      const parsed = parseViralResult(data, prefix);
      const objects = readTosObjects(row);
      const root = storageRoot(cfg);
      let storyboardPath = objects.storyboard || null;
      let storyboardRelative = row.storyboard_local_path || null;
      const measured = [];
      for (const clip of parsed.clips) {
        const relative = `viral/${id}/clips/clip_${String(clip.clip_index).padStart(3, '0')}.mp4`;
        const target = path.join(root, relative);
        let media;
        if (fs.existsSync(target)) {
          media = await shared.probe(target);
        } else {
          await tos.download(tosConfig, clip.tos_path, target);
          media = await shared.probe(target);
        }
        clip.local_bytes = fs.statSync(target).size;
        if (clip.provider_duration_sec != null && Math.abs(clip.provider_duration_sec * 1000 - media.durationMs) > 1000) {
          log.warn('投流剪辑成片时长与供应商回执偏差超过 1 秒，结算以本地实测为准', { id, clip: clip.clip_index, provider: clip.provider_duration_sec, measured_ms: media.durationMs });
        }
        measured.push({ clip, media, relative, target });
        upsertOutput(db, {
          id: randomUUID(), job_id: id, clip_index: clip.clip_index, owner_user_id: row.owner_user_id, drama_id: row.drama_id,
          provider_clip_id: clip.provider_clip_id, provider_duration_sec: clip.provider_duration_sec,
          local_path: relative, file_size: fs.statSync(target).size, width: media.width, height: media.height, duration_ms: media.durationMs,
          status: 'downloaded', timeline_json: JSON.stringify(enrichTimeline(clip.timeline, parsed.segments)),
          rating_summary_json: JSON.stringify(summarizeClipRating(clip, parsed.segments)),
        });
      }
      if (parsed.storyboard_path && !storyboardRelative) {
        storyboardRelative = `viral/${id}/storyboard.json`;
        await tos.download(tosConfig, parsed.storyboard_path, path.join(root, storyboardRelative));
        storyboardPath = { path: parsed.storyboard_path, bytes: fs.statSync(path.join(root, storyboardRelative)).size };
      }
      const totalOutputMs = measured.reduce((sum, entry) => sum + entry.media.durationMs, 0);
      record(db, id, { tos_objects_json: JSON.stringify({ ...objects, outputs: parsed.clips.map((clip) => ({ path: clip.tos_path, bytes: clip.local_bytes || null })), storyboard: storyboardPath }) });
      db.transaction(() => {
        billing.settleAuthorization(db, { id: row.owner_user_id }, row.authorization_id, {
          usage: { millisecond: input.totals.total_input_ms, second: Math.ceil(totalOutputMs / 1000) },
          provider_request_id: row.provider_task_id,
        });
        record(db, id, { storyboard_local_path: storyboardRelative, status: 'completed', error_msg: parsed.clips.length ? null : '供应商返回 0 条成片，仅结算输入分析费用', completed_at: now() });
      })();
      cleanupTransit(db, log, cfg, id).catch((error) => log.warn('投流剪辑中转清理异常', { id, error: error.message }));
      if (require('./mediaStorageService').isOss(cfg)) {
        const mediaStorage = require('./mediaStorageService');
        for (const relative of [...measured.map((entry) => entry.relative), storyboardRelative].filter(Boolean)) {
          try { await mediaStorage.mirrorAndTrack(db, cfg, root, relative, 'viral_edit_job', id, log); }
          catch (error) { log.warn('投流剪辑媒体镜像待重试', { id, local_path: relative, error: error.message }); }
        }
      }
    } catch (error) {
      log.warn('投流剪辑结果归档或结算待重试', { id, error: error.message });
      record(db, id, { error_msg: error.message.slice(0, 500) });
      if (error.code === 'BILLING_ACTUAL_USAGE_EXCEEDS_AVAILABLE_BALANCE' || /等待人工对账/.test(error.message)) reconcile(db, row, error.message);
    }
  } finally {
    clearInterval(heartbeat);
    db.prepare('UPDATE viral_edit_jobs SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').run(id, token);
    running.delete(id);
  }
}

async function saveOutputAsAsset(db, log, cfg, ownerId, jobId, clipIndex) {
  const row = db.prepare('SELECT * FROM viral_edit_jobs WHERE id=? AND owner_user_id=?').get(jobId, ownerId);
  if (!row) throw new Error('投流剪辑任务不存在');
  if (row.status !== 'completed') throw new Error('任务尚未完成，不能保存素材');
  const output = db.prepare('SELECT * FROM viral_edit_outputs WHERE job_id=? AND clip_index=?').get(jobId, Number(clipIndex));
  if (!output) throw new Error('成片不存在');
  if (output.asset_id) return { output: outputToItem(output, db), reused: true };
  const access = require('./projectAccessService').access(db, row.drama_id, ownerId);
  if (!access?.can_edit) throw new Error('项目不存在或没有编辑权限');
  const file = resolveStorageFile(storageRoot(cfg), output.local_path);
  if (!fs.existsSync(file)) throw new Error('本地成片文件缺失，无法保存为素材');
  const input = JSON.parse(row.input_json);
  const created = assets.create(db, log, {
    drama_id: row.drama_id, owner_user_id: ownerId,
    name: `投流成片 #${String(output.clip_index).padStart(2, '0')}`,
    type: 'video', source_type: 'las',
    local_path: output.local_path, duration: (output.duration_ms || 0) / 1000,
    width: output.width, height: output.height, file_size: fs.statSync(file).size,
    mime_type: 'video/mp4',
    metadata: {
      viral_job_id: jobId, clip_index: output.clip_index, provider_clip_id: output.provider_clip_id,
      rating_summary: JSON.parse(output.rating_summary_json || '{}'),
      input_asset_ids: input.episodes.map((episode) => episode.asset_id),
    },
  });
  db.prepare("UPDATE viral_edit_outputs SET asset_id=?, status='saved', updated_at=? WHERE id=?").run(created.id, now(), output.id);
  return { output: outputToItem(db.prepare('SELECT * FROM viral_edit_outputs WHERE id=?').get(output.id), db), asset: created };
}

function resume(db, log, cfg) {
  const recoverUncertain = () => {
    const uncertain = db.prepare("SELECT * FROM viral_edit_jobs WHERE status='submitting' AND (lease_until IS NULL OR lease_until<?)").all(now());
    let count = 0;
    for (const row of uncertain) {
      const token = randomUUID();
      if (!db.prepare("UPDATE viral_edit_jobs SET lease_token=?,lease_until=? WHERE id=? AND status='submitting' AND (lease_until IS NULL OR lease_until<?)").run(token, leaseUntil(), row.id, now()).changes) continue;
      try { reconcile(db, row, '进程中断，LAS 投流剪辑提交结果不确定；禁止自动重提'); count += 1; }
      finally { db.prepare('UPDATE viral_edit_jobs SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').run(row.id, token); }
    }
    return count;
  };
  const uncertain = recoverUncertain();
  const pending = db.prepare("SELECT id FROM viral_edit_jobs WHERE status IN ('queued','processing','finalizing')").all();
  for (const row of pending) setImmediate(() => processJob(db, log, cfg, row.id).catch((error) => log.error('投流剪辑任务恢复失败', { id: row.id, error: error.message })));
  const timer = setInterval(() => {
    try { recoverUncertain(); } catch (error) { log.error('投流剪辑提交恢复失败', { error: error.message }); }
    for (const row of db.prepare("SELECT id FROM viral_edit_jobs WHERE status IN ('queued','processing','finalizing') LIMIT 50").all()) {
      processJob(db, log, cfg, row.id).catch((error) => log.error('投流剪辑任务轮询失败', { id: row.id, error: error.message }));
    }
    for (const row of db.prepare("SELECT id FROM viral_edit_jobs WHERE status IN ('completed','failed') AND tos_policy='cleanup' AND tos_cleanup_at IS NULL AND tos_cleanup_attempts < 5 LIMIT 20").all()) {
      cleanupTransit(db, log, cfg, row.id).catch((error) => log.warn('投流剪辑中转清理重试失败', { id: row.id, error: error.message }));
    }
  }, 30_000);
  timer.unref?.();
  return { queued: pending.length, uncertain, stop: () => clearInterval(timer) };
}

module.exports = {
  CAPS, BILLING, quote, create, get, list, processJob, resume, cleanupTransit, saveOutputAsAsset,
  validateParams, validateInputs, reservedUsage, parseViralResult, summarizeClipRating, enrichTimeline, bitrateFor, translateProviderError,
};
