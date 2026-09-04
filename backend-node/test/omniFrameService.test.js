const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { getFfmpegPath } = require('../src/utils/ffmpegPath');
const frameService = require('../src/services/omniFrameService');
const omniVideoRoutes = require('../src/routes/omniVideo');

function hasFfmpeg() {
  return spawnSync(getFfmpegPath(), ['-version'], { encoding: 'utf8' }).status === 0;
}

function createDatabase(file) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY, drama_id INTEGER, owner_user_id INTEGER,
      local_path TEXT, duration REAL, output_duration_ms INTEGER,
      output_fps REAL, status TEXT
    );
    CREATE TABLE omni_video_jobs (
      id INTEGER PRIMARY KEY, video_generation_id INTEGER, owner_user_id INTEGER
    );
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, drama_id INTEGER, owner_user_id INTEGER,
      name TEXT, reference_alias TEXT, description TEXT, type TEXT, category TEXT,
      url TEXT, local_path TEXT, thumbnail_url TEXT, thumbnail_local_path TEXT,
      file_size INTEGER, mime_type TEXT, width INTEGER, height INTEGER, duration REAL,
      image_gen_id INTEGER, video_gen_id INTEGER, source_type TEXT, parent_asset_id INTEGER,
      metadata_json TEXT, tags_json TEXT, checksum TEXT, processing_status TEXT,
      error_msg TEXT, is_favorite INTEGER, seedance2_asset TEXT,
      requires_sd2_identity INTEGER, created_at TEXT, updated_at TEXT,
      deleted_at TEXT, archived_at TEXT
    );
  `);
  return db;
}

function makeVideo(output, { fps = 24, videoDuration = 2, audioDuration = null } = {}) {
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=blue:s=320x180:r=${fps}:d=${videoDuration}`];
  if (audioDuration != null) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(audioDuration));
  }
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  if (audioDuration != null) args.push('-c:a', 'aac');
  args.push(output);
  const result = spawnSync(getFfmpegPath(), args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
}

