const test = require('node:test');
const assert = require('node:assert/strict');
const {
  configuredModelLimits,
  modelLimits,
  validateResolution,
  validateAspectRatio,
} = require('../src/services/videoModelCapabilities');

const FAST_MODEL = 'doubao-seedance-2-0-fast-260128';

test('Seedance 2.0 Fast rejects unsupported 1080p source output', () => {
  const limits = modelLimits({}, {}, FAST_MODEL);
  assert.deepEqual(limits.resolutions, ['480p', '720p']);
  assert.equal(validateResolution({ model: FAST_MODEL, limits }, '720p'), '720p');
  assert.throws(
    () => validateResolution({ model: FAST_MODEL, limits }, '1080p'),
    /不支持 1080p 原片.*720p 原片并启用 AI 超分至 1080p/,
  );
});

test('Volcengine capabilities reject project-only aspect ratios', () => {
  const model = 'doubao-seedance-2-0-mini-260615';
  const limits = modelLimits({}, {}, model, { api_protocol: 'volcengine_omni' });
  assert.deepEqual(limits.aspect_ratios, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']);
  assert.equal(validateAspectRatio({ model, limits }, '9:16'), '9:16');
  assert.throws(() => validateAspectRatio({ model, limits }, '2:3'), /不支持 2:3 画幅/);
});

test('an exact video_capabilities model entry overrides the built-in model registry', () => {
  const settings = { video_capabilities: { models: { [FAST_MODEL]: { limits: { resolutions: ['720p', '1080p'] } } } } };
  assert.deepEqual(configuredModelLimits(settings, FAST_MODEL.toUpperCase()), { resolutions: ['720p', '1080p'] });
  assert.deepEqual(modelLimits(settings, {}, FAST_MODEL).resolutions, ['720p', '1080p']);
});
