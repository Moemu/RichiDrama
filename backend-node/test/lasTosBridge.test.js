const test = require('node:test');
const assert = require('node:assert/strict');
const bridge = require('../src/services/lasTosBridge');

const jobId = 'a106ecad-410b-4a0b-a250-838a047a1d8f';
const config = bridge.configuration({ region: 'cn-beijing', bucket: 'example-bucket', accessKeyId: 'test-access', secretAccessKey: 'test-secret' });

test('TOS bridge uses a separate region-matched bucket and job-scoped keys', () => {
  assert.equal(config.host, 'example-bucket.tos-cn-beijing.volces.com');
  assert.equal(bridge.objectKey(jobId, 'input', 'source.mp4'), `richidrama/las/${jobId}/input/source.mp4`);
  assert.throws(() => bridge.configuration({ region: 'cn-beijing', bucket: 'example-bucket' }), /凭证/);
  assert.throws(() => bridge.configuration({ region: 'cn beijing', bucket: 'example-bucket', accessKeyId: 'a', secretAccessKey: 'b' }), /地域/);
  assert.throws(() => bridge.configuration({ region: 'cn-beijing', bucket: 'Bad_Bucket', accessKeyId: 'a', secretAccessKey: 'b' }), /Bucket/);
  assert.throws(() => bridge.objectKey(jobId, 'input', '../other.mp4'), /路径/);
});

test('TOS signature binds method, object, payload, and content type', () => {
  const date = new Date('2026-09-22T03:00:00Z');
  const key = bridge.objectKey(jobId, 'input', 'source.mp4');
  const first = bridge.signedHeaders(config, 'PUT', key, 'a'.repeat(64), 'video/mp4', date);
  const again = bridge.signedHeaders(config, 'PUT', key, 'a'.repeat(64), 'video/mp4', date);
  const changed = bridge.signedHeaders(config, 'PUT', key, 'b'.repeat(64), 'video/mp4', date);
  assert.deepEqual(first, again);
  assert.equal(first.uri, `/${key}`);
  assert.match(first.headers.authorization, /SignedHeaders=content-type;host;x-tos-content-sha256;x-tos-date/);
  assert.notEqual(first.headers.authorization, changed.headers.authorization);
  assert.equal(first.headers['x-tos-date'], '20260922T030000Z');
});
