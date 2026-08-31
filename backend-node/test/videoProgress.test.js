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
  assert.match(source, /正在准备 \$\{reference_urls\.length\} 个参考素材/);
  assert.match(source, /任务已提交模型服务，正在等待生成结果/);
  assert.match(source, /模型服务正在生成视频/);
  assert.match(source, /视频已生成，正在下载并保存原片/);
  assert.doesNotMatch(source, /正在上传 \$\{reference_urls\.length\} 张参考图到图床/);
});
