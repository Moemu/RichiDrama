const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const videoService = require('../src/services/videoService');
const { probeVideoMedia } = require('../src/services/videoMediaProbeService');
const { getFfmpegPath, hasLocalFfmpeg } = require('../src/utils/ffmpegPath');

const log = { info() {}, warn() {}, error() {} };

test('aspect contract derives exact canvases from the selected short-edge tier', () => {
  assert.deepEqual(videoService.targetVideoPixelsForAspect('16:9', '1080p'), { w: 1920, h: 1080, aspect_ratio: '16:9', short_edge: 1080 });
  assert.deepEqual(videoService.targetVideoPixelsForAspect('9:16', '1080p'), { w: 1080, h: 1920, aspect_ratio: '9:16', short_edge: 1080 });
  assert.deepEqual(videoService.targetVideoPixelsForAspect('1:1', '720p'), { w: 720, h: 720, aspect_ratio: '1:1', short_edge: 720 });
  assert.deepEqual(videoService.targetVideoPixelsForAspect('3:4', '480p'), { w: 480, h: 640, aspect_ratio: '3:4', short_edge: 480 });
  assert.deepEqual(videoService.targetVideoPixelsForAspect('21:9', '1080p'), { w: 2520, h: 1080, aspect_ratio: '21:9', short_edge: 1080 });
});

test('final aspect normalization preserves the paid stage artifact and creates an exact final canvas', { skip: !hasLocalFfmpeg() }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-aspect-contract-'));
  try {
    const sourceRelative = 'videos/upscaled.mp4';
    const source = path.join(root, sourceRelative);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    const created = spawnSync(getFfmpegPath(), ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1882x1080:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    const sourceSize = fs.statSync(source).size;
    const result = videoService.normalizeFinalVideoToContract(root, sourceRelative, { aspect_ratio: '16:9', resolution: '720p', upscale_resolution: '1080p' }, 77, log);
    assert.notEqual(result.local_path, sourceRelative);
    assert.equal(fs.statSync(source).size, sourceSize);
    const finalProbe = probeVideoMedia(path.join(root, result.local_path));
    assert.equal(finalProbe.width, 1920);
    assert.equal(finalProbe.height, 1080);
    assert.ok(Math.abs(finalProbe.fps - 24) < 0.5);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unprocessed video normalizes in place so it remains a single retained artifact', { skip: !hasLocalFfmpeg() }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-aspect-single-'));
  try {
    const relative = 'videos/original.mp4';
    const source = path.join(root, relative);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    const created = spawnSync(getFfmpegPath(), ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=1882x1080:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    const result = videoService.normalizeFinalVideoToContract(root, relative, { aspect_ratio: '16:9', resolution: '1080p', upscale_resolution: null, target_fps: null }, 78, log);
    assert.equal(result.local_path, relative);
    assert.equal(fs.readdirSync(path.join(root, 'videos')).filter((x) => x.endsWith('.mp4')).length, 1);
    assert.equal(probeVideoMedia(source).width, 1920);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('intermediate cleanup is opt-in and never deletes legacy artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-cleanup-'));
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE video_generations (id INTEGER PRIMARY KEY, source_local_path TEXT, upscale_local_path TEXT, intermediate_cleanup_enabled INTEGER, updated_at TEXT)');
    fs.mkdirSync(path.join(root, 'videos'), { recursive: true });
    for (const name of ['source.mp4', 'upscaled.mp4', 'final.mp4']) fs.writeFileSync(path.join(root, 'videos', name), name);
    db.prepare('INSERT INTO video_generations VALUES (1, ?, ?, 0, NULL)').run('videos/source.mp4', 'videos/upscaled.mp4');
    assert.deepEqual(videoService.pruneSupersededVideoArtifacts(db, root, 1, 'videos/final.mp4', log), { skipped: 'legacy_or_disabled' });
    assert.ok(fs.existsSync(path.join(root, 'videos/source.mp4')));
    db.prepare('INSERT INTO video_generations VALUES (2, ?, ?, 1, NULL)').run('videos/source.mp4', 'videos/upscaled.mp4');
    const cleaned = videoService.pruneSupersededVideoArtifacts(db, root, 2, 'videos/final.mp4', log);
    assert.deepEqual(cleaned.removed.sort(), ['videos/source.mp4', 'videos/upscaled.mp4']);
    assert.ok(fs.existsSync(path.join(root, 'videos/final.mp4')));
    assert.deepEqual(db.prepare('SELECT source_local_path, upscale_local_path FROM video_generations WHERE id=2').get(), { source_local_path: null, upscale_local_path: null });
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
