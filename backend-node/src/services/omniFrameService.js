'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawnSync } = require('child_process');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');
const assetService = require('./assetService');

function storageRoot(cfg) {
  const raw = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function parseRate(value) {
  const [numerator, denominator = '1'] = String(value || '').split('/');
  const rate = Number(numerator) / Number(denominator);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

function stderrTail(result) {
  return String(result?.stderr || '').slice(-2000);
}

function runFfmpeg(args) {
  return spawnSync(getFfmpegPath(), ['-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
  });
}

function removeOutput(output) {
  try {
    if (fs.existsSync(output)) fs.unlinkSync(output);
  } catch (_) {}
}

function ownedBy(row, actor, ownerField = 'owner_user_id') {
  if (!actor?.id || Number(row?.[ownerField]) !== Number(actor.id)) {
    throw new Error('视频生成记录不存在或无权操作');
  }
}

function probeVideo(input, row, log, context) {
  const result = spawnSync(getFfprobePath(), [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=duration,avg_frame_rate:format=duration',
    '-of', 'json', input,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 10_000 });
  let payload = {};
  try { payload = JSON.parse(result.stdout || '{}'); } catch (_) {}
  const stream = payload.streams?.[0] || {};
  const videoDuration = Number(stream.duration)
    || (Number(row.output_duration_ms) > 0 ? Number(row.output_duration_ms) / 1000 : 0)
    || Number(row.duration)
    || 0;
  const formatDuration = Number(payload.format?.duration) || 0;
  const fps = parseRate(stream.avg_frame_rate) || Number(row.output_fps) || 0;
  if (result.status !== 0 || !videoDuration) {
    log?.warn?.('Video frame probe incomplete', {
      ...context,
      probe_status: result.status,
      probe_signal: result.signal || null,
      probe_error: result.error?.message || null,
      probe_stderr: stderrTail(result),
      video_duration_seconds: videoDuration || null,
      format_duration_seconds: formatDuration || null,
      fps: fps || null,
    });
  }
  return { videoDuration, formatDuration, fps };
}

function runExtraction(input, output, position, probe) {
  if (position === 'first') {
    const args = ['-y', '-i', input, '-map', '0:v:0', '-frames:v', '1', '-q:v', '2', output];
    return { result: runFfmpeg(args), seekStart: 0, fallback: false };
  }

  // Decode only the final second of the video stream. `-update 1` writes every
  // decoded frame to one file. The file left at EOF is the actual last frame.
  // This does not use container duration, which can include a longer audio tail.
  const seekStart = probe.videoDuration > 0 ? Math.max(0, probe.videoDuration - 1) : 0;
  const tailArgs = ['-y'];
  if (seekStart > 0) tailArgs.push('-ss', String(seekStart));
  tailArgs.push('-i', input, '-map', '0:v:0', '-an', '-fps_mode', 'passthrough', '-q:v', '2', '-update', '1', output);
  let result = runFfmpeg(tailArgs);
  if (result.status === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) {
    return { result, seekStart, fallback: false };
  }

  // Bad duration metadata must not make extraction fail. Decode the complete
  // video as a bounded fallback. The output file is overwritten in place.
  removeOutput(output);
  const fallbackArgs = ['-y', '-i', input, '-map', '0:v:0', '-an', '-fps_mode', 'passthrough', '-q:v', '2', '-update', '1', output];
  result = runFfmpeg(fallbackArgs);
  return { result, seekStart: 0, fallback: true };
}

function createFrameAsset(db, cfg, log, row, position, ownerUserId, omniJobId = null) {
  const root = storageRoot(cfg);
  const input = path.join(root, row.local_path.replace(/\//g, path.sep));
  if (!fs.existsSync(input)) throw new Error('成片本地文件不存在');
  const dir = path.join(root, 'frames');
  fs.mkdirSync(dir, { recursive: true });
  const prefix = omniJobId ? `omni_${omniJobId}` : `video_${row.id}`;
  const name = `${prefix}_${position}_${randomUUID()}.jpg`;
  const output = path.join(dir, name);
  const context = {
    video_generation_id: Number(row.id),
    ...(omniJobId ? { omni_job_id: Number(omniJobId) } : {}),
    owner_user_id: Number(ownerUserId),
    position,
    local_path: row.local_path,
  };
  const probe = position === 'last'
    ? probeVideo(input, row, log, context)
    : { videoDuration: 0, formatDuration: 0, fps: Number(row.output_fps) || 0 };
  const extraction = runExtraction(input, output, position, probe);
  const validOutput = fs.existsSync(output) && fs.statSync(output).size > 0;
  if (extraction.result.status !== 0 || !validOutput) {
    log?.warn?.('Video frame extraction failed', {
      ...context,
      video_duration_seconds: probe.videoDuration || null,
      format_duration_seconds: probe.formatDuration || null,
      fps: probe.fps || null,
      seek_start_seconds: extraction.seekStart,
      fallback_used: extraction.fallback,
      ffmpeg_status: extraction.result.status,
      ffmpeg_signal: extraction.result.signal || null,
      ffmpeg_error: extraction.result.error?.message || null,
      ffmpeg_stderr: stderrTail(extraction.result),
    });
    removeOutput(output);
    throw new Error('Failed to extract video frame');
  }
  if (extraction.fallback) {
    log?.warn?.('Video frame extraction used full-decode fallback', {
      ...context,
      video_duration_seconds: probe.videoDuration || null,
      format_duration_seconds: probe.formatDuration || null,
      fps: probe.fps || null,
    });
  }
  const localPath = `frames/${name}`;
  return assetService.create(db, log, {
    drama_id: row.drama_id ?? null,
    owner_user_id: Number(ownerUserId),
    name: `视频${row.id}${position === 'first' ? '首帧' : '尾帧'}`,
    type: 'image',
    url: `/static/${localPath}`,
    local_path: localPath,
    source_type: 'video_frame',
    mime_type: 'image/jpeg',
    file_size: fs.statSync(output).size,
    metadata: {
      ...(omniJobId ? { source_omni_job_id: Number(omniJobId) } : {}),
      source_video_generation_id: Number(row.id),
      frame_position: position,
      timestamp_seconds: position === 'last' ? (probe.videoDuration || null) : 0,
      seek_start_seconds: extraction.seekStart,
    },
  });
}

function extract(db, cfg, log, jobId, position, actor) {
  if (!['first', 'last'].includes(position)) throw new Error('position 必须为 first 或 last');
  const row = db.prepare(`SELECT v.id, v.drama_id, v.owner_user_id, v.local_path, v.duration,
      v.output_duration_ms, v.output_fps, v.status, j.id AS omni_job_id,
      j.owner_user_id AS job_owner_user_id
    FROM omni_video_jobs j JOIN video_generations v ON v.id = j.video_generation_id
    WHERE j.id = ?`).get(Number(jobId));
  ownedBy(row, actor, 'job_owner_user_id');
  if (!row.local_path || row.status !== 'completed') throw new Error('仅已完成且已保存到本地的视频可提取帧');
  return createFrameAsset(db, cfg, log, row, position, row.job_owner_user_id, row.omni_job_id);
}

function extractVideoGeneration(db, cfg, log, videoGenerationId, position, actor) {
  if (!['first', 'last'].includes(position)) throw new Error('position must be first or last');
  const row = db.prepare(`SELECT id, drama_id, owner_user_id, local_path, duration,
    output_duration_ms, output_fps, status FROM video_generations WHERE id = ?`).get(Number(videoGenerationId));
  ownedBy(row, actor);
  if (!row.local_path || row.status !== 'completed') throw new Error('Only completed videos saved locally can have frames extracted');
  return createFrameAsset(db, cfg, log, row, position, row.owner_user_id);
}

module.exports = { extract, extractVideoGeneration, parseRate };
