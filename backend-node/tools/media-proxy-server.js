'use strict';

// Preview media proxy core. A long-lived TRUSTED container dual-homed onto
// the production egress network and the isolated preview network: untrusted
// preview code reaches it only over the internal network, it holds the
// production credentials so the preview app itself never has to, and its sole
// capability is reading whitelisted media objects from the private bucket.
//
// Everything about its posture exists to keep two invariants intact:
//   - preview containers stay credential-free and offline;
//   - production data stays read-only (streaming reads only, no writes).

const http = require('http');
const mediaStorage = require('../src/services/mediaStorageService');

function validateProxyConfig(cfg) {
  if (!cfg || !mediaStorage.isOss(cfg)) {
    return 'media proxy requires storage.type=oss';
  }
  const oss = cfg.storage.oss || {};
  for (const field of ['endpoint', 'bucket', 'access_key_id', 'access_key_secret']) {
    if (!String(oss[field] || '').trim()) return `media proxy requires storage.oss.${field}`;
  }
  return null;
}

function createMediaProxyServer({ cfg, maxConcurrent = 12 } = {}) {
  const validationError = validateProxyConfig(cfg);
  if (validationError) throw new Error(validationError);
  let activeStreams = 0;

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"ok":true}');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }

    if (!url.pathname.startsWith('/media/')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }

    // Decode ONCE, then restrict the character set before any filesystem or
    // object-key derivation. This kills traversal shapes outright ('..' needs
    // characters the whitelist refuses), including double-encoded variants,
    // which still contain '%' after the single legitimate decode.
    let decoded;
    try { decoded = decodeURIComponent(url.pathname.slice('/media/'.length)); }
    catch (_) { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end(); }

    const pathShapeOk = /^[A-Za-z0-9_一-鿿][A-Za-z0-9_一-鿿/.-]*$/.test(decoded);
    let key;
    try { key = mediaStorage.normalizeKey(decoded); }
    catch (_) { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end(); }
    if (!pathShapeOk || !mediaStorage.mediaContentType(key)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end();
    }

    const rangeHeader = String(req.headers.range || '');
    const range = /^bytes=/i.test(rangeHeader.trim()) ? rangeHeader.trim() : null;

    mediaStorage.openObjectStream(cfg, mediaStorage.objectKey(cfg, key), { range })
      .then((upstream) => {
        const statusOk = upstream.status === 200 || upstream.status === 206;
        if (!statusOk) {
          upstream.stream.destroy();
          res.writeHead(upstream.status === 404 ? 404 : 502, { 'Content-Type': 'text/plain' });
          return res.end(upstream.status === 404 ? 'media not found' : 'media upstream error');
        }
        // Count a stream only from here on: concurrent-cap enforcement covers
        // real upstream sockets, and every exit below calls complete() once.
        activeStreams += 1;
        let completed = false;
        const complete = () => {
          if (!completed) { completed = true; activeStreams -= 1; }
        };

        const responseHeaders = {
          'Content-Type': mediaStorage.mediaContentType(key) || 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
        };
        for (const headerName of ['content-range', 'content-length', 'etag']) {
          const value = upstream.headers[headerName];
          if (value != null) responseHeaders[headerName.charAt(0).toUpperCase() + headerName.slice(1)] = value;
        }
        res.writeHead(upstream.status, responseHeaders);

        upstream.stream.on('close', complete);
        if (req.method === 'HEAD') {
          upstream.stream.destroy();
          return res.end();
        }
        res.on('close', () => { if (!res.writableEnded) upstream.stream.destroy(); });
        upstream.stream.pipe(res);
      })
      .catch((error) => {
        console.error('media proxy error', { path: url.pathname, message: error.message });
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('media upstream error');
        } else {
          res.destroy();
        }
      });
  });
}

module.exports = { validateProxyConfig, createMediaProxyServer };
