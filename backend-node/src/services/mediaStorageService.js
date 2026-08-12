'use strict';

// Storage keys deliberately reuse the existing local_path convention. This
// lets old database rows, `/static/...` links and every existing UI consumer
// survive an OSS migration without a data rewrite.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

function normalizeKey(value) {
  const key = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!key || key.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid media storage key');
  return key;
}
function isOss(cfg) { return String(cfg?.storage?.type || 'local').toLowerCase() === 'oss'; }
function ossConfig(cfg) { return cfg?.storage?.oss || {}; }
function assertOssDeliveryReady(cfg) {
  if (!isOss(cfg)) return;
  const oss = ossConfig(cfg);
  if (!String(oss.endpoint || '').trim() || !String(oss.bucket || '').trim()) throw new Error('OSS endpoint and bucket are required');
  if (!String(oss.access_key_id || '').trim() || !String(oss.access_key_secret || '').trim()) throw new Error('OSS access credentials are required');
  if (!String(oss.public_base_url || '').trim()) throw new Error('storage.oss.public_base_url is required before removing local media');
}
function objectKey(cfg, localPath) {
  const prefix = String(ossConfig(cfg).prefix || 'local-mini-drama').replace(/^\/+|\/+$/g, '');
  return `${prefix ? `${prefix}/` : ''}${normalizeKey(localPath)}`;
}
function publicBaseUrl(value) {
  const base = String(value || '').trim().replace(/\/$/, '');
  if (!base) return '';
  return /^https?:\/\//i.test(base) ? base : `https://${base}`;
}
function objectUrl(cfg, localPath) {
  if (!isOss(cfg)) return `/static/${normalizeKey(localPath)}`;
  const oss = ossConfig(cfg);
  const base = publicBaseUrl(oss.public_base_url);
  if (!base) return `/static/${normalizeKey(localPath)}`;
  return `${base}/${objectKey(cfg, localPath).split('/').map(encodeURIComponent).join('/')}`;
}
function endpointUrl(oss, key) {
  const endpoint = String(oss.endpoint || '').replace(/\/$/, '');
  if (!endpoint || !oss.bucket) throw new Error('OSS endpoint and bucket are required');
  const encoded = String(key).split('/').map(encodeURIComponent).join('/');
  if (oss.force_path_style) return `${endpoint}/${encodeURIComponent(oss.bucket)}/${encoded}`;
  const url = new URL(endpoint);
  url.hostname = `${oss.bucket}.${url.hostname}`;
  url.pathname = `/${encoded}`;
  return url.toString();
}
function ossAuthorization(oss, method, contentType, date, key) {
  const id = String(oss.access_key_id || ''); const secret = String(oss.access_key_secret || '');
  if (!id || !secret) throw new Error('OSS access_key_id and access_key_secret are required');
  const canonical = `/${oss.bucket}/${key}`;
  const text = `${method}\n\n${contentType || ''}\n${date}\n${canonical}`;
  return `OSS ${id}:${crypto.createHmac('sha1', secret).update(text).digest('base64')}`;
}
function requestBuffer(urlText, options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlText); const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, options, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.setTimeout(Math.max(5_000, Number(options.timeout || 60_000)), () => req.destroy(new Error('OSS request timed out')));
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
async function putBuffer(cfg, localPath, buffer, contentType = 'application/octet-stream') {
  const oss = ossConfig(cfg); const key = objectKey(cfg, localPath); const url = endpointUrl(oss, key); const date = new Date().toUTCString();
  const result = await requestBuffer(url, { method: 'PUT', headers: {
    Date: date, 'Content-Type': contentType, 'Content-Length': buffer.length,
    Authorization: ossAuthorization(oss, 'PUT', contentType, date, key),
  } }, buffer);
  if (result.status < 200 || result.status >= 300) throw new Error(`OSS upload failed: HTTP ${result.status}`);
  return { key, url: objectUrl(cfg, localPath), etag: result.headers.etag || null };
}
async function readMediaBuffer(cfg, storageRoot, localPath) {
  const relative = normalizeKey(localPath);
  const absolute = path.join(storageRoot, relative);
  if (fs.existsSync(absolute)) return fs.readFileSync(absolute);
  if (!isOss(cfg)) return null;
  const oss = ossConfig(cfg); const key = objectKey(cfg, relative); const date = new Date().toUTCString();
  const result = await requestBuffer(endpointUrl(oss, key), { method: 'GET', headers: {
    Date: date, Authorization: ossAuthorization(oss, 'GET', '', date, key),
  } });
  if (result.status === 404) return null;
  if (result.status < 200 || result.status >= 300) throw new Error(`OSS read failed: HTTP ${result.status}`);
  return result.body;
}
async function archiveLocalFile(cfg, storageRoot, localPath, log, options = {}) {
  const relative = normalizeKey(localPath);
  if (!isOss(cfg)) return { provider: 'local', key: relative, url: `/static/${relative}` };
  if (options.removeLocal) assertOssDeliveryReady(cfg);
  const absolute = path.join(storageRoot, relative);
  if (!fs.existsSync(absolute)) throw new Error(`Local media file is missing: ${relative}`);
  const buffer = fs.readFileSync(absolute);
  if (!buffer.length) throw new Error(`Local media file is empty: ${relative}`);
  const ext = path.extname(relative).toLowerCase();
  const type = options.contentType || ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' }[ext] || 'application/octet-stream');
  const saved = await putBuffer(cfg, relative, buffer, type);
  if (options.removeLocal) fs.unlinkSync(absolute);
  if (log) log.info('Media archived to OSS', { local_path: relative, oss_key: saved.key, bytes: buffer.length });
  return { provider: 'oss', ...saved };
}
function staticHandler(cfg, storageRoot) {
  return (req, res, next) => {
    let key; try { key = normalizeKey(decodeURIComponent(req.path)); } catch (_) { return res.status(400).end(); }
    const local = path.join(storageRoot, key);
    // Legacy and not-yet-migrated files keep working. New OSS-only videos have
    // no local file and are redirected straight to the CDN/OSS object.
    if (fs.existsSync(local)) return res.sendFile(local);
    if (isOss(cfg) && ossConfig(cfg).public_base_url) return res.redirect(302, objectUrl(cfg, key));
    return next();
  };
}
async function migrateLocalTree(cfg, storageRoot, log, options = {}) {
  if (!isOss(cfg)) throw new Error('storage.type must be oss before migration');
  if (options.remove_local) assertOssDeliveryReady(cfg);
  const dryRun = !!options.dry_run; const removeLocal = !!options.remove_local; const rows = [];
  function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.isFile()) rows.push(full); } }
  if (fs.existsSync(storageRoot)) walk(storageRoot);
  const minAgeMs = Math.max(0, Number(options.min_age_ms) || 0);
  const result = { scanned: rows.length, migrated: 0, skipped: 0, failed: 0, bytes: 0, failures: [] };
  for (const full of rows) {
    const relative = normalizeKey(path.relative(storageRoot, full)); const stat = fs.statSync(full); const bytes = stat.size;
    if (minAgeMs && Date.now() - stat.mtimeMs < minAgeMs) { result.skipped++; continue; }
    if (dryRun) { result.bytes += bytes; continue; }
    try { await archiveLocalFile(cfg, storageRoot, relative, log, { removeLocal }); result.migrated++; result.bytes += bytes; }
    catch (error) { result.failed++; result.failures.push({ local_path: relative, error: error.message }); }
  }
  return result;
}

