const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiConfigs = require('../src/services/aiConfigService');
const videoClient = require('../src/services/videoClient');
const videoService = require('../src/services/videoService');

const log = { info() {}, warn() {}, error() {} };

async function withDatabase(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richbest-recon-'));
  const db = getDb({ path: path.join(root, 'test.db'), type: 'sqlite' });
  try {
    runMigrationsAndEnsure(db);
    return await run(db);
  } finally {
    closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createRelayConfig(db) {
  return aiConfigs.createConfig(db, log, {
    service_type: 'video', provider: 'richbest', name: 'relay', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_relay', model: ['doubao-seedance-2.0'], default_model: 'doubao-seedance-2.0', is_default: true,
  });
}

function seedAuthorization(db, { amountMicro = 1000000, serviceType = 'video', model = 'doubao-seedance-2.0' } = {}) {
  const now = new Date().toISOString();
  const id = `auth-${Math.random().toString(16).slice(2)}`;
  // 释放冻结要动账户，所以账户状态必须与预授权一致（否则 voidAuthorization 会因
  // 「预授权冻结状态异常」抛错，被 setVideoGenFailed 的 try/catch 吃掉，测试会假绿）。
  db.prepare(`INSERT INTO billing_accounts (user_id, balance_micro, frozen_micro, total_recharged_micro, total_consumed_micro, updated_at)
    VALUES (1, ?, ?, 0, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET frozen_micro = excluded.frozen_micro, balance_micro = excluded.balance_micro, updated_at = excluded.updated_at`)
    .run(amountMicro, amountMicro, now);
  db.prepare(`INSERT INTO billing_transactions
    (id, user_id, type, amount_micro, balance_after_micro, frozen_after_micro, idempotency_key, snapshot_json, created_at)
    VALUES (?, 1, 'authorization', ?, 0, ?, ?, ?, ?)`).run(
    id, amountMicro, amountMicro, `key-${id}`,
    JSON.stringify({ service_type: serviceType, model, usage: { output_token: 40000 }, rates: [] }), now,
  );
  return id;
}

function seedGeneration(db, { authorizationId, configId }) {
  const now = new Date().toISOString();
  return db.prepare(`INSERT INTO video_generations
    (drama_id, prompt, model, status, ai_config_id, owner_user_id, billing_authorization_id, created_at, updated_at)
    VALUES (1, '测试镜头', 'doubao-seedance-2.0', 'processing', ?, 1, ?, ?, ?)`).run(
    configId, authorizationId, now, now,
  ).lastInsertRowid;
}

function billingState(db, authorizationId) {
  return {
    voided: !!db.prepare("SELECT 1 FROM billing_transactions WHERE authorization_id = ? AND type = 'void'").get(authorizationId),
    settled: !!db.prepare("SELECT 1 FROM billing_transactions WHERE authorization_id = ? AND type = 'settlement'").get(authorizationId),
    reconciliation: db.prepare('SELECT status, reason FROM billing_reconciliation_cases WHERE authorization_id = ?').get(authorizationId) || null,
  };
}

test('写请求终态未知时不释放预授权，改为挂起对账', async () => await withDatabase(async (db) => {
  const config = createRelayConfig(db);
  const authorizationId = seedAuthorization(db);
  const videoGenId = seedGeneration(db, { authorizationId, configId: config.id });

  const original = videoClient.callVideoApi;
  // 5xx / 传输中断：中转站可能已经建好任务并计费，返回体拿不到而已。
  videoClient.callVideoApi = async () => ({ error: '中转站视频请求未能确定结果: socket hang up', ambiguous: true });
  try {
    await videoService.processVideoGeneration(db, log, videoGenId);
  } finally {
    videoClient.callVideoApi = original;
  }

  const state = billingState(db, authorizationId);
  assert.equal(state.voided, false, '终态未知时不得释放预授权——释放等于把可能已计费的任务当成没发生');
  assert.equal(state.settled, false);
  assert.ok(state.reconciliation, '必须留下待对账记录供管理员按供应商用量核实');
  assert.equal(state.reconciliation.status, 'pending');
  assert.match(state.reconciliation.reason, /未取得确定结果/);

  const row = db.prepare('SELECT status, error_msg FROM video_generations WHERE id = ?').get(videoGenId);
  assert.equal(row.status, 'failed');
  assert.match(row.error_msg, /未能确定结果/);
}));

test('确定失败（4xx/参数错误）仍然释放预授权，不留对账噪声', async () => await withDatabase(async (db) => {
  const config = createRelayConfig(db);
  const authorizationId = seedAuthorization(db);
  const videoGenId = seedGeneration(db, { authorizationId, configId: config.id });

  const original = videoClient.callVideoApi;
  videoClient.callVideoApi = async () => ({ error: '中转站不支持该请求参数（video_parameter_unsupported）' });
  try {
    await videoService.processVideoGeneration(db, log, videoGenId);
  } finally {
    videoClient.callVideoApi = original;
  }

  const state = billingState(db, authorizationId);
  assert.equal(state.voided, true, '确定没有提交成功时必须释放冻结');
  assert.equal(state.reconciliation, null, '确定失败不该占用用户的对账额度');
}));

test('已钉住配置被删除时暂停提交，不换一枚业务 Key 重投', async () => await withDatabase(async (db) => {
  const config = createRelayConfig(db);
  const authorizationId = seedAuthorization(db);
  const videoGenId = seedGeneration(db, { authorizationId, configId: config.id });
  // 模拟配置被删除后重启续跑：模型名仍能解析到同名配置，但钉住的那条已经没了。
  db.prepare('UPDATE ai_service_configs SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), config.id);

  let called = false;
  const original = videoClient.callVideoApi;
  videoClient.callVideoApi = async () => { called = true; return { task_id: 'vid_should_not_exist' }; };
  try {
    await videoService.processVideoGeneration(db, log, videoGenId);
  } finally {
    videoClient.callVideoApi = original;
  }

  assert.equal(called, false, '钉住配置不可用时不得提交');
  const row = db.prepare('SELECT status, error_msg FROM video_generations WHERE id = ?').get(videoGenId);
  assert.equal(row.status, 'processing', '保持 processing 等待管理员恢复配置，而不是判失败');
  assert.match(row.error_msg, /固定配置已删除/);
  const state = billingState(db, authorizationId);
  assert.equal(state.voided, false, '什么都没提交，冻结要留着');
  assert.equal(state.reconciliation, null);
}));
