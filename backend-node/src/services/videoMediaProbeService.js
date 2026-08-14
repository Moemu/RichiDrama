'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');

function parseFps(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  if (text.includes('/')) {
    const [numerator, denominator] = text.split('/').map(Number);
    return denominator ? numerator / denominator : 0;
  }
  return Number(text) || 0;
}

function resolutionLabel(width, height) {
  const shortEdge = Math.min(Number(width || 0), Number(height || 0));
  if (shortEdge >= 2160) return '4k';
  if (shortEdge >= 1440) return '2k';
  if (shortEdge >= 1080) return '1080p';
  if (shortEdge >= 720) return '720p';
  if (shortEdge >= 480) return '480p';
  return `${Number(width || 0)}x${Number(height || 0)}`;
}

function probeVideoMedia(absolutePath) {
  if (!absolutePath || !fs.existsSync(absolutePath)) throw new Error('待探测视频文件不存在');
  const result = spawnSync(getFfprobePath(), [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate:format=duration',
    '-of', 'json', absolutePath,
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) return probeWithFfmpeg(absolutePath);
  let payload;
  try { payload = JSON.parse(result.stdout || '{}'); } catch (_) { throw new Error('视频媒体探测返回无效 JSON'); }
  const stream = payload.streams?.[0] || {};
  const width = Number(stream.width || 0);
  const height = Number(stream.height || 0);
  const fps = parseFps(stream.avg_frame_rate);
  const durationMs = Math.max(1, Math.round(Number(payload.format?.duration || 0) * 1000));
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || !Number.isFinite(fps) || fps <= 0) {
    throw new Error('视频媒体探测缺少有效宽高或帧率');
  }
  return { width, height, fps: Math.round(fps * 1000) / 1000, duration_ms: durationMs, resolution: resolutionLabel(width, height) };
}

function probeWithFfmpeg(absolutePath) {
  const result = spawnSync(getFfmpegPath(), [
    '-hide_banner', '-i', absolutePath, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-',
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const videoLine = output.split(/\r?\n/).find((line) => /Video:/.test(line)) || '';
  const dimension = videoLine.match(/\b(\d{2,5})x(\d{2,5})\b/);
  const fpsMatch = videoLine.match(/\b([\d.]+)\s+fps\b/i);
  const duration = output.match(/Duration:\s*(\d+):(\d+):([\d.]+)/i);
  const width = Number(dimension?.[1] || 0);
  const height = Number(dimension?.[2] || 0);
  const fps = Number(fpsMatch?.[1] || 0);
  const durationMs = duration
    ? Math.max(1, Math.round((Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000))
    : 0;
  if (!width || !height || !fps || !durationMs) throw new Error(`视频媒体探测失败：${output.slice(-300)}`);
  return { width, height, fps: Math.round(fps * 1000) / 1000, duration_ms: durationMs, resolution: resolutionLabel(width, height) };
}

module.exports = { probeVideoMedia, parseFps, resolutionLabel, probeWithFfmpeg };
