const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  getActiveStoryboardSnapshot,
  processStoryboardGeneration,
  replaceStoryboardsAtomically,
} = require('../src/services/episodeStoryboardService');
const aiClient = require('../src/services/aiClient');
const taskService = require('../src/services/taskService');

const log = { info() {}, warn() {}, error() {} };
const cfg = { style: { default_style: '', default_video_ratio: '16:9' } };

function createSchema(db) {
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      scene_id INTEGER,
      storyboard_number INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      storyboard_uid TEXT,
      position INTEGER,
      title TEXT,
      description TEXT,
      location TEXT,
      time TEXT,
      duration REAL,
      dialogue TEXT,
      narration TEXT,
      action TEXT,
      result TEXT,
      atmosphere TEXT,
      image_prompt TEXT,
      video_prompt TEXT,
      characters TEXT,
      shot_type TEXT,
      angle TEXT,
      angle_h TEXT,
      angle_v TEXT,
      angle_s TEXT,
      movement TEXT,
      lighting_style TEXT,
      depth_of_field TEXT,
      segment_index INTEGER DEFAULT 0,
      segment_title TEXT,
      creation_mode TEXT DEFAULT 'classic',
      universal_segment_text TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboard_props (
      storyboard_id INTEGER NOT NULL,
      prop_id INTEGER NOT NULL,
      PRIMARY KEY (storyboard_id, prop_id)
    );
  `);
}

function insertOld(db, number, title, updatedAt = '2026-08-28T08:00:00.000Z') {
  return Number(db.prepare(
    `INSERT INTO storyboards
      (episode_id, storyboard_number, sort_order, storyboard_uid, position, title, status, created_at, updated_at)
     VALUES (26, ?, ?, ?, ?, ?, 'completed', ?, ?)`
  ).run(number, number - 1, `stable-${number}`, number - 1, title, updatedAt, updatedAt).lastInsertRowid);
}

function generated(number, title) {
  return {
    shot_number: number,
    title,
    duration: 5,
    action: `${title}动作`,
    characters: [],
  };
}

test('regeneration keeps old storyboards readable before the successful cutover and after restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-regeneration-'));
  const file = path.join(dir, 'data.db');
  try {
    let db = new Database(file);
    createSchema(db);
    insertOld(db, 1, '旧分镜一');
    insertOld(db, 2, '旧分镜二');

    const snapshot = getActiveStoryboardSnapshot(db, 26);
    assert.equal(snapshot.length, 2);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM storyboards WHERE episode_id = 26 AND deleted_at IS NULL').get().count, 2);
    db.close();

    db = new Database(file, { fileMustExist: true });
    assert.deepEqual(getActiveStoryboardSnapshot(db, 26), snapshot);
    assert.deepEqual(
      db.prepare('SELECT title FROM storyboards WHERE episode_id = 26 AND deleted_at IS NULL ORDER BY id').all().map((row) => row.title),
      ['旧分镜一', '旧分镜二']
    );
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('provider failure during regeneration keeps old storyboards active', async () => {
  const db = new Database(':memory:');
  createSchema(db);
  insertOld(db, 1, '旧一');
  insertOld(db, 2, '旧二');
  const originalGenerateText = aiClient.generateText;
  const originalUpdateStatus = taskService.updateTaskStatus;
  const originalUpdateError = taskService.updateTaskError;
  let taskError = null;
  aiClient.generateText = async () => { throw new Error('mock provider failure'); };
  taskService.updateTaskStatus = () => {};
  taskService.updateTaskError = (_db, _taskId, message) => { taskError = message; };
  try {
    await processStoryboardGeneration(
      db, log, cfg, 'task-1', 26, 'mock-model', '', 'user prompt', 'system prompt', false, false
    );
  } finally {
    aiClient.generateText = originalGenerateText;
    taskService.updateTaskStatus = originalUpdateStatus;
    taskService.updateTaskError = originalUpdateError;
  }

  assert.match(taskError, /mock provider failure/);
  assert.deepEqual(
    db.prepare('SELECT title FROM storyboards WHERE episode_id = 26 AND deleted_at IS NULL ORDER BY id').all().map((row) => row.title),
    ['旧一', '旧二']
  );
});

test('successful regeneration preserves matching storyboard identities and adds only new positions', () => {
  const db = new Database(':memory:');
  createSchema(db);
  const oldIds = [insertOld(db, 1, '旧一'), insertOld(db, 2, '旧二')];
  const historicalTime = '2026-08-20T00:00:00.000Z';
  db.prepare(
    `INSERT INTO storyboards
      (episode_id, storyboard_number, title, status, created_at, updated_at, deleted_at)
     VALUES (26, 99, '历史分镜', 'completed', ?, ?, ?)`
  ).run(historicalTime, historicalTime, historicalTime);
  const snapshot = getActiveStoryboardSnapshot(db, 26);

  const saved = replaceStoryboardsAtomically(
    db, log, 26, [generated(1, '新一'), generated(2, '新二'), generated(3, '新三')], cfg, '', snapshot
  );

  assert.equal(saved.length, 3);
  assert.deepEqual(
    db.prepare('SELECT title FROM storyboards WHERE episode_id = 26 AND deleted_at IS NULL ORDER BY storyboard_number').all().map((row) => row.title),
    ['新一', '新二', '新三']
  );
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM storyboards WHERE id IN (${oldIds.map(() => '?').join(',')}) AND deleted_at IS NULL`).get(...oldIds).count, 2);
  assert.deepEqual(
    db.prepare(`SELECT storyboard_uid FROM storyboards WHERE id IN (${oldIds.map(() => '?').join(',')}) ORDER BY id`).all(...oldIds).map((row) => row.storyboard_uid),
    ['stable-1', 'stable-2']
  );
  assert.equal(db.prepare('SELECT COUNT(*) count FROM storyboards WHERE episode_id = 26 AND deleted_at IS NULL').get().count, 3);
  assert.equal(db.prepare("SELECT updated_at FROM storyboards WHERE title = '历史分镜'").get().updated_at, historicalTime);
});