function startArchiveScheduler(cfg, storageRoot, log, options = {}) {
  if (!isOss(cfg)) return { runNow: async () => ({ skipped: 'local_storage' }), stop: () => {} };
  if (ossConfig(cfg).auto_archive_enabled !== true) return { runNow: async () => ({ skipped: 'auto_archive_disabled' }), stop: () => {} };
  assertOssDeliveryReady(cfg);
  const minAgeMs = Math.max(30_000, Number(options.min_age_ms ?? 5 * 60_000));
  const intervalMs = Math.max(30_000, Number(options.interval_ms ?? 60_000));
  let running = false;
  const runNow = async () => {
    if (running) return { skipped: 'already_running' };
    running = true;
    try {
      const result = await migrateLocalTree(cfg, storageRoot, log, { remove_local: true, min_age_ms: minAgeMs });
      if (result.migrated || result.failed) log.info('OSS background archive sweep completed', result);
      return result;
    } finally { running = false; }
  };
  setImmediate(() => runNow().catch((error) => log.error('OSS initial archive sweep failed', { error: error.message })));
  const timer = setInterval(() => runNow().catch((error) => log.error('OSS archive sweep failed', { error: error.message })), intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return { runNow, stop: () => clearInterval(timer) };
}

module.exports = { normalizeKey, isOss, objectKey, objectUrl, publicBaseUrl, putBuffer, readMediaBuffer, archiveLocalFile, staticHandler, migrateLocalTree, startArchiveScheduler, assertOssDeliveryReady };
