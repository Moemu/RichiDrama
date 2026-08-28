const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ownedTask } = require('../src/routes/task');

function setup() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE async_tasks (id TEXT PRIMARY KEY, owner_user_id INTEGER, deleted_at TEXT);
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, owner_user_id INTEGER, deleted_at TEXT);
    CREATE TABLE image_generations (id INTEGER PRIMARY KEY, drama_id INTEGER, task_id TEXT, deleted_at TEXT);
    CREATE TABLE video_generations (id INTEGER PRIMARY KEY, owner_user_id INTEGER, task_id TEXT, deleted_at TEXT);
  `);
  return db;
}

test('an owner can poll a legacy ownerless image task through its project', () => {
  const db = setup();
  db.prepare('INSERT INTO dramas (id, owner_user_id) VALUES (?, ?)').run(32, 7);
  db.prepare('INSERT INTO async_tasks (id, owner_user_id) VALUES (?, NULL)').run('legacy-image-task');
  db.prepare('INSERT INTO image_generations (id, drama_id, task_id) VALUES (?, ?, ?)').run(25, 32, 'legacy-image-task');

  assert.equal(ownedTask(db, 'legacy-image-task', { id: 7, role: 'user' }).id, 'legacy-image-task');
  assert.equal(ownedTask(db, 'legacy-image-task', { id: 8, role: 'user' }), false);
});

test('a new task remains accessible only to its stored owner', () => {
  const db = setup();
  db.prepare('INSERT INTO async_tasks (id, owner_user_id) VALUES (?, ?)').run('owned-task', 7);

  assert.equal(ownedTask(db, 'owned-task', { id: 7, role: 'user' }).id, 'owned-task');
  assert.equal(ownedTask(db, 'owned-task', { id: 8, role: 'user' }), false);
});
