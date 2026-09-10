const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');

test('application serves SPA routes and preserves cookie sessions and projects after a process restart', { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minidrama-app-http-'));
  const web = path.join(root, 'web');
  fs.mkdirSync(web);
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>SPA fixture</title>');
  fs.writeFileSync(path.join(root, 'empty.env'), '');
  fs.writeFileSync(path.join(root, 'config.yaml'), JSON.stringify({
    app: { name: 'HTTP fixture', language: 'zh' }, server: {},
    database: { type: 'sqlite', path: path.join(root, 'fixture.db') },
    storage: { type: 'local', local_path: path.join(root, 'storage') },
    payments: { enabled: false }, image_proxy: { use_for_video: false },
  }));
  let child;
  let base;
  async function start() {
    child = fork(path.join(__dirname, 'helpers/appHttpProcess.js'), [], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        NODE_ENV: 'test', MINIDRAMA_PROFILE: 'dev', MINIDRAMA_ENV_FILE: path.join(root, 'empty.env'),
        WEB_DIST_PATH: web, INITIAL_ADMIN_USERNAME: 'http-fixture', INITIAL_ADMIN_PASSWORD: 'fixture-password',
      },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const message = await Promise.race([
      once(child, 'message').then(([value]) => value),
      once(child, 'exit').then(([code]) => { throw new Error(`Application exited ${code}: ${output}`); }),
    ]);
    base = `http://127.0.0.1:${message.port}`;
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  try {
    await start();
    for (const route of ['/', '/login', '/dramas/42/canvas']) {
      const result = await fetch(base + route);
      assert.equal(result.status, 200, route);
      assert.match(await result.text(), /SPA fixture/);
    }
    assert.equal((await fetch(base + '/api/v1/nonexistent')).status, 401);
    assert.equal((await fetch(base + '/ready')).status, 200);
    assert.equal((await fetch(base + '/api/v1/dramas')).status, 401);
    const login = await fetch(base + '/api/v1/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'http-fixture', password: 'fixture-password' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base + '/api/v1/nonexistent', { headers: { cookie } })).status, 404);
    const created = await fetch(base + '/api/v1/dramas', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '升级前保存的项目', style: 'cinematic' }),
    });
    assert.equal(created.status, 201);
    const project = (await created.json()).data;
    const before = await fetch(base + `/api/v1/dramas/${project.id}`, { headers: { cookie } });
    assert.equal(before.status, 200);
    const saved = (await before.json()).data;
    await stop();
    await start();
    const restored = await fetch(base + `/api/v1/dramas/${project.id}`, { headers: { cookie } });
    assert.equal(restored.status, 200, 'existing cookie remains valid after restart');
    assert.deepEqual((await restored.json()).data, saved);
  } finally {
    await stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
