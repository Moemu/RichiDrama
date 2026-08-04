const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const uploadService = require('./uploadService');
const storageLayout = require('./storageLayout');
const assetService = require('./assetService');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');

const LIMITS = { image: 30, video: 50, audio: 15 };
const EXTENSIONS = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  video: ['.mp4', '.webm', '.mov', '.m4v'],
  audio: ['.mp3', '.wav', '.m4a', '.ogg'],
};

function readableUploadName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const fixed = Buffer.from(raw, 'latin1').toString('utf8');
    return fixed.includes('\ufffd') ? raw : fixed;
  } catch (_) { return raw; }
}

function limits() {
  return {
    files: { image: { max_mb: LIMITS.image, extensions: EXTENSIONS.image }, video: { max_mb: LIMITS.video, extensions: EXTENSIONS.video }, audio: { max_mb: LIMITS.audio, extensions: EXTENSIONS.audio } },
    shot: { total: 12, image: 9, video: 3, audio: 3 },
  };
}

function detectType(file) {
  const mime = String(file.mimetype || '').toLowerCase();
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (mime.startsWith('image/') || EXTENSIONS.image.includes(ext)) return 'image';
  if (mime.startsWith('video/') || EXTENSIONS.video.includes(ext)) return 'video';
  if (mime.startsWith('audio/') || EXTENSIONS.audio.includes(ext)) return 'audio';
  return null;
}

function validate(file, type) {
  if (!type) throw new Error('仅支持图片、视频或音频文件');
  const max = LIMITS[type] * 1024 * 1024;
  if (file.size > max) throw new Error(`${type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'}不能超过 ${LIMITS[type]} MB`);
  if (!hasExpectedSignature(file.buffer, type)) throw new Error('文件内容与声明的媒体类型不匹配');
}

// 浏览器 MIME 和扩展名都可伪造；这里先做轻量签名校验。视频/音频的时长、编码等
// 由后续预处理任务补齐，不把未校验文件直接送往供应商。
function hasExpectedSignature(buffer, type) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const head = buffer.subarray(0, 12);
  const ascii = head.toString('ascii');
  if (type === 'image') return head[0] === 0xff && head[1] === 0xd8 || (head[0] === 0x89 && ascii.slice(1, 4) === 'PNG') || ascii.startsWith('GIF8') || ascii.slice(0, 4) === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
  if (type === 'video') return ascii.slice(4, 8) === 'ftyp' || (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3);
  if (type === 'audio') return ascii.startsWith('ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) || (ascii.slice(0, 4) === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WAVE') || ascii.slice(4, 8) === 'ftyp' || (head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53);
  return false;
}

async function upload(db, cfg, log, file, body = {}) {
  const type = detectType(file);
  validate(file, type);
  const rawStorage = cfg?.storage?.local_path || './data/storage';
  const storagePath = path.isAbsolute(rawStorage) ? rawStorage : path.join(process.cwd(), rawStorage);
  const dramaId = Number(body.drama_id) || null;
  const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const duplicate = assetService.findByChecksum(db, checksum, dramaId);
  if (duplicate) {
    log.info('媒体上传命中内容去重，复用已有素材', { asset_id: duplicate.id, drama_id: dramaId, type });
    return { ...duplicate, deduplicated: true };
  }
  const projectSubdir = storageLayout.getProjectStorageSubdir(db, dramaId);
  const result = uploadService.uploadFile(storagePath, cfg?.storage?.base_url || '', log, file.buffer, file.originalname, file.mimetype, `${type}s`, projectSubdir);
  const inspection = await inspectMedia(path.join(storagePath, result.local_path.replace(/\//g, path.sep)), type, storagePath, result.local_path, log);
  const displayName = String(body.name || readableUploadName(file.originalname) || 'untitled-media').slice(0, 255);
  return assetService.create(db, log, {
    drama_id: dramaId,
    name: displayName,
    type, category: body.category || null, url: result.url, local_path: result.local_path,
    file_size: file.size, mime_type: file.mimetype || null, source_type: 'upload', checksum,
    width: inspection.width, height: inspection.height, duration: inspection.duration, thumbnail_local_path: inspection.thumbnail_local_path,
    metadata: { original_name: displayName, uploaded_mime_type: file.mimetype || '', ...inspection.metadata },
    processing_status: 'ready',
  });
}

async function inspectMedia(filePath, type, storageRoot, localPath, log) {
  const result = { width: null, height: null, duration: null, thumbnail_local_path: null, metadata: {} };
  try {
    if (type === 'image') {
      const sharp = require('sharp'); const image = await sharp(filePath).metadata();
      result.width = image.width || null; result.height = image.height || null;
      result.metadata = { format: image.format || null, space: image.space || null };
      return result;
    }
    const probe = spawnSync(getFfprobePath(), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type,width,height,r_frame_rate', '-of', 'json', filePath], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (probe.status === 0) {
      const parsed = JSON.parse(probe.stdout || '{}'); const stream = (parsed.streams || []).find((item) => item.codec_type === (type === 'audio' ? 'audio' : 'video')) || (parsed.streams || [])[0] || {};
      result.width = Number(stream.width) || null; result.height = Number(stream.height) || null;
      result.duration = Number(parsed.format?.duration) || null;
      result.metadata = { codec: stream.codec_name || null, frame_rate: stream.r_frame_rate || null, duration: result.duration };
    }
    if (type === 'video') {
      const thumbDir = path.join(storageRoot, path.dirname(localPath), 'thumbnails'); fs.mkdirSync(thumbDir, { recursive: true });
      const thumbName = `${path.basename(localPath, path.extname(localPath))}.jpg`; const thumbAbs = path.join(thumbDir, thumbName);
      const made = spawnSync(getFfmpegPath(), ['-y', '-ss', '0', '-i', filePath, '-frames:v', '1', '-q:v', '3', thumbAbs], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
      if (made.status === 0 && fs.existsSync(thumbAbs)) result.thumbnail_local_path = path.relative(storageRoot, thumbAbs).replace(/\\/g, '/');
    }
  } catch (error) { log.warn('媒体探测失败，仍保留已上传文件', { error: error.message, local_path: localPath }); }
  return result;
}

module.exports = { upload, detectType, LIMITS, EXTENSIONS, limits, readableUploadName, hasExpectedSignature, inspectMedia };
