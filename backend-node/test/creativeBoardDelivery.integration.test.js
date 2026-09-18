const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { getFfmpegPath, getFfprobePath } = require('../src/utils/ffmpegPath');
const delivery = require('../src/services/creativeBoardDeliveryService');
const assets = require('../src/services/assetService');
const { authorizeMediaPath } = require('../src/services/mediaAuthorizationService');

const log = { info() {}, warn() {}, error() {} };

function execute(bin, args) {
  const result = spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 100000, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr?.slice(-1000) || result.error?.message);
  return result.stdout;
}

async function waitForCompletion(db, id) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const row = db.prepare('SELECT * FROM creative_board_deliveries WHERE id=?').get(id);
    if (row.status === 'completed' || row.status === 'failed') return row;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('组装任务超时');
}

test('one local episode resumes after database restart and writes distinct clean, finished and SRT files', { timeout: 240000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-board-delivery-'));
  const oldStorage = process.env.CFG_STORAGE__LOCAL_PATH, oldType = process.env.CFG_STORAGE__TYPE;
  process.env.CFG_STORAGE__LOCAL_PATH = root;
  process.env.CFG_STORAGE__TYPE = 'local';
  let db;
  try {
    const sourceDir = path.join(root, 'test');
    fs.mkdirSync(sourceDir);
    execute(getFfmpegPath(), ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=10:d=5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-c:a', 'aac', '-shortest', path.join(sourceDir, 'clip.mp4')]);
    const dbPath = path.join(root, 'isolated.db');
    db = new Database(dbPath);
    const originalLog = console.log, originalWarn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { runMigrationsAndEnsure(db); } finally { console.log = originalLog; console.warn = originalWarn; }
    const at = new Date().toISOString();
    const board = db.prepare("INSERT INTO creative_boards(owner_user_id,name,created_at,updated_at) VALUES(1,'本地交付',?,?)").run(at, at);
    const video = db.prepare("INSERT INTO video_generations(owner_user_id,prompt,status,local_path,created_at,updated_at) VALUES(1,'本地片段','completed','test/clip.mp4',?,?)").run(at, at);
    const input = {
      video_generation_ids: [Number(video.lastInsertRowid)],
      videos: [{ id: Number(video.lastInsertRowid), local_path: 'test/clip.mp4', width: 320, height: 240, seconds: 5, audio: true }],
      subtitles: [{ start_ms: 1000, end_ms: 3000, text: '本地字幕' }], bgm: null, total_ms: 5000,
    };
    const row = db.prepare("INSERT INTO creative_board_deliveries(board_id,owner_user_id,idempotency_key,input_json,created_at,updated_at) VALUES(?,1,'restart-test',?,?,?)")
      .run(Number(board.lastInsertRowid), JSON.stringify(input), at, at);
    db.close(); db = new Database(dbPath);
    assert.equal(delivery.resume(db, log), 1);
    const done = await waitForCompletion(db, Number(row.lastInsertRowid));
    assert.equal(done.status, 'completed', done.error_msg);
    for (const field of ['clean_local_path', 'finished_local_path', 'srt_local_path']) {
      const file = path.join(root, done[field]);
      assert.ok(fs.statSync(file).size > 0, field);
      assert.equal(authorizeMediaPath(db, done[field], { id: 1 }, { storageRoot: root }).status, 200, field);
      assert.equal(authorizeMediaPath(db, done[field], { id: 2 }, { storageRoot: root }).status, 404, field);
    }
    const clean = path.join(root, done.clean_local_path), finished = path.join(root, done.finished_local_path);
    assert.notEqual(fs.statSync(clean).size, fs.statSync(finished).size);
    assert.match(fs.readFileSync(path.join(root, done.srt_local_path), 'utf8'), /00:00:01,000 --> 00:00:03,000/);
    for (const file of [clean, finished]) {
      const metadata = JSON.parse(execute(getFfprobePath(), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file]));
      assert.ok(Math.abs(Number(metadata.format.duration) - 5) < 1);
      assert.ok(metadata.streams.some((stream) => stream.codec_type === 'audio'));
      assert.equal(metadata.streams.find((stream) => stream.codec_type === 'video').height, 240);
    }
    db.close(); db = new Database(dbPath);
    assert.equal(delivery.ownedDelivery(db, Number(row.lastInsertRowid), 1).status, 'completed');
    assert.equal(delivery.resume(db, log), 0);
    assert.equal(authorizeMediaPath(db, done.srt_local_path, { id: 1 }, { storageRoot: root }).status, 200);
    const secondBoard = db.prepare("INSERT INTO creative_boards(owner_user_id,name,created_at,updated_at) VALUES(1,'另一张画布',?,?)").run(at, at);
    await assert.rejects(() => delivery.create(db, log, Number(secondBoard.lastInsertRowid), 1, { idempotency_key: 'restart-test' }), /幂等键已用于其他画布/);
    execute(getFfmpegPath(), ['-y', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=5', '-c:a', 'pcm_s16le', path.join(sourceDir, 'bgm.wav')]);
    const bgm = assets.create(db, log, { owner_user_id: 1, name: '本地配乐', type: 'audio', local_path: 'test/bgm.wav' });
    const request = { idempotency_key: 'bgm-test', video_generation_ids: [Number(video.lastInsertRowid)], subtitles: [{ start_ms: 1000, end_ms: 3000, text: '混音字幕' }], bgm_asset_id: bgm.id };
    const mixed = await delivery.create(db, log, Number(board.lastInsertRowid), 1, request);
    assert.equal((await delivery.create(db, log, Number(board.lastInsertRowid), 1, request)).id, mixed.id);
    assert.throws(() => delivery.ownedDelivery(db, mixed.id, 2), /无权/);
    const mixedDone = await waitForCompletion(db, mixed.id);
    assert.equal(mixedDone.status, 'completed', mixedDone.error_msg);
    const audioHash = (file) => execute(getFfmpegPath(), ['-v', 'error', '-i', file, '-vn', '-t', '2', '-c:a', 'pcm_s16le', '-f', 'md5', '-']).trim();
    assert.notEqual(audioHash(path.join(root, mixedDone.clean_local_path)), audioHash(path.join(root, mixedDone.finished_local_path)), 'selected BGM changes only the finished audio');
    const plain = await delivery.create(db, log, Number(board.lastInsertRowid), 1, { idempotency_key: 'plain-test', video_generation_ids: [Number(video.lastInsertRowid)] });
    const plainDone = await waitForCompletion(db, plain.id);
    assert.equal(plainDone.status, 'completed', plainDone.error_msg);
    assert.equal(plainDone.srt_local_path, null);
    assert.equal(delivery.ownedDelivery(db, plain.id, 1).srt_url, null);
    assert.deepEqual(fs.readFileSync(path.join(root, plainDone.clean_local_path)), fs.readFileSync(path.join(root, plainDone.finished_local_path)));
    assert.deepEqual(delivery.validateSubtitles([], 5000), []);
    assert.throws(() => delivery.validateSubtitles([{ start_ms: 0, end_ms: 6000, text: '超出片段' }], 5000), /字幕时间/);
    db.prepare('UPDATE creative_boards SET deleted_at=? WHERE id=?').run(new Date().toISOString(), Number(board.lastInsertRowid));
    assert.equal(authorizeMediaPath(db, done.finished_local_path, { id: 1 }, { storageRoot: root }).status, 404);
  } finally {
    if (db?.open) db.close();
    if (oldStorage === undefined) delete process.env.CFG_STORAGE__LOCAL_PATH; else process.env.CFG_STORAGE__LOCAL_PATH = oldStorage;
    if (oldType === undefined) delete process.env.CFG_STORAGE__TYPE; else process.env.CFG_STORAGE__TYPE = oldType;
    if (path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true });
  }
});
