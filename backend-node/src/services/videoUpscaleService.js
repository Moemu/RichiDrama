'use strict';

const fs = require('fs');
const path = require('path');
const client = require('./videoUpscaleClient');
const billing = require('./billingService');
const { probeVideoMedia } = require('./videoMediaProbeService');
const { resolutionTier, fpsTier } = require('./videoInterpolationService');

const BILLING_MODEL = 'volcengine-video-generative-enhancement';
const active = new Set();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function targetResolution(db, row) {
  const value = String(row.upscale_resolution || '').toLowerCase();
  if (!['720p', '1080p'].includes(value)) throw new Error('当前视频未选择有效的超分目标');
  return value;
}

function createAuthorization(db, row, resolution) {
  const durationMs = Math.max(1000, Math.ceil((Number(row.duration || 15) + 1) * 1000));
  const reserveFps = Math.min(120, Math.max(30, Number(client.config(db).settings.upscale_reserve_fps || 60)));
  return billing.createAuthorization(db, { id: row.owner_user_id, role: 'admin' }, {
    idempotency_key: `video-upscale:${row.id}`,
    service_type: 'video_postprocess', model: BILLING_MODEL,
    usage: { millisecond: durationMs },
    pricing_context: { resolution_tier: resolution, fps_tier: fpsTier(reserveFps) },
    reference_type: 'video_upscale', reference_id: row.id,
  });
}

function reserveForGeneration(db, videoGenerationId, requestedResolution) {
  const row = db.prepare('SELECT * FROM video_generations WHERE id=? AND deleted_at IS NULL').get(Number(videoGenerationId));
  if (!row) throw new Error('视频生成记录不存在');
  const existing = db.prepare('SELECT * FROM video_upscale_jobs WHERE video_generation_id=?').get(row.id);
  if (existing) return existing;
  const resolution = String(requestedResolution || targetResolution(db, row)).toLowerCase();
  if (!['720p', '1080p'].includes(resolution)) throw new Error('超分目标仅支持 720p 或 1080p');
  const authorization = createAuthorization(db, row, resolution);
  const now = new Date().toISOString();
  const info = db.prepare(`INSERT INTO video_upscale_jobs
    (video_generation_id, owner_user_id, billing_authorization_id, target_resolution, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'awaiting_source', ?, ?)`).run(row.id, row.owner_user_id, authorization.authorization_id, resolution, now, now);
  db.prepare(`UPDATE video_generations SET upscale_resolution=?, upscale_job_id=?, upscale_status='awaiting_source',
    upscale_billing_authorization_id=?, updated_at=? WHERE id=?`)
    .run(resolution, info.lastInsertRowid, authorization.authorization_id, now, row.id);
  return db.prepare('SELECT * FROM video_upscale_jobs WHERE id=?').get(info.lastInsertRowid);
}

function ensureJob(db, row, sourceLocalPath) {
  let job = db.prepare('SELECT * FROM video_upscale_jobs WHERE video_generation_id=?').get(row.id);
  if (!job) job = reserveForGeneration(db, row.id, row.upscale_resolution);
  if (!job.source_local_path && sourceLocalPath) {
    db.prepare("UPDATE video_upscale_jobs SET source_local_path=?, status='pending', updated_at=? WHERE id=?")
      .run(sourceLocalPath, new Date().toISOString(), job.id);
  }
  return db.prepare('SELECT * FROM video_upscale_jobs WHERE id=?').get(job.id);
}

async function downloadResult(url, storagePath, row, job) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`超分结果下载失败（HTTP ${response.status}）`);
  const sourceAbs = path.join(storagePath, job.source_local_path);
  const dir = path.dirname(sourceAbs);
  fs.mkdirSync(dir, { recursive: true });
  const relative = path.join(path.relative(storagePath, dir), `vg_${row.id}_upscaled_${job.target_resolution}.mp4`).replace(/\\/g, '/');
  const absolute = path.join(storagePath, relative);
  fs.writeFileSync(absolute, Buffer.from(await response.arrayBuffer()));
  if (!fs.existsSync(absolute) || fs.statSync(absolute).size === 0) throw new Error('超分结果为空');
  return relative;
}

function targetSatisfied(probe, target) {
  const shortEdge = Math.min(probe.width, probe.height);
  if (target === '1080p') return shortEdge >= 1040;
  return shortEdge >= 700;
}

