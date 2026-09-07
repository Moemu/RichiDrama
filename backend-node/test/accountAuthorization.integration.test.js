const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');

test('public signup cannot grant console access; global writes require an administrator across restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minidrama-account-auth-'));
  const previousCwd = process.cwd();
  const cfg = {
    app: { language: 'zh' }, database: { path: path.join(root, 'test.db'), type: 'sqlite' },
    storage: { type: 'local', local_path: path.join(root, 'storage') },
    payments: { enabled: false }, server: {},
  };
  fs.writeFileSync(path.join(root, 'config.yaml'), JSON.stringify(cfg));
  process.chdir(root);
  const log = { info() {}, warn() {}, error() {}, infow() {}, warnw() {} };
  let server;
  let base;
  let db;
  const { setupRouter } = require('../src/routes');
  async function start() {
    db = getDb(cfg.database);
    runMigrationsAndEnsure(db);
    const app = express();
    app.use(express.json());
    app.use('/api/v1', setupRouter(cfg, db, log));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  }
  async function stop() {
    if (server) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server = null;
    }
    closeDb();
  }
  async function request(method, route, body, cookie) {
    const result = await fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: result.status, body: await result.json(), cookie: result.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    await start();
    const existingAdmin = auth.createUser(db, {
      username: 'existing-admin', password: 'test-password', account_kind: 'platform_admin',
    }, null);
    const login = await request('POST', '/auth/login', { username: existingAdmin.username, password: 'test-password' });
    assert.equal(login.status, 200);
    const adminCookie = login.cookie;
    let creatorCookie;
    for (const [index, fields] of [
      { role: 'admin' }, { account_kind: 'platform_admin' }, { console_access: true },
      { role: 'admin', account_kind: 'platform_admin', console_access: true, is_active: false },
    ].entries()) {
      const signup = await request('POST', '/auth/register', {
        username: `public-${index}`, password: 'test-password', display_name: 'Creator', ...fields,
      });
      assert.equal(signup.status, 201);
      assert.equal(signup.body.data.user.role, 'user');
      assert.equal(signup.body.data.user.console_access, false);
      assert.equal(signup.body.data.user.account_kind, 'creator');
      assert.equal(signup.body.data.user.is_active, true);
      assert.equal((await request('GET', '/admin/users', undefined, signup.cookie)).status, 403);
      creatorCookie = signup.cookie;
    }
    const writes = [
      ['PUT', '/settings/language', { language: 'en' }],
      ['PUT', '/settings/generation', { concurrency: 4, video_concurrency: 2 }],
      ['PUT', '/settings/prompts/story_expansion_system', { content: 'Isolated prompt' }],
      ['DELETE', '/settings/prompts/story_expansion_system'],
    ];
    for (const [method, route, body] of writes) {
      assert.equal((await request(method, route, body, creatorCookie)).status, 403, route);
      assert.equal((await request(method, route, body, adminCookie)).status, 200, route);
    }
    const newAdmin = await request('POST', '/admin/users', {
      username: 'authorized-admin', password: 'test-password', account_kind: 'platform_admin',
    }, adminCookie);
    assert.equal(newAdmin.status, 201);
    assert.equal(newAdmin.body.data.console_access, true);
    await stop();
    await start();
    assert.equal((await request('GET', '/admin/users', undefined, adminCookie)).status, 200);
    assert.equal((await request('GET', '/admin/users', undefined, creatorCookie)).status, 403);
    const settings = await request('GET', '/settings/generation', undefined, creatorCookie);
    assert.equal(settings.status, 200);
    assert.equal(settings.body.data.concurrency, 4);
    assert.equal(settings.body.data.video_concurrency, 2);
    assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(existingAdmin.id).role, 'admin');
  } finally {
    await stop();
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
