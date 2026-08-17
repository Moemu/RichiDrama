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
async function verifyOssObject(cfg, localPath) {
  if (!isOss(cfg)) return { ok: false, reason: 'local_storage' };
  const oss = ossConfig(cfg); const key = objectKey(cfg, localPath); const date = new Date().toUTCString();
  const result = await requestBuffer(endpointUrl(oss, key), { method: 'HEAD', headers: {
    Date: date, Authorization: ossAuthorization(oss, 'HEAD', '', date, key),
  } });
  const size = Number(result.headers['content-length'] || 0);
  if (result.status < 200 || result.status >= 300) return { ok: false, reason: `HTTP ${result.status}`, key };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, reason: 'empty_object', key };
  return { ok: true, key, bytes: size, etag: result.headers.etag || null };
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

function archiveStamp() { return new Date().toISOString(); }
const activeMirrors = new Map();
function retentionDays(cfg, sourceType) {
  const configured = ossConfig(cfg).local_retention_days;
  const values = typeof configured === 'object' && configured ? configured : { default: configured };
  const type = String(sourceType || '').toLowerCase();
  const key = type.includes('video') ? 'video' : type.includes('image') ? 'image' : type.includes('audio') ? 'audio' : 'default';
  const fallback = key === 'video' ? 14 : 30;
  const days = Number(values[key] ?? values.default ?? fallback);
  return Number.isFinite(days) && days >= 1 ? Math.min(days, 3650) : fallback;
}
function deleteAfter(cfg, sourceType, at = Date.now()) { return new Date(at + retentionDays(cfg, sourceType) * 86400_000).toISOString(); }
function trackArchive(db, localPath, sourceType, sourceId, patch = {}) {
  if (!db) return;
  const at = archiveStamp();
  try {
    db.prepare(`INSERT INTO media_archive_records
      (local_path, source_type, source_id, oss_key, oss_etag, archive_status, archive_attempts, archive_error, verified_at, local_delete_after, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(local_path) DO UPDATE SET source_type=excluded.source_type, source_id=excluded.source_id,
        oss_key=excluded.oss_key, oss_etag=excluded.oss_etag, archive_status=excluded.archive_status,
        archive_attempts=excluded.archive_attempts, archive_error=excluded.archive_error,
        verified_at=excluded.verified_at, local_delete_after=excluded.local_delete_after, updated_at=excluded.updated_at`)
      .run(normalizeKey(localPath), sourceType || 'media', sourceId || null, patch.oss_key || null, patch.oss_etag || null,
        patch.archive_status || 'local_ready', Number(patch.archive_attempts || 0), patch.archive_error || null,
        patch.verified_at || null, patch.local_delete_after || null, at, at);
  } catch (_) { /* Older unit-test schemas and pre-migration databases remain local-first. */ }
}

async function mirrorAndTrackOnce(db, cfg, storageRoot, localPath, sourceType, sourceId, log, options = {}) {
  const relative = normalizeKey(localPath);
  if (!isOss(cfg)) {
    trackArchive(db, relative, sourceType, sourceId, { archive_status: 'local_ready' });
    return { provider: 'local', status: 'local_ready', local_path: relative };
  }
  try {
    // A mirror never deletes the hot local file. Retention cleanup is a
    // separate, database-driven operation after the configured retention age.
    const saved = await archiveLocalFile(cfg, storageRoot, relative, log, { ...options, removeLocal: false });
    trackArchive(db, relative, sourceType, sourceId, {
      oss_key: saved.key, oss_etag: saved.etag, archive_status: 'oss_synced',
      archive_attempts: 1, verified_at: archiveStamp(), local_delete_after: deleteAfter(cfg, sourceType),
    });
    return { ...saved, status: 'oss_synced' };
  } catch (error) {
    trackArchive(db, relative, sourceType, sourceId, {
      archive_status: 'pending', archive_attempts: 1,
      archive_error: String(error.message || 'OSS mirror failed').slice(0, 500),
    });
    throw error;
  }
}

// Completion and restart-recovery can request the same stable media path at
// nearly the same time. Share that upload instead of writing the same OSS
// object twice and emitting duplicate success logs.
async function mirrorAndTrack(db, cfg, storageRoot, localPath, sourceType, sourceId, log, options = {}) {
  const key = normalizeKey(localPath);
  const active = activeMirrors.get(key);
  if (active) return active;
  const work = mirrorAndTrackOnce(db, cfg, storageRoot, key, sourceType, sourceId, log, options);
  activeMirrors.set(key, work);
  try { return await work; }
  finally {
    if (activeMirrors.get(key) === work) activeMirrors.delete(key);
  }
}

