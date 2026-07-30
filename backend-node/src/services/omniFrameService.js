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

function extract(db, cfg, log, jobId, position) {
  if (!['first', 'last'].includes(position)) throw new Error('position 必须为 first 或 last');
  const row = db.prepare(`SELECT j.id, j.video_generation_id, v.local_path, v.duration, v.status
    FROM omni_video_jobs j JOIN video_generations v ON v.id = j.video_generation_id WHERE j.id = ?`).get(Number(jobId));
  if (!row?.local_path || row.status !== 'completed') throw new Error('仅已完成且已保存到本地的视频可提取帧');
  const root = storageRoot(cfg); const input = path.join(root, row.local_path.replace(/\//g, path.sep));
  if (!fs.existsSync(input)) throw new Error('成片本地文件不存在');
  const dir = path.join(root, 'frames'); fs.mkdirSync(dir, { recursive: true });
  const name = `omni_${row.id}_${position}_${randomUUID()}.jpg`; const output = path.join(dir, name);
  let seconds = 0;
  if (position === 'last') {
    const probe = spawnSync(getFfprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nokey=1:noprint_wrappers=1', input], { encoding: 'utf8' });
    seconds = Math.max(0, (Number(probe.stdout) || Number(row.duration) || 0) - 0.08);
  }
  const args = ['-y']; if (seconds > 0) args.push('-ss', String(seconds)); args.push('-i', input, '-frames:v', '1', '-q:v', '2', output);
  const result = spawnSync(getFfmpegPath(), args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0 || !fs.existsSync(output)) throw new Error('提取视频帧失败');
  const localPath = `frames/${name}`;
  const asset = assetService.create(db, log, { name: `视频${row.video_generation_id}${position === 'first' ? '首帧' : '尾帧'}`, type: 'image', url: `/static/${localPath}`, local_path: localPath, source_type: 'video_frame', mime_type: 'image/jpeg', file_size: fs.statSync(output).size, metadata: { source_omni_job_id: row.id, source_video_generation_id: row.video_generation_id, frame_position: position, timestamp_seconds: seconds } });
  return asset;
}

module.exports = { extract };
