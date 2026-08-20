const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const sequenceService = require('../src/services/omniSequenceService');
const storyboardService = require('../src/services/storyboardService');
const dramaService = require('../src/services/dramaService');
const generationSettings = require('../src/services/generationSettingsService');

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
  assert.deepEqual(updated.settings, { model: 'seedance-2', aspect_ratio: '9:16', duration: 10, resolution: '1080p', upscale_resolution: null, target_fps: null, audio_strategy: 'reference_only' });
});

test('new free-create shots default to 15 seconds', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE omni_video_sequences (id INTEGER PRIMARY KEY, name TEXT, is_default INTEGER, deleted_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE omni_video_sequence_shots (id INTEGER PRIMARY KEY, sequence_id INTEGER, title TEXT, sort_order INTEGER, prompt TEXT, prompt_document_json TEXT, assets_json TEXT, settings_json TEXT, omni_job_id INTEGER, deleted_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE omni_video_jobs (id INTEGER PRIMARY KEY, video_generation_id INTEGER);
    CREATE TABLE video_generations (id INTEGER PRIMARY KEY, status TEXT, video_url TEXT, local_path TEXT, error_msg TEXT);`);
  const sequence = sequenceService.createSequence(db, { name: 'defaults' });
  assert.equal(sequence.shots[0].settings.duration, 15);
  assert.equal(sequence.shots[0].settings.upscale_resolution, '1080p');
  assert.equal(sequence.shots[0].settings.target_fps, null);
  sequenceService.updateShot(db, sequence.id, sequence.shots[0].id, { settings: { model: 'master-model', duration: 9, resolution: '1080p', aspect_ratio: '9:16' } });
  const inherited = sequenceService.createShot(db, sequence.id, {});
  assert.equal(inherited.settings.model, 'master-model');
  assert.equal(inherited.settings.duration, 9);
  assert.equal(inherited.settings.resolution, '1080p');
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
  // expected_updated_at 已不再作为乐观锁：过期时间戳也允许直接保存（单人使用场景）。
  const updated = storyboardService.updateStoryboard(db, log, 1, { text_model: 'gpt-text', video_model: 'seedance-2', video_resolution: '1080p', video_aspect_ratio: '9:16', duration: 10, expected_updated_at: '2000-01-01T00:00:00.000Z' });
  assert.equal(updated.text_model, 'gpt-text');
  assert.equal(updated.video_model, 'seedance-2');
  assert.equal(updated.video_resolution, '1080p');
  assert.equal(updated.video_aspect_ratio, '9:16');
  assert.equal(updated.duration, 10);
});

test('first storyboard edit establishes episode defaults, later edits only override the current shot', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE episodes (id INTEGER PRIMARY KEY, generation_defaults_json TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, storyboard_number INTEGER, sort_order INTEGER DEFAULT 0, duration REAL, text_model TEXT, video_model TEXT, video_resolution TEXT, video_aspect_ratio TEXT, video_upscale_resolution TEXT, video_target_fps INTEGER, generation_overrides_json TEXT, updated_at TEXT, deleted_at TEXT);`);
  db.prepare('INSERT INTO episodes (id) VALUES (1)').run();
  db.prepare('INSERT INTO storyboards (id, episode_id, storyboard_number) VALUES (1,1,1),(2,1,2)').run();
  const initialized = generationSettings.setStoryboardSettings(db, 1, { video_model: 'seedance-2', duration: 10, resolution: '1080p', aspect_ratio: '9:16' });
  assert.equal(initialized.affected_count, 2);
  assert.equal(initialized.master_storyboard_id, 1);
  assert.equal(initialized.storyboards[0].mode, 'master');
  assert.equal(db.prepare('SELECT duration FROM storyboards WHERE id=2').get().duration, 10);
  const custom = generationSettings.setStoryboardSettings(db, 2, { duration: 6 });
  assert.equal(custom.mode, 'custom');
  assert.equal(custom.effective.duration, 6);
  generationSettings.setEpisodeDefaults(db, 1, { ...initialized.defaults, duration: 12 }, 'preserve');
  assert.equal(db.prepare('SELECT duration FROM storyboards WHERE id=1').get().duration, 12);
  assert.equal(db.prepare('SELECT duration FROM storyboards WHERE id=2').get().duration, 6);
  const inherited = generationSettings.clearStoryboardOverrides(db, 2);
  assert.equal(inherited.mode, 'inherited');
  assert.equal(db.prepare('SELECT duration FROM storyboards WHERE id=2').get().duration, 12);
});

