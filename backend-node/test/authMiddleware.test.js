const test = require('node:test');
const assert = require('node:assert/strict');
const { TokenExpiredError } = require('jsonwebtoken');
const authService = require('../src/services/authService');
const logger = require('../src/logger');
const { requireAuth } = require('../src/middleware/auth');

function request(token = 'test-session') {
  return {
    headers: { 'x-lmd-session': token },
    originalUrl: '/api/v1/billing/me',
    requestId: 'request-1',
    ip: '127.0.0.1',
    get: () => null,
  };
}

function responseRecorder() {
  return {
    locals: {},
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function withAuthenticate(implementation, run) {
  const originalAuthenticate = authService.authenticate;
  const originalWarn = logger.warn;
  const originalError = logger.error;
  const logs = [];
  authService.authenticate = implementation;
  logger.warn = (message, detail) => logs.push({ level: 'warn', message, detail });
  logger.error = (message, detail) => logs.push({ level: 'error', message, detail });
  try { return run(logs); }
  finally {
    authService.authenticate = originalAuthenticate;
    logger.warn = originalWarn;
    logger.error = originalError;
  }
}

test('expired JWT remains a classified 401 without exposing the credential', () => {
  withAuthenticate(() => { throw new TokenExpiredError('jwt expired', new Date()); }, (logs) => {
    const req = request('secret-session-value');
    const res = responseRecorder();
    requireAuth({})(req, res, () => assert.fail('next must not run'));

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error.code, 'TOKEN_EXPIRED');
    assert.equal(res.locals.authErrorCode, 'TOKEN_EXPIRED');
    assert.equal(logs[0].detail.credential_source, 'x-lmd-session');
    assert.equal(logs[0].detail.client_ip, '127.0.0.1');
    assert.match(logs[0].detail.credential_fingerprint, /^[0-9a-f]{12}$/);
    assert.doesNotMatch(JSON.stringify(logs), /secret-session-value/);
  });
});

test('database authentication failure returns 503 instead of logging the user out', () => {
  withAuthenticate(() => { throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }); }, (logs) => {
    const res = responseRecorder();
    requireAuth({})(request(), res, () => assert.fail('next must not run'));

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error.code, 'SERVICE_BUSY');
    assert.equal(res.locals.authErrorCode, 'SERVICE_BUSY');
    assert.equal(logs[0].level, 'error');
    assert.equal(logs[0].detail.code, 'SQLITE_BUSY');
  });
});

test('valid authentication continues with the resolved user', () => {
  withAuthenticate(() => ({ id: 33, role: 'user' }), () => {
    const req = request();
    const res = responseRecorder();
    let called = false;
    requireAuth({})(req, res, () => { called = true; });

    assert.equal(called, true);
    assert.equal(req.auth.id, 33);
    assert.equal(req.authToken, 'test-session');
    assert.equal(res.statusCode, null);
  });
});
