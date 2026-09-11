const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { spawn, spawnSync } = require('node:child_process');
const express = require('express');

const { getFfmpegPath, getFfprobePath } = require('../src/utils/ffmpegPath');

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr: Buffer.concat(stderr).toString('utf8') }));
  });
}

test('setupRouter tool writing and reverse workflows settle one authorization with aggregated usage', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minidrama-tool-http-billing-'));
  const previousCwd = process.cwd();
  process.chdir(root);
  const cfg = {
    app: { name: 'Tool billing integration' }, server: {},
    database: { type: 'sqlite', path: path.join(root, 'test.db') },
    storage: { type: 'local', local_path: path.join(root, 'storage') },
    payments: { enabled: false }, image_proxy: { use_for_video: false },
    vendor_lock: { enabled: false },
  };
  fs.writeFileSync(path.join(root, 'config.yaml'), JSON.stringify(cfg));
  // Load config-dependent modules after the isolated working directory is set.
  // The config module resolves its search paths when it is first required.
  const { getDb, closeDb } = require('../src/db');
  const { runMigrationsAndEnsure } = require('../src/db/migrate');
  const auth = require('../src/services/authService');
  const aiConfigs = require('../src/services/aiConfigService');
  const billing = require('../src/services/billingService');
  const errors = [];
  const log = { info() {}, warn() {}, error(...args) { errors.push(args); }, debug() {}, infow() {}, warnw() {}, errorw(...args) { errors.push(args); } };
  const providerCalls = [];
  let failNextProviderCall = false;
  let pauseNextProviderCall = false;
  let providerSequence = 0;
  const provider = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      if (pauseNextProviderCall) { pauseNextProviderCall = false; await delay(300); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const isVision = Array.isArray(body.messages?.[1]?.content);
      const kind = isVision ? 'vision' : 'text';
      providerCalls.push({ kind, body });
      if (failNextProviderCall) {
        failNextProviderCall = false;
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: { message: 'fixture provider failure' } }));
        return;
      }
      const id = `fixture-${++providerSequence}`;
      const usage = kind === 'vision'
        ? { prompt_tokens: 2, completion_tokens: 1 }
        : { prompt_tokens: 7, completion_tokens: 3 };
      res.setHeader('content-type', kind === 'vision' ? 'application/json' : 'text/event-stream');
      if (kind === 'vision') {
        res.end(JSON.stringify({
          id,
          choices: [{ message: { content: 'fixture visual analysis' } }],
          usage,
        }));
        return;
      }
      const userText = body.messages?.find((message) => message.role === 'user')?.content || '';
      const content = String(userText).includes('综合首、中、尾帧分析')
        ? 'fixture video prompt'
        : JSON.stringify([{ episode: 1, title: '测试集', content: 'fixture script' }]);
      res.write(`data: ${JSON.stringify({ id, choices: [{ delta: { content } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id, choices: [], usage })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });

  let server;
  let db;
  let base;
  let creator;
  let creatorToken;
  const { setupRouter } = require('../src/routes');

  async function start() {
    db = getDb(cfg.database);
    runMigrationsAndEnsure(db);
    const app = express();
    app.use(express.json());
    app.use('/api/v1', setupRouter(cfg, db, log));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  }

  async function stop() {
    if (server) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server = null;
    }
    closeDb();
  }

  async function request(method, route, body) {
    const result = await fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json', 'x-lmd-session': creatorToken },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: result.status, body: await result.json() };
  }

  async function waitForRun(id) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const result = await request('GET', `/tool-runs/${id}`);
      if (['completed', 'failed'].includes(result.body.data?.status)) return result.body.data;
      await delay(25);
    }
    throw new Error(`tool run ${id} did not finish`);
  }

  function assertLedger(run, expectedUsage) {
    const authorizationCount = db.prepare("SELECT COUNT(*) AS count FROM billing_transactions WHERE authorization_id=? AND type='authorization'").get(run.billing_authorization_id).count;
    const settlementCount = db.prepare("SELECT COUNT(*) AS count FROM billing_transactions WHERE authorization_id=? AND type='settlement'").get(run.billing_authorization_id).count;
    const voidCount = db.prepare("SELECT COUNT(*) AS count FROM billing_transactions WHERE authorization_id=? AND type='void'").get(run.billing_authorization_id).count;
    const usageRows = db.prepare('SELECT * FROM billing_usage_logs WHERE authorization_id=?').all(run.billing_authorization_id);
    assert.equal(authorizationCount, 1, 'nested provider calls must not create authorizations');
    assert.equal(settlementCount, 1, 'one tool run must create one settlement');
    assert.equal(voidCount, 0);
    assert.equal(usageRows.length, 1);
    assert.deepEqual(JSON.parse(usageRows[0].usage_json), expectedUsage);
    assert.match(String(usageRows[0].provider_request_id), /^fixture-/);
  }

  try {
    await new Promise((resolve, reject) => provider.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
    await start();
    const admin = auth.createUser(db, {
      username: 'tool-billing-admin', password: 'test-password', account_kind: 'platform_admin',
    }, null);
    creator = auth.createUser(db, { username: 'tool-billing-user', password: 'test-password' }, admin.id);
    const config = aiConfigs.createConfig(db, log, {
      service_type: 'text', provider: 'fixture', api_protocol: 'openai', name: 'Fixture text',
      base_url: `http://127.0.0.1:${provider.address().port}`, endpoint: '/chat/completions',
      api_key: 'fixture-key', model: ['fixture-model'], default_model: 'fixture-model', is_default: true,
    });
    assert.equal(config.model[0], 'fixture-model');
    const priceBook = db.prepare("SELECT id FROM billing_price_books WHERE status='published' ORDER BY id LIMIT 1").get();
    assert.ok(priceBook, 'migrations must provide a published system price book');
    const now = new Date().toISOString();
    const addPrice = db.prepare(`INSERT INTO billing_price_book_items
      (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
      VALUES (?, 'text', 'fixture-model', ?, 10000, 0, NULL, ?, ?)`);
    for (const meter of ['request', 'input_token', 'output_token']) addPrice.run(priceBook.id, meter, now, now);
    billing.adjustBalance(db, admin.id, creator.id, 100000, 'fixture tool balance', { idempotency_key: 'fixture-tool-balance' });
    const login = auth.login(db, creator.username, 'test-password');
    creatorToken = login.token;

    const project = await request('POST', '/dramas', { title: '工具计费项目' });
    assert.equal(project.status, 201, JSON.stringify(project.body));
    const dramaId = project.body.data.id;
    const storage = cfg.storage.local_path;
    fs.mkdirSync(path.join(storage, 'tool-fixture'), { recursive: true });
    const imageRelative = 'tool-fixture/reference.jpg';
    const imageAbsolute = path.join(storage, imageRelative);
    fs.writeFileSync(imageAbsolute, Buffer.from('fixture-image'));
    const ffmpeg = getFfmpegPath();
    const ffprobe = getFfprobePath();
    if (spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' }).status !== 0
      || spawnSync(ffprobe, ['-version'], { encoding: 'utf8' }).status !== 0) {
      t.skip('ffmpeg/ffprobe is unavailable');
      return;
    }
    const videoRelative = 'tool-fixture/reference.mp4';
    const videoAbsolute = path.join(storage, videoRelative);
    const madeVideo = await runProcess(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=8:d=1',
      '-f', 'lavfi', '-i', 'color=c=green:s=64x64:r=8:d=1',
      '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=8:d=1',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p',
      '-c:v', 'libx264', '-y', videoAbsolute,
    ]);
    assert.equal(madeVideo.code, 0, madeVideo.stderr);
    const insertAsset = db.prepare(`INSERT INTO assets
      (drama_id, name, type, url, local_path, file_size, mime_type, created_at, updated_at)
      VALUES (?, ?, ?, '', ?, ?, ?, ?, ?)`);
    const imageAsset = Number(insertAsset.run(dramaId, 'Fixture image', 'image', imageRelative, fs.statSync(imageAbsolute).size, 'image/jpeg', now, now).lastInsertRowid);
    const videoAsset = Number(insertAsset.run(dramaId, 'Fixture video', 'video', videoRelative, fs.statSync(videoAbsolute).size, 'video/mp4', now, now).lastInsertRowid);

    const writing = await request('POST', '/tools/script_writing/runs', {
      drama_id: dramaId, model: 'fixture-model', idempotency_key: 'fixture-writing-1',
      input: { premise: '一个可验证的故事' },
    });
    assert.equal(writing.status, 201, JSON.stringify(writing.body));
    const writingRun = await waitForRun(writing.body.data.id);
    assert.equal(writingRun.status, 'completed', `${writingRun.error_msg}; ${JSON.stringify(errors)}`);
    assertLedger(writingRun, { request: 1, input_token: 7, output_token: 3 });

    const imageReverse = await request('POST', '/tools/reverse_prompt/runs', {
      drama_id: dramaId, model: 'fixture-model', idempotency_key: 'fixture-image-reverse-1',
      assets: [{ asset_id: imageAsset }], input: {},
    });
    assert.equal(imageReverse.status, 201, JSON.stringify(imageReverse.body));
    const imageRun = await waitForRun(imageReverse.body.data.id);
    assert.equal(imageRun.status, 'completed', imageRun.error_msg);
    assertLedger(imageRun, { request: 1, input_token: 2, output_token: 1 });

    const videoReverse = await request('POST', '/tools/reverse_prompt/runs', {
      drama_id: dramaId, model: 'fixture-model', idempotency_key: 'fixture-video-reverse-1',
      assets: [{ asset_id: videoAsset }], input: {},
    });
    assert.equal(videoReverse.status, 201, JSON.stringify(videoReverse.body));
    const videoRun = await waitForRun(videoReverse.body.data.id);
    assert.equal(videoRun.status, 'completed', videoRun.error_msg);
    assertLedger(videoRun, { request: 1, input_token: 13, output_token: 6 });
    assert.equal(providerCalls.filter((call) => call.kind === 'vision').length, 4);
    assert.equal(providerCalls.filter((call) => call.kind === 'text').length, 2);
    const costCalls = db.prepare('SELECT c.*,r.usage_json FROM cost_calls c JOIN cost_revisions r ON r.id=c.latest_revision_id WHERE c.authorization_id=? ORDER BY c.attempt').all(videoRun.billing_authorization_id);
    assert.equal(costCalls.length, 4, 'three vision requests plus synthesis are separate supplier attempts');
    assert.equal(new Set(costCalls.map(call => call.operation_id)).size, 1);
    assert.equal(costCalls.reduce((n, call) => n + JSON.parse(call.usage_json).input_token, 0), 13);
    assert.equal(costCalls.reduce((n, call) => n + JSON.parse(call.usage_json).output_token, 0), 6);
    assert.ok(costCalls.every(call => call.drama_id === dramaId && call.config_id === config.id));
    assert.equal(fs.readdirSync(path.join(storage, 'tool-reverse')).length, 0, 'temporary reverse frames must be cleaned');

    failNextProviderCall = true;
    const failedReverse = await request('POST', '/tools/reverse_prompt/runs', {
      drama_id: dramaId, model: 'fixture-model', idempotency_key: 'fixture-failure-1',
      assets: [{ asset_id: imageAsset }], input: {},
    });
    assert.equal(failedReverse.status, 201, JSON.stringify(failedReverse.body));
    const failedRun = await waitForRun(failedReverse.body.data.id);
    assert.equal(failedRun.status, 'failed');
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing_transactions WHERE authorization_id=? AND type='settlement'").get(failedRun.billing_authorization_id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing_transactions WHERE authorization_id=? AND type='void'").get(failedRun.billing_authorization_id).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_usage_logs WHERE authorization_id=?').get(failedRun.billing_authorization_id).count, 0);
    assert.equal(billing.account(db, creator.id).frozen_micro, 0);

    const ownerToken = creatorToken;
    const editor = auth.createUser(db, { username: 'tool-project-editor', password: 'test-password' }, admin.id);
    billing.adjustBalance(db, admin.id, editor.id, 100000, 'fixture editor balance', { idempotency_key: 'fixture-editor-balance' });
    assert.equal((await request('PUT', `/dramas/${dramaId}/collaboration/members`, { username: editor.username, role: 'editor' })).status, 200);
    const ownerBalance = billing.account(db, creator.id).balance_micro;
    creatorToken = auth.login(db, editor.username, 'test-password').token;
    pauseNextProviderCall = true;
    const shared = await request('POST', '/tools/script_writing/runs', {
      drama_id: dramaId, owner_user_id: creator.id, model: 'fixture-model', idempotency_key: 'fixture-editor-writing',
      input: { premise: '成员自己的生成' },
    });
    assert.equal(shared.status, 201, JSON.stringify(shared.body));
    const sharedRunId = shared.body.data.id;
    assert.equal(shared.body.data.owner_user_id, editor.id, 'the caller cannot choose another payer');
    creatorToken = ownerToken;
    assert.equal((await request('DELETE', `/dramas/${dramaId}/collaboration/members/${editor.id}`)).status, 200);
    assert.equal((await request('POST', `/tool-runs/${sharedRunId}/retry`, {})).status, 403);
    const sharedResult = await waitForRun(sharedRunId);
    assert.equal(sharedResult.status, 'completed', JSON.stringify(sharedResult));
    assert.equal(sharedResult.billing_authorization_id, undefined, 'project readers cannot read another member billing record');
    const persistedSharedRun = db.prepare('SELECT * FROM tool_runs WHERE id=?').get(sharedRunId);
    assertLedger(persistedSharedRun, { request: 1, input_token: 7, output_token: 3 });
    assert.equal(billing.account(db, creator.id).balance_micro, ownerBalance);
    assert.equal(billing.account(db, editor.id).frozen_micro, 0);
    const callsBeforeRestart = providerCalls.length;

    await stop();
    await start();
    const restored = await request('GET', `/tool-runs/${videoRun.id}`);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.data.status, 'completed');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cost_calls WHERE authorization_id=?').get(videoRun.billing_authorization_id).n, 4);
    assert.equal(restored.body.data.output.prompt, 'fixture video prompt');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_usage_logs WHERE authorization_id=?').get(videoRun.billing_authorization_id).count, 1);
    assert.equal((await request('GET', `/tool-runs/${sharedRunId}`)).body.data.status, 'completed');
    assert.equal(providerCalls.length, callsBeforeRestart, 'restart must not resubmit completed shared work');
  } finally {
    await stop();
    await new Promise((resolve) => provider.close(resolve));
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