test('storyboard master defaults to 1080p enhancement without interpolation and synchronizes explicit changes', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE episodes (id INTEGER PRIMARY KEY, generation_defaults_json TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, storyboard_number INTEGER, sort_order INTEGER DEFAULT 0, duration REAL, text_model TEXT, video_model TEXT, video_resolution TEXT, video_aspect_ratio TEXT, video_upscale_resolution TEXT, video_target_fps INTEGER, generation_overrides_json TEXT, updated_at TEXT, deleted_at TEXT);`);
  db.prepare('INSERT INTO episodes (id) VALUES (1)').run();
  db.prepare("INSERT INTO storyboards (id, episode_id, storyboard_number, video_resolution, video_aspect_ratio) VALUES (1,1,1,'720p','16:9'),(2,1,2,'720p','16:9')").run();
  const initial = generationSettings.getEpisodeSettings(db, 1);
  assert.equal(initial.defaults.upscale_resolution, '1080p');
  assert.equal(initial.defaults.target_fps, null);
  generationSettings.setEpisodeDefaults(db, 1, { ...initial.defaults, upscale_resolution: null, target_fps: null }, 'replace');
  const rows = db.prepare('SELECT video_upscale_resolution, video_target_fps FROM storyboards ORDER BY id').all();
  assert.deepEqual(rows, [
    { video_upscale_resolution: null, video_target_fps: null },
    { video_upscale_resolution: null, video_target_fps: null },
  ]);
  const custom = generationSettings.setStoryboardSettings(db, 2, { upscale_resolution: '1080p', target_fps: 60 });
  assert.equal(custom.effective.upscale_resolution, '1080p');
  assert.equal(custom.effective.target_fps, 60);
  assert.equal(generationSettings.getEpisodeSettings(db, 1).storyboards[0].effective.upscale_resolution, null);
});

test('a later storyboard edited before settings are loaded becomes an override and never redefines the first-shot master', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE episodes (id INTEGER PRIMARY KEY, generation_defaults_json TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, storyboard_number INTEGER, sort_order INTEGER DEFAULT 0, duration REAL, text_model TEXT, video_model TEXT, video_resolution TEXT, video_aspect_ratio TEXT, video_upscale_resolution TEXT, video_target_fps INTEGER, generation_overrides_json TEXT, updated_at TEXT, deleted_at TEXT);`);
  db.prepare('INSERT INTO episodes (id) VALUES (1)').run();
  db.prepare(`INSERT INTO storyboards (id, episode_id, storyboard_number, duration, video_model, video_resolution, video_aspect_ratio)
    VALUES (1,1,1,12,'master-model','1080p','9:16'),(2,1,2,5,NULL,NULL,NULL),(3,1,3,5,NULL,NULL,NULL)`).run();
  const custom = generationSettings.setStoryboardSettings(db, 2, { duration: 6, resolution: '720p' });
  assert.equal(custom.mode, 'custom');
  const contract = generationSettings.getEpisodeSettings(db, 1);
  assert.equal(contract.master_storyboard_id, 1);
  assert.equal(contract.defaults.video_model, 'master-model');
  assert.equal(contract.defaults.duration, 12);
  assert.equal(contract.storyboards[0].mode, 'master');
  assert.equal(contract.storyboards[1].mode, 'custom');
  assert.equal(contract.storyboards[2].mode, 'inherited');
  const created = db.prepare('INSERT INTO storyboards (episode_id, storyboard_number) VALUES (1,4)').run();
  const initialized = generationSettings.initializeStoryboardFromMaster(db, created.lastInsertRowid);
  assert.equal(initialized.mode, 'inherited');
  assert.equal(initialized.effective.video_model, 'master-model');
  assert.equal(db.prepare('SELECT duration FROM storyboards WHERE id=?').get(created.lastInsertRowid).duration, 12);
});

