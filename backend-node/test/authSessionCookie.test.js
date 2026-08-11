const test = require('node:test');
const assert = require('node:assert/strict');
const authRoutes = require('../src/routes/auth');

test('session-cookie refresh bridges an authenticated bearer session to protected media', () => {
  const handler = authRoutes({}).sessionCookie;
  const cookies = [];
  let result;
  const res = {
    cookie: (...args) => cookies.push(args),
    status: () => res,
    json: (body) => { result = body; },
  };
  handler({ authToken: 'verified-token', protocol: 'http', headers: {} }, res);
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0][0], 'lmd_session');
  assert.equal(cookies[0][1], 'verified-token');
  assert.equal(cookies[0][2].secure, false);
  assert.equal(result.success, true);
});
