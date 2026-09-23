const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getFfprobePath } = require('../utils/ffmpegPath');
const { resolveStorageFile } = require('../utils/storagePath');
const assets = require('./assetService');
const billing = require('./billingService');
const las = require('./lasOperatorClient');
const tos = require('./lasTosBridge');

const execFileAsync = promisify(execFile);
const running = new Set();
const now = () => new Date().toISOString();
const LEASE_MS = 120_000;
const LEASE_HEARTBEAT_MS = 15_000;
const leaseUntil = () => new Date(Date.now() + LEASE_MS).toISOString();
const MODEL = { translate: 'las-video-translate', inpaint: { lite: 'las-video-inpaint-lite', pro: 'las-video-inpaint-pro' } };
const SERVICE_TYPE = 'video_localization';

// 地域与 Bucket 只有一份来源，LAS 与 TOS 不可能再配成两个不同的桶。
function serviceConfig(db) {
  const active = require('./aiConfigService').listConfigs(db, SERVICE_TYPE)
    .filter((item) => item.is_active && !item.owner_tenant_id);
  if (!active.length) throw new Error('尚未启用「视频本地化」专用服务，不能提交付费任务');
  const defaults = active.filter((item) => item.is_default);
  const row = defaults.length === 1 ? defaults[0] : active.length === 1 ? active[0] : null;
  if (!row) throw new Error('请在「视频本地化」专用服务中启用并指定唯一默认配置');
  let settings = {};
  try { settings = JSON.parse(row.settings || '{}'); } catch (_) {}
  const shared = { region: settings.region, bucket: settings.tos_bucket };
  return {
    clientConfig: las.configuration({ ...shared, apiKey: row.api_key }),
    tosConfig: tos.configuration({ ...shared, accessKeyId: settings.tos_access_key_id, secretAccessKey: settings.tos_secret_access_key }),
  };
}

function storageRoot(cfg) {
  return path.resolve(cfg.storage?.local_path || './data/storage');
}

