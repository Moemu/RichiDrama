const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { loadOmniReferenceVideoUrls } = require('../src/services/videoService');

const log = { info() {}, warn() {}, error() {} };

test('native video references recover from the immutable Omni job snapshot', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE omni_video_jobs (id INTEGER PRIMARY KEY, video_generation_id INTEGER);
    CREATE TABLE assets (id INTEGER PRIMARY KEY, local_path TEXT);
    CREATE TABLE omni_video_job_assets (
      id INTEGER PRIMARY KEY, omni_job_id INTEGER, asset_id INTEGER, ordinal REAL,
      alias TEXT, media_type TEXT, send_to_model INTEGER, snapshot_json TEXT
    );
  `);
  db.prepare('INSERT INTO omni_video_jobs (id, video_generation_id) VALUES (1, 973)').run();
  db.prepare(`INSERT INTO omni_video_job_assets
    (omni_job_id, asset_id, ordinal, alias, media_type, send_to_model, snapshot_json)
    VALUES (1, NULL, 1, '动作视频', 'video', 1, ?)`)
    .run(JSON.stringify({ type: 'video', model_url: 'https://cdn.example.test/motion.mp4', send_to_model: true, strategy: 'native' }));

  const urls = await loadOmniReferenceVideoUrls(db, { storage: { type: 'local' } }, process.cwd(), 973, log);
  assert.deepEqual(urls, ['https://cdn.example.test/motion.mp4']);
  db.close();
});

test('native video recovery fails instead of silently dropping an unreachable source', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE omni_video_jobs (id INTEGER PRIMARY KEY, video_generation_id INTEGER);
    CREATE TABLE assets (id INTEGER PRIMARY KEY, local_path TEXT);
    CREATE TABLE omni_video_job_assets (
      id INTEGER PRIMARY KEY, omni_job_id INTEGER, asset_id INTEGER, ordinal REAL,
      alias TEXT, media_type TEXT, send_to_model INTEGER, snapshot_json TEXT
    );
  `);
  db.prepare('INSERT INTO omni_video_jobs (id, video_generation_id) VALUES (1, 974)').run();
  db.prepare(`INSERT INTO omni_video_job_assets
    (omni_job_id, asset_id, ordinal, alias, media_type, send_to_model, snapshot_json)
    VALUES (1, NULL, 1, '本地动作视频', 'video', 1, ?)`)
    .run(JSON.stringify({ type: 'video', local_path: 'library/videos/local.mp4', send_to_model: true, strategy: 'native' }));

  await assert.rejects(
    () => loadOmniReferenceVideoUrls(db, { storage: { type: 'local' } }, process.cwd(), 974, log),
    /没有模型可访问的公网地址/
  );
  db.close();
});
