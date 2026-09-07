'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runMediaProcess } = require('../src/services/mediaAssetService');

test('media inspection subprocess is asynchronous and returns bounded output', async () => {
  const result = await runMediaProcess(process.execPath, ['-e', 'process.stdout.write("probe-ok")'], { timeoutMs: 2_000, maxBuffer: 64 * 1024 });
  assert.equal(result.stdout, 'probe-ok');
});

test('media inspection propagates subprocess failures', async () => {
  await assert.rejects(
    runMediaProcess(process.execPath, ['-e', 'process.stderr.write("invalid media"); process.exit(3)'], { timeoutMs: 2_000 }),
    /媒体处理失败.*invalid media/
  );
});

test('media inspection terminates a hung subprocess at the timeout', async () => {
  const started = Date.now();
  await assert.rejects(
    runMediaProcess(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { timeoutMs: 150 }),
    /媒体处理超时（150ms）/
  );
  assert.ok(Date.now() - started < 2_000);
});
