const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const auth = require('../src/services/authService');
const { createRecoveryFixture } = require('./helpers/recoveryFixture');

async function request(f, route, body, token, credential = 'X-LMD-Session') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers[credential] = credential === 'Cookie' ? `lmd_session=${token}` : credential === 'Authorization' ? `Bearer ${token}` : token;
  const res = await fetch(f.url + route, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, cookie: res.headers.get('set-cookie'), cache: res.headers.get('cache-control'), body: text.startsWith('{') ? JSON.parse(text) : text };
}
async function login(f, username = f.user.username, password = 'Creator123') {
  const res = await request(f, '/api/v1/auth/login', { username, password });
  assert.equal(res.status, 200);
  return res.body.data.token;
}
async function sentCode(f, email, purpose = 'bind') {
  for (let i = 0; i < 100; i++) {
    const row = f.db.prepare('SELECT status FROM auth_email_challenges WHERE email = ? AND purpose = ? ORDER BY rowid DESC LIMIT 1').get(email, purpose);
    if (row?.status === 'sent') {
      const code = f.mailbox.messages.filter((m) => m.recipient.includes(email)).at(-1)?.code;
      assert.match(code, /^\d{6}$/);
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('local SMTP delivery did not finish');
}
async function bind(f, token, email = 'creator@example.test') {
  const input = { email, password: 'Creator123' };
  assert.equal((await request(f, '/api/v1/auth/email/code', input, token)).status, 200);
  const code = await sentCode(f, email);
  assert.equal((await request(f, '/api/v1/auth/email/confirm', { ...input, code }, token)).status, 200);
  return email;
}
function allowResend(f, email) {
  f.db.prepare('UPDATE auth_email_challenges SET created_at = ? WHERE email = ?').run(new Date(Date.now() - 61000).toISOString(), email);
}
async function scenario(fn) {
  const f = await createRecoveryFixture();
  try { await fn(f); } finally { await f.close(); }
}

test('email binding and recovery invalidate all old credential transports, once only', () => scenario(async (f) => {
  const token = await login(f);
  const otherToken = await login(f, f.other.username);
  const email = await bind(f, token);
  const details = await request(f, '/api/v1/auth/email', undefined, token);
  assert.equal(details.body.data.email, email);
  assert.equal((await request(f, '/api/v1/auth/me', undefined, token)).body.data.verified_email, undefined);
  allowResend(f, email);
  assert.equal((await request(f, '/api/v1/auth/password-reset/code', { email })).status, 200);
  const code = await sentCode(f, email, 'reset');
  const row = f.db.prepare("SELECT * FROM auth_email_challenges WHERE purpose = 'reset'").get();
  assert.equal(row.code_digest.length, 64);
  assert.notEqual(row.code_digest, code);
  const input = { email, code, new_password: 'Recovered123' };
  const responses = await Promise.all([request(f, '/api/v1/auth/password-reset/confirm', input), request(f, '/api/v1/auth/password-reset/confirm', input)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
  for (const transport of ['X-LMD-Session', 'Authorization', 'Cookie']) {
    assert.equal((await request(f, '/api/v1/auth/me', undefined, token, transport)).status, 401);
    assert.equal((await request(f, '/static/protected-test', undefined, token, transport)).status, 401);
  }
  assert.equal((await request(f, '/api/v1/auth/me', undefined, otherToken)).status, 200);
  assert.equal((await request(f, '/api/v1/auth/login', { username: f.user.username, password: 'Creator123' })).status, 401);
  await login(f, f.user.username, 'Recovered123');
  const audit = f.db.prepare('SELECT detail_json FROM billing_audit_logs').all();
  assert.ok(!JSON.stringify(audit).includes(code));
  assert.ok(!JSON.stringify(audit).includes('Recovered123'));
}));

test('administrator reset restricts business and media until password change, including after restart', () => scenario(async (f) => {
  const old = await login(f);
  const admin = await login(f, f.admin.username, f.adminPassword);
  const endpoint = `/api/v1/admin/users/${f.user.id}/reset-password`;
  assert.equal((await request(f, endpoint, { confirm: true }, old)).status, 403);
  assert.equal((await request(f, `/api/v1/admin/users/${f.admin.id}/reset-password`, { confirm: true }, admin)).status, 403);
  assert.equal((await request(f, endpoint, {}, admin)).status, 400);
  const reset = await request(f, endpoint, { confirm: true }, admin);
  assert.equal(reset.status, 200);
  assert.equal(reset.cache, 'no-store');
  const temporary = reset.body.data.temporary_password;
  assert.match(temporary, /^[A-Za-z0-9_-]{16}$/);
  assert.ok(Date.parse(reset.body.data.expires_at) > Date.now() + 86300000);
  assert.equal((await request(f, '/api/v1/auth/me', undefined, old)).status, 401);
  const limited = await login(f, f.user.username, temporary);
  await f.restart();
  assert.equal((await request(f, '/api/v1/auth/me', undefined, limited)).body.data.must_change_password, true);
  for (const route of ['/api/v1/billing/me', '/api/v1/auth/email', '/static/protected-test']) {
    const res = await request(f, route, undefined, limited, 'Cookie');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
  }
  assert.equal((await request(f, '/api/v1/auth/change-password', { old_password: temporary, new_password: temporary }, limited)).status, 400);
  const changed = await request(f, '/api/v1/auth/change-password', { old_password: temporary, new_password: 'Personal123' }, limited);
  assert.equal(changed.status, 200);
  assert.match(changed.cookie, /lmd_session=;/);
  assert.equal((await request(f, '/api/v1/auth/me', undefined, limited)).status, 401);
  const next = await login(f, f.user.username, 'Personal123');
  assert.equal((await request(f, '/api/v1/auth/me', undefined, next)).body.data.must_change_password, false);
  assert.equal((await request(f, '/static/protected-test', undefined, next, 'Cookie')).status, 200);
}));

test('expired temporary passwords cannot login or refresh an issued session', () => scenario(async (f) => {
  const admin = await login(f, f.admin.username, f.adminPassword);
  const reset = await request(f, `/api/v1/admin/users/${f.user.id}/reset-password`, { confirm: true }, admin);
  const password = reset.body.data.temporary_password;
  const limited = await login(f, f.user.username, password);
  f.db.prepare('UPDATE users SET temporary_password_expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', f.user.id);
  await f.restart();
  assert.equal((await request(f, '/api/v1/auth/login', { username: f.user.username, password })).status, 401);
  assert.equal((await request(f, '/api/v1/auth/session-cookie', {}, limited)).status, 401);
}));

test('binding checks password, ownership, uniqueness and invalidates recovery through replaced email', () => scenario(async (f) => {
  const token = await login(f), other = await login(f, f.other.username);
  const email = 'creator@example.test';
  assert.equal((await request(f, '/api/v1/auth/email/code', { email, password: 'wrong' }, token)).status, 400);
  await bind(f, token, email);
  assert.equal((await request(f, '/api/v1/auth/email/code', { email, password: 'Creator123' }, other)).status, 429);
  allowResend(f, email);
  assert.equal((await request(f, '/api/v1/auth/email/code', { email, password: 'Creator123' }, other)).status, 400);
  await request(f, '/api/v1/auth/password-reset/code', { email });
  const oldCode = await sentCode(f, email, 'reset');
  const nextEmail = 'next@example.test';
  await request(f, '/api/v1/auth/email/code', { email: nextEmail, password: 'Creator123' }, token);
  const nextCode = await sentCode(f, nextEmail);
  assert.equal((await request(f, '/api/v1/auth/email', undefined, token)).body.data.email, email);
  assert.equal((await request(f, '/api/v1/auth/email/confirm', { email: nextEmail, password: 'Creator123', code: nextCode }, other)).status, 400);
  assert.equal((await request(f, '/api/v1/auth/email/confirm', { email: nextEmail, password: 'Creator123', code: nextCode }, token)).status, 200);
  assert.equal((await request(f, '/api/v1/auth/password-reset/confirm', { email, code: oldCode, new_password: 'Recovered123' })).status, 400);
  assert.equal((await request(f, '/api/v1/auth/email', undefined, token)).body.data.email, nextEmail);
}));

test('attempts, expiry, resend and delivery failures never leave usable stale codes', () => scenario(async (f) => {
  const token = await login(f), email = 'creator@example.test';
  const input = { email, password: 'Creator123' };
  await request(f, '/api/v1/auth/email/code', input, token);
  const first = await sentCode(f, email);
  const wrong = first === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await request(f, '/api/v1/auth/email/confirm', { ...input, code: wrong }, token)).status, 400);
  await f.restart();
  assert.equal((await request(f, '/api/v1/auth/email/confirm', { ...input, code: first }, token)).status, 400);
  allowResend(f, email);
  await request(f, '/api/v1/auth/email/code', input, token);
  await sentCode(f, email);
  assert.equal(f.db.prepare('SELECT status FROM auth_email_challenges ORDER BY rowid LIMIT 1').get().status, 'consumed');
  f.db.prepare('UPDATE auth_email_challenges SET expires_at = ?').run('2000-01-01T00:00:00.000Z');
  assert.equal((await request(f, '/api/v1/auth/email/confirm', { ...input, code: await sentCode(f, email) }, token)).status, 400);
  allowResend(f, email);
  f.mailbox.reject = true;
  assert.equal((await request(f, '/api/v1/auth/email/code', input, token)).status, 503);
  assert.equal(f.db.prepare('SELECT status FROM auth_email_challenges ORDER BY rowid DESC LIMIT 1').get().status, 'failed');
}));

test('durable mailbox and IP limits apply even to unknown accounts with uniform responses', () => scenario(async (f) => {
  const unknown = 'unknown@example.test';
  const first = await request(f, '/api/v1/auth/password-reset/code', { email: unknown });
  assert.equal(first.status, 200);
  assert.equal((await request(f, '/api/v1/auth/password-reset/code', { email: unknown })).status, 429);
  for (let i = 0; i < 4; i++) {
    allowResend(f, unknown);
    assert.equal((await request(f, '/api/v1/auth/password-reset/code', { email: unknown })).status, 200);
  }
  await f.restart(); allowResend(f, unknown);
  assert.equal((await request(f, '/api/v1/auth/password-reset/code', { email: unknown })).status, 429);
  for (let i = 0; i < 15; i++) assert.equal((await request(f, '/api/v1/auth/password-reset/code', { email: `unknown${i}@example.test` })).status, 200);
  assert.equal((await request(f, '/api/v1/auth/password-reset/code', { email: 'limit@example.test' })).status, 429);
  assert.equal(f.mailbox.messages.length, 0);
}));

test('migration preserves legacy credentials and history; legacy password updates revoke sessions', () => scenario(async (f) => {
  const originalHash = f.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(f.user.id).password_hash;
  const legacy = jwt.sign({ sub: f.user.id, username: f.user.username }, auth.jwtSecret(f.db));
  const balance = f.db.prepare('SELECT * FROM billing_accounts WHERE user_id = ?').get(f.user.id);
  f.db.prepare("INSERT INTO dramas (title, owner_user_id, created_at, updated_at) VALUES ('历史项目', ?, ?, ?)").run(f.user.id, new Date().toISOString(), new Date().toISOString());
  await f.restart(); await f.restart();
  assert.equal((await request(f, '/api/v1/auth/me', undefined, legacy)).status, 200);
  assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(f.user.id).password_hash, originalHash);
  assert.deepEqual(f.db.prepare('SELECT * FROM billing_accounts WHERE user_id = ?').get(f.user.id), balance);
  assert.equal(f.db.prepare('SELECT title FROM dramas WHERE owner_user_id = ?').get(f.user.id).title, '历史项目');
  const admin = await login(f, f.admin.username, f.adminPassword);
  const res = await fetch(f.url + `/api/v1/admin/users/${f.user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-LMD-Session': admin }, body: JSON.stringify({ password: 'LegacyNew123' }) });
  assert.equal(res.status, 200); await res.text();
  assert.equal((await request(f, '/api/v1/auth/me', undefined, legacy)).status, 401);
}));

test('unconfigured email is explicit and does not block administrator reset', () => scenario(async (f) => {
  delete process.env.SMTP_HOST;
  await f.restart();
  assert.equal((await request(f, '/api/v1/auth/recovery-options')).body.data.email_enabled, false);
  assert.equal((await request(f, '/api/v1/auth/password-reset/code', { email: 'a@example.test' })).body.error.code, 'EMAIL_UNAVAILABLE');
  const admin = await login(f, f.admin.username, f.adminPassword);
  assert.equal((await request(f, `/api/v1/admin/users/${f.user.id}/reset-password`, { confirm: true }, admin)).status, 200);
}));

test('recovery send hides SMTP failure and rejected recovery rolls back password and code together', () => scenario(async (f) => {
  const token = await login(f), email = await bind(f, token);
  allowResend(f, email);
  f.mailbox.reject = true;
  const failedSend = await request(f, '/api/v1/auth/password-reset/code', { email });
  const unknown = await request(f, '/api/v1/auth/password-reset/code', { email: 'unknown@example.test' });
  assert.deepEqual(failedSend.body.data, unknown.body.data);
  for (let i = 0; i < 100; i++) {
    if (f.db.prepare("SELECT status FROM auth_email_challenges WHERE email = ? AND purpose = 'reset' ORDER BY rowid DESC LIMIT 1").get(email).status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(f.db.prepare("SELECT status FROM auth_email_challenges WHERE email = ? AND purpose = 'reset' ORDER BY rowid DESC LIMIT 1").get(email).status, 'failed');
  f.mailbox.reject = false;
  allowResend(f, email);
  const sends = await Promise.all([request(f, '/api/v1/auth/password-reset/code', { email }), request(f, '/api/v1/auth/password-reset/code', { email })]);
  assert.deepEqual(sends.map((r) => r.status).sort(), [200, 429]);
  const input = { email, code: await sentCode(f, email, 'reset'), new_password: 'Recovered123' };
  f.db.exec("CREATE TRIGGER reject_reset_audit BEFORE INSERT ON billing_audit_logs WHEN NEW.action = 'user.password.reset' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END");
  assert.equal((await request(f, '/api/v1/auth/password-reset/confirm', input)).status, 500);
  assert.equal((await request(f, '/api/v1/auth/me', undefined, token)).status, 200);
  assert.equal(f.db.prepare("SELECT status FROM auth_email_challenges WHERE email = ? AND purpose = 'reset' ORDER BY rowid DESC LIMIT 1").get(email).status, 'sent');
  f.db.exec('DROP TRIGGER reject_reset_audit');
  assert.equal((await request(f, '/api/v1/auth/password-reset/confirm', input)).status, 200);
  const admin = await login(f, f.admin.username, f.adminPassword);
  const audit = await request(f, '/api/v1/admin/audit-logs', undefined, admin);
  assert.ok(audit.body.data.items.some((item) => item.actor_username === '未登录请求'));
  assert.ok(audit.body.data.items.some((item) => item.action === 'user.password.reset'));
}));
