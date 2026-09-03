const test = require('node:test');
const assert = require('node:assert/strict');

const aiConfigService = require('../src/services/aiConfigService');
const aiClient = require('../src/services/aiClient');

const capturedBodies = [];
aiConfigService.listConfigs = () => [{
  provider: 'volcengine',
  api_protocol: 'volcengine',
  base_url: 'https://volcengine.example/api/v3',
  api_key: 'test-key',
  model: ['doubao-seedream-4-5'],
  default_model: 'doubao-seedream-4-5',
  is_active: true,
  is_default: true,
}];
aiClient.postJSONWithTimeout = async (_url, _headers, body) => {
  capturedBodies.push(body);
  return { statusCode: 200, raw: JSON.stringify({ data: [{ url: 'https://example.test/result.png' }] }) };
};

const { callImageApi, appendNegativePromptToMainPrompt } = require('../src/services/imageClient');

const log = {
  info() {},
  warn() {},
  error() {},
};

test('appends a negative prompt as a main prompt constraint for Volcengine images', () => {
  assert.equal(
    appendNegativePromptToMainPrompt('A woman walks through a rainy street.', 'collage, split panels'),
    'A woman walks through a rainy street.\n\nDo not include these elements or styles: collage, split panels'
  );
});

test('does not change the main prompt when the negative prompt is empty', () => {
  assert.equal(appendNegativePromptToMainPrompt('A quiet lake.', '  '), 'A quiet lake.');
});

test('creates a valid main prompt when only a negative prompt exists', () => {
  assert.equal(
    appendNegativePromptToMainPrompt('', 'watermark'),
    'Do not include these elements or styles: watermark'
  );
});

test('Volcengine image request moves negative_prompt into prompt', async () => {
  const result = await callImageApi({}, log, {
    prompt: '一名演员站在街道上。',
    model: 'doubao-seedream-4-5',
    user_negative_prompt: '水印，模糊',
    size: '1920x1920',
  });

  assert.equal(result.image_url, 'https://example.test/result.png');
  const body = capturedBodies.at(-1);
  assert.equal(Object.hasOwn(body, 'negative_prompt'), false);
  assert.match(body.prompt, /^一名演员站在街道上。/);
  assert.match(body.prompt, /Do not include these elements or styles:/);
  assert.match(body.prompt, /水印，模糊/);
  assert.match(body.prompt, /split panels/);
});
