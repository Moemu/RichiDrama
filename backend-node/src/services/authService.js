const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const TOKEN_TTL = process.env.AUTH_TOKEN_TTL || '24h';
const DEVELOPMENT_JWT_SECRET = 'local-mini-drama-development-secret-change-me';
const isProduction = process.env.NODE_ENV === 'production';

function now() { return new Date().toISOString(); }

function runtimeSetting(db, key) {
  try { return db.prepare('SELECT setting_value FROM runtime_settings WHERE setting_key = ?').get(key)?.setting_value || null; } catch (_) { return null; }
}

function saveRuntimeSetting(db, key, value) {
  const at = now();
  db.prepare(`INSERT INTO runtime_settings (setting_key, setting_value, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`).run(key, value, at, at);
  return value;
}

function jwtSecret(db) {
  const configured = process.env.AUTH_JWT_SECRET;
  if (configured) {
    if (isProduction && configured.length < 32) throw new Error('生产环境 AUTH_JWT_SECRET 至少需要 32 位');
    return configured;
  }
  if (!isProduction) return DEVELOPMENT_JWT_SECRET;
  const saved = runtimeSetting(db, 'auth.jwt_secret');
  if (saved) return saved;
  return saveRuntimeSetting(db, 'auth.jwt_secret', crypto.randomBytes(48).toString('base64url'));
}

function validateRuntimeSecurity(db) {
  // Environment values win. When absent, a production-only random secret is
  // persisted in SQLite so ordinary code updates do not invalidate sessions.
  jwtSecret(db);
}

function writeInitialCredentials(db, username, password) {
  if (!isProduction || !db.name || db.name === ':memory:') return;
  const target = path.join(path.dirname(db.name), 'initial-admin-credentials.txt');
  if (fs.existsSync(target)) return;
  fs.writeFileSync(target, `Initial administrator credentials (delete this file after first login)\nusername=${username}\npassword=${password}\n`, { mode: 0o600 });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || !password.length) throw new Error('密码不能为空');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, encoded) {
  const [kind, salt, expected] = String(encoded || '').split('$');
  if (kind !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function publicUser(row) {
  return { id: row.id, username: row.username, display_name: row.display_name, role: row.role, is_active: !!row.is_active, created_at: row.created_at, last_login_at: row.last_login_at };
}

function ensureBootstrapAdmin(db, log) {
  let user = db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();
  if (!user) {
    const username = process.env.INITIAL_ADMIN_USERNAME || 'admin';
    const password = process.env.INITIAL_ADMIN_PASSWORD || (isProduction ? crypto.randomBytes(18).toString('base64url') : 'admin123456');
    const at = now();
    const info = db.prepare(`INSERT INTO users (username, password_hash, display_name, role, is_active, created_at, updated_at)
      VALUES (?, ?, '平台管理员', 'admin', 1, ?, ?)`)
      .run(username, hashPassword(password), at, at);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    db.prepare(`INSERT INTO billing_accounts (user_id, updated_at) VALUES (?, ?)`).run(user.id, at);
    writeInitialCredentials(db, username, password);
    log.warn('Created initial administrator. Change its password before production use.', { username, credentials_file: isProduction ? 'data/initial-admin-credentials.txt' : null });
  }
  for (const table of ['dramas', 'image_generations', 'video_generations', 'async_tasks', 'assets', 'omni_video_sequences', 'omni_video_jobs', 'tool_runs']) {
    try { db.prepare(`UPDATE ${table} SET owner_user_id = ? WHERE owner_user_id IS NULL`).run(user.id); } catch (_) {}
  }
  return user;
}

function requestUsesHttps(req) {
  if (req?.secure || req?.protocol === 'https') return true;
  const forwarded = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return forwarded === 'https';
}

function sessionCookieOptions(req) {
  const sameSite = String(process.env.AUTH_COOKIE_SAME_SITE || 'lax').toLowerCase();
  const normalizedSameSite = ['lax', 'strict', 'none'].includes(sameSite) ? sameSite : 'lax';
  // Browser media tags cannot attach the SPA's Authorization header. They use
  // this HttpOnly cookie instead, so a direct HTTP deployment must not receive
  // a Secure-only cookie that the browser will silently discard.
  const configuredSecure = process.env.AUTH_COOKIE_SECURE;
  const secure = normalizedSameSite === 'none'
    ? true
    : configuredSecure === 'true'
      ? true
      : configuredSecure === 'false'
        ? false
        : requestUsesHttps(req);
  return {
    httpOnly: true,
    secure,
    sameSite: normalizedSameSite,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  };
}

function login(db, username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) return null;
  const at = now();
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(at, at, user.id);
  return issueSession(db, { ...user, last_login_at: at });
}

function issueSession(db, user) {
  const publicData = publicUser(user);
  const token = jwt.sign({ sub: user.id, role: user.role, username: user.username }, jwtSecret(db), { expiresIn: TOKEN_TTL });
  return { token, user: publicData };
}

function normalizeUsername(username) {
  const value = String(username || '').trim();
  if (!/^[A-Za-z0-9_.-]{3,64}$/.test(value)) throw new Error('用户名需为 3-64 位字母、数字或 ._-');
  return value;
}

function register(db, input) {
  const user = createUser(db, { ...input, role: 'user', is_active: true }, null);
  return login(db, user.username, input.password);
}

function authenticate(db, token) {
  const claims = jwt.verify(token, jwtSecret(db));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(claims.sub);
  if (!user || !user.is_active) throw new Error('账号不可用');
  return publicUser(user);
}

function createUser(db, input, actorId) {
  const username = normalizeUsername(input.username);
  const at = now();
  const info = db.prepare(`INSERT INTO users (username, password_hash, display_name, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(username, hashPassword(input.password), String(input.display_name || username).trim(), input.role === 'admin' ? 'admin' : 'user', input.is_active === false ? 0 : 1, at, at);
  const id = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO billing_accounts (user_id, updated_at) VALUES (?, ?)').run(id, at);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function changePassword(db, userId, oldPassword, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !verifyPassword(oldPassword, user.password_hash)) throw new Error('当前密码不正确');
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(newPassword), now(), userId);
}

function changeUsername(db, userId, username) {
  const next = normalizeUsername(username);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId));
  if (!user) throw new Error('账户不存在');
  if (user.username === next) return user;
  const duplicate = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(next, user.id);
  if (duplicate) throw new Error('该用户名已被使用');
  db.prepare('UPDATE users SET username = ?, updated_at = ? WHERE id = ?').run(next, now(), user.id);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

function updateUser(db, id, input) {
  const updates = [], params = [];
  if (input.display_name !== undefined) { updates.push('display_name = ?'); params.push(String(input.display_name || '').trim()); }
  if (input.role !== undefined) { updates.push('role = ?'); params.push(input.role === 'admin' ? 'admin' : 'user'); }
  if (input.is_active !== undefined) { updates.push('is_active = ?'); params.push(input.is_active ? 1 : 0); }
  if (input.password) { updates.push('password_hash = ?'); params.push(hashPassword(input.password)); }
  if (!updates.length) return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  params.push(now(), id);
  db.prepare(`UPDATE users SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`).run(...params);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
module.exports = { validateRuntimeSecurity, ensureBootstrapAdmin, sessionCookieOptions, login, register, authenticate, createUser, updateUser, changePassword, changeUsername, issueSession, publicUser, jwtSecret };
