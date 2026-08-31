const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  findActiveVideoForTarget,
  findActiveImageForStoryboard,
} = require('../src/services/generationSubmissionGuard');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY, owner_user_id INTEGER, storyboard_id INTEGER,
      status TEXT, deleted_at TEXT
    );
    CREATE TABLE omni_video_jobs (
      id INTEGER PRIMARY KEY, video_generation_id INTEGER, owner_user_id INTEGER,
      sequence_id INTEGER, shot_id INTEGER
    );
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY, owner_user_id INTEGER, storyboard_id INTEGER,
      status TEXT, deleted_at TEXT
    );
  `);
  return db;
}

test('findActiveVideoForTarget blocks only an active generation for the same storyboard and owner', () => {
  const db = makeDb();
  db.prepare('INSERT INTO video_generations VALUES (?, ?, ?, ?, NULL)').run(1, 7, 31, 'processing');
  db.prepare('INSERT INTO video_generations VALUES (?, ?, ?, ?, NULL)').run(2, 7, 32, 'completed');
  assert.equal(findActiveVideoForTarget(db, { ownerUserId: 7, storyboardId: 31 })?.id, 1);
  assert.equal(findActiveVideoForTarget(db, { ownerUserId: 8, storyboardId: 31 }), null);
  assert.equal(findActiveVideoForTarget(db, { ownerUserId: 7, storyboardId: 32 }), null);
  db.close();
});

test('findActiveVideoForTarget protects a free-create sequence shot', () => {
  const db = makeDb();
  db.prepare('INSERT INTO video_generations VALUES (?, ?, NULL, ?, NULL)').run(4, 7, 'upscaling');
  db.prepare('INSERT INTO omni_video_jobs VALUES (?, ?, ?, ?, ?)').run(9, 4, 7, 12, 15);
  assert.equal(findActiveVideoForTarget(db, { ownerUserId: 7, sequenceId: 12, shotId: 15 })?.id, 4);
  assert.equal(findActiveVideoForTarget(db, { ownerUserId: 7, sequenceId: 12, shotId: 16 }), null);
  db.close();
});

test('findActiveImageForStoryboard ignores completed and deleted records', () => {
  const db = makeDb();
  db.prepare('INSERT INTO image_generations VALUES (?, ?, ?, ?, NULL)').run(1, 7, 31, 'completed');
  db.prepare('INSERT INTO image_generations VALUES (?, ?, ?, ?, ?)').run(2, 7, 31, 'processing', '2026-01-01T00:00:00Z');
  assert.equal(findActiveImageForStoryboard(db, { ownerUserId: 7, storyboardId: 31 }), null);
  db.prepare('INSERT INTO image_generations VALUES (?, ?, ?, ?, NULL)').run(3, 7, 31, 'pending');
  assert.equal(findActiveImageForStoryboard(db, { ownerUserId: 7, storyboardId: 31 })?.id, 3);
  db.close();
});
