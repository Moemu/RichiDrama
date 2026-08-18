const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createStoryboard } = require('../src/services/storyboardService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE storyboards (
    id INTEGER PRIMARY KEY,
    episode_id INTEGER NOT NULL,
    scene_id INTEGER,
    storyboard_number INTEGER,
    title TEXT,
    description TEXT,
    location TEXT,
    time TEXT,
    duration REAL,
    dialogue TEXT,
    action TEXT,
    result TEXT,
    atmosphere TEXT,
    image_prompt TEXT,
    video_prompt TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
  )`);
  return db;
}

test('createStoryboard allocates a new unique number when stale client submits an existing number', () => {
  const db = createDb();
  db.prepare("INSERT INTO storyboards (episode_id, storyboard_number, title, status) VALUES (102, 1, '镜头 1', 'pending'), (102, 3, '镜头 3', 'pending'), (102, 4, '镜头 4', 'pending')").run();

  const created = createStoryboard(db, { info() {} }, {
    episode_id: 102,
    storyboard_number: 4,
    title: '镜头 4',
  });

  assert.equal(created.storyboard_number, 5);
  assert.equal(created.title, '镜头 5');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM storyboards WHERE episode_id = 102 AND storyboard_number = 4 AND deleted_at IS NULL').get().count, 1);
});

test('createStoryboard preserves an explicit unused number and rejects invalid episode ids', () => {
  const db = createDb();
  const created = createStoryboard(db, { info() {} }, { episode_id: 7, storyboard_number: 2, title: '自定义镜头' });
  assert.equal(created.storyboard_number, 2);
  assert.equal(created.title, '自定义镜头');
  assert.throws(() => createStoryboard(db, { info() {} }, { episode_id: 0 }), /有效/);
});