async function process(db, log, videoGenerationId, storagePath) {
  if (active.has(Number(videoGenerationId))) return null;
  active.add(Number(videoGenerationId));
  let job;
  try {
    const row = db.prepare('SELECT * FROM video_generations WHERE id=? AND deleted_at IS NULL').get(Number(videoGenerationId));
    if (!row?.source_local_path) throw new Error('超分缺少本地源视频');
    job = ensureJob(db, row, row.source_local_path);
    if (job.status === 'completed' && job.output_local_path) {
      db.prepare("UPDATE video_generations SET upscale_status='completed', upscale_local_path=?, updated_at=? WHERE id=?")
        .run(job.output_local_path, new Date().toISOString(), row.id);
      return { local_path: job.output_local_path, duration_ms: job.output_duration_ms, resolution: job.output_resolution, fps: job.output_fps, provider_request_id: job.provider_request_id, reused: true };
    }
    const sourceProbe = probeVideoMedia(path.join(storagePath, row.source_local_path));
    if (Math.min(sourceProbe.width, sourceProbe.height) < 360 || Math.max(sourceProbe.width, sourceProbe.height) > 1920) {
      throw new Error(`超分输入规格不受支持：${sourceProbe.width}x${sourceProbe.height}`);
    }
    if (!job.provider_task_id) {
      const uploaded = await client.uploadLocalVideo(db, path.join(storagePath, row.source_local_path));
      const submitted = await client.submit(db, {
        video_url: uploaded.file_id, resolution: job.target_resolution, client_token: `vg-up-${row.id}`,
        callback_args: JSON.stringify({ video_generation_id: row.id, stage: 'upscale' }),
      });
      const now = new Date().toISOString();
      db.prepare("UPDATE video_upscale_jobs SET provider_task_id=?, provider_request_id=?, input_video_url=?, status='processing', attempts=attempts+1, updated_at=? WHERE id=?")
        .run(submitted.task_id, submitted.request_id || uploaded.request_id, uploaded.file_id, now, job.id);
      db.prepare("UPDATE video_generations SET status='upscaling', upscale_status='processing', updated_at=? WHERE id=?").run(now, row.id);
      job = db.prepare('SELECT * FROM video_upscale_jobs WHERE id=?').get(job.id);
    }
    let result;
    const settings = client.config(db).settings;
    const maxAttempts = Math.max(1, Number(settings.upscale_poll_max_attempts || settings.poll_max_attempts || 720));
    const interval = Math.max(1000, Number(settings.poll_interval_ms || 5000));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      result = await client.retrieve(db, job.provider_task_id);
      if (result.status === 'completed' || result.status === 'failed') break;
      await wait(interval);
    }
    if (result?.status !== 'completed' || !result?.result?.video_url) throw new Error(result?.error?.message || 'AI MediaKit 超分超时或失败');
    const localPath = await downloadResult(result.result.video_url, storagePath, row, job);
    const outputProbe = probeVideoMedia(path.join(storagePath, localPath));
    if (!targetSatisfied(outputProbe, job.target_resolution)) throw new Error(`超分输出未达到 ${job.target_resolution}：${outputProbe.width}x${outputProbe.height}`);
    if (Math.abs(outputProbe.fps - sourceProbe.fps) > 1) throw new Error(`超分阶段意外改变帧率：${sourceProbe.fps}fps → ${outputProbe.fps}fps`);
    const sourceRatio = sourceProbe.width / sourceProbe.height;
    const outputRatio = outputProbe.width / outputProbe.height;
    if ((sourceRatio > 1) !== (outputRatio > 1) || Math.abs(outputRatio / sourceRatio - 1) > 0.08) {
      throw new Error(`超分阶段画幅比例偏差过大：${sourceProbe.width}x${sourceProbe.height} → ${outputProbe.width}x${outputProbe.height}`);
    }
    const pricingContext = { resolution_tier: resolutionTier(outputProbe), fps_tier: fpsTier(outputProbe.fps) };
    const quote = billing.quote(db, { id: row.owner_user_id, role: 'admin' }, {
      service_type: 'video_postprocess', model: BILLING_MODEL,
      usage: { millisecond: outputProbe.duration_ms }, pricing_context: pricingContext,
    });
    const authorization = billing.getAuthorization(db, job.billing_authorization_id);
    if (quote.amount_micro > Number(authorization?.amount_micro || 0)) {
      billing.markPendingReconciliation(db, { id: row.owner_user_id, role: 'admin' }, job.billing_authorization_id, {
        provider_request_id: result.request_id || job.provider_request_id || job.provider_task_id,
        observed_usage: { millisecond: outputProbe.duration_ms },
        reason: `超分实际规格 ${pricingContext.resolution_tier}/${pricingContext.fps_tier} 超出预授权`,
      });
      const now = new Date().toISOString();
      db.prepare(`UPDATE video_upscale_jobs SET status='reconciliation_required', output_local_path=?, output_width=?, output_height=?,
        output_duration_ms=?, output_resolution=?, output_fps=?, error_msg=?, updated_at=? WHERE id=?`)
        .run(localPath, outputProbe.width, outputProbe.height, outputProbe.duration_ms, outputProbe.resolution, outputProbe.fps, '超分实际费用超过预授权', now, job.id);
      db.prepare("UPDATE video_generations SET status='billing_reconciliation', upscale_status='reconciliation_required', error_msg=?, updated_at=? WHERE id=?")
        .run('超分已完成但实际费用超过预授权，等待管理员对账', now, row.id);
      const error = new Error('超分实际费用超过预授权，已进入待对账'); error.reconciliationRequired = true; throw error;
    }
    billing.settleAuthorization(db, { id: row.owner_user_id, role: 'admin' }, job.billing_authorization_id, {
      usage: { millisecond: outputProbe.duration_ms }, provider_request_id: result.request_id || job.provider_request_id || job.provider_task_id,
    });
    const now = new Date().toISOString();
    db.prepare(`UPDATE video_upscale_jobs SET status='completed', output_local_path=?, output_width=?, output_height=?, output_duration_ms=?,
      output_resolution=?, output_fps=?, provider_request_id=?, completed_at=?, updated_at=? WHERE id=?`)
      .run(localPath, outputProbe.width, outputProbe.height, outputProbe.duration_ms, outputProbe.resolution, outputProbe.fps, result.request_id || job.provider_request_id, now, now, job.id);
    db.prepare("UPDATE video_generations SET upscale_status='completed', upscale_local_path=?, updated_at=? WHERE id=?").run(localPath, now, row.id);
    return { local_path: localPath, duration_ms: outputProbe.duration_ms, width: outputProbe.width, height: outputProbe.height, resolution: outputProbe.resolution, fps: outputProbe.fps, provider_request_id: result.request_id || job.provider_request_id };
  } catch (error) {
    const now = new Date().toISOString();
    if (error.reconciliationRequired) { log.error('Video upscale requires billing reconciliation', { video_generation_id: videoGenerationId, error: error.message }); return null; }
    if (job) {
      db.prepare("UPDATE video_upscale_jobs SET status='failed', error_msg=?, updated_at=? WHERE id=?").run(String(error.message).slice(0, 500), now, job.id);
      try { billing.voidAuthorization(db, { id: job.owner_user_id, role: 'admin' }, job.billing_authorization_id, '视频超分失败'); } catch (_) {}
    }
    db.prepare("UPDATE video_generations SET status='failed', upscale_status='failed', error_msg=?, updated_at=? WHERE id=?").run(String(error.message).slice(0, 500), now, Number(videoGenerationId));
    log.error('Video upscale failed', { video_generation_id: videoGenerationId, error: error.message });
    return null;
  } finally { active.delete(Number(videoGenerationId)); }
}

function resumePending(db, log, storagePath) {
  let rows = [];
  try {
    rows = db.prepare(`SELECT j.video_generation_id FROM video_upscale_jobs j JOIN video_generations v ON v.id=j.video_generation_id
      WHERE j.status IN ('awaiting_source','pending','processing') AND v.deleted_at IS NULL
        AND v.source_local_path IS NOT NULL AND TRIM(v.source_local_path) != '' ORDER BY j.id`).all();
  } catch (_) {}
  for (const row of rows) setImmediate(async () => {
    const result = await process(db, log, row.video_generation_id, storagePath);
    if (result?.local_path) await require('./videoService').resumePostprocessVideoGeneration(db, log, row.video_generation_id);
  });
  return { queued: rows.length };
}

module.exports = { process, resumePending, reserveForGeneration, ensureJob, createAuthorization, targetResolution, targetSatisfied, BILLING_MODEL };
