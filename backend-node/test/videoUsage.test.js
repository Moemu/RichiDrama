const test = require('node:test');
const assert = require('node:assert/strict');
const { extractVideoProviderUsage, sanitizeVideoProviderResponse } = require('../src/services/videoClient');
const { textUsage } = require('../src/services/billingUsageService');

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

test('Seedance completion usage is converted to the actual token settlement, not the reservation', () => {
  // Captured shape from a successful Ark Seedance 2.0 task response. Values
  // are representative and intentionally contain no prompt, URL, or secret.
  const completion = {
    id: 'cgt-example', model: 'doubao-seedance-2-0-260128', status: 'succeeded',
    duration: 5, resolution: '480p', usage: { completion_tokens: 50638, total_tokens: 50638 },
  };
  const provider = extractVideoProviderUsage(completion);
  assert.equal(provider.path, 'usage');
  assert.deepEqual(textUsage(provider.usage), { output_token: 50638 });
  assert.notDeepEqual(textUsage(provider.usage), { output_token: 200000 }); // reservation cap
});

test('text usage splits included and disjoint cached input without inventing cache hits', () => {
  assert.deepEqual(textUsage({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 30 } }),
    { input_token: 70, cache_token: 30, output_token: 5 });
  assert.deepEqual(textUsage({ input_tokens: 70, output_tokens: 5, cache_read_input_tokens: 30 }),
    { input_token: 70, cache_token: 30, output_token: 5 });
  assert.deepEqual(textUsage({ prompt_tokens: 100, completion_tokens: 5 }), { input_token: 100, output_token: 5 });
  assert.deepEqual(textUsage({ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 11 } }), { input_token: 10 });
});

test('Richbest provider identity overrides a stale explicit video protocol', () => {
  const { resolveVideoProtocol } = require('../src/services/videoClient');
  assert.equal(resolveVideoProtocol({ provider: 'richbest', api_protocol: 'volcengine_omni' }, 'doubao-seedance-2.0-mini'), 'richbest');
});

test('sanitizeVideoProviderResponse preserves usage but redacts sensitive fields', () => {
  const snapshot = sanitizeVideoProviderResponse({ status: 'succeeded', content: { video_url: 'https://signed.example/video?sig=secret' }, usage: { completion_tokens: 35800 }, prompt: 'private', api_key: 'secret' });
  assert.equal(snapshot.status, 'succeeded');
  assert.deepEqual(snapshot.usage, { completion_tokens: 35800 });
  assert.equal(snapshot.content.video_url, '[redacted]');
  assert.equal(snapshot.prompt, '[redacted]');
  assert.equal(snapshot.api_key, '[redacted]');
});
