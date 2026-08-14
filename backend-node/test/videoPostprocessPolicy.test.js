const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../src/services/videoPostprocessPolicy');

test('video post-processing defaults to preserving the generated source', () => {
  assert.deepEqual(policy.normalize({ resolution: '720p' }), {
    resolution: '720p', upscale_resolution: null, target_fps: null,
  });
  assert.match(policy.describe(policy.normalize({ resolution: '720p' })), /保持原片/);
});

test('480p supports optional 720p or 1080p enhancement', () => {
  assert.equal(policy.normalize({ resolution: '480p', upscale_resolution: '720p' }).upscale_resolution, '720p');
  assert.equal(policy.normalize({ resolution: '480p', upscale_resolution: '1080p' }).upscale_resolution, '1080p');
});

test('720p supports only an optional 1080p enhancement', () => {
  assert.equal(policy.normalize({ resolution: '720p', upscale_resolution: '1080p' }).upscale_resolution, '1080p');
  assert.throws(() => policy.normalize({ resolution: '720p', upscale_resolution: '720p' }), /必须高于/);
});

test('1080p cannot be redundantly enhanced and 2K is not an exposed target', () => {
  assert.throws(() => policy.normalize({ resolution: '1080p', upscale_resolution: '1080p' }), /必须高于|不提供/);
  assert.throws(() => policy.normalize({ resolution: '720p', upscale_resolution: '2k' }), /仅支持 720p 或 1080p/);
});

test('interpolation is independent from enhancement and may be disabled', () => {
  assert.deepEqual(policy.normalize({ resolution: '720p', target_fps: 60 }), {
    resolution: '720p', upscale_resolution: null, target_fps: 60,
  });
  assert.equal(policy.normalize({ resolution: '480p', upscale_resolution: '1080p', target_fps: 120 }).target_fps, 120);
  assert.equal(policy.normalize({ resolution: '720p', target_fps: '' }).target_fps, null);
  assert.throws(() => policy.normalize({ resolution: '720p', target_fps: 60.5 }), /整数/);
});
