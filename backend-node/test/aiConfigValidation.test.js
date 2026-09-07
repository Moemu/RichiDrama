const test = require('node:test');
const assert = require('node:assert/strict');
const aiConfig = require('../src/services/aiConfigService');

const base = {
  service_type: 'text',
  name: '文本配置',
  provider: 'openai',
  base_url: 'https://example.test/v1',
  api_key: 'secret-key',
  model: ['gpt-test'],
};

test('HTTP config validation rejects empty ordinary credentials and model lists', () => {
  assert.throws(() => aiConfig.validateConfigRequest({ ...base, api_key: '' }), /api_key/);
  assert.throws(() => aiConfig.validateConfigRequest({ ...base, model: [] }), /模型/);
});

test('HTTP config validation preserves masked edits and legal official AK/SK exceptions', () => {
  assert.doesNotThrow(() => aiConfig.validateConfigRequest(
    { api_key: 'secr****-key' },
    { mode: 'update', existing: base },
  ));
  assert.throws(() => aiConfig.validateConfigRequest(
    { api_key: '' },
    { mode: 'update', existing: base },
  ), /api_key/);
  assert.doesNotThrow(() => aiConfig.validateConfigRequest({
    service_type: 'video', name: '可灵', provider: 'klingai', api_protocol: 'kling_omni',
    base_url: 'https://api.example.test', api_key: '', model: ['kling-video-o1'],
    settings: JSON.stringify({ kling_access_key: 'ak', kling_secret_key: 'sk' }),
  }));
});
