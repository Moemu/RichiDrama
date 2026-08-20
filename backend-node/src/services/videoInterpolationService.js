'use strict';

const fs = require('fs');
const path = require('path');
const client = require('./videoInterpolationClient');
const billing = require('./billingService');
const { probeVideoMedia } = require('./videoMediaProbeService');
const BILLING_MODEL = 'volcengine-video-frame-interpolation';

const active = new Set();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fpsTier(fps) { return Number(fps) <= 30 ? 'lte30' : Number(fps) <= 60 ? 'lte60' : 'lte120'; }
function resolutionTier(value, heightValue) {
  const width = typeof value === 'object' ? Number(value?.width || 0) : Number(value || 0);
  const height = typeof value === 'object' ? Number(value?.height || 0) : Number(heightValue || 0);
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge >= 7000 || shortEdge >= 4000) throw new Error('AI MediaKit 8K 插帧尚无已核验公开价目，已拒绝调用');
  if (longEdge >= 3000 || shortEdge >= 2000) return '4k';
  if (longEdge >= 2000 || shortEdge >= 1300) return '2k';
  if (longEdge >= 1500 || shortEdge >= 900) return '1080p';
  const text = String(value || '').toLowerCase();
  if (text.includes('8k') || /(?:7680|4320)/.test(text)) throw new Error('AI MediaKit 8K 插帧尚无已核验公开价目，已拒绝调用');
  if (text.includes('4k') || /2160/.test(text)) return '4k';
  if (text.includes('2k') || /1440/.test(text)) return '2k';
  if (text.includes('1080')) return '1080p';
  return '720p';
}

function createAuthorization(db, row, targetFps, retryNonce = '') {
  // Reserve one extra second because container duration can be fractionally
  // longer than the requested duration. Settlement releases the difference.
  const durationMs = Math.max(1000, Math.ceil((Number(row.duration || 15) + 1) * 1000));
  return billing.createAuthorization(db, { id: row.owner_user_id, role: 'admin' }, {
    idempotency_key: `video-interpolation:${row.id}${retryNonce ? `:retry:${retryNonce}` : ''}`,
    service_type: 'video_postprocess', model: BILLING_MODEL, usage: { millisecond: durationMs },
    pricing_context: { resolution_tier: resolutionTier(row.upscale_resolution || row.resolution), fps_tier: fpsTier(targetFps) },
    reference_type: 'video_interpolation', reference_id: row.id,
    drama_id: row.drama_id || null, source_kind: 'video_interpolation', source_id: row.id,
  });
}

function retryFromSource(db, videoGenerationId) {
  const row = db.prepare('SELECT * FROM video_generations WHERE id=? AND deleted_at IS NULL').get(Number(videoGenerationId));
  const source = row?.upscale_local_path || row?.source_local_path;
  if (!source) throw new Error('插帧重试缺少已归档的视频');
  const job = db.prepare('SELECT * FROM video_interpolation_jobs WHERE video_generation_id=?').get(row.id);
  if (!job) return ensureJob(db, row, source);
  if (!['failed', 'cancelled'].includes(job.status)) throw new Error('当前插帧任务不可重试');
  // Release a failed attempt before creating the retry authorization, so a
  // stage retry cannot leave two frozen/settled postprocess charges.
  billing.voidAuthorization(db, { id: job.owner_user_id, role: 'admin' }, job.billing_authorization_id, '插帧阶段重试前释放失败尝试预授权');
  const authorization = createAuthorization(db, row, job.target_fps || row.target_fps, `${Number(job.attempts || 0) + 1}:${Date.now()}`);
  const now = new Date().toISOString();
  db.prepare(`UPDATE video_interpolation_jobs SET billing_authorization_id=?, source_local_path=?, provider_task_id=NULL,
    provider_request_id=NULL, input_video_url=NULL, output_local_path=NULL, output_width=NULL, output_height=NULL,
    output_duration_ms=NULL, output_resolution=NULL, output_fps=NULL, status='pending', error_msg=NULL,
    completed_at=NULL, updated_at=? WHERE id=?`)
    .run(authorization.authorization_id, source, now, job.id);
  db.prepare(`UPDATE video_generations SET status='interpolation_pending', interpolation_status='pending',
    interpolation_billing_authorization_id=?, error_msg=NULL, updated_at=? WHERE id=?`)
    .run(authorization.authorization_id, now, row.id);
  return db.prepare('SELECT * FROM video_interpolation_jobs WHERE id=?').get(job.id);
}

