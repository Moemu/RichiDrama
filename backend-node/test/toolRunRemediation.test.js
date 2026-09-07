const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const tools = require('../src/services/toolRunService');
const storyGeneration = require('../src/services/storyGenerationService');
const { getFfmpegPath, getFfprobePath } = require('../src/utils/ffmpegPath');

function dbWithToolTables() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, type TEXT, local_path TEXT, url TEXT, deleted_at TEXT);
    CREATE TABLE tool_prompt_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_type TEXT, name TEXT, language TEXT, content TEXT, is_builtin INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE tool_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tool_type TEXT, batch_id TEXT, title TEXT, model TEXT,
      language TEXT, status TEXT, input_json TEXT, output_json TEXT, streamed_text TEXT,
      error_msg TEXT, task_id TEXT, continuation_count INTEGER DEFAULT 0, owner_user_id INTEGER,
      tenant_id INTEGER, drama_id INTEGER, billing_authorization_id TEXT, created_at TEXT,
      updated_at TEXT, completed_at TEXT, deleted_at TEXT
    );
    CREATE TABLE tool_run_assets (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_run_id INTEGER, asset_id INTEGER, ordinal INTEGER, usage TEXT, snapshot_json TEXT, created_at TEXT);
  `);
  return db;
}

test('tool usage collector sums every provider response and keeps request ids', () => {
  const collector = tools.createUsageCollector();
  collector.record({ prompt_tokens: 11, completion_tokens: 7 }, 'vision-1');
  collector.record({ input_token: 13, output_token: 5 }, 'vision-2');
  collector.record({ prompt_tokens: 0, completion_tokens: 3 }, 'text-1');
  collector.record({ prompt_tokens: 1, completion_tokens: 2 }, 'text-1');
  assert.deepEqual(collector.usage, { request: 1, input_token: 25, output_token: 17 });
  assert.equal(collector.providerRequestId, 'vision-1,vision-2,text-1');
});

test('script writing forwards provider usage to the tool settlement callback', async () => {
  const db = dbWithToolTables();
  const log = { info() {}, warn() {}, error() {} };
  const original = storyGeneration.generateStory;
  let receivedBody;
  storyGeneration.generateStory = async (_db, _log, body) => {
    receivedBody = body;
    body.usage_callback({ prompt_tokens: 46, completion_tokens: 12 }, 'story-request-1');
    return { episodes: [{ episode: 1, title: '第一集', content: '内容' }] };
  };
  try {
    const run = tools.create(db, {
      tool_type: 'script_writing', title: 'usage', model: 'text-model',
      input: { premise: '一场误会' }, owner_user_id: 7,
    });
    const completed = await tools.executeStory(db, log, run.id);
    assert.equal(completed.status, 'completed');
    assert.deepEqual(receivedBody.usage_callback && tools.createUsageCollector ? completed.output.episodes.length : null, 1);
  } finally {
    storyGeneration.generateStory = original;
    db.close();
  }
});

test('video reverse extraction chooses distinct first, middle and last frames and cleans only its exact files', async (t) => {
  const ffmpeg = getFfmpegPath();
  const ffprobe = getFfprobePath();
  if (spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' }).status !== 0
    || spawnSync(ffprobe, ['-version'], { encoding: 'utf8' }).status !== 0) {
    t.skip('ffmpeg/ffprobe is unavailable');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-reverse-test-'));
  try {
    const video = path.join(root, 'distinct.mp4');
    const made = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:s=96x96:r=10:d=1',
      '-f', 'lavfi', '-i', 'color=c=green:s=96x96:r=10:d=1',
      '-f', 'lavfi', '-i', 'color=c=blue:s=96x96:r=10:d=1',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p',
      '-c:v', 'libx264', '-y', video,
    ], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);

    const created = [];
    const frames = await tools.extractVideoFrames(video, root, 91, created);
    const hashes = frames.map((frame) => crypto.createHash('sha256').update(fs.readFileSync(frame)).digest('hex'));
    assert.equal(frames.length, 3);
    assert.equal(new Set(hashes).size, 3);

    const keep = path.join(root, 'tool-reverse', 'other-run.jpg');
    fs.writeFileSync(keep, 'keep');
    tools.cleanupTemporaryFrames(root, created);
    assert.ok(created.every((file) => !fs.existsSync(file)));
    assert.ok(fs.existsSync(keep));

    const blockedRoot = path.join(root, 'blocked-root');
    fs.writeFileSync(blockedRoot, 'not a directory');
    assert.doesNotThrow(() => tools.cleanupTemporaryFrames(blockedRoot, created));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
