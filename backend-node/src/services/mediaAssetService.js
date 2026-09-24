const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const uploadService = require('./uploadService');
const storageLayout = require('./storageLayout');
const assetService = require('./assetService');
const mediaStorage = require('./mediaStorageService');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');

// 视频上限对齐投流/本地化单集场景（官方单文件 ≤5GB、TOS 中转 ≤5GB）；
// 上传已改流式落盘（multer diskStorage），内存占用与文件大小无关，放开不再有 OOM 风险。
const LIMITS = { image: 30, video: 2048, audio: 15 };
const UPLOAD_TEMP_DIRNAME = '.tmp-uploads';
const INSPECTION_TIMEOUT_MS = 30_000;
const THUMBNAIL_TIMEOUT_MS = 60_000;
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
    shot: { total: 15, image: 9, video: 3, audio: 3 },
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
  if (file.size > max) throw new Error(`${type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'}不能超过 ${LIMITS[type] >= 1024 ? `${LIMITS[type] / 1024} GB` : `${LIMITS[type]} MB`}`);
  if (!hasExpectedSignature(headBytes(file), type)) throw new Error('文件内容与声明的媒体类型不匹配');
}

// diskStorage 上传的 file 只有 path；旧调用方仍可能传 memoryStorage 的 buffer 形态，两者都支持。
function headBytes(file) {
  if (Buffer.isBuffer(file.buffer)) return file.buffer.subarray(0, 12);
  if (!file.path) return Buffer.alloc(0);
  const fd = fs.openSync(file.path, 'r');
  try {
    const buffer = Buffer.alloc(12);
    return buffer.subarray(0, fs.readSync(fd, buffer, 0, 12, 0));
  } finally { fs.closeSync(fd); }
}

function fileChecksum(file) {
  if (Buffer.isBuffer(file.buffer)) return crypto.createHash('sha256').update(file.buffer).digest('hex');
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file.path, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function resolveStoragePath(cfg) {
  const raw = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), raw);
}

function uploadTempDir(storagePath) {
  return path.join(storagePath, UPLOAD_TEMP_DIRNAME);
}

// 进程被杀时 multer 的临时文件不会被任何请求线程回收；启动清扫只删超时文件，
// 6 小时远超 2GB 上传的最长合理耗时，不会碰到进行中的请求。
function sweepUploadTemp(storagePath, log, maxAgeMs = 6 * 3600_000, at = Date.now()) {
  const dir = uploadTempDir(storagePath);
  let removed = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (_) { return { removed: 0 }; }
  for (const name of entries) {
    const file = path.join(dir, name);
    try {
      const stats = fs.statSync(file);
      if (stats.isFile() && at - stats.mtimeMs > maxAgeMs) { fs.rmSync(file, { force: true }); removed += 1; }
    } catch (_) {}
  }
  if (removed) log.info('已清理过期上传临时文件', { removed });
  return { removed };
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
  try {
    return await uploadInner(db, cfg, log, file, body);
  } finally {
    // diskStorage 的临时文件必须无论成败都不残留（成功路径已被 rename 走，rmSync 幂等）。
    if (file && file.path) { try { fs.rmSync(file.path, { force: true }); } catch (_) {} }
  }
}