function ensureJob(db, row, sourceLocalPath) {
  let job = db.prepare('SELECT * FROM video_interpolation_jobs WHERE video_generation_id=?').get(row.id);
  if (job) {
    // A previous upstream-stage failure cancels the reserved interpolation
    // authorization. Once a source becomes available again, reopen it with a
    // fresh authorization instead of leaving the generation stuck pending.
    if (['failed', 'cancelled'].includes(job.status)) return retryFromSource(db, row.id);
    if (!job.source_local_path && sourceLocalPath) db.prepare("UPDATE video_interpolation_jobs SET source_local_path=?, status='pending', updated_at=? WHERE id=?")
      .run(sourceLocalPath, new Date().toISOString(), job.id);
    return db.prepare('SELECT * FROM video_interpolation_jobs WHERE id=?').get(job.id);
  }
  const targetFps = Number(row.target_fps);
  if (!Number.isInteger(targetFps) || targetFps < 15 || targetFps > 120) throw new Error('当前视频未选择有效的插帧目标');
  const authorization = createAuthorization(db, row, targetFps);
  const now = new Date().toISOString();
  const info = db.prepare(`INSERT INTO video_interpolation_jobs
    (video_generation_id, owner_user_id, billing_authorization_id, target_fps, source_local_path, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`).run(row.id, row.owner_user_id, authorization.authorization_id, targetFps, sourceLocalPath, now, now);
  db.prepare(`UPDATE video_generations SET source_local_path=?, interpolation_job_id=?, interpolation_status='pending',
    target_fps=?, interpolation_billing_authorization_id=?, updated_at=? WHERE id=?`)
    .run(sourceLocalPath, info.lastInsertRowid, targetFps, authorization.authorization_id, now, row.id);
  return db.prepare('SELECT * FROM video_interpolation_jobs WHERE id=?').get(info.lastInsertRowid);
}

function reserveForGeneration(db, videoGenerationId, requestedTargetFps) {
  const row = db.prepare('SELECT * FROM video_generations WHERE id=? AND deleted_at IS NULL').get(Number(videoGenerationId));
  if (!row) throw new Error('视频生成记录不存在');
  const existing = db.prepare('SELECT * FROM video_interpolation_jobs WHERE video_generation_id=?').get(row.id);
  if (existing) return existing;
  const targetFps = Number(requestedTargetFps ?? row.target_fps);
  if (!Number.isInteger(targetFps) || targetFps < 15 || targetFps > 120) throw new Error('当前视频未选择有效的插帧目标');
  const authorization = createAuthorization(db, row, targetFps);
  const now = new Date().toISOString();
  const info = db.prepare(`INSERT INTO video_interpolation_jobs
    (video_generation_id, owner_user_id, billing_authorization_id, target_fps, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'awaiting_source', ?, ?)`).run(row.id, row.owner_user_id, authorization.authorization_id, targetFps, now, now);
  db.prepare(`UPDATE video_generations SET interpolation_job_id=?, interpolation_status='awaiting_source',
    target_fps=?, interpolation_billing_authorization_id=?, updated_at=? WHERE id=?`)
    .run(info.lastInsertRowid, targetFps, authorization.authorization_id, now, row.id);
  return db.prepare('SELECT * FROM video_interpolation_jobs WHERE id=?').get(info.lastInsertRowid);
}

async function downloadResult(url, storagePath, row, job) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`插帧结果下载失败（HTTP ${response.status}）`);
  const sourceAbs = path.join(storagePath, job.source_local_path);
  const dir = path.dirname(sourceAbs);
  fs.mkdirSync(dir, { recursive: true });
  const relative = path.join(path.relative(storagePath, dir), `vg_${row.id}_interpolated_${job.target_fps}fps.mp4`).replace(/\\/g, '/');
  const absolute = path.join(storagePath, relative);
  fs.writeFileSync(absolute, Buffer.from(await response.arrayBuffer()));
  if (!fs.existsSync(absolute) || fs.statSync(absolute).size === 0) throw new Error('插帧结果为空');
  return relative;
}

