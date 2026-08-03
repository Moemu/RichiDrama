const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const sequenceService = require('../src/services/omniSequenceService');
const storyboardService = require('../src/services/storyboardService');
const dramaService = require('../src/services/dramaService');

const log = { info() {}, warn() {}, error() {} };

test('free-create shot stores independent model, duration and resolution', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE omni_video_sequences (id INTEGER PRIMARY KEY, name TEXT, is_default INTEGER, deleted_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE omni_video_sequence_shots (id INTEGER PRIMARY KEY, sequence_id INTEGER, title TEXT, sort_order INTEGER, prompt TEXT, prompt_document_json TEXT, assets_json TEXT, settings_json TEXT, omni_job_id INTEGER, deleted_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE omni_video_jobs (id INTEGER PRIMARY KEY, video_generation_id INTEGER);
    CREATE TABLE video_generations (id INTEGER PRIMARY KEY, status TEXT, video_url TEXT, local_path TEXT, error_msg TEXT);`);
  const sequence = sequenceService.createSequence(db, { name: 'test' });
  const shot = sequence.shots[0];
  const updated = sequenceService.updateShot(db, sequence.id, shot.id, { settings: { model: 'seedance-2', duration: 10, resolution: '1080p', aspect_ratio: '9:16' } });
  assert.deepEqual(updated.settings, { model: 'seedance-2', aspect_ratio: '9:16', duration: 10, resolution: '1080p', audio_strategy: 'reference_only' });
});

test('classic storyboard persists per-shot text and video generation settings', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, title TEXT, duration REAL, text_model TEXT, video_model TEXT, video_resolution TEXT, video_aspect_ratio TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE storyboard_props (storyboard_id INTEGER, prop_id INTEGER);
    CREATE TABLE storyboard_characters (storyboard_id INTEGER, character_id INTEGER);
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER);
    CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT);
    CREATE TABLE character_libraries (id INTEGER PRIMARY KEY, name TEXT, drama_id INTEGER, deleted_at TEXT);`);
  db.prepare('INSERT INTO storyboards (id, episode_id, title, duration) VALUES (1, 1, ?, 5)').run('shot');
  const updated = storyboardService.updateStoryboard(db, log, 1, { text_model: 'gpt-text', video_model: 'seedance-2', video_resolution: '1080p', video_aspect_ratio: '9:16', duration: 10 });
  assert.equal(updated.text_model, 'gpt-text');
  assert.equal(updated.video_model, 'seedance-2');
  assert.equal(updated.video_resolution, '1080p');
  assert.equal(updated.video_aspect_ratio, '9:16');
  assert.equal(updated.duration, 10);
});

test('episode merge ignores storyboard image local_path when selecting a video URL', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE storyboards (id INTEGER PRIMARY KEY, video_url TEXT, local_path TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE video_generations (storyboard_id INTEGER, video_url TEXT, local_path TEXT, completed_at TEXT, updated_at TEXT, created_at TEXT, status TEXT, deleted_at TEXT);`);
  db.prepare('INSERT INTO storyboards (id, video_url, local_path, updated_at) VALUES (1, ?, ?, ?)').run(
    'https://provider.example/shot.mp4',
    'projects/demo/images/ig_cover.jpg',
    '2026-08-03T00:00:00.000Z'
  );
  assert.equal(
    dramaService.getVideoUrlForStoryboard(db, 1, 'http://localhost:5679/static'),
    'https://provider.example/shot.mp4'
  );
});
