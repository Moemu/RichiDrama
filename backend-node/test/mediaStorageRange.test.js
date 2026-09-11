'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { staticHandler } = require('../src/services/mediaStorageService');

function cfg(endpoint) {
  return {
    storage: {
      type: 'oss',
      oss: {
        endpoint,
        bucket: 'cold-media',
        prefix: 'drama',
        force_path_style: true,
        access_key_id: 'test-id',
        access_key_secret: 'test-secret',
      },
    },
  };
}

test('cold OSS static media forwards Range and HEAD without buffering the object in the app', async (t) => {
  const bytes = Buffer.from('0123456789');
  const seen = [];
  const upstream = http.createServer((req, res) => {
    seen.push({ method: req.method, range: req.headers.range || null });
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': bytes.length, 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4' });
      return res.end();
    }
    const range = /^bytes=(\d+)-(\d*)$/i.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      if (start >= bytes.length || end < start) {
        const errorBody = Buffer.from('provider-error');
        res.writeHead(416, {
          'Content-Length': errorBody.length,
          'Content-Range': `bytes */${bytes.length}`,
          'Content-Encoding': 'identity',
        });
        return res.end(errorBody);
      }
      const part = bytes.subarray(start, end + 1);
      res.writeHead(206, {
        'Content-Length': part.length,
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Type': 'video/mp4',
      });
      return res.end(part);
    }
    res.writeHead(200, { 'Content-Length': bytes.length, 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4' });
    res.end(bytes);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-cold-range-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = express();
  app.use('/static', staticHandler(cfg(`http://127.0.0.1:${upstream.address().port}`), root));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/static/videos/cold.mp4`;

  const ranged = await fetch(base, { headers: { Range: 'bytes=2-5' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await ranged.text(), '2345');

  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');

  const invalid = await fetch(base, { headers: { Range: 'bytes=99-' } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('content-range'), 'bytes */10');
  assert.equal(invalid.headers.get('content-length'), '0');
  assert.equal(invalid.headers.get('content-encoding'), null);
  assert.deepEqual(seen.slice(0, 3), [
    { method: 'GET', range: 'bytes=2-5' },
    { method: 'HEAD', range: null },
    { method: 'GET', range: 'bytes=99-' },
  ]);
});

test('cold OSS stream closes its upstream request when the client disconnects', async (t) => {
  let upstreamClosed = false;
  const upstream = http.createServer((req, res) => {
    req.on('close', () => { upstreamClosed = true; });
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Transfer-Encoding': 'chunked' });
    const timer = setInterval(() => res.write(Buffer.alloc(64 * 1024, 7)), 10);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-cold-abort-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = express();
  app.use('/static', staticHandler(cfg(`http://127.0.0.1:${upstream.address().port}`), root));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${server.address().port}/static/videos/abort.mp4`, (res) => {
      res.on('error', () => {});
      res.once('data', () => {
        req.destroy();
        setTimeout(resolve, 80);
      });
    });
    req.once('error', (error) => {
      if (error.code === 'ECONNRESET') return;
      reject(error);
    });
  });
  assert.equal(upstreamClosed, true);
});

test('cold OSS stream terminates the downstream when the provider body aborts', async (t) => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Length': '1024', 'Content-Type': 'video/mp4' });
    res.write(Buffer.from('partial'));
    setTimeout(() => res.destroy(), 15);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-cold-body-abort-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = express();
  app.use('/static', staticHandler(cfg(`http://127.0.0.1:${upstream.address().port}`), root));
  app.use((error, req, res, next) => {
    if (res.headersSent) return res.destroy();
    return res.status(502).end();
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const outcome = await Promise.race([
    new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${server.address().port}/static/videos/body-abort.mp4`, (res) => {
        res.resume();
        res.once('aborted', () => resolve('aborted'));
        res.once('error', () => resolve('error'));
        res.once('end', () => resolve('end'));
      });
      req.once('error', () => resolve('request-error'));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('downstream response did not terminate')), 2_000)),
  ]);
  assert.notEqual(outcome, 'end');
});

test('cold OSS cancellation before response headers keeps the server alive', async (t) => {
  let received;
  const upstreamReceived = new Promise(resolve => { received = resolve; });
  let closed;
  const upstreamClosed = new Promise(resolve => { closed = resolve; });
  const upstream = http.createServer((req, res) => {
    res.once('close', closed);
    received();
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-cold-header-abort-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = express();
  app.use('/static', staticHandler(cfg(`http://127.0.0.1:${upstream.address().port}`), root));
  app.get('/health', (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = http.get(`${base}/static/videos/header-abort.mp4`);
  request.on('error', () => {});
  await upstreamReceived;
  request.destroy();
  await upstreamClosed;
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
});
