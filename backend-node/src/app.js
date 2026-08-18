const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { getDb } = require('./db/index.js');
const { loadConfig } = require('./config/index.js');
const logger = require('./logger.js');
const { setupRouter } = require('./routes/index.js');

function resolveHttpErrorStatus(err) {
  if (err?.code === 'LIMIT_FILE_SIZE' || String(err?.message || '').includes('File too large')) return 413;
  const status = Number(err?.status || err?.statusCode);
  return Number.isInteger(status) && status >= 400 && status < 500 ? status : 500;
}

function createApp() {
  const config = loadConfig();
  const db = getDb(config.database);
  const { runMigrationsAndEnsure } = require('./db/migrate.js');
  runMigrationsAndEnsure(db);
  const { ensureBootstrapAdmin, validateRuntimeSecurity } = require('./services/authService');
  validateRuntimeSecurity(db);
  ensureBootstrapAdmin(db, logger);
  // A successful call without verifiable usage remains frozen for reconciliation.
  // This sweep makes the timeout release deterministic even if no request follows it.
  const billingService = require('./services/billingService');
  try {
    const result = billingService.recoverCompletedVideoReconciliations(db);
    if (result.recovered) logger.warn('recovered completed video billing reconciliations', result);
  } catch (error) { logger.warn('completed video billing recovery failed', { error: error.message }); }
  try {
    const result = billingService.recoverInterruptedTextReconciliations(db);
    if (result.recovered) logger.warn('recovered interrupted text billing reconciliations', result);
  } catch (error) { logger.warn('interrupted text billing recovery failed', { error: error.message }); }
  // 历史计费流水的分组快照回填（幂等，仅填 NULL 行；未启用分组的环境自动跳过）
  try {
    const result = billingService.backfillTenantSnapshots(db);
    if (result && !result.skipped && (result.transactions || result.usage_logs)) {
      logger.info('billing tenant snapshot backfilled', result);
    }
  } catch (error) { logger.warn('billing tenant snapshot backfill failed', { error: error.message }); }
  const reconcileExpired = () => {
    try {
      const result = billingService.expireReconciliationCases(db);
      if (result.expired) logger.warn('billing reconciliation cases expired', result);
    } catch (error) { logger.warn('billing reconciliation sweep failed', { error: error.message }); }
  };
  reconcileExpired();
  const reconciliationTimer = setInterval(reconcileExpired, 60 * 1000);
  if (typeof reconciliationTimer.unref === 'function') reconciliationTimer.unref();

  // 厂商锁定模式：在迁移完成后同步 vendor_lock 配置
  const { applyVendorLock } = require('./services/aiConfigService');
  applyVendorLock(db, logger, config);
  const log = logger;

  const { resumeProcessingVideoGenerations, reconcileUnarchivedCompletedVideos, resumePendingVideoArchives, resumeMissingVideoPosters, startPendingVideoArchiveRetry } = require('./services/videoService');
  reconcileUnarchivedCompletedVideos(db, log);
  resumeProcessingVideoGenerations(db, log);
  resumePendingVideoArchives(db, log);
  resumeMissingVideoPosters(db, log);
  const videoStoragePath = path.isAbsolute(config.storage?.local_path)
    ? config.storage.local_path
    : path.join(process.cwd(), config.storage?.local_path || './data/storage');
  require('./services/videoUpscaleService').resumePending(db, log, videoStoragePath);
  require('./services/videoInterpolationService').resumePending(db, log, videoStoragePath);
  startPendingVideoArchiveRetry(db, log);
  require('./services/operationsReportService').startDailyReporting(db, log);
  require('./services/assetSd2Service').resumePendingCertifications(db, log, config);
  require('./services/omniVideoService').startSd2WaitingGenerationRecovery(db, log);
  const taskService = require('./services/taskService');
  taskService.failOrphanedAsyncTasksOnStartup(db, log);

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  const allowedOrigins = Array.isArray(config.server.cors_origins) ? config.server.cors_origins.filter(Boolean) : [];
  app.use(cors({
    origin(origin, callback) {
      // Same-origin production traffic has no Origin header. Cross-origin traffic
      // must be explicitly allow-listed so HttpOnly media-session cookies are safe.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, process.env.NODE_ENV !== 'production' && allowedOrigins.length === 0);
    },
    credentials: true,
  }));

  app.use((req, res, next) => {
    const requestId = String(req.get('x-request-id') || randomUUID()).slice(0, 128);
    const startedAt = process.hrtime.bigint();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      log.info('HTTP request completed', {
        request_id: requestId,
        method: req.method,
        path: req.path,
        status_code: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100,
      });
    });
    next();
  });

  // 静态资源目录：统一转为绝对路径（打包 exe 下相对路径可能解析异常）
  const storageRoot = config.storage?.local_path
    ? (path.isAbsolute(config.storage.local_path)
        ? config.storage.local_path
        : path.join(process.cwd(), config.storage.local_path))
    : path.join(process.cwd(), 'data', 'storage');
  try {
    if (!fs.existsSync(storageRoot)) fs.mkdirSync(storageRoot, { recursive: true });
    const protectStatic = config.security?.protect_static ?? process.env.NODE_ENV === 'production';
    const mediaStorage = require('./services/mediaStorageService');
    if (protectStatic) {
      const { requireAuth } = require('./middleware/auth');
      app.use('/static', requireAuth(db), mediaStorage.staticHandler(config, storageRoot));
    } else {
      app.use('/static', mediaStorage.staticHandler(config, storageRoot));
    }
    mediaStorage.startArchiveScheduler(config, storageRoot, log, { db });
  } catch (e) {
    console.warn('Static storage mount skipped:', e.message);
  }

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      app: config.app.name,
      version: config.app.version,
    });
  });

  app.use('/api/v1', setupRouter(config, db, log));

  // 前端静态资源（sxy：web/dist）；Electron 打包时可设 WEB_DIST_PATH
  const webDist = process.env.WEB_DIST_PATH || path.join(process.cwd(), '..', 'frontweb', 'dist');
  console.log('webDist', webDist);
  if (fs.existsSync(webDist)) {
    app.use('/assets', express.static(path.join(webDist, 'assets')));
    // 服务 dist 根目录的静态文件（如 wx.jpg、favicon.ico 等）
    app.use(express.static(webDist, { index: false }));
    app.get('/favicon.ico', (req, res) => {
      const fav = path.join(webDist, 'favicon.ico');
      if (fs.existsSync(fav)) res.sendFile(fav);
      else res.status(404).end();
    });
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      const indexHtml = path.join(webDist, 'index.html');
      if (fs.existsSync(indexHtml)) res.sendFile(indexHtml);
      else next();
    });
  } else {
    app.get('/', (req, res) => {
      res.send(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>瑞池传媒短剧平台</title></head><body>' +
          '<h1>瑞池传媒短剧平台 API</h1><p>后端已启动。请先构建前端：</p>' +
          '<pre>cd web &amp;&amp; pnpm install &amp;&amp; pnpm build</pre>' +
          '<p>然后将 <code>web/dist</code> 放到与 backend-node 同级的 <code>web/dist</code>，或访问 <a href="/health">/health</a> 检查接口。</p></body></html>'
      );
    });
  }

  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.status(404).send('Not Found');
  });

  app.use((err, req, res, next) => {
    log.errorw('Unhandled error', { error: err.message, path: req.path });
    if (!res.headersSent) {
      const isFileTooLarge = err.code === 'LIMIT_FILE_SIZE' || (err.message && err.message.includes('File too large'));
      const status = resolveHttpErrorStatus(err);
      // express.sendFile reports an invalid or stale media Range as 416. This
      // is a normal media protocol response, not an application failure.
      if (status === 416) return res.status(416).set('Content-Range', 'bytes */*').end();
      const message = isFileTooLarge ? '图片大小不能超过 16MB，请压缩后重试' : (err.message || '服务器错误');
      res.status(status).json({ success: false, error: { code: isFileTooLarge ? 'FILE_TOO_LARGE' : (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'), message }, timestamp: new Date().toISOString() });
    }
  });

  return { app, config, db };
}

module.exports = { createApp, resolveHttpErrorStatus };
