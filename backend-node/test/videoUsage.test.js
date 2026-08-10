const test = require('node:test');
const assert = require('node:assert/strict');
const { extractVideoProviderUsage, sanitizeVideoProviderResponse } = require('../src/services/videoClient');

test('extractVideoProviderUsage accepts every supported provider completion envelope', () => {
  const cases = [
    [{ usage: { prompt_tokens: 1, completion_tokens: 2 } }, 'usage'],
    [{ data: { usage: { input_tokens: 1, output_tokens: 2 } } }, 'data.usage'],
    [{ output: { usage: { input_token_count: 1, output_token_count: 2 } } }, 'output.usage'],
    [{ data: { output: { usage: { prompt_tokens: 1, completion_tokens: 2 } } } }, 'data.output.usage'],
    [{ result: { usage: { prompt_tokens: 1, completion_tokens: 2 } } }, 'result.usage'],
    [{ data: { result: { usage: { prompt_tokens: 1, completion_tokens: 2 } } } }, 'data.result.usage'],
  ];
  for (const [payload, path] of cases) {
    const found = extractVideoProviderUsage(payload);
    assert.equal(found.path, path);
    assert.ok(found.usage);
  }
});

test('extractVideoProviderUsage never fabricates usage from a completed task', () => {
  assert.deepEqual(extractVideoProviderUsage({ data: { status: 'succeeded', duration: 5 } }), { usage: null, path: null });
});

test('sanitizeVideoProviderResponse preserves usage but redacts sensitive fields', () => {
  const snapshot = sanitizeVideoProviderResponse({ status: 'succeeded', content: { video_url: 'https://signed.example/video?sig=secret' }, usage: { completion_tokens: 35800 }, prompt: 'private', api_key: 'secret' });
  assert.equal(snapshot.status, 'succeeded');
  assert.deepEqual(snapshot.usage, { completion_tokens: 35800 });
  assert.equal(snapshot.content.video_url, '[redacted]');
  assert.equal(snapshot.prompt, '[redacted]');
  assert.equal(snapshot.api_key, '[redacted]');
});
