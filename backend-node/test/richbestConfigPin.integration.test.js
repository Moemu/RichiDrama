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
const omniVideoService = require('../src/services/omniVideoService');

const log = { info() {}, warn() {}, error() {} };

async function withDatabase(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richbest-pin-'));
  const filename = path.join(root, 'test.db');
  const db = getDb({ path: filename, type: 'sqlite' });
  try {
    runMigrationsAndEnsure(db);
    return await run(db);
  } finally {
    closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function seedRow(db, values) {
  const now = new Date().toISOString();
  // tenant_id 留空：本夹具里的配置都是全局配置，与老用户的历史行同构。
  return db.prepare(`INSERT INTO video_generations
    (drama_id, prompt, model, status, provider_task_id, ai_config_id, owner_user_id, created_at, updated_at)
    VALUES (?, ?, ?, 'processing', ?, ?, 1, ?, ?)`).run(
    values.drama_id ?? 1, '测试镜头', values.model, values.provider_task_id ?? 'vid_local_1',
    values.ai_config_id ?? null, now, now,
  ).lastInsertRowid;
}

test('submission resolves the pinned config instead of re-guessing it from the model name', async () => await withDatabase(async (db) => {
  const relay = aiConfigs.createConfig(db, log, {
    service_type: 'video', provider: 'richbest', name: 'relay', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_relay', model: ['doubao-seedance-2.0'], default_model: 'doubao-seedance-2.0', is_default: true,
  });
  const direct = aiConfigs.createConfig(db, log, {
    service_type: 'video', provider: 'volcengine', name: 'direct', base_url: 'https://ark.example.test/api/v3',
    api_key: 'ark-key', model: ['doubao-seedance-2.0'], default_model: 'doubao-seedance-2.0',
  });

  assert.equal(videoClient.resolveVideoConfigForSubmit(db, { ai_config_id: direct.id, model: 'doubao-seedance-2.0' }).id, direct.id);
  // 没有钉住值时保持原行为：命中默认配置
  assert.equal(videoClient.resolveVideoConfigForSubmit(db, { model: 'doubao-seedance-2.0' }).id, relay.id);
  // 钉住的配置已不存在：返回 null 交给上层报错，而不是静默换一枚 Key 去提交
  assert.equal(videoClient.resolveVideoConfigForSubmit(db, { ai_config_id: 999999, model: 'doubao-seedance-2.0' }), null);
}));

test('restart resume keeps polling the config that created the relay task', async () => await withDatabase(async (db) => {
  const relay = aiConfigs.createConfig(db, log, {
    service_type: 'video', provider: 'richbest', name: 'relay', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_relay', model: ['doubao-seedance-2.0'], default_model: 'doubao-seedance-2.0', is_default: true,
  });
  const id = seedRow(db, { model: 'doubao-seedance-2.0', ai_config_id: relay.id });

  const polls = [];
  const originalPoll = videoClient.pollVideoTask;
  videoClient.pollVideoTask = async (_db, _log, videoGenId, taskId, config) => {
    polls.push({ videoGenId, taskId, config_id: config?.id, provider: config?.provider });
    return { error: 'stop the fixture here' };
  };
  try {
    await videoService.resumePollForVideoGeneration(db, log, id);
  } finally {
    videoClient.pollVideoTask = originalPoll;
  }
  assert.equal(polls.length, 1);
  assert.equal(polls[0].config_id, relay.id);
  assert.equal(polls[0].provider, 'richbest');
  assert.equal(polls[0].taskId, 'vid_local_1');
}));

test('a rotated default cannot redirect a pinned poll, and a missing pinned config pauses instead of failing', async () => await withDatabase(async (db) => {
  const relay = aiConfigs.createConfig(db, log, {
    service_type: 'video', provider: 'richbest', name: 'relay', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_relay', model: ['doubao-seedance-2.0'], default_model: 'doubao-seedance-2.0', is_default: true,
  });
  const pinnedRow = seedRow(db, { model: 'doubao-seedance-2.0', ai_config_id: relay.id });

  // 换默认配置后，在途任务仍按钉住的那枚 Key 查询
  aiConfigs.updateConfig(db, log, relay.id, { is_default: false, is_active: false });
  const replacement = aiConfigs.createConfig(db, log, {
    service_type: 'video', provider: 'richbest', name: 'relay-2', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_rotated', model: ['doubao-seedance-2.0'], default_model: 'doubao-seedance-2.0', is_default: true,
  });
  const seen = [];
  const originalPoll = videoClient.pollVideoTask;
  videoClient.pollVideoTask = async (_db, _log, _id, _task, config) => {
    seen.push(config.api_key);
    return { error: 'fixture stop' };
  };
  try {
    await videoService.resumePollForVideoGeneration(db, log, pinnedRow);
    assert.deepEqual(seen, ['vap_live_relay'], '不得用轮换后的 Key 查询旧任务');

    // 原配置被彻底删除：保持 processing 并留住宿预授权，等管理员恢复后自动继续
    db.prepare('UPDATE ai_service_configs SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), relay.id);
    const stranded = seedRow(db, { model: 'doubao-seedance-2.0', ai_config_id: relay.id });
    await videoService.resumePollForVideoGeneration(db, log, stranded);
    const paused = db.prepare('SELECT status, error_msg, provider_task_id FROM video_generations WHERE id = ?').get(stranded);
    assert.equal(paused.status, 'processing');
    assert.equal(paused.provider_task_id, 'vid_local_1');
    assert.match(paused.error_msg, /固定配置已删除/);
    assert.deepEqual(seen, ['vap_live_relay'], '暂停时不应改用另一枚 Key');

    // 历史行（无钉住值）仍按模型名解析，行为与改造前一致
    const legacy = seedRow(db, { model: 'doubao-seedance-2.0', ai_config_id: null });
    await videoService.resumePollForVideoGeneration(db, log, legacy);
    assert.deepEqual(seen, ['vap_live_relay', 'vap_live_rotated']);
  } finally {
    videoClient.pollVideoTask = originalPoll;
  }
  assert.equal(replacement.provider, 'richbest');
}));

test('user cancel uses the pinned config key, and a deleted pinned config refuses to cancel with another key', async () => await withDatabase(async (db) => {
  const relay = aiConfigs.createConfig(db, log, {
    service_type: 'video', provider: 'richbest', name: 'relay', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_relay', model: ['doubao-seedance-2.0'], default_model: 'doubao-seedance-2.0', is_default: true,
  });
  const generationId = seedRow(db, { model: 'doubao-seedance-2.0', ai_config_id: relay.id });
  const now = new Date().toISOString();
  const jobId = db.prepare('INSERT INTO omni_video_jobs (video_generation_id, prompt, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(generationId, '取消测试', now, now).lastInsertRowid;
  const actor = { id: 1, role: 'admin' };

  // 默认配置已轮换到另一枚业务 Key：取消仍必须使用建任务的那枚 Key
  aiConfigs.updateConfig(db, log, relay.id, { is_default: false });
  aiConfigs.createConfig(db, log, {
    service_type: 'video', provider: 'richbest', name: 'relay-2', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_rotated', model: ['doubao-seedance-2.0'], default_model: 'doubao-seedance-2.0', is_default: true,
  });
  const seenKeys = [];
  const originalCancel = videoClient.cancelVideoTask;
  videoClient.cancelVideoTask = async (config, _log, taskId) => {
    seenKeys.push(config.api_key);
    return { cancelled: true, provider_status: 'cancelled' };
  };
  try {
    await omniVideoService.cancelJob(db, log, jobId, actor);
  } finally {
    videoClient.cancelVideoTask = originalCancel;
  }
  assert.deepEqual(seenKeys, ['vap_live_relay'], '取消不得用轮换后的 Key');
  const cancelled = db.prepare('SELECT status, error_msg FROM video_generations WHERE id = ?').get(generationId);
  assert.equal(cancelled.status, 'failed');
  assert.match(cancelled.error_msg, /用户取消/);

  // 钉住的配置已被删除：宁可拒绝取消，也不换一枚 Key 去制造 video_task_not_found 假象
  db.prepare('UPDATE ai_service_configs SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), relay.id);
  const strandedId = seedRow(db, { model: 'doubao-seedance-2.0', ai_config_id: relay.id });
  const strandedJob = db.prepare('INSERT INTO omni_video_jobs (video_generation_id, prompt, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(strandedId, '取消测试', now, now).lastInsertRowid;
  const calls = [];
  videoClient.cancelVideoTask = async (config) => { calls.push(config.api_key); return { cancelled: true }; };
  try {
    await assert.rejects(() => omniVideoService.cancelJob(db, log, strandedJob, actor), /配置已被删除/);
  } finally {
    videoClient.cancelVideoTask = originalCancel;
  }
  assert.equal(calls.length, 0, '钉住配置缺失时绝不能拿别的 Key 发起取消');
  const untouched = db.prepare('SELECT status FROM video_generations WHERE id = ?').get(strandedId);
  assert.equal(untouched.status, 'processing', '取消被拒绝后任务状态必须保持不变');
}));

test('historical rows without a pinned config keep the legacy failure when no model is configured', async () => await withDatabase(async (db) => {
  const id = seedRow(db, { model: 'doubao-seedance-2.0', ai_config_id: null });
  await videoService.resumePollForVideoGeneration(db, log, id);
  const row = db.prepare('SELECT status, error_msg FROM video_generations WHERE id = ?').get(id);
  assert.equal(row.status, 'failed');
  assert.equal(row.error_msg, '未配置视频模型');
}));

test('连接测试提示「生成」与「素材库」两处业务 Key 是否同一个瑞池项目', async () => await withDatabase(async (db) => {
  // 中转站按业务 Key 隔离项目，且 /api/auth/me 不返回项目名：两处 Key 填成不同项目时
  // 只能在生成阶段以「素材不存在 / 模型未开通」暴露，所以连接测试要主动比对。
  aiConfigs.createConfig(db, log, {
    service_type: 'jimeng2_character_auth', provider: 'richbest_asset_v3', name: '素材库',
    base_url: 'https://api.richbest.cn', api_key: 'vap_live_asset_project',
  });
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    const payload = path === '/health' ? { status: 'ok' }
      : path === '/api/auth/me' ? { authenticated: true, apiKeyId: 'key-1' }
        : { object: 'list', data: [{ id: 'doubao-seedance-2.0', modality: 'video' }] };
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(payload),
    };
  };
  try {
    const same = await aiConfigs.testConnection({
      db, provider: 'richbest', base_url: 'https://api.richbest.cn', api_key: 'vap_live_asset_project',
      service_type: 'video', model: 'doubao-seedance-2.0',
    });
    assert.deepEqual(same.warnings, [], '同一个项目的 Key 不该报警');

    const different = await aiConfigs.testConnection({
      db, provider: 'richbest', base_url: 'https://api.richbest.cn', api_key: 'vap_live_other_project',
      service_type: 'video', model: 'doubao-seedance-2.0',
    });
    assert.equal(different.warnings.length, 1);
    assert.match(different.warnings[0], /jimeng2_character_auth/);
    assert.match(different.warnings[0], /同一个瑞池项目的 Key/);
  } finally {
    global.fetch = originalFetch;
  }
}));