function fixture(t, videoOptions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-frame-'));
  const dbFile = path.join(root, 'frame.db');
  const videoDir = path.join(root, 'videos');
  fs.mkdirSync(videoDir, { recursive: true });
  makeVideo(path.join(videoDir, 'source.mp4'), videoOptions);
  const db = createDatabase(dbFile);
  const duration = videoOptions.videoDuration || 2;
  const fps = videoOptions.fps || 24;
  db.prepare(`INSERT INTO video_generations
    (id, drama_id, owner_user_id, local_path, duration, output_duration_ms, output_fps, status)
    VALUES (907, 41, 7, 'videos/source.mp4', ?, ?, ?, 'completed')`)
    .run(duration, Math.round(duration * 1000), fps);
  db.prepare('INSERT INTO omni_video_jobs (id, video_generation_id, owner_user_id) VALUES (81, 907, 7)').run();
  t.after(() => {
    try { if (db.open) db.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, dbFile, db, cfg: { storage: { local_path: root } }, log: { warn() {} } };
}

test('last-frame extraction ignores a longer audio stream and preserves asset ownership', (t) => {
  if (!hasFfmpeg()) return t.skip('ffmpeg is unavailable');
  const ctx = fixture(t, { fps: 24, videoDuration: 2, audioDuration: 2.2 });
  const asset = frameService.extractVideoGeneration(ctx.db, ctx.cfg, ctx.log, 907, 'last', { id: 7, role: 'user' });
  const stored = ctx.db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.id);
  assert.equal(stored.owner_user_id, 7);
  assert.equal(stored.drama_id, 41);
  assert.equal(stored.source_type, 'video_frame');
  assert.ok(stored.file_size > 0);
  assert.equal(JSON.parse(stored.metadata_json).frame_position, 'last');
  assert.ok(fs.existsSync(path.join(ctx.root, stored.local_path)));
});

test('last-frame extraction works for a low-frame-rate silent video', (t) => {
  if (!hasFfmpeg()) return t.skip('ffmpeg is unavailable');
  const ctx = fixture(t, { fps: 2, videoDuration: 2 });
  const asset = frameService.extractVideoGeneration(ctx.db, ctx.cfg, ctx.log, 907, 'last', { id: 7, role: 'user' });
  assert.ok(asset.file_size > 0);
});

test('first-frame extraction works for a silent video after a database restart', (t) => {
  if (!hasFfmpeg()) return t.skip('ffmpeg is unavailable');
  const ctx = fixture(t, { fps: 24, videoDuration: 1 });
  ctx.db.close();
  const reopened = new Database(ctx.dbFile);
  const asset = frameService.extractVideoGeneration(reopened, ctx.cfg, ctx.log, 907, 'first', { id: 7, role: 'user' });
  assert.ok(asset.file_size > 0);
  reopened.close();
});

test('service-level ownership checks protect both frame extraction entry points', (t) => {
  if (!hasFfmpeg()) return t.skip('ffmpeg is unavailable');
  const ctx = fixture(t, { fps: 24, videoDuration: 1 });
  assert.throws(
    () => frameService.extractVideoGeneration(ctx.db, ctx.cfg, ctx.log, 907, 'first', { id: 8, role: 'user' }),
    /无权操作/
  );
  assert.throws(
    () => frameService.extract(ctx.db, ctx.cfg, ctx.log, 81, 'first', { id: 8, role: 'user' }),
    /无权操作/
  );
  assert.equal(ctx.db.prepare('SELECT COUNT(*) count FROM assets').get().count, 0);
});

test('omni-job extraction assigns the job owner to the created frame asset', (t) => {
  if (!hasFfmpeg()) return t.skip('ffmpeg is unavailable');
  const ctx = fixture(t, { fps: 24, videoDuration: 1 });
  const asset = frameService.extract(ctx.db, ctx.cfg, ctx.log, 81, 'first', { id: 7, role: 'user' });
  const stored = ctx.db.prepare('SELECT owner_user_id, drama_id FROM assets WHERE id = ?').get(asset.id);
  assert.deepEqual(stored, { owner_user_id: 7, drama_id: 41 });
});

test('video frame HTTP handler keeps the created response contract', (t) => {
  if (!hasFfmpeg()) return t.skip('ffmpeg is unavailable');
  const ctx = fixture(t, { fps: 24, videoDuration: 1 });
  const handler = omniVideoRoutes(ctx.db, ctx.log, ctx.cfg).extractVideoFrame;
  let statusCode = null;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; },
  };
  handler({ params: { id: '907' }, body: { position: 'first' }, auth: { id: 7, role: 'user' } }, res);
  assert.equal(statusCode, 201);
  assert.equal(payload.success, true);
  assert.equal(payload.data.source_type, 'video_frame');
  assert.equal(payload.data.metadata.source_video_generation_id, 907);
});

test('failed extraction logs bounded diagnostics without media content', (t) => {
  if (!hasFfmpeg()) return t.skip('ffmpeg is unavailable');
  const ctx = fixture(t, { fps: 24, videoDuration: 1 });
  fs.writeFileSync(path.join(ctx.root, 'videos', 'source.mp4'), 'invalid video');
  const warnings = [];
  ctx.log = { warn(message, details) { warnings.push({ message, details }); } };
  assert.throws(
    () => frameService.extractVideoGeneration(ctx.db, ctx.cfg, ctx.log, 907, 'last', { id: 7, role: 'user' }),
    /Failed to extract video frame/
  );
  const failure = warnings.find((entry) => entry.message === 'Video frame extraction failed');
  assert.equal(failure.details.video_generation_id, 907);
  assert.equal(failure.details.position, 'last');
  assert.equal(typeof failure.details.ffmpeg_stderr, 'string');
  assert.ok(failure.details.ffmpeg_stderr.length <= 2000);
  assert.doesNotMatch(JSON.stringify(warnings), /base64/i);
});

test('parseRate accepts rational frame rates', () => {
  assert.equal(frameService.parseRate('24/1'), 24);
  assert.equal(frameService.parseRate('30000/1001').toFixed(3), '29.970');
  assert.equal(frameService.parseRate('0/0'), 0);
});
