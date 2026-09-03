const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const videoClient = require('../src/services/videoClient');

test('provider polling reports normalized status without inventing overall progress', async () => {
  const originalFetch = global.fetch;
  const updates = [];
  global.fetch = async () => new Response(JSON.stringify({ id: 'provider-1', status: 'running' }), { status: 200 });
  try {
    const result = await videoClient.pollVideoTask(
      null,
      { info() {}, warn() {}, error() {} },
      1,
      'provider-1',
      { provider: 'volces', base_url: 'https://example.test', api_key: 'test' },
      1,
      0,
      (update) => updates.push(update)
    );
    assert.equal(updates.length, 1);
    assert.equal(updates[0].status, 'running');
    assert.equal(updates[0].provider_progress, null);
    assert.ok(result.error);
  } finally {
    global.fetch = originalFetch;
  }
});

test('video task stages do not claim every reference is uploaded to an image proxy', () => {
  const source = fs.readFileSync(require.resolve('../src/services/videoService'), 'utf8');
  assert.match(source, /正在准备 \$\{omniReferenceCount\} 个参考素材/);
  assert.match(source, /任务已提交模型服务，正在等待生成结果/);
  assert.match(source, /模型服务正在生成视频/);
  assert.match(source, /视频已生成，正在下载并保存原片/);
  assert.doesNotMatch(source, /正在上传 \$\{reference_urls\.length\} 张参考图到图床/);
});

test('Volcengine cancellation deletes only a queued task', async () => {
  const originalFetch = global.fetch;
  const methods = [];
  global.fetch = async (_url, options) => {
    methods.push(options.method);
    if (options.method === 'GET') return new Response(JSON.stringify({ id: 'provider-queued', status: 'queued' }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  try {
    const result = await videoClient.cancelVideoTask(
      { provider: 'volcengine', base_url: 'https://example.test/api/v3', api_key: 'test' },
      { info() {} },
      'provider-queued'
    );
    assert.equal(result.cancelled, true);
    assert.deepEqual(methods, ['GET', 'DELETE']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Volcengine cancellation does not delete a running task', async () => {
  const originalFetch = global.fetch;
  const methods = [];
  global.fetch = async (_url, options) => {
    methods.push(options.method);
    return new Response(JSON.stringify({ id: 'provider-running', status: 'running' }), { status: 200 });
  };
  try {
    const result = await videoClient.cancelVideoTask(
      { provider: 'volcengine', base_url: 'https://example.test/api/v3', api_key: 'test' },
      { info() {} },
      'provider-running'
    );
    assert.equal(result.cancelled, false);
    assert.equal(result.reason, 'running');
    assert.deepEqual(methods, ['GET']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('provider polling stops after a confirmed local cancellation', async () => {
  const originalFetch = global.fetch;
  let fetched = false;
  global.fetch = async () => {
    fetched = true;
    return new Response('{}', { status: 200 });
  };
  const db = {
    prepare() {
      return { get() { return { status: 'failed' }; } };
    },
  };
  try {
    const result = await videoClient.pollVideoTask(
      db,
      { info() {}, warn() {}, error() {} },
      1,
      'provider-cancelled',
      { provider: 'volcengine', base_url: 'https://example.test/api/v3', api_key: 'test' },
      1,
      0
    );
    assert.equal(result.stopped, true);
    assert.equal(fetched, false);
  } finally {
    global.fetch = originalFetch;
  }
});
