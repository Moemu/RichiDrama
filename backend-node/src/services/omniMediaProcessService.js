const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const { getFfmpegPath } = require('../utils/ffmpegPath');
const assetService = require('./assetService');

function storageRoot() {
  const cfg = require('../config').loadConfig();
  const root = cfg.storage?.local_path || './data/storage';
  return path.isAbsolute(root) ? root : path.join(process.cwd(), root);
}
function run(args, log, tag) {
  const out = spawnSync(getFfmpegPath(), args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`${tag}失败：${String(out.stderr || out.error?.message || '').slice(-300)}`);
}
function abs(localPath) { return path.join(storageRoot(), String(localPath || '').replace(/^\/+/, '').replace(/\//g, path.sep)); }

function extractKeyframes(db, log, source, count = 3) {
  const sourcePath = abs(source.local_path);
  if (!fs.existsSync(sourcePath)) throw new Error(`视频素材文件不存在：${source.name || source.id}`);
  const root = storageRoot(); const dir = path.join(root, 'library', 'derived'); fs.mkdirSync(dir, { recursive: true });
  const total = Math.max(1, Math.min(9, Number(count) || 3));
  const created = [];
  for (let i = 0; i < total; i++) {
    const seek = total === 1 ? '0' : String(i / (total - 1));
    const name = `keyframe_${source.id}_${Date.now()}_${i}_${randomUUID().slice(0, 8)}.jpg`;
    const target = path.join(dir, name);
    // 百分比 seek 不能直接由 ffmpeg 使用；以 duration*比例表达式由 select 兜底取首/中/尾近似关键帧。
    const filter = total === 1 ? 'select=eq(n\\,0)' : `select=not(mod(n\\,${Math.max(1, 30 * (i + 1))}))`;
    try { run(['-y', '-i', sourcePath, '-vf', filter, '-frames:v', '1', '-q:v', '2', target], log, '提取关键帧'); }
    catch (_) { run(['-y', '-ss', seek, '-i', sourcePath, '-frames:v', '1', '-q:v', '2', target], log, '提取关键帧'); }
    if (!fs.existsSync(target)) continue;
    const localPath = `library/derived/${name}`;
    created.push(assetService.create(db, log, { name: `${source.name || '视频'} · 关键帧 ${i + 1}`, type: 'image', local_path: localPath, url: `/static/${localPath}`, mime_type: 'image/jpeg', file_size: fs.statSync(target).size, source_type: 'derived', parent_asset_id: source.id, processing_status: 'ready', metadata: { derived_from: 'video_keyframe', index: i, requested_ratio: seek } }));
  }
  if (!created.length) throw new Error('未能从视频提取关键帧');
  return created;
}

function mixAudio(videoLocalPath, audioLocalPath, log, options = {}) {
  const video = abs(videoLocalPath), audio = abs(audioLocalPath);
  if (!fs.existsSync(video) || !fs.existsSync(audio)) throw new Error('混音源文件不存在');
  const out = path.join(path.dirname(video), `${path.basename(video, path.extname(video))}_mixed.mp4`);
  const volume = Math.max(0, Math.min(2, Number(options.audio_volume) || 1));
  const fade = Math.max(0, Math.min(10, Number(options.audio_fade_seconds) || 0));
  const filterAudio = `volume=${volume}${fade ? `,afade=t=in:st=0:d=${fade},afade=t=out:st=0:d=${fade}` : ''}`;
  const args = options.keep_original_audio
    ? ['-y', '-i', video, '-i', audio, '-filter_complex', `[1:a]${filterAudio}[user];[0:a][user]amix=inputs=2:duration=first:dropout_transition=2[mix]`, '-map', '0:v:0', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out]
    : ['-y', '-i', video, '-i', audio, '-filter:a', filterAudio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out];
  run(args, log, '成片混音');
  return path.relative(storageRoot(), out).replace(/\\/g, '/');
}
module.exports = { extractKeyframes, mixAudio };