async function process(db, log, videoGenerationId, storagePath) {
  if (active.has(Number(videoGenerationId))) return null;
  active.add(Number(videoGenerationId));
  let job;
  try {
    const row = db.prepare('SELECT * FROM video_generations WHERE id=? AND deleted_at IS NULL').get(Number(videoGenerationId));
    const interpolationSource = row?.upscale_local_path || row?.source_local_path;
    if (!interpolationSource) throw new Error('插帧缺少超分后的本地视频');
    job = ensureJob(db, row, interpolationSource);
    if (job.status === 'completed' && job.output_local_path) {
      db.prepare("UPDATE video_generations SET interpolation_status='completed', updated_at=? WHERE id=?")
        .run(new Date().toISOString(), row.id);
      return {
        local_path: job.output_local_path,
        duration_ms: job.output_duration_ms,
        resolution: job.output_resolution,
        fps: job.output_fps || job.target_fps,
        provider_request_id: job.provider_request_id,
        reused: true,
      };
    }
    const sourceProbe = probeVideoMedia(path.join(storagePath, interpolationSource));
    if (Number(job.target_fps) <= Number(sourceProbe.fps) + 0.5) {
      const now = new Date().toISOString();
      billing.voidAuthorization(db, { id: row.owner_user_id, role: 'admin' }, job.billing_authorization_id, '源视频帧率已达到或超过插帧目标，未调用供应商');
      db.prepare(`UPDATE video_interpolation_jobs SET status='skipped', output_local_path=?, output_width=?, output_height=?,
        output_duration_ms=?, output_resolution=?, output_fps=?, error_msg=NULL, completed_at=?, updated_at=? WHERE id=?`)
        .run(interpolationSource, sourceProbe.width, sourceProbe.height, sourceProbe.duration_ms, sourceProbe.resolution, sourceProbe.fps, now, now, job.id);
      db.prepare(`UPDATE video_generations SET interpolation_status='skipped', output_width=?, output_height=?, output_resolution=?,
        output_fps=?, output_duration_ms=?, updated_at=? WHERE id=?`)
        .run(sourceProbe.width, sourceProbe.height, sourceProbe.resolution, sourceProbe.fps, sourceProbe.duration_ms, now, row.id);
      return { local_path: interpolationSource, duration_ms: sourceProbe.duration_ms, width: sourceProbe.width, height: sourceProbe.height, resolution: sourceProbe.resolution, fps: sourceProbe.fps, skipped: true };
    }
    if (!job.provider_task_id) {
      const uploaded = await client.uploadLocalVideo(db, path.join(storagePath, interpolationSource));
      const submitted = await client.submit(db, { video_url: uploaded.file_id, fps: job.target_fps, client_token: `vg-${row.id}`, callback_args: JSON.stringify({ video_generation_id: row.id }) });
      const now = new Date().toISOString();
      db.prepare("UPDATE video_interpolation_jobs SET provider_task_id=?, provider_request_id=?, input_video_url=?, status='processing', attempts=attempts+1, updated_at=? WHERE id=?")
        .run(submitted.task_id, submitted.request_id || uploaded.request_id, uploaded.file_id, now, job.id);
      db.prepare("UPDATE video_generations SET status='interpolating', interpolation_status='processing', updated_at=? WHERE id=?").run(now, row.id);
      job = db.prepare('SELECT * FROM video_interpolation_jobs WHERE id=?').get(job.id);
    }
    let result;
    const maxAttempts = Math.max(1, Number(client.config(db).settings.poll_max_attempts || 360));
    const interval = Math.max(1000, Number(client.config(db).settings.poll_interval_ms || 5000));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      result = await client.retrieve(db, job.provider_task_id);
      if (result.status === 'completed' || result.status === 'failed') break;
      await wait(interval);
    }
    if (result?.status !== 'completed' || !result?.result?.video_url) throw new Error(result?.error?.message || 'AI MediaKit 插帧超时或失败');
    const localPath = await downloadResult(result.result.video_url, storagePath, row, job);
    const outputProbe = probeVideoMedia(path.join(storagePath, localPath));
    if (sourceProbe.width !== outputProbe.width || sourceProbe.height !== outputProbe.height) {
      throw new Error(`插帧输出分辨率异常：输入 ${sourceProbe.width}x${sourceProbe.height}，输出 ${outputProbe.width}x${outputProbe.height}`);
    }
    const durationMs = Math.max(1, outputProbe.duration_ms);
    try {
      billing.settleAuthorization(db, { id: row.owner_user_id, role: 'admin' }, job.billing_authorization_id, {
        usage: { millisecond: durationMs }, provider_request_id: result.request_id || job.provider_request_id || job.provider_task_id,
      });
    } catch (error) {
      if (error.code !== 'BILLING_ACTUAL_USAGE_EXCEEDS_AVAILABLE_BALANCE') throw error;
      billing.markPendingReconciliation(db, { id: row.owner_user_id, role: 'admin' }, job.billing_authorization_id, {
        provider_request_id: result.request_id || job.provider_request_id || job.provider_task_id,
        observed_usage: { millisecond: durationMs },
        reason: '插帧实际费用超过预授权且可用余额不足，等待管理员对账',
      });
      const now = new Date().toISOString();
      db.prepare(`UPDATE video_interpolation_jobs SET status='reconciliation_required', output_local_path=?, output_duration_ms=?,
        output_width=?, output_height=?, output_resolution=?, output_fps=?, provider_request_id=?, error_msg=?, updated_at=? WHERE id=?`)
        .run(localPath, durationMs, outputProbe.width, outputProbe.height, outputProbe.resolution, outputProbe.fps, result.request_id || job.provider_request_id,
          '实际插帧费用超过预授权且余额不足，已进入待对账', now, job.id);
      db.prepare("UPDATE video_generations SET status='billing_reconciliation', interpolation_status='reconciliation_required', error_msg=?, updated_at=? WHERE id=?")
        .run('插帧已完成但实际费用超过预授权且余额不足，等待管理员对账', now, row.id);
      error.reconciliationRequired = true;
      throw error;
    }
    const now = new Date().toISOString();
    db.prepare(`UPDATE video_interpolation_jobs SET status='completed', output_local_path=?, output_duration_ms=?,
      output_width=?, output_height=?, output_resolution=?, output_fps=?, provider_request_id=?, completed_at=?, updated_at=? WHERE id=?`)
      .run(localPath, durationMs, outputProbe.width, outputProbe.height, outputProbe.resolution, outputProbe.fps, result.request_id || job.provider_request_id, now, now, job.id);
    db.prepare(`UPDATE video_generations SET interpolation_status='completed', output_width=?, output_height=?,
      output_resolution=?, output_fps=?, output_duration_ms=?, updated_at=? WHERE id=?`)
      .run(outputProbe.width, outputProbe.height, outputProbe.resolution, outputProbe.fps, durationMs, now, row.id);
    return { local_path: localPath, duration_ms: durationMs, width: outputProbe.width, height: outputProbe.height, resolution: outputProbe.resolution, fps: outputProbe.fps, provider_request_id: result.request_id || job.provider_request_id };
  } catch (error) {
    const now = new Date().toISOString();
    if (error.reconciliationRequired) {
      log.error('Video interpolation requires billing reconciliation', { video_generation_id: videoGenerationId, error: error.message });
      return null;
    }
    if (job) {
      db.prepare("UPDATE video_interpolation_jobs SET status='failed', error_msg=?, updated_at=? WHERE id=?").run(String(error.message).slice(0, 500), now, job.id);
      try { billing.voidAuthorization(db, { id: job.owner_user_id, role: 'admin' }, job.billing_authorization_id, '视频插帧失败'); } catch (_) {}
    }
    db.prepare("UPDATE video_generations SET status='failed', interpolation_status='failed', error_msg=?, updated_at=? WHERE id=?").run(String(error.message).slice(0, 500), now, Number(videoGenerationId));
    log.error('Video interpolation failed', { video_generation_id: videoGenerationId, error: error.message });
    return null;
  } finally { active.delete(Number(videoGenerationId)); }
}

function resumePending(db, log, storagePath) {
  let rows = [];
  try {
    rows = db.prepare(`SELECT j.video_generation_id
      FROM video_interpolation_jobs j
      JOIN video_generations v ON v.id=j.video_generation_id
      WHERE j.status IN ('awaiting_source','pending','processing')
        AND v.deleted_at IS NULL
        AND ((v.upscale_resolution IS NULL AND v.source_local_path IS NOT NULL AND TRIM(v.source_local_path) != '')
          OR (v.upscale_status = 'completed' AND v.upscale_local_path IS NOT NULL AND TRIM(v.upscale_local_path) != ''))
      ORDER BY j.id`).all();
  } catch (_) {}
  for (const row of rows) setImmediate(async () => {
    const result = await process(db, log, row.video_generation_id, storagePath);
    if (result?.local_path) await require('./videoService').resumePostprocessVideoGeneration(db, log, row.video_generation_id);
  });
  return { queued: rows.length };
}

module.exports = { process, resumePending, resolutionTier, fpsTier, ensureJob, createAuthorization, reserveForGeneration, retryFromSource, BILLING_MODEL };