async function probe(file) {
  const { stdout } = await execFileAsync(getFfprobePath(), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', file], { windowsHide: true });
  const info = JSON.parse(stdout);
  const video = info.streams?.find((stream) => stream.codec_type === 'video');
  const [numerator, denominator = 1] = String(video?.r_frame_rate || '0/1').split('/').map(Number);
  const durationMs = Math.ceil(Number(info.format?.duration) * 1000);
  const fps = numerator / denominator;
  if (!video?.width || !video?.height || !Number.isSafeInteger(durationMs) || durationMs <= 0 || !Number.isFinite(fps) || fps <= 0) throw new Error('视频规格无法读取');
  return { durationMs, width: video.width, height: video.height, fps, audio: info.streams.some((stream) => stream.codec_type === 'audio') };
}

function modelFor(input) {
  return input.stage === 'translate' ? MODEL.translate : MODEL.inpaint[input.model_level];
}

function validateMedia(media, stage) {
  if (stage === 'translate' && (!media.audio || media.durationMs < 10_000 || media.durationMs > 4 * 3600_000)) throw new Error('翻译视频须带音轨，时长在 10 秒至 4 小时之间');
  if (stage === 'inpaint' && (media.durationMs < 1000 || media.durationMs > 3 * 3600_000)) throw new Error('擦除视频时长须在 1 秒至 3 小时之间');
  if (media.width * media.height > 1920 * 1080 || media.fps > 30) throw new Error('首版 LAS 工作流只支持不超过 1080p、30fps 的视频');
}

function publicJob(row) {
  return {
    id: row.id, drama_id: row.drama_id, source_asset_id: row.source_asset_id,
    output_asset_id: row.output_asset_id, stage: row.stage, status: row.status,
    caption_url: row.caption_local_path ? `/static/${row.caption_local_path}` : null,
    input: JSON.parse(row.input_json), error_msg: row.error_msg,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function get(db, ownerId, id) {
  const row = db.prepare('SELECT * FROM las_media_jobs WHERE id=? AND owner_user_id=?').get(id, ownerId);
  return row ? publicJob(row) : null;
}

function list(db, ownerId, dramaId) {
  return db.prepare('SELECT * FROM las_media_jobs WHERE owner_user_id=? AND drama_id=? ORDER BY created_at DESC LIMIT 100').all(ownerId, dramaId).map(publicJob);
}

function resultPaths(data, outputPrefix) {
  const matches = new Set();
  const visit = (value) => {
    if (typeof value === 'string' && value.startsWith(outputPrefix) && !value.includes('?')) matches.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(data);
  const videos = [...matches].filter((value) => /\.mp4$/i.test(value));
  if (videos.length !== 1) throw new Error('LAS 完成结果缺少唯一的 TOS 视频路径');
  return { video: videos[0], caption: [...matches].find((value) => /\.srt$/i.test(value)) || null };
}

function billedMilliseconds(input, output) {
  if (input.stage === 'translate') return input.media.durationMs;
  if (output.fps > 30 || output.width * output.height > 1920 * 1080) throw new Error('LAS 输出超出已报价规格，等待人工对账');
  const fpsFactor = output.fps <= 24 ? 0.8 : 1;
  const sizeFactor = input.model_level === 'pro' && output.width * output.height <= 1280 * 720 ? 0.6 : 1;
  return Math.ceil(output.durationMs * fpsFactor * sizeFactor);
}

async function create(db, log, cfg, ownerId, body) {
  const key = String(body?.idempotency_key || '').trim();
  if (!key || key.length > 100) throw new Error('请提供有效幂等键');
  const existing = db.prepare('SELECT * FROM las_media_jobs WHERE owner_user_id=? AND idempotency_key=?').get(ownerId, key);
  if (existing) {
    const previous = JSON.parse(existing.input_json);
    if (Number(body.drama_id) !== existing.drama_id || Number(body.asset_id) !== existing.source_asset_id
      || String(body.stage || '') !== existing.stage
      || (existing.stage === 'translate' && String(body.output_language || '') !== previous.output_language)
      || (existing.stage === 'inpaint' && String(body.model_level || '') !== previous.model_level)) throw new Error('幂等键已用于不同任务');
    return publicJob(existing);
  }
  const stage = String(body.stage || '');
  if (!['translate', 'inpaint'].includes(stage)) throw new Error('LAS 任务类型无效');
  const dramaId = Number(body.drama_id);
  const assetId = Number(body.asset_id);
  if (!Number.isInteger(dramaId) || !Number.isInteger(assetId) || dramaId <= 0 || assetId <= 0) throw new Error('项目和视频素材 ID 必填');
  const access = require('./projectAccessService').access(db, dramaId, ownerId);
  if (!access?.can_edit) throw new Error('项目不存在或没有编辑权限');
  const source = assets.getByIdForOwner(db, assetId, ownerId);
  if (!source || source.drama_id !== dramaId || source.type !== 'video' || !source.local_path) throw new Error('请选择该项目已本地归档的视频素材');
  const localFile = resolveStorageFile(storageRoot(cfg), source.local_path);
  if (fs.statSync(localFile).size > 5 * 1024 ** 3) throw new Error('首版 TOS 中转不支持超过 5GB 的素材');
  const media = await probe(localFile);
  validateMedia(media, stage);
  const input = { stage, media, output_language: stage === 'translate' ? String(body.output_language || '') : null, model_level: stage === 'inpaint' ? String(body.model_level || '') : null };
  const { clientConfig, tosConfig } = serviceConfig(db);
  const id = randomUUID();
  las.submitPayload(clientConfig, stage, { job_id: id, video_url: `tos://${tosConfig.bucket}/${tos.objectKey(id, 'input', 'source.mp4')}`, ...input });
  const model = modelFor(input);
  if (!model) throw new Error('LAS 任务档位无效');
  const actor = { id: ownerId };
  billing.quote(db, actor, { service_type: 'video_postprocess', model, provider: 'las', usage: { millisecond: media.durationMs } });
  const at = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO las_media_jobs(id,owner_user_id,drama_id,source_asset_id,idempotency_key,stage,input_json,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'queued',?,?)`).run(id, ownerId, dramaId, assetId, key, stage, JSON.stringify(input), at, at);
    const authorization = billing.createAuthorization(db, actor, {
      idempotency_key: `las:${ownerId}:${key}`, service_type: 'video_postprocess', model,
      provider: 'las', usage: { millisecond: media.durationMs }, drama_id: dramaId,
      reference_type: 'las_media_job', reference_id: id, source_kind: 'las_media_job', source_id: id,
    });
    db.prepare('UPDATE las_media_jobs SET authorization_id=? WHERE id=?').run(authorization.authorization_id, id);
  })();
  setImmediate(() => processJob(db, log, cfg, id).catch((error) => log.error('LAS 任务失败', { id, error: error.message })));
  return get(db, ownerId, id);
}

function record(db, id, patch) {
  const allowed = ['status', 'input_tos_path', 'provider_task_id', 'result_json', 'output_asset_id', 'caption_local_path', 'error_msg'];
  const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
  if (!entries.length) return;
  const at = now();
  db.prepare(`UPDATE las_media_jobs SET ${entries.map(([key]) => `${key}=?`).join(',')}, updated_at=? WHERE id=?`).run(...entries.map(([, value]) => value), at, id);
}

function reconcile(db, row, reason) {
  billing.markPendingReconciliation(db, { id: row.owner_user_id }, row.authorization_id, {
    provider_request_id: row.provider_task_id || null,
    reason,
  });
  record(db, row.id, { status: 'reconciliation', error_msg: reason.slice(0, 500) });
}

async function processJob(db, log, cfg, id) {
  if (running.has(id)) return;
  const token = randomUUID();
  const claimed = db.prepare("UPDATE las_media_jobs SET lease_token=?,lease_until=? WHERE id=? AND status IN ('queued','processing','finalizing') AND (lease_until IS NULL OR lease_until<?)")
    .run(token, leaseUntil(), id, now()).changes;
  if (!claimed) return;
  running.add(id);
  const renewLease = () => db.prepare("UPDATE las_media_jobs SET lease_until=? WHERE id=? AND lease_token=? AND status IN ('queued','submitting','processing','finalizing')")
    .run(leaseUntil(), id, token).changes === 1;
  const heartbeat = setInterval(() => {
    try { if (!renewLease()) clearInterval(heartbeat); }
    catch (error) { clearInterval(heartbeat); log.error('LAS 任务租约续期失败', { id, error: error.message }); }
  }, LEASE_HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    let row = db.prepare('SELECT * FROM las_media_jobs WHERE id=?').get(id);
    if (!row || !['queued', 'processing', 'finalizing'].includes(row.status)) return;
    const input = JSON.parse(row.input_json);
    const { clientConfig, tosConfig } = serviceConfig(db);
    if (row.status === 'queued') {
      try {
        const source = assets.getById(db, row.source_asset_id);
        const file = resolveStorageFile(storageRoot(cfg), source.local_path);
        const tosPath = await tos.upload(tosConfig, tos.objectKey(id, 'input', 'source.mp4'), file);
        if (!renewLease()) return;
        record(db, id, { input_tos_path: tosPath, status: 'submitting' });
        row = db.prepare('SELECT * FROM las_media_jobs WHERE id=?').get(id);
      } catch (error) {
        billing.voidAuthorization(db, { id: row.owner_user_id }, row.authorization_id, 'LAS 输入未提交供应商');
        record(db, id, { status: 'failed', error_msg: error.message.slice(0, 500) });
        return;
      }
      try {
        if (!renewLease()) return;
        const payload = las.submitPayload(clientConfig, row.stage, { ...input, job_id: id, video_url: row.input_tos_path });
        const accepted = await las.request(clientConfig, 'submit', payload);
        record(db, id, { provider_task_id: accepted.task_id, status: 'processing', error_msg: null });
      } catch (error) {
        reconcile(db, row, `LAS 提交结果不确定：${error.message}`);
        return;
      }
      row = db.prepare('SELECT * FROM las_media_jobs WHERE id=?').get(id);
    }
    if (row.status === 'processing') {
      try {
        const result = await las.request(clientConfig, 'poll', las.pollPayload(row.stage, row.provider_task_id));
        if (result.status === 'FAILED' || result.status === 'TIMEOUT') { reconcile(db, row, `LAS 任务${result.status === 'TIMEOUT' ? '超时' : '失败'}：${result.business_code} ${result.error_msg}`); return; }
        if (result.status !== 'COMPLETED') return;
        record(db, id, { status: 'finalizing', result_json: JSON.stringify(result.data), error_msg: null });
      } catch (error) {
        record(db, id, { error_msg: `LAS 查询暂失败：${error.message}`.slice(0, 500) });
        return;
      }
      row = db.prepare('SELECT * FROM las_media_jobs WHERE id=?').get(id);
    }
    if (row.status !== 'finalizing') return;
    try {
      const prefix = las.outputPath(clientConfig, id, row.stage);
      const paths = resultPaths(JSON.parse(row.result_json), prefix);
      const relative = `las/${id}/video.mp4`;
      const target = path.join(storageRoot(cfg), relative);
      await tos.download(tosConfig, paths.video, target);
      const captionRelative = paths.caption ? `las/${id}/subtitles.srt` : null;
      if (captionRelative) await tos.download(tosConfig, paths.caption, path.join(storageRoot(cfg), captionRelative));
      const media = await probe(target);
      validateMedia(media, row.stage);
      const chargedMs = billedMilliseconds(input, media);
      db.transaction(() => {
        const created = assets.create(db, log, {
          drama_id: row.drama_id, owner_user_id: row.owner_user_id,
          name: row.stage === 'translate' ? `LAS 翻译 ${input.output_language}` : 'LAS 字幕擦除',
          type: 'video', source_type: 'las', parent_asset_id: row.source_asset_id,
          local_path: relative, duration: media.durationMs / 1000,
          width: media.width, height: media.height, file_size: fs.statSync(target).size,
          mime_type: 'video/mp4', metadata: { las_job_id: id, stage: row.stage, caption_local_path: captionRelative },
        });
        billing.settleAuthorization(db, { id: row.owner_user_id }, row.authorization_id, {
          usage: { millisecond: chargedMs }, provider_request_id: row.provider_task_id,
        });
        record(db, id, { output_asset_id: created.id, caption_local_path: captionRelative, status: 'completed', error_msg: null });
      })();
      if (require('./mediaStorageService').isOss(cfg)) {
        const mediaStorage = require('./mediaStorageService');
        for (const localPath of [relative, captionRelative].filter(Boolean)) {
          try { await mediaStorage.mirrorAndTrack(db, cfg, storageRoot(cfg), localPath, 'las_media_job', id, log); }
          catch (error) { log.warn('LAS 项目媒体镜像待重试', { id, local_path: localPath, error: error.message }); }
        }
      }
    } catch (error) {
      log.warn('LAS 结果归档或结算待重试', { id, error: error.message });
      record(db, id, { error_msg: error.message.slice(0, 500) });
      if (error.code === 'BILLING_ACTUAL_USAGE_EXCEEDS_AVAILABLE_BALANCE' || /已报价规格/.test(error.message)) reconcile(db, row, error.message);
    }
  } finally {
    clearInterval(heartbeat);
    db.prepare('UPDATE las_media_jobs SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').run(id, token);
    running.delete(id);
  }
}

function resume(db, log, cfg) {
  const recoverUncertain = () => {
    const uncertain = db.prepare("SELECT * FROM las_media_jobs WHERE status='submitting' AND (lease_until IS NULL OR lease_until<?)").all(now());
    let count = 0;
    for (const row of uncertain) {
      const token = randomUUID();
      if (!db.prepare("UPDATE las_media_jobs SET lease_token=?,lease_until=? WHERE id=? AND status='submitting' AND (lease_until IS NULL OR lease_until<?)").run(token, leaseUntil(), row.id, now()).changes) continue;
      try { reconcile(db, row, '进程中断，LAS 提交结果不确定；禁止自动重提'); count += 1; }
      finally { db.prepare('UPDATE las_media_jobs SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').run(row.id, token); }
    }
    return count;
  };
  const uncertain = recoverUncertain();
  // 案件已在处置与任务同步之间中断时落下的窗口，启动/恢复时补偿对齐。
  const caseSync = billing.recoverResolvedLasReconciliations(db);
  const pending = db.prepare("SELECT id FROM las_media_jobs WHERE status IN ('queued','processing','finalizing')").all();
  for (const row of pending) setImmediate(() => processJob(db, log, cfg, row.id).catch((error) => log.error('LAS 任务恢复失败', { id: row.id, error: error.message })));
  const timer = setInterval(() => {
    try { recoverUncertain(); billing.recoverResolvedLasReconciliations(db); } catch (error) { log.error('LAS 提交恢复失败', { error: error.message }); }
    for (const row of db.prepare("SELECT id FROM las_media_jobs WHERE status IN ('queued','processing','finalizing') LIMIT 50").all()) {
      processJob(db, log, cfg, row.id).catch((error) => log.error('LAS 任务轮询失败', { id: row.id, error: error.message }));
    }
  }, 30_000);
  timer.unref?.();
  return { queued: pending.length, uncertain, case_synced: caseSync.synced, stop: () => clearInterval(timer) };
}

module.exports = { create, get, list, processJob, resume, resultPaths, billedMilliseconds, validateMedia, serviceConfig };
