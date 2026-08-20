const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const omni = require('../src/services/omniVideoService');

function dbWithCompletedJob() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE omni_video_jobs (
      id INTEGER PRIMARY KEY, video_generation_id INTEGER, owner_user_id INTEGER,
      hidden_at TEXT, hidden_by_user_id INTEGER, updated_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY, owner_user_id INTEGER, status TEXT, deleted_at TEXT
    );
  `);
  db.prepare('INSERT INTO video_generations (id, owner_user_id, status) VALUES (1, 7, ?)').run('completed');
  db.prepare('INSERT INTO omni_video_jobs (id, video_generation_id, owner_user_id, updated_at) VALUES (1, 1, 7, ?)').run(new Date().toISOString());
  return db;
}

test('hiding a completed history entry retains its source generation and records the actor', () => {
  const db = dbWithCompletedJob();
  assert.deepEqual(omni.hide(db, 1, { id: 7, role: 'user' }), { ok: true, id: 1 });
  const job = db.prepare('SELECT hidden_at, hidden_by_user_id FROM omni_video_jobs WHERE id = 1').get();
  assert.ok(job.hidden_at);
  assert.equal(job.hidden_by_user_id, 7);
  assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = 1').get().status, 'completed');
});

test('a different user cannot hide another user\'s history entry', () => {
  const db = dbWithCompletedJob();
  assert.throws(() => omni.hide(db, 1, { id: 8, role: 'user' }), /无权操作/);
});
