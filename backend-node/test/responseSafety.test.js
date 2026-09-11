const test = require('node:test');
const assert = require('node:assert/strict');
const response = require('../src/response');

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('database constraint details are replaced with useful client messages', () => {
  const res = mockResponse();
  response.badRequest(res, 'UNIQUE constraint failed: users.username');
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, '该数据已存在，请检查后重试');
  assert.doesNotMatch(JSON.stringify(res.body), /constraint|users\.username/i);
});

test('internal errors never expose supplied implementation details', () => {
  const res = mockResponse();
  response.internalError(res, 'ENOENT: C:\\private\\storage\\secret.mp4');
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.message, response.INTERNAL_ERROR_MESSAGE);
  assert.doesNotMatch(JSON.stringify(res.body), /ENOENT|private|secret/i);
});

test('ordinary validation messages remain unchanged', () => {
  const res = mockResponse();
  response.badRequest(res, '用户名需为 1-64 个字符');
  assert.equal(res.body.error.message, '用户名需为 1-64 个字符');
});
