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
const { setupRouter } = require('../src/routes');

test('episode HTTP edits preserve history, isolate concurrent writes, and survive restart', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'episode-edits-'));
  const cwd = process.cwd();
  process.chdir(root);
  const cfg = {
    app: { language: 'zh' }, server: {},
    database: { type: 'sqlite', path: path.join(root, 'test.db') },
    storage: { type: 'local', local_path: path.join(root, 'storage') },
    payments: { enabled: false }, image_proxy: { use_for_video: false }, vendor_lock: { enabled: false },
  };
  fs.writeFileSync('config.yaml', JSON.stringify(cfg));
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  let db, server, base;
  async function start() {
    db = getDb(cfg.database);
    runMigrationsAndEnsure(db);
    const app = express();
    app.use(express.json());
    app.use('/api/v1', setupRouter(cfg, db, log));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  }
  async function stop() {
    if (server) await new Promise(resolve => server.close(resolve));
    server = null;
    closeDb();
  }
  async function request(method, route, token, body) {
    const res = await fetch(base + route, {
      method, headers: { 'content-type': 'application/json', ...(token ? { 'x-lmd-session': token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json() };
  }
  try {
    await start();
    auth.createUser(db, { username: 'episode-owner', password: 'test-password' }, null);
    auth.createUser(db, { username: 'episode-other', password: 'test-password' }, null);
    const login = async username => (await request('POST', '/auth/login', null, { username, password: 'test-password' })).body.data.token;
    const token = await login('episode-owner');
    const otherToken = await login('episode-other');
    const created = await request('POST', '/dramas', token, { title: 'Episode safety fixture' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.id;
    const route = `/dramas/${id}/episode-edits`;
    const edit = body => request('PUT', route, token, body);
    const read = async () => (await request('GET', `/dramas/${id}`, token)).body.data.episodes;
    let response = await edit({ mode: 'append', episodes: Array.from({ length: 8 }, (_, i) => ({
      title: `第${i + 1}集`, script_content: `original ${i + 1}`,
    })) });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const initial = await read();
    assert.equal(initial.length, 8);
    const eighth = initial[7];
    const firstId = initial[0].id;
    db.prepare(`INSERT INTO storyboards (episode_id,storyboard_number,title) VALUES (?,1,'historical shot')`).run(firstId);
    const shot = db.prepare('SELECT * FROM storyboards WHERE episode_id=?').get(firstId);
    db.prepare(`INSERT INTO video_generations (drama_id,storyboard_id,status,local_path) VALUES (?,?,'completed','fixture/video.mp4')`).run(id, shot.id);
    const video = db.prepare('SELECT * FROM video_generations WHERE storyboard_id=?').get(shot.id);

    // Reproduce the incident input: only episode 8 changes; 1-7 keep their identity and script.
    const update = { mode: 'update', episodes: [{ id: eighth.id, expected_title: eighth.title, expected_script_content: eighth.script_content,
      script_content: '第八集\n新的正文\n第九集\n下一集正文' }] };
    // Opening the editor can save generation settings and change updated_at without changing the script.
    db.prepare('UPDATE episodes SET updated_at=?, generation_defaults_json=? WHERE id=?')
      .run(new Date().toISOString(), '{"video_resolution":"720p"}', eighth.id);
    assert.equal((await edit(update)).status, 200);
    let episodes = await read();
    assert.deepEqual(episodes.slice(0, 7).map(e => [e.id, e.title, e.script_content]),
      initial.slice(0, 7).map(e => [e.id, e.title, e.script_content]));
    assert.equal(episodes[7].script_content, update.episodes[0].script_content);
    assert.equal(db.prepare('SELECT generation_defaults_json FROM episodes WHERE id=?').get(eighth.id).generation_defaults_json,
      '{"video_resolution":"720p"}');
    assert.equal((await edit(update)).status, 409, 'stale edit must fail');
    assert.equal((await edit({ mode: 'delete', episodes: [{ id: eighth.id, expected_updated_at: eighth.updated_at }] })).status, 409);
    assert.equal((await request('PUT', route, otherToken, update)).status, 404);
    assert.equal((await request('PUT', route, null, update)).status, 401);
    assert.equal((await edit({ episodes: [] })).status, 400, 'new route must never fall back to replacement');
    assert.equal((await edit({ mode: 'update', episodes: [{ id: eighth.id, script_content: 'missing version' }] })).status, 400);

    // An invalid later item must roll back earlier inserts and leave numbering untouched.
    assert.equal((await edit({ mode: 'append', episodes: [{ title: 'would insert' }, { script_content: {} }] })).status, 400);
    assert.equal((await read()).length, 8);
    response = await edit({ mode: 'append', episodes: [{ episode_number: 1, title: 'import A' }, { episode_number: 1, title: 'import B' }] });
    assert.deepEqual(response.body.data.episodes.map(e => e.episode_number), [9, 10]);
    episodes = await read();
    const ninth = episodes[8];
    assert.equal((await edit({ mode: 'delete', episodes: [{ id: ninth.id, expected_updated_at: ninth.updated_at }] })).status, 200);
    assert.equal((await edit({ mode: 'append', episodes: [{ title: 'new after deletion' }] })).body.data.episodes[0].episode_number, 11);
    assert.equal(db.prepare('SELECT title FROM episodes WHERE id=?').get(ninth.id).title, 'import A');
    assert.ok(db.prepare('SELECT deleted_at FROM episodes WHERE id=?').get(ninth.id).deleted_at);
    assert.deepEqual(db.prepare('SELECT * FROM storyboards WHERE id=?').get(shot.id), shot);
    assert.deepEqual(db.prepare('SELECT * FROM video_generations WHERE id=?').get(video.id), video);

    // AI response is stubbed; no provider or paid API is contacted.
    const ai = require('../src/services/aiClient');
    const mock = t.mock.method(ai, 'generateText', async () => JSON.stringify([
      { episode: 1, title: 'generated A', content: 'generated script A' },
      { episode: 2, title: 'generated B', content: 'generated script B' },
    ]));
    const beforeGeneration = await read();
    response = await request('POST', '/generation/story/append', token, { drama_id: id, premise: 'fixture only' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const taskId = response.body.data.task_id;
    let task;
    for (let i = 0; i < 100; i++) {
      task = (await request('GET', `/tasks/${taskId}`, token)).body.data;
      if (['completed', 'failed'].includes(task.status)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(task.status, 'completed', JSON.stringify(task));
    assert.equal(mock.mock.callCount(), 1);
    episodes = await read();
    assert.deepEqual(episodes.slice(0, beforeGeneration.length), beforeGeneration);
    assert.deepEqual(episodes.slice(-2).map(e => e.episode_number), [12, 13]);

    await stop();
    await start();
    assert.deepEqual(await read(), episodes, 'reads after migration/restart preserve every episode');
    assert.deepEqual(db.prepare('SELECT * FROM storyboards WHERE id=?').get(shot.id), shot);
    assert.deepEqual(db.prepare('SELECT * FROM video_generations WHERE id=?').get(video.id), video);

    // Legacy endpoint remains compatible for callers that have not opted into safe edits.
    const legacy = (await request('POST', '/dramas', token, { title: 'Legacy fixture' })).body.data.id;
    assert.equal((await request('PUT', `/dramas/${legacy}/episodes`, token, {
      episodes: [{ episode_number: 1, title: 'legacy' }],
    })).status, 200);
  } finally {
    await stop();
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
