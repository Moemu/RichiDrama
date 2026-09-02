const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { copyStoryboard } = require('../src/services/storyboardService');

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      scene_id INTEGER,
      storyboard_number INTEGER,
      sort_order INTEGER DEFAULT 0,
      storyboard_uid TEXT,
      position INTEGER,
      title TEXT,
      description TEXT,
      dialogue TEXT,
      image_prompt TEXT,
      video_prompt TEXT,
      generation_overrides_json TEXT,
      characters TEXT,
      creation_mode TEXT,
      universal_segment_text TEXT,
      omni_asset_ids TEXT,
      image_url TEXT,
      local_path TEXT,
      video_url TEXT,
      active_video_generation_id INTEGER,
      first_frame_image_id INTEGER,
      last_frame_image_id INTEGER,
      audio_local_path TEXT,
      status TEXT,
      error_msg TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboard_characters (storyboard_id INTEGER, character_id INTEGER, created_at TEXT, PRIMARY KEY (storyboard_id, character_id));
    CREATE TABLE storyboard_props (storyboard_id INTEGER, prop_id INTEGER, PRIMARY KEY (storyboard_id, prop_id));
    CREATE TABLE frame_prompts (id INTEGER PRIMARY KEY AUTOINCREMENT, storyboard_id INTEGER, frame_type TEXT, prompt TEXT, description TEXT, layout TEXT, created_at TEXT, updated_at TEXT);
  `);
  return db;
}

test('copyStoryboard copies editable data after the source and excludes generated media', () => {
  const db = createDb();
  db.prepare(`INSERT INTO storyboards (
    episode_id, storyboard_number, sort_order, title, description, dialogue,
    image_prompt, video_prompt, generation_overrides_json, characters,
    creation_mode, universal_segment_text, omni_asset_ids, image_url, local_path,
    video_url, active_video_generation_id, first_frame_image_id, last_frame_image_id,
    audio_local_path, status, error_msg
  ) VALUES (1, 1, 0, '第一镜', '描述', '对白', '图片提示词', '视频提示词',
    '{"duration":8}', '[11]', 'universal', '@图片1 前进', '[101]',
    '/old.jpg', 'videos/old.mp4', '/old.mp4', 55, 21, 22, 'audio/old.mp3', 'completed', '旧错误')`).run();
  db.prepare("INSERT INTO storyboards (episode_id, storyboard_number, sort_order, title, status) VALUES (1, 2, 1, '第二镜', 'pending')").run();
  db.prepare('INSERT INTO storyboard_characters VALUES (1, 7, ?)').run('2026-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO storyboard_props VALUES (1, 9)').run();
  db.prepare("INSERT INTO frame_prompts (storyboard_id, frame_type, prompt) VALUES (1, 'first', '首帧提示词')").run();

  const copied = copyStoryboard(db, log, 1);

  assert.equal(copied.storyboard_number, 2);
  assert.equal(copied.title, '第一镜（副本）');
  assert.equal(copied.description, '描述');
  assert.equal(copied.video_prompt, '视频提示词');
  assert.equal(copied.creation_mode, 'universal');
  const row = db.prepare('SELECT * FROM storyboards WHERE id = ?').get(copied.id);
  assert.equal(row.image_url, null);
  assert.equal(row.local_path, null);
  assert.equal(row.video_url, null);
  assert.equal(row.active_video_generation_id, null);
  assert.equal(row.first_frame_image_id, null);
  assert.equal(row.last_frame_image_id, null);
  assert.equal(row.audio_local_path, null);
  assert.equal(row.status, 'pending');
  assert.equal(row.error_msg, null);
  const sourceRow = db.prepare('SELECT storyboard_uid, position FROM storyboards WHERE id = 1').get();
  assert.ok(sourceRow.storyboard_uid);
  assert.ok(row.storyboard_uid);
  assert.notEqual(row.storyboard_uid, sourceRow.storyboard_uid);
  assert.equal(sourceRow.position, 0);
  assert.equal(row.position, 1);
  assert.deepEqual(
    db.prepare('SELECT storyboard_number, sort_order, title FROM storyboards ORDER BY sort_order').all(),
    [
      { storyboard_number: 1, sort_order: 0, title: '第一镜' },
      { storyboard_number: 2, sort_order: 1, title: '第一镜（副本）' },
      { storyboard_number: 3, sort_order: 2, title: '第二镜' },
    ]
  );
  assert.deepEqual(db.prepare('SELECT character_id FROM storyboard_characters WHERE storyboard_id = ?').all(copied.id), [{ character_id: 7 }]);
  assert.deepEqual(db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?').all(copied.id), [{ prop_id: 9 }]);
  assert.equal(db.prepare('SELECT prompt FROM frame_prompts WHERE storyboard_id = ?').get(copied.id).prompt, '首帧提示词');
});

test('copyStoryboard returns null for a missing source', () => {
  const db = createDb();
  assert.equal(copyStoryboard(db, log, 404), null);
});
