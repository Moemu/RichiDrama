const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { publicVideoUrl, reconcileUnarchivedCompletedVideos, archiveCompletedVideo, list, listHomepageDefaultVideos } = require('../src/services/videoService');

test('completed-video output never falls back to a supplier signed URL', () => {
  assert.equal(publicVideoUrl('https://tos.example/a.mp4?signature=temporary', null), null);
  assert.equal(publicVideoUrl('https://tos.example/a.mp4?signature=temporary', 'projects/1/videos/a.mp4'), '/static/projects/1/videos/a.mp4');
});

test('video list exposes a durable local poster path without mounting video bytes', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE video_generations (id INTEGER PRIMARY KEY, storyboard_id INTEGER, drama_id INTEGER, provider TEXT, prompt TEXT, model TEXT, image_gen_id INTEGER, image_url TEXT, video_url TEXT, local_path TEXT, poster_local_path TEXT, status TEXT, task_id TEXT, error_msg TEXT, created_at TEXT, updated_at TEXT, completed_at TEXT, deleted_at TEXT);`);
  db.prepare(`INSERT INTO video_generations (id, video_url, local_path, poster_local_path, status, created_at) VALUES (1, '/static/videos/a.mp4', 'videos/a.mp4', 'videos/posters/a.jpg', 'completed', '2026-08-13T00:00:00Z')`).run();
  const item = list(db, {}).items[0];
  assert.equal(item.video_url, '/static/videos/a.mp4');
  assert.equal(item.poster_local_path, 'videos/posters/a.jpg');
});

test('homepage defaults use the configured product media resources rather than any user videos', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
  db.prepare('INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)').run(
    'homepage_default_video_paths',
    JSON.stringify(['library/videos/first.mp4', 'library/videos/second.mp4', '../outside.mp4', 'library/videos/fourth.mp4']),
    '2026-08-18T00:00:00Z'
  );

  const items = listHomepageDefaultVideos(db);
  assert.deepEqual(items.map((item) => item.id), ['global-default-1', 'global-default-2', 'global-default-3']);
  assert.deepEqual(items.map((item) => item.video_url), [
    '/static/library/videos/first.mp4',
    '/static/library/videos/second.mp4',
    '/static/library/videos/fourth.mp4',
  ]);
  assert.ok(items.every((item) => item.drama_id === null && item.status === 'completed'));
});

test('a completed local video remains completed when OSS archival is temporarily unavailable', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE video_generations (
    id INTEGER PRIMARY KEY, status TEXT, local_path TEXT, archive_status TEXT,
    archive_error TEXT, archive_attempts INTEGER, archived_at TEXT, updated_at TEXT, deleted_at TEXT
  )`);
  db.prepare("INSERT INTO video_generations (id, status, local_path, archive_status) VALUES (1, 'completed', 'videos/a.mp4', 'pending')").run();
  const cfg = { storage: { type: 'oss', local_path: '/path-that-does-not-exist', oss: { endpoint: 'http://127.0.0.1:1', bucket: 'x', access_key_id: 'x', access_key_secret: 'x', public_base_url: 'cdn.example.test' } } };
  const out = await archiveCompletedVideo(db, { warn() {}, info() {} }, 1, cfg);
  const row = db.prepare('SELECT status, archive_status, archive_attempts FROM video_generations WHERE id = 1').get();
  assert.equal(out.pending, true);
  assert.equal(row.status, 'completed');
  assert.equal(row.archive_status, 'pending');
  assert.equal(row.archive_attempts, 1);
});

test('startup reconciliation invalidates historical completed rows without a local archive', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE video_generations (
    id INTEGER PRIMARY KEY, task_id INTEGER, status TEXT, video_url TEXT, local_path TEXT,
    error_msg TEXT, updated_at TEXT, deleted_at TEXT
  )`);
  db.prepare("INSERT INTO video_generations VALUES (1, NULL, 'completed', ?, NULL, NULL, NULL, NULL)")
    .run('https://tos.example/a.mp4?ExpiresSeconds=86400');
  const result = reconcileUnarchivedCompletedVideos(db, { warn() {} });
  const row = db.prepare('SELECT status, video_url, error_msg FROM video_generations WHERE id = 1').get();
  assert.equal(result.reconciled, 1);
  assert.equal(row.status, 'failed');
  assert.equal(row.video_url, null);
  assert.match(row.error_msg, /本地归档/);
});
