'use strict';

// Preview media proxy — fully self-contained (http/https/crypto only).
//
// A long-lived TRUSTED container dual-homed onto the production egress
// network and the isolated preview network. Untrusted preview code reaches it
// only over the internal network; this process holds the production
// credentials (via --env-file at creation) and its sole capability is reading
// whitelisted media objects from the private bucket. Two invariants drive the
// design: preview containers stay credential-free and offline; production
// data stays read-only.
//
// Being standalone matters operationally: the proxy binds its own script from
// a host directory, so it never depends on which application release happens
// to be baked into the surrounding image.

const http = require('http');
const https = require('https');

const MEDIA_EXTENSIONS = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  avif: 'image/avif', mp3: 'audio/mpeg', wav: 'audio/wav',
  m4a: 'audio/mp4', m3u8: 'application/vnd.apple.mpegurl',
};

function contentTypeFor(key) {
  const dot = key.lastIndexOf('.');
  if (dot === -1) return null;
  return MEDIA_EXTENSIONS[key.slice(dot + 1).toLowerCase()] || null;
}

function normalizeKey(value) {
  const key = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!key || key.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid media storage key');
  return key;
}

function parseParams(env) {
  const explicitFlag = env.MINIDRAMA_OSS_FORCE_PATH_STYLE !== undefined
    && String(env.MINIDRAMA_OSS_FORCE_PATH_STYLE).trim() !== '';
  return {
    endpoint: String(env.MINIDRAMA_OSS_ENDPOINT || '').trim(),
    bucket: String(env.MINIDRAMA_OSS_BUCKET || '').trim(),
    prefix: String(env.MINIDRAMA_OSS_PREFIX || '').trim().replace(/^\/+|\/+$/g, ''),
    accessKeyId: String(env.MINIDRAMA_OSS_ACCESS_KEY_ID || '').trim(),
    accessKeySecret: String(env.MINIDRAMA_OSS_ACCESS_KEY_SECRET || '').trim(),
    // Default mirrors mediaStorageService behaviour.
    forcePathStyle: explicitFlag ? String(env.MINIDRAMA_OSS_FORCE_PATH_STYLE).trim() === 'true' : true,
  };
}

function validateProxyParams(p) {
  for (const field of ['endpoint', 'bucket', 'accessKeyId', 'accessKeySecret']) {
    if (!String(p?.[field] || '').trim()) return `media proxy requires ${field}`;
  }
  return null;
}

function buildTarget(params, encodedKey) {
  const endpoint = params.endpoint.replace(/\/+$/, '');
  const scheme = endpoint.startsWith('https://') ? 'https://' : 'http://';
  const rest = endpoint.replace(/^https?:\/\//, '');
  const keyPath = params.prefix ? `${params.prefix}/${encodedKey}` : encodedKey;
  if (params.forcePathStyle) return `${scheme}${rest}/${params.bucket}/${keyPath}`;
  return `${scheme}${params.bucket}.${rest}/${keyPath}`;
}

// Canonical Aliyun v1 text exactly mirrors what mediaStorageService signs for
// GET requests: empty content-type slot, raw (unencoded) key.
function signGet(params, method, date, contentType, key) {
  const crypto = require('crypto');
  const text = `${method}\n\n${contentType}\n${date}\n/${params.bucket}/${key}`;
  if (process.env.MEDIA_PROXY_DEBUG === '1') {
    console.error('[media-proxy][debug] canonical:', JSON.stringify(text));
  }
  return `OSS ${params.accessKeyId}:${crypto.createHmac('sha1', params.accessKeySecret).update(text).digest('base64')}`;
}

function requestStream(urlText, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlText);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, { method: 'GET', headers }, (res) => resolve({ status: res.statusCode || 0, headers: res.headers, stream: res }));
    req.setTimeout(Math.max(5000, 60000), () => req.destroy(new Error('OSS request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function createProxyServer(params, { maxConcurrent = 12 } = {}) {
  const validationError = validateProxyParams(params);
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

    let decoded;
    try { decoded = decodeURIComponent(url.pathname.slice('/media/'.length)); }
    catch (_) { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end(); }

    const extensionOk = contentTypeFor(decoded) !== null;
    const shapeOk = /^[A-Za-z0-9_一-鿿][A-Za-z0-9_一-鿿/.-]*$/.test(decoded);
    if (!shapeOk || !extensionOk) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end();
    }
    let key;
    try { key = normalizeKey(decoded); }
    catch (_) { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end(); }

    const rangeHeader = String(req.headers.range || '');
    const range = /^bytes=/i.test(rangeHeader.trim()) ? rangeHeader.trim() : null;

    openUpstream(key, range)
      .then((upstream) => {
        if (upstream.status !== 200 && upstream.status !== 206) {
          upstream.stream.destroy();
          res.writeHead(upstream.status === 404 ? 404 : 502, { 'Content-Type': 'text/plain' });
          return res.end(upstream.status === 404 ? 'media not found' : 'media upstream error');
        }
        activeStreams += 1;
        let completed = false;
        const complete = () => { if (!completed) { completed = true; activeStreams -= 1; } };

        const responseHeaders = {
          'Content-Type': contentTypeFor(key) || 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
        };
        for (const headerName of ['content-range', 'content-length', 'etag']) {
          const value = upstream.headers[headerName];
          if (value != null) responseHeaders[headerName.charAt(0).toUpperCase() + headerName.slice(1)] = value;
        }
        res.writeHead(upstream.status, responseHeaders);

        upstream.stream.on('close', complete);
        if (req.method === 'HEAD') { upstream.stream.destroy(); return res.end(); }
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

    async function openUpstream(rawKey, rangeValue) {
      // The signed canonical key INCLUDES the bucket prefix; only the URL
      // gets per-segment percent-encoding.
      const signedKey = `${params.prefix}/${rawKey}`;
      const segments = rawKey.split('/').map((s) => encodeURIComponent(s)).join('/');
      const target = buildTarget(params, segments);
      const date = new Date().toUTCString();
      const headerBag = { Date: date, Authorization: signGet(params, 'GET', date, '', signedKey) };
      if (process.env.MEDIA_PROXY_DEBUG === '1') {
        console.error('[media-proxy][debug] upstream:', JSON.stringify({
          target,
          method: 'GET',
          canonicalKey: signedKey,
          dateSent: headerBag.Date,
          secretFingerprint: `${params.accessKeySecret.length}:${params.accessKeySecret.slice(0, 3)}...${params.accessKeySecret.slice(-3)}`,
          authSent: headerBag.Authorization,
        }));
      }
      if (rangeValue) headerBag.Range = rangeValue;
      return requestStream(target, headerBag);
    }
  });
}

module.exports = { normalizeKey, contentTypeFor, parseParams, validateProxyParams, signGet, buildTarget, createProxyServer };

if (require.main === module) {
  const params = parseParams(process.env);
  const error = validateProxyParams(params);
  if (error) { console.error('media proxy config invalid:', error); process.exit(1); }
  const port = Number(process.env.PORT || 8090);
  createProxyServer(params).listen(port, '0.0.0.0', () => console.log(`media proxy listening on :${port}`));
}