test('failed insert rolls back the replacement and keeps every old storyboard active', () => {
  const db = new Database(':memory:');
  createSchema(db);
  insertOld(db, 1, '旧一');
  insertOld(db, 2, '旧二');
  const snapshot = getActiveStoryboardSnapshot(db, 26);
  db.exec(`
    CREATE TRIGGER reject_failed_storyboard
    BEFORE UPDATE ON storyboards
    WHEN NEW.title = '触发失败'
    BEGIN
      SELECT RAISE(ABORT, 'test insert failure');
    END;
  `);

  assert.throws(
    () => replaceStoryboardsAtomically(
      db, log, 26, [generated(1, '新一'), generated(2, '触发失败')], cfg, '', snapshot
    ),
    /test insert failure/
  );
  assert.deepEqual(
    db.prepare('SELECT title FROM storyboards WHERE episode_id = 26 AND deleted_at IS NULL ORDER BY id').all().map((row) => row.title),
    ['旧一', '旧二']
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM storyboards WHERE title = '新一'").get().count, 0);
});

test('concurrent storyboard edit stops regeneration without deleting user data', () => {
  const db = new Database(':memory:');
  createSchema(db);
  const oldId = insertOld(db, 1, '旧分镜');
  const snapshot = getActiveStoryboardSnapshot(db, 26);
  db.prepare('UPDATE storyboards SET title = ?, updated_at = ? WHERE id = ?')
    .run('用户已编辑', '2026-08-28T09:00:00.000Z', oldId);

  assert.throws(
    () => replaceStoryboardsAtomically(db, log, 26, [generated(1, '新分镜')], cfg, '', snapshot),
    /生成期间已变化/
  );
  const row = db.prepare('SELECT title, deleted_at FROM storyboards WHERE id = ?').get(oldId);
  assert.equal(row.title, '用户已编辑');
  assert.equal(row.deleted_at, null);
});
