const path = require('path');
const multer = require('multer');
const { randomUUID } = require('node:crypto');
const response = require('../response');
const uploadService = require('../services/uploadService');
const storageLayout = require('../services/storageLayout');
const mediaAsset = require('../services/mediaAssetService');

const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
// 单张图片上限。修改时请同步：
//   - 前端 frontweb/src/constants/uploadLimits.js (MAX_IMAGE_SIZE_MB)
//   - nginx deploy/nginx-drama-richbest.conf (client_max_body_size，需 ≥ 此值 + multipart 开销)
const MAX_IMAGE_SIZE_MB = 30;
const maxSize = MAX_IMAGE_SIZE_MB * 1024 * 1024;
// 兼容旧导出名（routes/index.js 等可能引用 MAX_IMAGE_SIZE_MB）
const MAX_SIZE_MB = MAX_IMAGE_SIZE_MB;

const memoryStorage = multer.memoryStorage();
const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: maxSize },
  fileFilter: (req, file, cb) => {
    const ct = file.mimetype || 'application/octet-stream';
    if (!allowedTypes.includes(ct)) {
      return cb(new Error('只支持图片格式 (jpg, png, gif, webp)'));
    }
    cb(null, true);
  },
});

// Seedance 2.0 音色参考音频上传（支持常见音频格式）
const allowedAudioTypes = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/m4a',
  'audio/ogg',
  'audio/webm',
];
const audioMaxSize = 10 * 1024 * 1024; // 10MB
const audioUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: audioMaxSize },
  fileFilter: (req, file, cb) => {
    const ct = file.mimetype || 'application/octet-stream';
    if (!allowedAudioTypes.includes(ct)) {
      return cb(new Error('只支持音频格式 (mp3, wav, m4a, ogg)'));
    }
    cb(null, true);
  },
});
// 媒体上传（视频/音频/图片混合入口）流式写入 storage/.tmp-uploads，
// 上限与去重口径共用 mediaAssetService.LIMITS，不再各自硬编码；
// 内存暂存版本会在 2GB 文件下打爆进程，diskStorage 后内存占用与文件大小无关。
function createMediaUpload(cfg) {
  const tempDir = mediaAsset.uploadTempDir(mediaAsset.resolveStoragePath(cfg));
  const storage = multer.diskStorage({
    destination(_req, _file, cb) { require('node:fs').mkdirSync(tempDir, { recursive: true }); cb(null, tempDir); },
    filename(_req, file, cb) {
      const ext = (path.extname(String(file.originalname || '')).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [''])[0];
      cb(null, `${Date.now()}-${randomUUID()}${ext}`);
    },
  });
  return multer({ storage, limits: { fileSize: mediaAsset.LIMITS.video * 1024 * 1024 } });
}

function routes(cfg, log, db) {
  const mediaUpload = createMediaUpload(cfg);
  const singleUpload = upload.single('file');
  return {
    multerSingle: singleUpload,
    multerMediaSingle: mediaUpload.single('file'),
    uploadImage: (req, res) => {
      if (!req.file || !req.file.buffer) {
        return response.badRequest(res, '请选择文件');
      }
      try {
        const rawStorage = cfg?.storage?.local_path || './data/storage';
        const storagePath = path.isAbsolute(rawStorage)
          ? rawStorage
          : path.join(process.cwd(), rawStorage);
        const baseUrl = cfg?.storage?.base_url || '';
        let projectSubdir = null;
        if (db) {
          const raw = req.body?.drama_id;
          const did =
            raw !== undefined && raw !== null && String(raw).trim() !== ''
              ? Number(raw)
              : NaN;
          if (Number.isFinite(did) && did > 0) {
            require('../services/projectAccessService').requireAccess(db, did, req.auth.id, 'edit');
            projectSubdir = storageLayout.getProjectStorageSubdir(db, did);
          }
        }
        const result = uploadService.uploadFile(
          storagePath,
          baseUrl,
          log,
          req.file.buffer,
          req.file.originalname || 'image.png',
          req.file.mimetype,
          'uploads',
          projectSubdir
        );
        response.success(res, {
          url: result.url,
          path: result.local_path,
          local_path: result.local_path,
          filename: req.file.originalname,
          size: req.file.size,
        });
      } catch (err) {
        log.error('upload image', { error: err.message });
        if (err.status) return response.error(res, err.status, 'PROJECT_ACCESS_DENIED', err.message);
        response.internalError(res, err.message || '上传失败');
      }
    },
    uploadMedia: async (req, res) => {
      if (!req.file || (!req.file.path && !req.file.buffer)) return response.badRequest(res, '请选择文件');
      try {
        const body = req.body || {};
        const dramaId = Number(body.drama_id) || null;
        // A media upload must be owned immediately. Previously global uploads
        // were inserted with a NULL owner, so they were hidden by the library's
        // ownership filter and their subsequent rename/delete calls returned 404.
        if (dramaId) require('../services/projectAccessService').requireAccess(db, dramaId, req.auth.id, 'edit');
        const asset = await mediaAsset.upload(db, cfg, log, req.file, {
          ...body,
          drama_id: dramaId,
          owner_user_id: req.auth.id,
        });
        response.created(res, { asset });
      } catch (err) {
        log.error('upload media', { error: err.message });
        if (err.status) return response.error(res, err.status, 'PROJECT_ACCESS_DENIED', err.message);
        response.badRequest(res, err.message || '上传失败');
      }
    },
  };
}

module.exports = {
  routes,
  upload,
  multerSingle: upload.single('file'),
  multerAudioSingle: audioUpload.single('file'),
  MAX_IMAGE_SIZE_MB,
  // 兼容旧导出名
  MAX_SIZE_MB,
};
