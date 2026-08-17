const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveHttpErrorStatus } = require('../src/app');

test('media range errors preserve HTTP 416 instead of becoming 500', () => {
  assert.equal(resolveHttpErrorStatus({ status: 416, message: 'Range Not Satisfiable' }), 416);
  assert.equal(resolveHttpErrorStatus({ statusCode: 404 }), 404);
  assert.equal(resolveHttpErrorStatus({ code: 'LIMIT_FILE_SIZE' }), 413);
  assert.equal(resolveHttpErrorStatus(new Error('unexpected failure')), 500);
});