test('generation master follows the same visual sort and duplicate-shot dedupe as the storyboard list', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE episodes (id INTEGER PRIMARY KEY, generation_defaults_json TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, storyboard_number INTEGER, sort_order INTEGER DEFAULT 0, duration REAL, text_model TEXT, video_model TEXT, video_resolution TEXT, video_aspect_ratio TEXT, video_upscale_resolution TEXT, video_target_fps INTEGER, generation_overrides_json TEXT, updated_at TEXT, deleted_at TEXT);`);
  db.prepare('INSERT INTO episodes (id) VALUES (1)').run();
  db.prepare(`INSERT INTO storyboards (id, episode_id, storyboard_number, sort_order, duration, video_model)
    VALUES (1,1,1,2,8,'old-first'),(2,1,2,0,6,'hidden-duplicate'),(3,1,2,0,10,'visual-first'),(4,1,3,3,5,NULL)`).run();
  const contract = generationSettings.getEpisodeSettings(db, 1);
  assert.equal(contract.master_storyboard_id, 3);
  assert.deepEqual(contract.storyboards.map((item) => item.id), [3, 1, 4]);
  assert.equal(contract.storyboards[0].mode, 'master');
  assert.equal(contract.defaults.video_model, 'visual-first');
  assert.equal(contract.defaults.duration, 10);
});

test('episode merge ignores storyboard image local_path when selecting a video URL', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE storyboards (id INTEGER PRIMARY KEY, video_url TEXT, local_path TEXT, active_video_generation_id INTEGER, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE video_generations (id INTEGER PRIMARY KEY, storyboard_id INTEGER, video_url TEXT, local_path TEXT, completed_at TEXT, updated_at TEXT, created_at TEXT, status TEXT, deleted_at TEXT);`);
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

test('episode merge uses the adopted version and never falls back when it is failed', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE storyboards (id INTEGER PRIMARY KEY, video_url TEXT, local_path TEXT, active_video_generation_id INTEGER, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE video_generations (id INTEGER PRIMARY KEY, storyboard_id INTEGER, video_url TEXT, local_path TEXT, completed_at TEXT, updated_at TEXT, created_at TEXT, status TEXT, deleted_at TEXT);`);
  db.prepare('INSERT INTO storyboards (id, active_video_generation_id, updated_at) VALUES (1, 2, ?)').run('2026-08-14T00:00:00.000Z');
  db.prepare(`INSERT INTO video_generations (id, storyboard_id, video_url, local_path, status, created_at)
    VALUES (1, 1, 'https://old.example/old.mp4', 'projects/demo/videos/old.mp4', 'completed', ?),
      (2, 1, NULL, NULL, 'failed', ?)`)
    .run('2026-08-13T00:00:00.000Z', '2026-08-14T00:00:00.000Z');
  assert.equal(dramaService.getVideoUrlForStoryboard(db, 1, 'http://localhost:5679/static'), null);
  db.prepare(`UPDATE video_generations SET status='completed', local_path='projects/demo/videos/adopted.mp4' WHERE id=2`).run();
  assert.equal(
    dramaService.getVideoUrlForStoryboard(db, 1, 'http://localhost:5679/static'),
    'http://localhost:5679/static/projects/demo/videos/adopted.mp4'
  );
});
