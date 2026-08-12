const test = require('node:test');
const assert = require('node:assert/strict');

test('environment override diagnostics redact storage credentials', () => {
  const prior = process.env.CFG_STORAGE__OSS__ACCESS_KEY_SECRET;
  process.env.CFG_STORAGE__OSS__ACCESS_KEY_SECRET = 'should-not-appear-in-logs';
  delete require.cache[require.resolve('../src/config')];
  const config = require('../src/config');
  config.loadConfig();
  const line = config.getEnvOverrideLog().find((entry) => entry.includes('CFG_STORAGE__OSS__ACCESS_KEY_SECRET'));
  assert.match(line, /<redacted>/);
  assert.doesNotMatch(line, /should-not-appear-in-logs/);
  if (prior === undefined) delete process.env.CFG_STORAGE__OSS__ACCESS_KEY_SECRET;
  else process.env.CFG_STORAGE__OSS__ACCESS_KEY_SECRET = prior;
});