async function pruneVerifiedLocalCopies(db, cfg, storageRoot, log, limit = 100) {
  if (!db || !isOss(cfg)) return { skipped: !db ? 'no_database' : 'local_storage' };
  let rows = [];
  try {
    rows = db.prepare(`SELECT local_path, source_type, source_id, oss_key, oss_etag, local_delete_after
      FROM media_archive_records
      WHERE archive_status = 'oss_synced' AND local_delete_after IS NOT NULL AND local_delete_after <= ?
      ORDER BY local_delete_after ASC LIMIT ?`).all(archiveStamp(), limit);
  } catch (_) { return { skipped: 'archive_table_unavailable' }; }
  const result = { scanned: rows.length, pruned: 0, retained: 0, failed: 0 };
  for (const row of rows) {
    const relative = normalizeKey(row.local_path); const local = path.join(storageRoot, relative);
    if (!fs.existsSync(local)) {
      trackArchive(db, relative, row.source_type, row.source_id, { ...row, archive_status: 'local_pruned', verified_at: archiveStamp() }); result.pruned++; continue;
    }
    try {
      // HEAD is the deletion gate: an upload acknowledgment alone is not
      // enough; the private object must still be readable through OSS.
      const verified = await verifyOssObject(cfg, relative);
      if (!verified.ok) {
        trackArchive(db, relative, row.source_type, row.source_id, { ...row, archive_status: 'oss_synced', archive_error: `Retention check failed: ${verified.reason}`, local_delete_after: new Date(Date.now() + 86400_000).toISOString() });
        result.retained++; continue;
      }
      fs.unlinkSync(local);
      trackArchive(db, relative, row.source_type, row.source_id, { ...row, oss_key: verified.key, oss_etag: verified.etag || row.oss_etag, archive_status: 'local_pruned', archive_error: null, verified_at: archiveStamp(), local_delete_after: null });
      result.pruned++;
      log?.info('Pruned verified local media hot copy', { local_path: relative, oss_key: verified.key });
    } catch (error) {
      trackArchive(db, relative, row.source_type, row.source_id, { ...row, archive_status: 'oss_synced', archive_error: `Retention deletion failed: ${String(error.message || error).slice(0, 400)}` });
      result.failed++;
    }
  }
  return result;
}

async function retryPendingMirrors(db, cfg, storageRoot, log, limit = 100) {
  if (!db || !isOss(cfg)) return { skipped: !db ? 'no_database' : 'local_storage' };
  let rows = [];
  try { rows = db.prepare(`SELECT local_path, source_type, source_id FROM media_archive_records WHERE archive_status = 'pending' ORDER BY updated_at ASC LIMIT ?`).all(limit); } catch (_) { return { skipped: 'archive_table_unavailable' }; }
  let synced = 0; let failed = 0;
  for (const row of rows) {
    try { await mirrorAndTrack(db, cfg, storageRoot, row.local_path, row.source_type, row.source_id, log); synced += 1; }
    catch (_) { failed += 1; }
  }
  return { synced, failed };
}
function staticHandler(cfg, storageRoot) {
  return async (req, res, next) => {
    let key; try { key = normalizeKey(decodeURIComponent(req.path)); } catch (_) { return res.status(400).end(); }
    const local = path.join(storageRoot, key);
    // The application route remains the authorization boundary. If a future
    // retention job removes a verified local hot copy, proxy bytes from the
    // private OSS object instead of leaking a permanent public object URL.
    if (fs.existsSync(local)) return res.sendFile(local);
    try {
      const body = await readMediaBuffer(cfg, storageRoot, key);
      if (!body) return next();
      const ext = path.extname(key).toLowerCase();
      const type = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' }[ext] || 'application/octet-stream';
      // Local files are served by sendFile, which implements byte ranges.
      // Preserve that contract after a hot copy has been pruned and the bytes
      // are read from private OSS, otherwise Chromium can discard a video
      // after seeking or resuming a buffered playback.
      const range = String(req.headers?.range || '');
      if (range && /^bytes=/.test(range)) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
        const total = body.length;
        const start = match && match[1] ? Number(match[1]) : null;
        const requestedEnd = match && match[2] ? Number(match[2]) : null;
        const end = requestedEnd == null ? total - 1 : Math.min(requestedEnd, total - 1);
        if (!match || !Number.isSafeInteger(start) || start < 0 || start >= total || end < start) {
          return res.status(416).set('Content-Range', `bytes */${total}`).end();
        }
        const chunk = body.subarray(start, end + 1);
        return res.status(206).set({
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Content-Length': String(chunk.length),
        }).type(type).send(chunk);
      }
      res.type(type).send(body);
    } catch (error) { next(error); }
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
  if (!ossConfig(cfg).auto_archive_enabled) return { runNow: async () => ({ skipped: 'auto_archive_disabled' }), stop: () => {} };
  // Do not scan a directory and delete files after a fixed age. Mirroring is
  // tracked per media record; local cleanup belongs to a future retention job.
  if (!options.db) return { runNow: async () => ({ skipped: 'no_archive_database' }), stop: () => {} };
  const intervalMs = Math.max(30_000, Number(options.interval_ms ?? 60_000));
  let running = false;
  const runNow = async () => {
    if (running) return { skipped: 'already_running' };
    running = true;
    try {
      const mirror = await retryPendingMirrors(options.db, cfg, storageRoot, log);
      const retention = await pruneVerifiedLocalCopies(options.db, cfg, storageRoot, log);
      const result = { mirror, retention };
      if (mirror.synced || mirror.failed || retention.pruned || retention.failed) log.info('OSS mirror and retention sweep completed', result);
      return result;
    } finally { running = false; }
  };
  setImmediate(() => runNow().catch((error) => log.error('OSS initial archive sweep failed', { error: error.message })));
  const timer = setInterval(() => runNow().catch((error) => log.error('OSS archive sweep failed', { error: error.message })), intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return { runNow, stop: () => clearInterval(timer) };
}

module.exports = { normalizeKey, isOss, objectKey, objectUrl, publicBaseUrl, putBuffer, readMediaBuffer, verifyOssObject, archiveLocalFile, mirrorAndTrack, retryPendingMirrors, pruneVerifiedLocalCopies, staticHandler, migrateLocalTree, startArchiveScheduler, assertOssDeliveryReady };
