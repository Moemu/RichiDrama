const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/services/authService');

test('session cookie follows the request transport unless explicitly configured', () => {
  const old = process.env.AUTH_COOKIE_SECURE;
  delete process.env.AUTH_COOKIE_SECURE;
  try {
    assert.equal(auth.sessionCookieOptions({ protocol: 'http', headers: {} }).secure, false);
    assert.equal(auth.sessionCookieOptions({ headers: { 'x-forwarded-proto': 'https' } }).secure, true);
    process.env.AUTH_COOKIE_SECURE = 'true';
    assert.equal(auth.sessionCookieOptions({ protocol: 'http', headers: {} }).secure, true);
  } finally {
    if (old === undefined) delete process.env.AUTH_COOKIE_SECURE;
    else process.env.AUTH_COOKIE_SECURE = old;
  }
});
