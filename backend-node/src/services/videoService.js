/** 轮询/同步返回的 video_url 须为 http(s)，避免中转 FAILURE 时 result_url 为错误文案 */
function resolveRemoteVideoUrl(videoUrl, fallbackError) {
  if (videoUrl && videoClient.isPlausibleHttpVideoUrl(videoUrl)) {
    return { ok: true, video_url: String(videoUrl).trim() };
  }
  if (videoUrl) {
    return { ok: false, error: (fallbackError || String(videoUrl)).slice(0, 500) };
  }
  return { ok: false, error: (fallbackError || '超时或失败').slice(0, 500) };
}

// 本地视频是持久化结果，优先于厂商返回的带过期时间签名 URL。
function publicVideoUrl(videoUrl, localPath) {
  const local = localPath && String(localPath).trim();
  if (local && /\.(?:mp4|webm|mov|m4v|avi|mkv)(?:[?#].*)?$/i.test(local)) {
    return `/static/${local.replace(/^\/+/, '')}`;
  }
  // Provider delivery URLs (notably Volcengine/TOS) are signed and expire.
  // A generated video is public only after its bytes have been archived here.
  return null;
}

/** 将 video_generations 标为失败；若无 error_msg 列则只更新 status/updated_at */
function setVideoGenFailed(db, videoGenId, errorMsg, now) {
  try {
    db.prepare('UPDATE video_generations SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?').run(
      'failed', (errorMsg || '').slice(0, 500), now, videoGenId
    );
  } catch (e) {
    if ((e.message || '').includes('error_msg')) {
      db.prepare('UPDATE video_generations SET status = ?, updated_at = ? WHERE id = ?').run('failed', now, videoGenId);
    } else throw e;
  }
  try {
    const row = db.prepare('SELECT owner_user_id, billing_authorization_id, storyboard_id FROM video_generations WHERE id = ?').get(videoGenId);
    if (row?.owner_user_id && row?.billing_authorization_id) {
      require('./billingService').voidAuthorization(db, { id: row.owner_user_id, role: 'admin' }, row.billing_authorization_id, errorMsg || '视频生成失败');
    }
    // Only the version explicitly selected by the storyboard can change its
    // visible state. A late failure of an old history record must not replace
    // a newer adopted completed video.
    if (row?.storyboard_id) {
      try {
        db.prepare(`UPDATE storyboards SET active_video_generation_id=COALESCE(active_video_generation_id, ?),
          status='failed', error_msg=?, updated_at=?
          WHERE id=? AND deleted_at IS NULL AND (active_video_generation_id IS NULL OR active_video_generation_id=?)`)
          .run(videoGenId, (errorMsg || '视频生成失败').slice(0, 500), now, row.storyboard_id, videoGenId);
      } catch (_) {}
    }
    const interpolation = db.prepare('SELECT owner_user_id, billing_authorization_id FROM video_interpolation_jobs WHERE video_generation_id=?').get(videoGenId);
    if (interpolation?.billing_authorization_id) {
      require('./billingService').voidAuthorization(db, { id: interpolation.owner_user_id, role: 'admin' }, interpolation.billing_authorization_id, '视频生成失败，插帧未调用');
      db.prepare("UPDATE video_interpolation_jobs SET status='cancelled', error_msg=?, updated_at=? WHERE video_generation_id=?")
        .run(String(errorMsg || '视频生成失败').slice(0, 500), now, videoGenId);
    }
    const upscale = db.prepare('SELECT owner_user_id, billing_authorization_id FROM video_upscale_jobs WHERE video_generation_id=?').get(videoGenId);
    if (upscale?.billing_authorization_id) {
      require('./billingService').voidAuthorization(db, { id: upscale.owner_user_id, role: 'admin' }, upscale.billing_authorization_id, '视频生成失败，超分未调用');
      db.prepare("UPDATE video_upscale_jobs SET status='cancelled', error_msg=?, updated_at=? WHERE video_generation_id=?")
        .run(String(errorMsg || '视频生成失败').slice(0, 500), now, videoGenId);
    }
  } catch (_) {}
}

function list(db, query) {
  let sql = 'FROM video_generations WHERE deleted_at IS NULL';
  const params = [];
  if (query.owner_user_id) {
    sql += ' AND owner_user_id = ?';
    params.push(Number(query.owner_user_id));
  }
  if (query.drama_id) {
    sql += ' AND drama_id = ?';
    params.push(query.drama_id);
  }
  // Re-generating an episode soft-deletes its former storyboard rows and
  // creates replacements with new IDs. Match the previous rows by episode +
  // storyboard number as well, so their completed videos remain visible in
  // the replacement shot's history.
  if (query.episode_id && query.storyboard_number != null) {
    sql += ` AND storyboard_id IN (
      SELECT id FROM storyboards WHERE episode_id = ? AND storyboard_number = ?
    )`;
    params.push(query.episode_id, query.storyboard_number);
  } else if (query.storyboard_id) {
    sql += ' AND storyboard_id = ?';
    params.push(query.storyboard_id);
  }
  // 与 Go 前端行为对齐：请求 status=processing 时，同时包含“刚结束”的记录（5 分钟内变为 completed/failed），
  // 这样轮询刷新后任务不会从列表消失，无需改 Vue
  if (query.status === 'processing') {
    sql += " AND (status IN ('processing','upscale_pending','upscaling','interpolation_pending','interpolating','persisting') OR (status IN ('completed','failed') AND updated_at >= datetime('now', '-5 minutes')))";
  } else if (query.status) {
    sql += ' AND status = ?';
    params.push(query.status);
  }
  const countRow = db.prepare('SELECT COUNT(*) as total ' + sql).get(...params);
  const total = countRow.total || 0;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;
  const rows = db.prepare('SELECT * ' + sql + ' ORDER BY created_at DESC LIMIT ? OFFSET ?').all(...params, pageSize, offset);
  return { items: rows.map((row) => rowToItem(withTaskProgress(db, row))), total, page, pageSize };
}

function withTaskProgress(db, row) {
  if (!row?.task_id) return row;
  const task = db.prepare('SELECT progress, message, updated_at FROM async_tasks WHERE id=? AND deleted_at IS NULL').get(row.task_id);
  return task ? { ...row, task_progress: task.progress, task_message: task.message, task_updated_at: task.updated_at } : row;
}

function rowToItem(r) {
  return {
    id: r.id,
    storyboard_id: r.storyboard_id,
    drama_id: r.drama_id,
    provider: r.provider,
    prompt: r.prompt,
    model: r.model,
    duration: r.duration,
    aspect_ratio: r.aspect_ratio,
    resolution: r.resolution || null,
    requested_resolution: r.resolution || null,
    image_gen_id: r.image_gen_id,
    image_url: r.image_url,
    video_url: publicVideoUrl(r.video_url, r.local_path),
    local_path: r.local_path,
    source_local_path: r.source_local_path || null,
    upscale_resolution: r.upscale_resolution || null,
    upscale_status: r.upscale_status || null,
    upscale_job_id: r.upscale_job_id || null,
    upscale_local_path: r.upscale_local_path || null,
    interpolation_status: r.interpolation_status || null,
    interpolation_job_id: r.interpolation_job_id || null,
    target_fps: r.target_fps || null,
    output_width: r.output_width || null,
    output_height: r.output_height || null,
    output_resolution: r.output_resolution || null,
    output_fps: r.output_fps || null,
    output_duration_ms: r.output_duration_ms || null,
    postprocess_chain: `${require('./videoPostprocessPolicy').describe({
      resolution: r.resolution || null,
      upscale_resolution: r.upscale_resolution || null,
      target_fps: r.target_fps || null,
    })} → 本地规范 ${r.aspect_ratio || '原画幅'}`,
    poster_local_path: r.poster_local_path || null,
    status: r.status,
    task_id: r.task_id,
    task_progress: r.task_progress == null ? null : Number(r.task_progress),
    task_message: r.task_message || null,
    task_updated_at: r.task_updated_at || null,
    error_msg: r.error_msg,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at,
  };
}

function getById(db, id) {
  const r = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return r ? rowToItem(withTaskProgress(db, r)) : null;
}

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const videoClient = require('./videoClient');
const taskService = require('./taskService');
const storageLayout = require('./storageLayout');
const { getFfmpegPath, hasLocalFfmpeg } = require('../utils/ffmpegPath');

/** @returns {{ dir: string, relPrefix: string }} 与图片 uploads 一致的工程子目录规则 */
function resolveVideosDir(storagePath, projectSubdir) {
  const sub = projectSubdir && String(projectSubdir).trim();
  if (sub) {
    const relPrefix = `${sub.replace(/\\/g, '/')}/videos`;
    return { dir: path.join(storagePath, sub, 'videos'), relPrefix };
  }
  return { dir: path.join(storagePath, 'videos'), relPrefix: 'videos' };
}

/**
 * 将远程 video_url 下载到本地
 * @returns {string|null} 相对 storage 根的路径，如 projects/.../videos/vg_1_xxx.mp4；无工程时为 videos/...
 */
async function downloadVideoToLocal(storagePath, videoUrl, videoGenId, log, projectSubdir = null) {
  if (!videoUrl || typeof videoUrl !== 'string') return null;
  const { dir, relPrefix } = resolveVideosDir(storagePath, projectSubdir);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ext = (videoUrl.split('?')[0].match(/\.(mp4|webm|mov)$/i) || [])[1] || 'mp4';
    const name = `vg_${videoGenId}_${randomUUID().slice(0, 8)}.${ext}`;
    const filePath = path.join(dir, name);
    const res = await fetch(videoUrl, { method: 'GET' });
    if (!res.ok) {
      log.warn('Download video failed', { status: res.status, videoGenId });
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) {
      log.warn('Download video returned an empty body', { videoGenId });
      return null;
    }
    fs.writeFileSync(filePath, buf);
    const relativePath = `${relPrefix}/${name}`.replace(/\\/g, '/');
    log.info('Video saved to local', { videoGenId, local_path: relativePath, projectSubdir: projectSubdir || '(root)' });
    return relativePath;
  } catch (e) {
    log.warn('Download video error', { videoGenId, error: e.message });
    return null;
  }
}

function markVideoArchivePending(db, log, videoGenId, error) {
  const at = new Date().toISOString();
  const message = String(error?.message || 'OSS 归档待重试').slice(0, 500);
  try {
    db.prepare('UPDATE video_generations SET archive_status = ?, archive_error = ?, archive_attempts = COALESCE(archive_attempts, 0) + 1, updated_at = ? WHERE id = ?')
      .run('pending', message, at, videoGenId);
  } catch (_) {}
  log.warn('Video OSS archive pending retry; local delivery remains available', { id: videoGenId, error: message });
}

async function archiveCompletedVideo(db, log, videoGenId, cfg = null) {
  const row = db.prepare('SELECT id, local_path, status FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(videoGenId));
  if (!row?.local_path || row.status !== 'completed') return { skipped: 'not_completed_local_video' };
  cfg = cfg || require('../config').loadConfig();
  const storage = require('./mediaStorageService');
  if (!storage.isOss(cfg)) {
    try { db.prepare('UPDATE video_generations SET archive_status = ?, archive_error = NULL, archived_at = ? WHERE id = ?').run('local', new Date().toISOString(), row.id); } catch (_) {}
    return { provider: 'local' };
  }
  try {
    const saved = await storage.mirrorAndTrack(db, cfg, resolveStoragePath(cfg), row.local_path, 'video_generation', row.id, log);
    const at = new Date().toISOString();
    try { db.prepare('UPDATE video_generations SET archive_status = ?, archive_error = NULL, archive_attempts = COALESCE(archive_attempts, 0) + 1, archived_at = ?, updated_at = ? WHERE id = ?').run('oss_synced', at, at, row.id); } catch (_) {}
    return saved;
  } catch (error) {
    markVideoArchivePending(db, log, row.id, error);
    return { provider: 'oss', pending: true, error: error.message };
  }
}

/** Resolve an exact aspect canvas from the requested short-edge tier. This
 * preserves 16:9/9:16/etc. without the former unconditional 2K enlargement. */
function targetVideoPixelsForAspect(aspectRatio, resolution, sourceProbe = null) {
  const normalized = videoClient.normalizeAspectRatioForApi(aspectRatio) || '16:9';
  const match = normalized.match(/^(\d+)\s*:\s*(\d+)$/);
  const a = Number(match?.[1] || 16);
  const b = Number(match?.[2] || 9);
  const requested = String(resolution || '').toLowerCase();
  const shortEdge = requested.includes('1080') ? 1080
    : requested.includes('720') ? 720
      : requested.includes('480') ? 480
        : Math.max(2, Math.round(Math.min(Number(sourceProbe?.width || 720), Number(sourceProbe?.height || 720)) / 2) * 2);
  const even = (value) => Math.max(2, Math.round(Number(value) / 2) * 2);
  if (a >= b) return { w: even(shortEdge * a / b), h: even(shortEdge), aspect_ratio: normalized, short_edge: shortEdge };
  return { w: even(shortEdge), h: even(shortEdge * b / a), aspect_ratio: normalized, short_edge: shortEdge };
}

/**
 * 用 ffmpeg 将视频缩放并加黑边到固定分辨率，避免 Grok 等返回实际像素不一致导致连播时画面跳动。
 */
function normalizeVideoFileToTargetPixels(absPath, tw, th, log, videoGenId) {
  if (!absPath || !tw || !th || !fs.existsSync(absPath)) return false;
  if (!hasLocalFfmpeg()) {
    log.info('[视频] 未找到 ffmpeg，跳过画幅归一化', { videoGenId });
    return false;
  }
  const ffmpeg = getFfmpegPath();
  const vf = `scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:black`;
  const tmpOut = absPath + '.norm-' + randomUUID().slice(0, 8) + (path.extname(absPath) || '.mp4');
  const baseArgs = ['-y', '-i', absPath, '-vf', vf, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  let r = spawnSync(ffmpeg, [...baseArgs, '-c:a', 'copy', tmpOut], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    r = spawnSync(ffmpeg, [...baseArgs, '-an', tmpOut], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  }
  if (r.status !== 0) {
    log.warn('[视频] 画幅归一化失败（保留原文件）', {
      videoGenId,
      stderr: (r.stderr || '').slice(-500),
    });
    try {
      fs.unlinkSync(tmpOut);
    } catch (_) {}
    return false;
  }
  try {
    fs.unlinkSync(absPath);
    fs.renameSync(tmpOut, absPath);
    log.info('[视频] 已统一画幅尺寸', { videoGenId, w: tw, h: th });
    return true;
  } catch (e) {
    log.warn('[视频] 替换归一化文件失败', { videoGenId, error: e.message });
    try {
      fs.unlinkSync(tmpOut);
    } catch (_) {}
    return false;
  }
}

function maybeNormalizeVideoAfterDownload(storagePath, localPath, row, videoGenId, log) {
  // Preserve the supplier's original pixels. Aspect ratio is a composition
  // contract, not permission to upscale a 480p/720p result to a fixed 2K
  // canvas. Explicit, separately billed enhancement must create a new file.
  return false;
}

function normalizeFinalVideoToContract(storagePath, localPath, row, videoGenId, log) {
  const probe = require('./videoMediaProbeService').probeVideoMedia(path.join(storagePath, localPath));
  const target = targetVideoPixelsForAspect(row.aspect_ratio, row.upscale_resolution || row.resolution, probe);
  if (probe.width === target.w && probe.height === target.h) return { local_path: localPath, probe, target, normalized: false };
  const sourceRatio = probe.width / probe.height;
  const targetRatio = target.w / target.h;
  if (Math.abs(sourceRatio / targetRatio - 1) > 0.08) {
    throw new Error(`供应商成片画幅 ${probe.width}x${probe.height} 与请求 ${target.aspect_ratio} 偏差超过 8%，拒绝大幅裁切`);
  }
  if (!hasLocalFfmpeg()) throw new Error(`最终成片 ${probe.width}x${probe.height} 未满足 ${target.aspect_ratio} / ${target.w}x${target.h}，且本机缺少 ffmpeg`);
  const source = path.join(storagePath, localPath);
  // With no paid post-process stage, normalize in place so the original
  // output remains the single retained artifact. Paid stages retain their
  // output until the new final canvas has passed validation.
  const replaceInput = !row.upscale_resolution && !row.target_fps;
  const relative = replaceInput
    ? localPath
    : path.join(path.dirname(localPath), `vg_${videoGenId}_final_${target.w}x${target.h}.mp4`).replace(/\\/g, '/');
  const output = path.join(storagePath, relative);
  const tempOutput = replaceInput
    ? output + `.norm-${randomUUID().slice(0, 8)}${path.extname(output) || '.mp4'}`
    : output;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const filter = `scale=${target.w}:${target.h}:force_original_aspect_ratio=increase,crop=${target.w}:${target.h}`;
  const base = ['-y', '-i', source, '-vf', filter, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  let result = spawnSync(getFfmpegPath(), [...base, '-c:a', 'copy', tempOutput], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) result = spawnSync(getFfmpegPath(), [...base, '-c:a', 'aac', '-b:a', '192k', tempOutput], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 || !fs.existsSync(tempOutput) || fs.statSync(tempOutput).size === 0) {
    try { fs.unlinkSync(tempOutput); } catch (_) {}
    throw new Error(`最终成片画幅规范化失败：${String(result.stderr || '').slice(-300)}`);
  }
  const finalProbe = require('./videoMediaProbeService').probeVideoMedia(tempOutput);
  const durationTolerance = Math.max(250, probe.duration_ms * 0.02);
  if (finalProbe.width !== target.w || finalProbe.height !== target.h
    || Math.abs(finalProbe.fps - probe.fps) > 1
    || Math.abs(finalProbe.duration_ms - probe.duration_ms) > durationTolerance) {
    try { fs.unlinkSync(tempOutput); } catch (_) {}
    throw new Error(`最终成片规范验收失败：期望 ${target.w}x${target.h}/${probe.fps}fps，实际 ${finalProbe.width}x${finalProbe.height}/${finalProbe.fps}fps`);
  }
  if (replaceInput) {
    try { fs.renameSync(tempOutput, output); } catch (error) {
      try { fs.unlinkSync(tempOutput); } catch (_) {}
      throw new Error(`最终成片规范化替换失败：${error.message}`);
    }
  }
  log.info('Final video normalized to requested aspect contract', { video_generation_id: videoGenId, from: `${probe.width}x${probe.height}`, to: `${target.w}x${target.h}`, aspect_ratio: target.aspect_ratio });
  return { local_path: relative, probe: finalProbe, target, normalized: true };
}

/**
 * New generations opt in to keeping exactly one video artifact. This function
 * only runs after final validation and the completed row are durable; legacy
 * rows keep their historical source paths and bytes unchanged.
 */
function pruneSupersededVideoArtifacts(db, storagePath, videoGenId, finalLocalPath, log) {
  const row = db.prepare('SELECT source_local_path, upscale_local_path, intermediate_cleanup_enabled FROM video_generations WHERE id=?').get(Number(videoGenId));
  if (!row || Number(row.intermediate_cleanup_enabled) !== 1) return { skipped: 'legacy_or_disabled' };
  const root = path.resolve(storagePath);
  const finalKey = String(finalLocalPath || '').replace(/\\/g, '/');
  const candidates = [...new Set([row.source_local_path, row.upscale_local_path].filter(Boolean).map((item) => String(item).replace(/\\/g, '/')))]
    .filter((item) => item !== finalKey);
  const removed = [];
  for (const relative of candidates) {
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root + path.sep)) {
      log.warn('Refused to remove video artifact outside storage root', { video_generation_id: videoGenId, local_path: relative });
      continue;
    }
    try {
      if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
      removed.push(relative);
    } catch (error) {
      log.warn('Could not remove superseded local video artifact', { video_generation_id: videoGenId, local_path: relative, error: error.message });
    }
  }
  if (removed.length) {
    const sourceRemoved = row.source_local_path && removed.includes(String(row.source_local_path).replace(/\\/g, '/'));
    const upscaleRemoved = row.upscale_local_path && removed.includes(String(row.upscale_local_path).replace(/\\/g, '/'));
    db.prepare('UPDATE video_generations SET source_local_path=?, upscale_local_path=?, updated_at=? WHERE id=?').run(
      sourceRemoved ? null : row.source_local_path,
      upscaleRemoved ? null : row.upscale_local_path,
      new Date().toISOString(), Number(videoGenId));
  }
  return { removed };
}

function createVideoPoster(storagePath, localPath, videoGenId, log) {
  if (!localPath || !hasLocalFfmpeg()) return null;
  try {
    const source = path.join(storagePath, localPath);
    const relativeDir = path.join(path.dirname(localPath), 'posters');
    const outputDir = path.join(storagePath, relativeDir);
    fs.mkdirSync(outputDir, { recursive: true });
    const fileName = `vg_${videoGenId}.jpg`;
    const output = path.join(outputDir, fileName);
    const result = spawnSync(getFfmpegPath(), ['-y', '-ss', '0.12', '-i', source, '-frames:v', '1', '-vf', 'thumbnail,scale=640:-2', '-q:v', '3', output], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (result.status === 0 && fs.existsSync(output)) return path.join(relativeDir, fileName).replace(/\\/g, '/');
    log.warn('视频海报提取失败', { video_gen_id: videoGenId, status: result.status });
  } catch (error) { log.warn('视频海报提取失败', { video_gen_id: videoGenId, error: error.message }); }
  return null;
}

/** 防止同一 videoGenId 重复发起 poll（含重启恢复） */
const activeVideoPolls = new Set();

function resolveStoragePath(cfg) {
  return path.isAbsolute(cfg.storage?.local_path)
    ? cfg.storage.local_path
    : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
}

function settleGenerationBeforePostProcess(db, log, row, videoGenId, providerUsage, providerRequestId) {
  if (!row?.owner_user_id || !row?.billing_authorization_id) return;
  try {
    const billing = require('./billingService');
    const auth = billing.getAuthorization(db, row.billing_authorization_id);
    const usage = require('./billingUsageService').textUsage(providerUsage);
    if (require('./billingUsageService').hasTokenMeter(auth?.snapshot) && !usage) {
      billing.markPendingReconciliation(db, { id: row.owner_user_id, role: 'admin' }, row.billing_authorization_id, {
        provider_request_id: providerRequestId || `video-generation:${videoGenId}`,
        reason: '视频供应商成功响应但未返回实际 token 用量',
      });
    } else {
      billing.settleAuthorization(db, { id: row.owner_user_id, role: 'admin' }, row.billing_authorization_id, {
        usage: usage || auth?.snapshot?.usage, provider_request_id: providerRequestId || `video-generation:${videoGenId}`,
      });
    }
  } catch (error) {
    log.error('[billing] generation settlement before interpolation failed', { video_gen_id: videoGenId, error: error.message });
  }
}

async function finalizeSuccessfulVideo(db, log, videoGenId, row, rowForAspect, videoUrl, logLabel, providerUsage = null, providerRequestId = null, providerResponseSnapshot = null) {
  const now = new Date().toISOString();
  let localPath = null;
  let storagePath = null;
  try {
    const cfg = require('../config').loadConfig();
    storagePath = resolveStoragePath(cfg);
    const projectSubdir = storageLayout.getProjectStorageSubdir(db, row.drama_id);
    const localStaticPath = String(videoUrl || '').startsWith('/static/')
      ? decodeURIComponent(String(videoUrl).slice('/static/'.length).split(/[?#]/)[0]).replace(/^\/+/, '')
      : null;
    if (localStaticPath && fs.existsSync(path.join(storagePath, localStaticPath))) localPath = localStaticPath;
    else localPath = await downloadVideoToLocal(storagePath, videoUrl, videoGenId, log, projectSubdir);
    maybeNormalizeVideoAfterDownload(storagePath, localPath, rowForAspect, videoGenId, log);
    // 全能工作台选择“成片后混音”时，生成完成后创建新成片，不覆盖原供应商结果。
    const postMix = db.prepare(`SELECT a.snapshot_json, j.request_snapshot_json FROM omni_video_jobs j
      JOIN omni_video_job_assets a ON a.omni_job_id = j.id
      WHERE j.video_generation_id = ? AND j.audio_strategy = 'post_mix' AND a.media_type = 'audio'
      ORDER BY a.ordinal LIMIT 1`).get(Number(videoGenId));
    if (postMix?.snapshot_json && localPath) {
      const audio = JSON.parse(postMix.snapshot_json);
      if (audio.local_path) {
        const processor = require('./omniMediaProcessService');
        const requestSnapshot = JSON.parse(postMix.request_snapshot_json || '{}');
        localPath = processor.mixAudio(localPath, audio.local_path, log, requestSnapshot.post_process || {});
        const baseUrl = cfg.storage?.base_url ? String(cfg.storage.base_url).replace(/\/$/, '') : '';
        videoUrl = baseUrl ? `${baseUrl}/${localPath}` : `/static/${localPath}`;
      }
    }
  } catch (error) {
    log.warn('全能视频本地归档/后期处理失败', { video_gen_id: videoGenId, error: error.message });
    // No local bytes exist, so this is a genuine generation-delivery failure.
    setVideoGenFailed(db, videoGenId, '视频下载或本地处理失败：' + error.message, new Date().toISOString());
    if (row?.task_id) taskService.updateTaskError(db, row.task_id, '视频下载或本地处理失败');
    return;
  }
  if (!localPath) {
    setVideoGenFailed(db, videoGenId, '视频下载失败，供应商临时地址未能归档到本地', new Date().toISOString());
    if (row?.task_id) taskService.updateTaskError(db, row.task_id, '视频下载失败');
    return;
  }
  // Generation and interpolation are independent billable supplier calls.
  // Settle the first call once its bytes exist even if post-processing fails.
  settleGenerationBeforePostProcess(db, log, row, videoGenId, providerUsage, providerRequestId);
  // Persist the supplier output before any optional post-processing. Each
  // selected stage owns its own authorization and creates a new local file.
  try {
    const sourceSavedAt = new Date().toISOString();
    db.prepare(`UPDATE video_generations SET source_local_path=?, upscale_status=?, interpolation_status=?, updated_at=? WHERE id=?`)
      .run(localPath,
        row.upscale_resolution ? (row.upscale_status === 'completed' ? 'completed' : 'awaiting_source') : 'skipped',
        row.target_fps ? (['completed', 'skipped'].includes(row.interpolation_status) ? row.interpolation_status : 'awaiting_source') : 'skipped',
        sourceSavedAt, videoGenId);

    if (row.upscale_resolution) {
      db.prepare("UPDATE video_generations SET status='upscale_pending', upscale_status='pending', updated_at=? WHERE id=?")
        .run(new Date().toISOString(), videoGenId);
      if (row.task_id) taskService.updateTaskStatus(db, row.task_id, 'processing', 78, `视频已生成，正在 AI 超分至 ${row.upscale_resolution}`);
      const upscaled = await require('./videoUpscaleService').process(db, log, videoGenId, storagePath);
      if (!upscaled?.local_path) {
        const current = db.prepare('SELECT status, error_msg FROM video_generations WHERE id=?').get(videoGenId);
        if (current?.status === 'billing_reconciliation') {
          if (row.task_id) taskService.updateTaskStatus(db, row.task_id, 'processing', 99, '超分已完成，等待计费对账');
          return;
        }
        // videoUpscaleService has already written the authoritative stage
        // failure (for example, MediaKit upload HTTP 500).  Do not overwrite
        // it with a generic message here, otherwise users cannot tell whether
        // the original generation or the enhancement stage failed.
        const message = current?.error_msg || 'AI 超分失败，原始视频已保留，可仅重试超分';
        if (current?.status !== 'failed') setVideoGenFailed(db, videoGenId, message, new Date().toISOString());
        if (row.task_id) taskService.updateTaskError(db, row.task_id, message);
        return;
      }
      localPath = upscaled.local_path;
      providerResponseSnapshot = {
        ...(providerResponseSnapshot || {}),
        upscale: { request_id: upscaled.provider_request_id, duration_ms: upscaled.duration_ms, resolution: upscaled.resolution, fps: upscaled.fps },
      };
    }

    if (row.target_fps) {
      db.prepare("UPDATE video_generations SET status='interpolation_pending', interpolation_status='pending', updated_at=? WHERE id=?")
        .run(new Date().toISOString(), videoGenId);
      if (row.task_id) taskService.updateTaskStatus(db, row.task_id, 'processing', 88, `${row.upscale_resolution ? '超分完成，' : ''}正在进行 ${Number(row.target_fps)}fps 智能插帧`);
      const interpolated = await require('./videoInterpolationService').process(db, log, videoGenId, storagePath);
      if (!interpolated?.local_path) {
        const current = db.prepare('SELECT status, error_msg FROM video_generations WHERE id=?').get(videoGenId);
        if (current?.status === 'billing_reconciliation') {
          if (row.task_id) taskService.updateTaskStatus(db, row.task_id, 'processing', 99, '插帧已完成，等待计费对账');
          return;
        }
        const message = current?.error_msg || '智能插帧失败，已保留上一阶段视频，可仅重试插帧';
        if (current?.status !== 'failed') setVideoGenFailed(db, videoGenId, message, new Date().toISOString());
        if (row.task_id) taskService.updateTaskError(db, row.task_id, message);
        return;
      }
      localPath = interpolated.local_path;
      providerResponseSnapshot = {
        ...(providerResponseSnapshot || {}),
        interpolation: interpolated.skipped
          ? { skipped: true, duration_ms: interpolated.duration_ms, resolution: interpolated.resolution, fps: interpolated.fps }
          : { request_id: interpolated.provider_request_id, duration_ms: interpolated.duration_ms, resolution: interpolated.resolution, fps: interpolated.fps },
      };
    }
  } catch (error) {
    setVideoGenFailed(db, videoGenId, '视频后处理失败：' + error.message, new Date().toISOString());
    if (row.task_id) taskService.updateTaskError(db, row.task_id, '视频后处理失败');
    return;
  }
  // Never persist a provider's signed delivery URL as the application's
  // completed-media URL. TOS links normally expire after 24 hours.
  db.prepare("UPDATE video_generations SET status='persisting', updated_at=? WHERE id=?").run(new Date().toISOString(), videoGenId);
  if (row.task_id) taskService.updateTaskStatus(db, row.task_id, 'processing', 95, '正在规范画幅并持久化最终成片');
  let finalProbe;
  try {
    const normalized = normalizeFinalVideoToContract(storagePath, localPath, rowForAspect || row, videoGenId, log);
    localPath = normalized.local_path;
    finalProbe = normalized.probe;
  } catch (error) {
    setVideoGenFailed(db, videoGenId, '最终成片画幅规范化失败：' + error.message, new Date().toISOString());
    if (row.task_id) taskService.updateTaskError(db, row.task_id, '最终成片画幅规范化失败');
    return;
  }
  videoUrl = `/static/${String(localPath).replace(/^\/+/, '')}`;
  const posterLocalPath = createVideoPoster(resolveStoragePath(require('../config').loadConfig()), localPath, videoGenId, log);
  try {
    db.prepare(
      'UPDATE video_generations SET status = ?, video_url = ?, local_path = ?, output_width=?, output_height=?, output_resolution=?, output_fps=?, output_duration_ms=?, archive_status = ?, archive_error = NULL, completed_at = ?, updated_at = ? WHERE id = ?'
    ).run('completed', videoUrl, localPath, finalProbe.width, finalProbe.height, finalProbe.resolution, finalProbe.fps, finalProbe.duration_ms, require('./mediaStorageService').isOss(require('../config').loadConfig()) ? 'pending' : 'local', new Date().toISOString(), new Date().toISOString(), videoGenId);
  } catch (e) {
    if ((e.message || '').includes('archive_')) {
      try {
        db.prepare(
          'UPDATE video_generations SET status = ?, video_url = ?, local_path = ?, completed_at = ?, updated_at = ? WHERE id = ?'
        ).run('completed', videoUrl, localPath, now, now, videoGenId);
      } catch (_) {
        db.prepare(
          'UPDATE video_generations SET status = ?, video_url = ?, local_path = ?, updated_at = ? WHERE id = ?'
        ).run('completed', videoUrl, localPath, now, videoGenId);
      }
    } else if ((e.message || '').includes('completed_at')) {
      db.prepare(
        'UPDATE video_generations SET status = ?, video_url = ?, local_path = ?, updated_at = ? WHERE id = ?'
      ).run('completed', videoUrl, localPath, now, videoGenId);
    } else throw e;
  }
  if (posterLocalPath) {
    try { db.prepare('UPDATE video_generations SET poster_local_path=? WHERE id=?').run(posterLocalPath, videoGenId); } catch (_) {}
  }
  if (providerResponseSnapshot) {
    try { db.prepare('UPDATE video_generations SET provider_response_snapshot_json = ? WHERE id = ?').run(JSON.stringify(providerResponseSnapshot), videoGenId); }
    catch (error) { log.warn('[billing] could not persist sanitized provider completion response', { video_gen_id: videoGenId, error: error.message }); }
  }
  // Only rows created after migration 55 opt in. Historical online records
  // retain both their database pointers and their local files.
  try { pruneSupersededVideoArtifacts(db, storagePath, videoGenId, localPath, log); }
  catch (error) { log.warn('Superseded video artifact cleanup failed', { video_generation_id: videoGenId, error: error.message }); }
  try {
    if (row?.owner_user_id && row?.billing_authorization_id) {
      const billing = require('./billingService');
      const auth = billing.getAuthorization(db, row.billing_authorization_id);
      const usage = require('./billingUsageService').textUsage(providerUsage);
      if (require('./billingUsageService').hasTokenMeter(auth?.snapshot) && !usage) {
        billing.markPendingReconciliation(db, { id: row.owner_user_id, role: 'admin' }, row.billing_authorization_id, {
          provider_request_id: providerRequestId || `video-generation:${videoGenId}`,
          reason: '视频供应商成功响应但未返回实际 token 用量',
        });
      } else {
        billing.settleAuthorization(db, { id: row.owner_user_id, role: 'admin' }, row.billing_authorization_id, {
          usage: usage || auth?.snapshot?.usage, provider_request_id: providerRequestId || `video-generation:${videoGenId}`,
        });
      }
    }
  } catch (err) {
    log.error('[billing] video settlement failed', { video_gen_id: videoGenId, error: err.message });
    // Preserve observed provider usage for an administrator when a historical
    // price snapshot cannot settle it (for example, a meter migration).
    try {
      if (row?.owner_user_id && row?.billing_authorization_id) {
        const observedUsage = require('./billingUsageService').textUsage(providerUsage);
        require('./billingService').markPendingReconciliation(db, { id: row.owner_user_id, role: 'admin' }, row.billing_authorization_id, {
          provider_request_id: providerRequestId || `video-generation:${videoGenId}`,
          observed_usage: observedUsage || undefined,
          reason: `视频结算失败，等待管理员核对供应商用量：${String(err.message || 'unknown error').slice(0, 180)}`,
        });
      }
    } catch (reconciliationError) {
      log.error('[billing] video settlement reconciliation failed', { video_gen_id: videoGenId, error: reconciliationError.message });
    }
  }
  if (row.storyboard_id) {
    try {
      db.prepare(`UPDATE storyboards SET active_video_generation_id=COALESCE(active_video_generation_id, ?), video_url=?, local_path=?,
        status='completed', error_msg=NULL, updated_at=?
        WHERE id=? AND deleted_at IS NULL AND (active_video_generation_id IS NULL OR active_video_generation_id=?)`).run(
        videoGenId, videoUrl, localPath, now, row.storyboard_id, videoGenId
      );
      log.info('Updated storyboard video' + (logLabel ? ` (${logLabel})` : ''), {
        storyboard_id: row.storyboard_id,
        video_url: videoUrl,
      });
    } catch (_) {}
  }
  if (row.task_id) {
    taskService.updateTaskResult(db, row.task_id, {
      video_generation_id: videoGenId,
      video_url: videoUrl,
      poster_local_path: posterLocalPath,
      status: 'completed',
    });
  }
  // OSS is a durability concern, not a user-visible generation-success gate.
  // Failure here leaves the completed local asset playable and schedules retry.
  await archiveCompletedVideo(db, log, videoGenId);
  log.info('Video generation completed' + (logLabel ? ` (${logLabel})` : ''), {
    id: videoGenId,
    video_url: videoUrl,
    local_path: localPath,
  });
}

async function pollProviderTaskAndFinalize(db, log, videoGenId, row, rowForAspect, providerTaskId, config) {
  const cfg = require('../config').loadConfig();
  const POLL_INTERVAL_MS = 10000;
  const { resolveVideoGenerationTimeoutMinutes } = require('../config/videoGeneration');
  const generationTimeoutMinutes = resolveVideoGenerationTimeoutMinutes(cfg);
  const pollMaxAttempts = Math.max(
    1,
    Math.ceil((generationTimeoutMinutes * 60 * 1000) / POLL_INTERVAL_MS)
  );
  const pollResult = await videoClient.pollVideoTask(
    db,
    log,
    videoGenId,
    providerTaskId,
    config,
    pollMaxAttempts,
    POLL_INTERVAL_MS
  );
  const now = new Date().toISOString();
  const polledVideo = resolveRemoteVideoUrl(pollResult.video_url, pollResult.error);
  if (polledVideo.ok) {
    await finalizeSuccessfulVideo(db, log, videoGenId, row, rowForAspect, polledVideo.video_url, 'after poll', pollResult.usage, pollResult.provider_request_id || providerTaskId, pollResult.provider_response_snapshot);
  } else {
    setVideoGenFailed(db, videoGenId, polledVideo.error, now);
    if (row.task_id) taskService.updateTaskError(db, row.task_id, polledVideo.error);
    log.error('Video generation failed (after poll)', { id: videoGenId, error: polledVideo.error });
  }
}

/**
 * 服务重启后恢复对厂商异步任务的轮询（需已持久化 provider_task_id）
 */
async function resumePollForVideoGeneration(db, log, videoGenId) {
  if (activeVideoPolls.has(videoGenId)) {
    log.info('Video poll already active, skip resume', { videoGenId });
    return;
  }
  const row = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(videoGenId));
  if (!row || row.status !== 'processing') return;
  const providerTaskId = row.provider_task_id && String(row.provider_task_id).trim();
  if (!providerTaskId) return;

  const config = videoClient.getDefaultVideoConfig(db, row.model);
  if (!config) {
    const now = new Date().toISOString();
    setVideoGenFailed(db, videoGenId, '未配置视频模型', now);
    if (row.task_id) taskService.updateTaskError(db, row.task_id, '未配置视频模型');
    return;
  }

  activeVideoPolls.add(videoGenId);
  log.info('Resuming video generation poll after restart', {
    videoGenId,
    provider_task_id: providerTaskId,
  });
  try {
    let aspectForVideo = row.aspect_ratio;
    if (aspectForVideo) {
      const n = videoClient.normalizeAspectRatioForApi(aspectForVideo);
      if (n) aspectForVideo = n;
    }
    const rowForAspect = { ...row, aspect_ratio: aspectForVideo || row.aspect_ratio };
    await pollProviderTaskAndFinalize(db, log, videoGenId, row, rowForAspect, providerTaskId, config);
  } catch (err) {
    const now = new Date().toISOString();
    setVideoGenFailed(db, videoGenId, err.message, now);
    if (row.task_id) taskService.updateTaskError(db, row.task_id, err.message);
    log.error('Video generation resume poll error', { id: videoGenId, error: err.message });
  } finally {
    activeVideoPolls.delete(videoGenId);
  }
}

/** 启动时恢复 processing 视频任务；无 provider_task_id 的保留为可显式重试。 */
function resumeProcessingVideoGenerations(db, log) {
  const hasOmniJobs = !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'omni_video_jobs'").get();
  const stuck = db
    .prepare(
      `SELECT id, task_id FROM video_generations
       WHERE status = 'processing' AND deleted_at IS NULL
         AND (provider_task_id IS NULL OR TRIM(provider_task_id) = '')`
    )
    .all();
  const stuckMsg = '服务重启前未持久化厂商任务 ID；原请求快照已保留，请在全能创作中显式重试';
  for (const s of stuck) {
    const now = new Date().toISOString();
    const omniJob = hasOmniJobs
      ? db.prepare('SELECT request_snapshot_json FROM omni_video_jobs WHERE video_generation_id = ? ORDER BY id DESC LIMIT 1').get(s.id)
      : null;
    let snapshot = null;
    try { snapshot = omniJob?.request_snapshot_json ? JSON.parse(omniJob.request_snapshot_json) : null; } catch (_) {}
    const isEmptyOmniJob = !!omniJob && (!snapshot?.prompt || !Array.isArray(snapshot.assets) || snapshot.assets.length === 0);
    const message = isEmptyOmniJob ? '历史空任务未实际提交模型，已标记为无效，可从任务历史中清理' : stuckMsg;
    const status = isEmptyOmniJob ? 'invalid' : 'retryable';
    db.prepare('UPDATE video_generations SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?').run(status, message, now, s.id);
    if (s.task_id) taskService.updateTaskError(db, s.task_id, message);
    log.warn(isEmptyOmniJob ? 'Marked empty omni video task invalid' : 'Marked interrupted video generation as retryable', { videoGenId: s.id });
  }

  const resumable = db
    .prepare(
      `SELECT id FROM video_generations
       WHERE status = 'processing' AND deleted_at IS NULL
         AND provider_task_id IS NOT NULL AND TRIM(provider_task_id) != ''`
    )
    .all();
  if (resumable.length) {
    log.info('Resuming video generation polls', { count: resumable.length });
  }
  for (const r of resumable) {
    setImmediate(() => {
      resumePollForVideoGeneration(db, log, r.id).catch((e) => {
        log.error('resumePollForVideoGeneration unhandled', { videoGenId: r.id, error: e.message });
      });
    });
  }
}

function reconcileUnarchivedCompletedVideos(db, log) {
  let rows;
  try {
    rows = db.prepare(`SELECT id, task_id, storyboard_id FROM video_generations
      WHERE status = 'completed' AND deleted_at IS NULL
        AND (local_path IS NULL OR TRIM(local_path) = '')`).all();
  } catch (_) {
    // Compatibility for a database that has not yet gained storyboard_id.
    rows = db.prepare(`SELECT id, task_id FROM video_generations
      WHERE status = 'completed' AND deleted_at IS NULL
        AND (local_path IS NULL OR TRIM(local_path) = '')`).all();
  }
  const at = new Date().toISOString();
  const message = '历史视频没有本地归档文件，原供应商链接可能已过期；请重新生成。';
  for (const row of rows) {
    db.prepare('UPDATE video_generations SET status = ?, video_url = NULL, error_msg = ?, updated_at = ? WHERE id = ?')
      .run('failed', message, at, row.id);
    if (row.task_id) taskService.updateTaskError(db, row.task_id, message);
    // Storyboards may have copied the same signed URL. Clear only the video
    // field; local_path can also be an image cover and must be preserved.
    if (row.storyboard_id) {
      try {
        const hasArchivedReplacement = db.prepare(`SELECT 1 FROM video_generations
          WHERE storyboard_id = ? AND status = 'completed' AND local_path IS NOT NULL
            AND TRIM(local_path) != '' AND deleted_at IS NULL LIMIT 1`).get(row.storyboard_id);
        if (!hasArchivedReplacement) {
          db.prepare('UPDATE storyboards SET video_url = NULL, updated_at = ? WHERE id = ?').run(at, row.storyboard_id);
        }
      } catch (_) {}
    }
  }
  // Earlier releases allowed direct imports from a completed supplier URL.
  // Such an asset has no bytes under storage and therefore cannot be durable.
  try {
    db.prepare(`UPDATE assets SET url = '', updated_at = ?
      WHERE type = 'video' AND deleted_at IS NULL
        AND (local_path IS NULL OR TRIM(local_path) = '')
        AND url LIKE 'http%'`).run(at);
  } catch (_) {}
  if (rows.length) log.warn('Marked unarchived completed videos as failed', { count: rows.length });
  return { reconciled: rows.length };
}

function resumePendingVideoArchives(db, log) {
  let rows = [];
  try { rows = db.prepare(`SELECT id FROM video_generations WHERE status = 'completed' AND local_path IS NOT NULL AND TRIM(local_path) != '' AND archive_status = 'pending' AND deleted_at IS NULL`).all(); } catch (_) { return; }
  for (const row of rows) setImmediate(() => archiveCompletedVideo(db, log, row.id).catch((error) => log.warn('Video archive retry failed', { id: row.id, error: error.message })));
}

// Historical completed rows predate poster extraction. Backfill a small batch
// after startup and yield between files so FFmpeg work never blocks request
// handling for an entire media library at once.
function resumeMissingVideoPosters(db, log) {
  let rows = [];
  try {
    rows = db.prepare(`SELECT id, local_path FROM video_generations
      WHERE status = 'completed' AND deleted_at IS NULL
        AND local_path IS NOT NULL AND TRIM(local_path) != ''
        AND (poster_local_path IS NULL OR TRIM(poster_local_path) = '')
      ORDER BY id DESC LIMIT 50`).all();
  } catch (_) { return { queued: 0 }; }
  if (!rows.length) return { queued: 0 };
  const storagePath = resolveStoragePath(require('../config').loadConfig());
  const processNext = () => {
    const row = rows.shift();
    if (!row) return;
    const poster = createVideoPoster(storagePath, row.local_path, row.id, log);
    if (poster) {
      try { db.prepare('UPDATE video_generations SET poster_local_path=?, updated_at=? WHERE id=?').run(poster, new Date().toISOString(), row.id); } catch (_) {}
    }
    if (rows.length) setTimeout(processNext, 120);
  };
  setImmediate(processNext);
  return { queued: rows.length };
}

function startPendingVideoArchiveRetry(db, log) {
  const run = () => resumePendingVideoArchives(db, log);
  const timer = setInterval(run, 60_000);
  if (typeof timer.unref === 'function') timer.unref();
  return { runNow: run, stop: () => clearInterval(timer) };
}

async function processVideoGeneration(db, log, videoGenId) {
  if (activeVideoPolls.has(videoGenId)) {
    log.info('Video generation already in progress, skip duplicate', { videoGenId });
    return;
  }
  activeVideoPolls.add(videoGenId);
  log.info('processVideoGeneration started', { videoGenId });
  const row = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(videoGenId));
  if (!row) {
    activeVideoPolls.delete(videoGenId);
    log.error('Video generation not found', { id: videoGenId });
    return;
  }
  const now = new Date().toISOString();
  try {
    db.prepare('UPDATE video_generations SET status = ?, updated_at = ? WHERE id = ?').run('processing', now, videoGenId);
    const loadConfig = require('../config').loadConfig;
    const cfg = loadConfig();
    const filesBaseUrl = (cfg.storage && cfg.storage.base_url) ? String(cfg.storage.base_url).replace(/\/$/, '') : '';
    const storageLocalPath = path.isAbsolute(cfg.storage?.local_path)
      ? cfg.storage.local_path
      : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
    const config = videoClient.getDefaultVideoConfig(db, row.model);
    if (!config) {
      setVideoGenFailed(db, videoGenId, '未配置视频模型', now);
      if (row.task_id) taskService.updateTaskError(db, row.task_id, '未配置视频模型');
      return;
    }
    let reference_urls = null;
    if (row.reference_image_urls) {
      try {
        reference_urls = JSON.parse(row.reference_image_urls);
        if (!Array.isArray(reference_urls)) reference_urls = null;
      } catch (_) {}
    }
    // 全能工作台的音频引用与图片一样从任务快照恢复，避免依赖角色专用音色字段。
    let voiceReferenceUrl = null;
    try {
      const omni = db.prepare('SELECT id FROM omni_video_jobs WHERE video_generation_id = ?').get(Number(videoGenId));
      if (omni) {
        const audio = db.prepare(`SELECT snapshot_json FROM omni_video_job_assets
          WHERE omni_job_id = ? AND media_type = 'audio' AND send_to_model = 1 ORDER BY ordinal LIMIT 1`).get(omni.id);
        if (audio?.snapshot_json) {
          const snapshot = JSON.parse(audio.snapshot_json);
          voiceReferenceUrl = snapshot.local_path || snapshot.url || null;
        }
      }
    } catch (_) {}
    // 优先使用分镜自身的镜头时长（storyboard.duration），其次用 video_generations.duration
    let effectiveDuration = row.duration || null;
    if (row.storyboard_id) {
      const sb = db.prepare('SELECT duration FROM storyboards WHERE id = ?').get(row.storyboard_id);
      if (sb && sb.duration > 0) {
        effectiveDuration = sb.duration;
        log.info('使用分镜镜头时长', { storyboard_id: row.storyboard_id, duration: effectiveDuration, video_gen_id: videoGenId });
      }
    }
    let aspectForVideo = row.aspect_ratio;
    if (aspectForVideo) {
      const n = videoClient.normalizeAspectRatioForApi(aspectForVideo);
      if (n) aspectForVideo = n;
    }
    if (!aspectForVideo && row.drama_id) {
      try {
        const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(row.drama_id);
        if (dramaRow && dramaRow.metadata) {
          const meta =
            typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
          if (meta && meta.aspect_ratio) {
            aspectForVideo = videoClient.normalizeAspectRatioForApi(meta.aspect_ratio);
          }
        }
      } catch (_) {}
    }
    const rowForAspect = { ...row, aspect_ratio: aspectForVideo || row.aspect_ratio };
    const hasOmniRefs = !!(reference_urls && reference_urls.length > 0);
    if (row.task_id && hasOmniRefs) {
      taskService.updateTaskStatus(
        db,
        row.task_id,
        'processing',
        5,
        `正在上传 ${reference_urls.length} 张参考图到图床…`
      );
    }
    const result = await videoClient.callVideoApi(db, log, {
      prompt: row.prompt,
      model: row.model,
      duration: effectiveDuration,
      aspect_ratio: rowForAspect.aspect_ratio,
      resolution: row.resolution,
      seed: row.seed,
      camera_fixed: row.camera_fixed,
      watermark: row.watermark,
      provider: row.provider,
      drama_id: row.drama_id,
      storyboard_id: row.storyboard_id || undefined,
      image_url: hasOmniRefs ? undefined : row.image_url,
      first_frame_url: hasOmniRefs ? undefined : row.first_frame_url,
      last_frame_url: hasOmniRefs ? undefined : row.last_frame_url,
      reference_urls,
      voice_reference_url: voiceReferenceUrl,
      files_base_url: filesBaseUrl,
      storage_local_path: storageLocalPath,
      video_gen_id: videoGenId,
    });
    const now2 = new Date().toISOString();
    if (result.error) {
      setVideoGenFailed(db, videoGenId, result.error, now2);
      if (row.task_id) taskService.updateTaskError(db, row.task_id, result.error);
      log.error('Video generation failed', { id: videoGenId, error: result.error });
      return;
    }
    const directVideo = resolveRemoteVideoUrl(result.video_url, result.error);
    if (directVideo.ok) {
      await finalizeSuccessfulVideo(db, log, videoGenId, row, rowForAspect, directVideo.video_url, '', result.usage, result.provider_request_id || result.task_id, result.provider_response_snapshot);
      return;
    }
    if (result.video_url) {
      setVideoGenFailed(db, videoGenId, directVideo.error, now2);
      if (row.task_id) taskService.updateTaskError(db, row.task_id, directVideo.error);
      log.error('Video generation failed', { id: videoGenId, error: directVideo.error });
      return;
    }
    if (result.task_id) {
      db.prepare(
        'UPDATE video_generations SET status = ?, provider_task_id = ?, updated_at = ? WHERE id = ?'
      ).run('processing', result.task_id, now2, videoGenId);
      await pollProviderTaskAndFinalize(db, log, videoGenId, row, rowForAspect, result.task_id, config);
      return;
    }
    setVideoGenFailed(db, videoGenId, '未返回 task_id 或 video_url', now2);
    if (row.task_id) taskService.updateTaskError(db, row.task_id, '未返回 task_id 或 video_url');
  } catch (err) {
    const now2 = new Date().toISOString();
    setVideoGenFailed(db, videoGenId, err.message, now2);
    if (row && row.task_id) taskService.updateTaskError(db, row.task_id, err.message);
    log.error('Video generation error', { id: videoGenId, error: err.message });
  } finally {
    activeVideoPolls.delete(videoGenId);
  }
}

/** Continue the persisted post-processing pipeline after a service restart.
 * The supplier-generation bytes were already archived and billed before any
 * optional stage started, so this re-enters with the local source and never
 * submits the video-generation request a second time. */
async function resumePostprocessVideoGeneration(db, log, videoGenId) {
  const row = db.prepare('SELECT * FROM video_generations WHERE id=? AND deleted_at IS NULL').get(Number(videoGenId));
  if (!row?.source_local_path || row.status === 'completed' || row.status === 'billing_reconciliation') return;
  try {
    await finalizeSuccessfulVideo(
      db, log, Number(videoGenId),
      { ...row, billing_authorization_id: null }, row,
      `/static/${String(row.source_local_path).replace(/^\/+/, '')}`,
      'restart-resume'
    );
  } catch (error) {
    log.error('Post-processing pipeline resume failed', { video_generation_id: Number(videoGenId), error: error.message });
  }
}

function deleteById(db, log, id) {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE video_generations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, Number(id));
  return result.changes > 0;
}

module.exports = {
  setVideoGenFailed,
  list,
  getById,
  deleteById,
  processVideoGeneration,
  archiveCompletedVideo,
  resumePendingVideoArchives,
  resumeMissingVideoPosters,
  startPendingVideoArchiveRetry,
  resumeProcessingVideoGenerations,
  reconcileUnarchivedCompletedVideos,
  resumePostprocessVideoGeneration,
  targetVideoPixelsForAspect,
  normalizeFinalVideoToContract,
  pruneSupersededVideoArtifacts,
  publicVideoUrl,
};
