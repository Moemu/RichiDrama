const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const bridge = require('../src/services/lasTosBridge');

const jobId = 'a106ecad-410b-4a0b-a250-838a047a1d8f';
const config = bridge.configuration({ region: 'cn-beijing', bucket: 'example-bucket', accessKeyId: 'test-access', secretAccessKey: 'test-secret' });

test('TOS bridge uses a separate region-matched bucket and job-scoped keys', () => {
  assert.equal(config.host, 'example-bucket.tos-cn-beijing.volces.com');
  assert.equal(bridge.objectKey(jobId, 'input', 'source.mp4'), `richidrama/las/${jobId}/input/source.mp4`);
  assert.equal(bridge.objectKey(jobId, 'viral', 'ep1.mp4'), `richidrama/las/${jobId}/viral/ep1.mp4`);
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

test('TOS 错误响应体的 Code/Message 会被带进失败信息，便于区分 bucket 与凭证问题', () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message><Resource>richibest</Resource></Error>';
  const detail = bridge.tosErrorDetail(xml);
  assert.match(detail, /NoSuchBucket/);
  assert.match(detail, /specified bucket does not exist/);
  assert.equal(bridge.tosErrorDetail('not xml'), '');
  // 拼错的 bucket 名会被点名，而不是只留一个 HTTP 404。
  assert.match(
    bridge.tosErrorMessage('PUT', 404, xml),
    /LAS TOS PUT 失败：HTTP 404 NoSuchBucket[\s\S]*Bucket 不存在/,
  );
});

test('地域或域名层面的 404 没有 XML 错误体时，失败信息仍须带可诊断内容', () => {
  assert.match(bridge.tosErrorMessage('PUT', 404, ''), /未返回错误详情/, '空响应体必须显式说明');
  assert.match(bridge.tosErrorMessage('PUT', 404, '  \n  '), /未返回错误详情/, '纯空白响应体同样显式说明');
  assert.match(bridge.tosErrorMessage('PUT', 404, '<html><body>404 Not Found</body></html>'), /响应体：<html><body>404 Not Found<\/body><\/html>/, '非 XML 响应体要带上原文片段');
  assert.ok(bridge.tosErrorMessage('PUT', 404, 'x'.repeat(1000)).length < 500, '超长响应体必须截断');
  assert.match(bridge.tosErrorMessage('PUT', 403, '<Error><Code>AccessDenied</Code><Message>x</Message></Error>'), /AccessDenied[\s\S]*凭证无该 Bucket 读写权限/);
});

test('中转清理只接受本 bucket 的精确 richidrama/las/ 键', async () => {
  const date = new Date('2026-09-23T03:00:00Z');
  const key = bridge.objectKey(jobId, 'inpaint', 'output.mp4');
  const signed = bridge.signedHeaders(config, 'DELETE', key, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '', date);
  assert.match(signed.headers.authorization, /TOS4-HMAC-SHA256/);
  assert.equal(signed.uri, `/${key}`);
  await assert.rejects(() => bridge.remove(config, `tos://other-bucket/${key}`), /不在配置的 TOS Bucket 内/);
  await assert.rejects(() => bridge.remove(config, `tos://example-bucket/other/${key}`), /对象路径无效/);
  await assert.rejects(() => bridge.remove(config, `https://example.com/${key}`), /不在配置的 TOS Bucket 内/);
});

test('仅对象不存在的 404 可视为清理完成，Bucket 或地域错误必须保留重试', () => {
  assert.equal(bridge.isMissingObject({ statusCode: 404, tosCode: 'NoSuchKey' }), true);
  assert.equal(bridge.isMissingObject({ statusCode: 404, tosCode: 'NoSuchBucket' }), false);
  assert.equal(bridge.isMissingObject({ statusCode: 404, tosCode: null }), false);
  assert.equal(bridge.isMissingObject({ statusCode: 403, tosCode: 'NoSuchKey' }), false);
});

test('TOS 删除请求不吞掉 NoSuchBucket，只有 NoSuchKey 才幂等成功', async () => {
  const originalRequest = https.request;
  let code = 'NoSuchBucket';
  https.request = (_options, respond) => {
    const req = new EventEmitter();
    req.end = () => {
      const res = Readable.from([Buffer.from(`<Error><Code>${code}</Code><Message>missing</Message></Error>`)]);
      res.statusCode = 404;
      res.headers = {};
      respond(res);
    };
    return req;
  };
  try {
    const objectPath = `tos://example-bucket/${bridge.objectKey(jobId, 'input', 'source.mp4')}`;
    await assert.rejects(() => bridge.remove(config, objectPath), /NoSuchBucket/);
    code = 'NoSuchKey';
    assert.deepEqual(await bridge.remove(config, objectPath), { deleted: false, already_absent: true });
  } finally {
    https.request = originalRequest;
  }
});
