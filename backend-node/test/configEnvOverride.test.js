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

test('deployment MINIDRAMA OSS variables activate storage when Compose leaves CFG defaults empty', () => {
  const prior = {
    deploymentType: process.env.MINIDRAMA_STORAGE_TYPE,
    deploymentEndpoint: process.env.MINIDRAMA_OSS_ENDPOINT,
    cfgType: process.env.CFG_STORAGE__TYPE,
    cfgEndpoint: process.env.CFG_STORAGE__OSS__ENDPOINT,
  };
  process.env.MINIDRAMA_STORAGE_TYPE = 'oss';
  process.env.MINIDRAMA_OSS_ENDPOINT = 'https://oss.example.test';
  process.env.CFG_STORAGE__TYPE = '';
  process.env.CFG_STORAGE__OSS__ENDPOINT = '';
  delete require.cache[require.resolve('../src/config')];
  const config = require('../src/config').loadConfig();
  assert.equal(config.storage.type, 'oss');
  assert.equal(config.storage.oss.endpoint, 'https://oss.example.test');
  for (const [key, value] of Object.entries(prior)) {
    const envKey = key === 'deploymentType' ? 'MINIDRAMA_STORAGE_TYPE' : key === 'deploymentEndpoint' ? 'MINIDRAMA_OSS_ENDPOINT' : key === 'cfgType' ? 'CFG_STORAGE__TYPE' : 'CFG_STORAGE__OSS__ENDPOINT';
    if (value === undefined) delete process.env[envKey]; else process.env[envKey] = value;
  }
});

test('missing deployment OSS variables do not create string undefined CFG overrides', () => {
  const deploymentKey = 'MINIDRAMA_OSS_AUTO_ARCHIVE_ENABLED';
  const cfgKey = 'CFG_STORAGE__OSS__AUTO_ARCHIVE_ENABLED';
  const priorDeployment = process.env[deploymentKey];
  const priorCfg = process.env[cfgKey];
  delete process.env[deploymentKey];
  delete process.env[cfgKey];
  delete require.cache[require.resolve('../src/config')];

  const configModule = require('../src/config');
  const config = configModule.loadConfig();
  assert.equal(process.env[cfgKey], undefined);
  assert.equal(config.storage.oss?.auto_archive_enabled, undefined);
  assert.equal(configModule.getEnvOverrideLog().some((entry) => entry.includes(cfgKey)), false);

  if (priorDeployment === undefined) delete process.env[deploymentKey];
  else process.env[deploymentKey] = priorDeployment;
  if (priorCfg === undefined) delete process.env[cfgKey];
  else process.env[cfgKey] = priorCfg;
});