async function uploadInner(db, cfg, log, file, body = {}) {
  const type = detectType(file);
  validate(file, type);
  const storagePath = resolveStoragePath(cfg);
  const dramaId = Number(body.drama_id) || null;
  const checksum = fileChecksum(file);
  const duplicate = assetService.findByChecksum(db, checksum, dramaId, body.owner_user_id);
  if (duplicate) {
    log.info('媒体上传命中内容去重，复用已有素材', { asset_id: duplicate.id, drama_id: dramaId, type });
    return { ...duplicate, deduplicated: true };
  }
  const projectSubdir = storageLayout.getProjectStorageSubdir(db, dramaId);
  const result = Buffer.isBuffer(file.buffer)
    ? uploadService.uploadFile(storagePath, cfg?.storage?.base_url || '', log, file.buffer, file.originalname, file.mimetype, `${type}s`, projectSubdir)
    : uploadService.uploadFileFromPath(storagePath, cfg?.storage?.base_url || '', log, file.path, file.originalname, file.mimetype, `${type}s`, projectSubdir);
  let inspection;
  try {
    inspection = await inspectMedia(path.join(storagePath, result.local_path.replace(/\//g, path.sep)), type, storagePath, result.local_path, log);
  } catch (error) {
    // The file has no database owner yet.  Remove only the exact newly-created
    // path so a failed probe cannot leave an untracked media object behind.
    try {
      const absolute = path.resolve(storagePath, result.local_path.replace(/\//g, path.sep));
      const relative = path.relative(path.resolve(storagePath), absolute);
      if (relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) fs.rmSync(absolute, { force: true });
    } catch (_) {}
    throw error;
  }
  const displayName = String(body.name || readableUploadName(file.originalname) || 'untitled-media').slice(0, 255);
  const asset = assetService.create(db, log, {
    drama_id: dramaId,
    owner_user_id: body.owner_user_id ?? null,
    name: displayName,
    type, category: body.category || null, url: result.url, local_path: result.local_path,
    file_size: file.size, mime_type: file.mimetype || null, source_type: 'upload', checksum,
    width: inspection.width, height: inspection.height, duration: inspection.duration, thumbnail_local_path: inspection.thumbnail_local_path,
    metadata: { original_name: displayName, uploaded_mime_type: file.mimetype || '', ...inspection.metadata },
    processing_status: 'ready',
  });
  // User uploads are local-first.  When OSS is enabled, make a second durable
  // copy before returning, but never fail or delete the local upload merely
  // because the mirror is temporarily unavailable.  SD2 can still consume the
  // local image while a later retry/migration catches up.
  if (!mediaStorage.isOss(cfg)) return asset;
  const syncedAt = new Date().toISOString();
  const metadata = { ...(asset.metadata || {}) };
  try {
    const mirrored = await mediaStorage.mirrorAndTrack(db, cfg, storagePath, result.local_path, 'asset', asset.id, log, { contentType: file.mimetype || undefined });
    metadata.persistence = { local: 'available', oss: { status: 'synced', key: mirrored.key, url: mirrored.url, synced_at: syncedAt } };
    db.prepare('UPDATE assets SET metadata_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(metadata), syncedAt, asset.id);
    return { ...asset, metadata };
  } catch (error) {
    metadata.persistence = { local: 'available', oss: { status: 'pending', error: String(error.message || 'OSS mirror failed').slice(0, 500), updated_at: syncedAt } };
    db.prepare('UPDATE assets SET metadata_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(metadata), syncedAt, asset.id);
    log.warn('Media uploaded locally but OSS mirror is pending', { asset_id: asset.id, local_path: result.local_path, error: error.message });
    return { ...asset, metadata };
  }
}

function runMediaProcess(command, args, options = {}) {
  const timeoutMs = Math.max(100, Number(options.timeoutMs || INSPECTION_TIMEOUT_MS));
  const maxBuffer = Math.max(64 * 1024, Number(options.maxBuffer || 1024 * 1024));
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let timedOut = false;
    let outputTooLarge = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxBuffer) {
        outputTooLarge = true;
        child.kill('SIGKILL');
        return;
      }
      target.push(chunk);
    };
    child.stdout?.on('data', collect(stdout));
    child.stderr?.on('data', collect(stderr));
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    child.once('error', fail);
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const standardError = Buffer.concat(stderr).toString('utf8').trim().slice(-2000);
      if (timedOut) return reject(new Error(`媒体处理超时（${timeoutMs}ms）`));
      if (outputTooLarge) return reject(new Error('媒体处理输出超过限制'));
      if (code !== 0) {
        const suffix = standardError ? `: ${standardError}` : '';
        return reject(new Error(`媒体处理失败（退出码 ${code ?? 'unknown'}${signal ? `，信号 ${signal}` : ''}）${suffix}`));
      }
      resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: standardError, code, signal });
    });
  });
}

async function inspectMedia(filePath, type, storageRoot, localPath, log) {
  const result = { width: null, height: null, duration: null, thumbnail_local_path: null, metadata: {} };
  let thumbnailAbs = null;
  try {
    if (type === 'image') {
      const sharp = require('sharp'); const image = await sharp(filePath).metadata();
      result.width = image.width || null; result.height = image.height || null;
      result.metadata = { format: image.format || null, space: image.space || null };
      return result;
    }
    const probe = await runMediaProcess(getFfprobePath(), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type,width,height,r_frame_rate', '-of', 'json', filePath], { timeoutMs: INSPECTION_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(probe.stdout || '{}'); const stream = (parsed.streams || []).find((item) => item.codec_type === (type === 'audio' ? 'audio' : 'video')) || (parsed.streams || [])[0] || {};
    result.width = Number(stream.width) || null; result.height = Number(stream.height) || null;
    result.duration = Number(parsed.format?.duration) || null;
    result.metadata = { codec: stream.codec_name || null, frame_rate: stream.r_frame_rate || null, duration: result.duration,
      audio_codecs: (parsed.streams || []).filter((item) => item.codec_type === 'audio').map((item) => item.codec_name) };
    if (type === 'video') {
      const thumbDir = path.join(storageRoot, path.dirname(localPath), 'thumbnails'); fs.mkdirSync(thumbDir, { recursive: true });
      const thumbName = `${path.basename(localPath, path.extname(localPath))}.jpg`; const thumbAbs = path.join(thumbDir, thumbName);
      thumbnailAbs = thumbAbs;
      await runMediaProcess(getFfmpegPath(), ['-y', '-ss', '0', '-i', filePath, '-frames:v', '1', '-q:v', '3', thumbAbs], { timeoutMs: THUMBNAIL_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
      if (!fs.existsSync(thumbAbs)) throw new Error('视频缩略图生成失败');
      result.thumbnail_local_path = path.relative(storageRoot, thumbAbs).replace(/\\/g, '/');
    }
  } catch (error) {
    if (thumbnailAbs) {
      try { fs.rmSync(thumbnailAbs, { force: true }); } catch (_) {}
    }
    log?.warn?.('媒体探测失败', { error: error.message, local_path: localPath });
    throw error;
  }
  return result;
}

module.exports = { upload, detectType, LIMITS, EXTENSIONS, limits, readableUploadName, hasExpectedSignature, inspectMedia, runMediaProcess, resolveStoragePath, uploadTempDir, sweepUploadTemp };
