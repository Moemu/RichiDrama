'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createProxyServer, validateProxyParams, signGet } = require('../tools/media-proxy.js');

const MEDIA_BYTES = Buffer.from('0123456789', 'utf8'); // 10 bytes, easy range math

function proxyConfig(endpoint) {
  return {
    endpoint,
    bucket: 'test-bucket',
    prefix: 'drama',
    accessKeyId: 'test-id',
    accessKeySecret: 'test-secret',
    forcePathStyle: true,
  };
}

// Minimal OSS stub honouring the path shape the proxy signs/requests:
// /<bucket>/<prefix>/<relative key>. Range slicing mirrors simple byte ranges.
function startOssStub(t) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const matched = req.url.match(/^\/test-bucket\/drama\/(.+)$/);
    if (!matched) { seen.push({ url: req.url, note: 'unmatched' }); res.writeHead(404); return res.end(); }
    const key = decodeURIComponent(matched[1]);
    seen.push({ url: req.url, key, allHeaders: { ...req.headers }, auth: req.headers.authorization || null, cookie: req.headers.cookie || null, range: req.headers.range || null });
    if (key === 'library/videos/carousel.mp4') {
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
      if (range) {
        const chunk = MEDIA_BYTES.subarray(Number(range[1]), Number(range[2]) + 1);
        res.writeHead(206, {
          'Content-Range': `bytes ${range[1]}-${range[2]}/${MEDIA_BYTES.length}`,
          'Content-Length': String(chunk.length),
          ETag: '"carousel-etag"',
        });
        return res.end(chunk);
      }
      res.writeHead(200, { 'Content-Length': String(MEDIA_BYTES.length), ETag: '"carousel-etag"' });
      return res.end(MEDIA_BYTES);
    }
    res.writeHead(404);
    return res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, endpoint: `http://127.0.0.1:${server.address().port}`, seen })));
}

function startProxy(t, params) {
  const server = createProxyServer(params).listen(0, '127.0.0.1');
  return new Promise((resolve) => server.once('listening', () => resolve({ server, port: server.address().port })));
}

async function get(port, urlPath, headers = {}) {
  // The inbound Cookie marker exists to prove outbound calls never carry it.
  return fetch(`http://127.0.0.1:${port}${urlPath}`, { headers: { Cookie: 'session=attacker-marker', ...headers } });
}

test('validateProxyParams rejects missing endpoint or credentials', () => {
  assert.match(String(validateProxyParams({ bucket: 'b' })), /requires endpoint/);
  assert.match(String(validateProxyParams(proxyConfig('http://x').accessKeySecret === '' ? proxyConfig('http://x') : { ...proxyConfig('http://x'), accessKeyId: '' })), /accessKeyId/);
});

test('healthz answers without touching the bucket', async (t) => {
  const oss = await startOssStub(t);
  const params = proxyConfig(oss.endpoint);
  const proxy = await startProxy(t, params);
  t.after(() => { proxy.server.close(); oss.server.close(); });
  const response = await get(proxy.port, '/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('full and ranged reads pass through signed, cached, cookie-free', async (t) => {
  const oss = await startOssStub(t);
  const params = proxyConfig(oss.endpoint);
  const proxy = await startProxy(t, params);
  t.after(() => { proxy.server.close(); oss.server.close(); });

  const full = await get(proxy.port, '/media/library/videos/carousel.mp4');
  assert.equal(full.status, 200);
  assert.equal(await full.text(), MEDIA_BYTES.toString());
  assert.equal(full.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('etag'), '"carousel-etag"');

  const ranged = await get(proxy.port, '/media/library/videos/carousel.mp4', { Range: 'bytes=2-5' });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await ranged.text(), '2345');

  // Credentials must never travel toward untrusted code paths, and the
  // outbound signature must be recomputable from wire-visible values alone.
  const record = oss.seen[0];
  assert.equal(oss.seen.some((entry) => entry.cookie !== null), false);
  assert.match(record.auth, /^OSS test-id:/);
  // Wire canonical resource is /<bucket>/<prefix>/<relative>: signing uses
  // the prefixed object key and the wire Date exactly like production.
  const wireDate = record.allHeaders?.date ?? '';
  const expectedCanonicalKey = `drama/${record.key}`;
  assert.equal(record.auth, signGet(params, 'GET', wireDate, '', expectedCanonicalKey));
});

test('cold objects map to clean 404s and non-media extensions are refused pre-OSS', async (t) => {
  const oss = await startOssStub(t);
  const params = proxyConfig(oss.endpoint);
  const proxy = await startProxy(t, params);
  t.after(() => { proxy.server.close(); oss.server.close(); });

  const missing = await get(proxy.port, '/media/library/videos/gone.mp4');
  assert.equal(missing.status, 404);

  const traversal = await get(proxy.port, '/media/%252e%252e%252fsecret.txt');
  assert.ok([400, 404].includes(traversal.status));

  const textFile = await get(proxy.port, '/media/docs/readme.txt');
  assert.equal(textFile.status, 404);
});

test('POST is rejected outright', async (t) => {
  const oss = await startOssStub(t);
  const params = proxyConfig(oss.endpoint);
  const proxy = await startProxy(t, params);
  t.after(() => { proxy.server.close(); oss.server.close(); });
  const response = await fetch(`http://127.0.0.1:${proxy.port}/media/library/videos/carousel.mp4`, { method: 'POST' });
  assert.equal(response.status, 405);
});
