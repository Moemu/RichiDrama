const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const aiConfigs = require('../src/services/aiConfigService');
const catalog = require('../src/services/modelCatalogService');
const prices = require('../src/services/providerPriceService');
const billing = require('../src/services/billingService');

const log = { info() {}, warn() {}, error() {} };

async function withDatabase(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richbest-price-'));
  const db = getDb({ path: path.join(root, 'test.db'), type: 'sqlite' });
  try {
    runMigrationsAndEnsure(db);
    return await run(db);
  } finally {
    closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const PRICING = {
  object: 'list', month: '2026-09', currency: 'CNY', tax_inclusive: false, billing_enabled: true, discount_bps: 8000,
  data: [
    { id: 'glm-5.2', display_name: 'GLM 5.2', provider: 'volcengine_ark', modality: 'text', configured: true, prices: [
      { metric: 'input_tokens', dimension: null, unit_size: 1000000, list_price_yuan: '8.000000', effective_price_yuan: '6.400000' },
      { metric: 'cached_input_tokens', dimension: null, unit_size: 1000000, list_price_yuan: '2.000000', effective_price_yuan: '1.600000' },
      { metric: 'output_tokens', dimension: null, unit_size: 1000000, list_price_yuan: '28.000000', effective_price_yuan: '22.400000' },
    ] },
    { id: 'doubao-seedance-2.0', display_name: 'Doubao Seedance 2.0', modality: 'video', configured: true, prices: [
      { metric: 'video_duration', dimension: '720p_no_audio', unit_size: 1, list_price_yuan: '1.000000', effective_price_yuan: '0.800000' },
    ] },
    { id: 'doubao-seedance-2.0-fast', display_name: 'Doubao Seedance 2.0 Fast', modality: 'video', configured: true, prices: [
      { metric: 'video_duration', dimension: '720p_no_audio', unit_size: 1, list_price_yuan: '0.500000', effective_price_yuan: '0.400000' },
    ] },
    { id: 'doubao-seedasr-2.0', display_name: 'ASR', modality: 'audio', configured: false, prices: [] },
  ],
};

function relayResponse(body) {
  return {
    ok: true, status: 200,
    headers: { get: (name) => (String(name).toLowerCase() === 'x-request-id' ? 'req-price-1' : null) },
    text: async () => JSON.stringify(body || PRICING),
  };
}

function relayFetch(seen) {
  return async (url) => {
    seen.push(String(url));
    return relayResponse();
  };
}

function seedConfigs(db) {
  aiConfigs.createConfig(db, log, { service_type: 'text', provider: 'richbest', name: 'relay text', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_price', model: ['glm-5.2'], default_model: 'glm-5.2', is_default: true });
  // 同族别名必须在一张配置里，才能验证价格不会串到 -fast 上
  aiConfigs.createConfig(db, log, { service_type: 'video', provider: 'richbest', name: 'relay video', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_price', model: ['doubao-seedance-2.0', 'doubao-seedance-2.0-fast'], default_model: 'doubao-seedance-2.0', is_default: true });
  // 直连火山的带日期 SKU：中转价目绝不能落到它的 billing_key 上
  aiConfigs.createConfig(db, log, { service_type: 'video', provider: 'volcengine', name: 'direct volc', base_url: 'https://ark.example.test/api/v3',
    api_key: 'ark-key', model: ['doubao-seedance-2-0-260128'], default_model: 'doubao-seedance-2-0-260128', billing_key: 'doubao-seedance-2-0-260128' });
}

test('relay price sync maps metrics, keeps cached input unpriced and never touches the Volcengine SKU', async () => withDatabase(async (db) => {
  seedConfigs(db);
  const seen = [];
  const sync = await prices.sync(db, 1, { provider: 'richbest', fetchImpl: relayFetch(seen) });
  assert.deepEqual(seen, ['https://api.richbest.cn/v1/pricing']);
  assert.equal(sync.status, 'completed');
  const byKey = new Map(sync.candidates.map((row) => [`${row.provider_model}/${row.charge_type}`, row]));
  assert.equal(byKey.get('glm-5.2/input_tokens').new_unit_price_micro, 6400000, '¥6.4/百万 token → 6,400,000 微积分');
  assert.equal(byKey.get('glm-5.2/output_tokens').new_unit_price_micro, 22400000);
  assert.equal(byKey.get('glm-5.2/cached_input_tokens').mapping_status, 'unmapped');
  assert.match(byKey.get('glm-5.2/cached_input_tokens').error_summary, /按 input_token 全价/);
  assert.equal(byKey.get('doubao-seedasr-2.0/NotConfigured').mapping_status, 'unmapped');
  assert.equal(byKey.get('doubao-seedasr-2.0/NotConfigured').is_free, undefined);
  // 同族别名各自精确匹配
  assert.equal(byKey.get('doubao-seedance-2.0/video_duration').billing_key, 'doubao-seedance-2.0');
  assert.equal(byKey.get('doubao-seedance-2.0-fast/video_duration').billing_key, 'doubao-seedance-2.0-fast');
  assert.equal(sync.candidates.some((row) => row.billing_key === 'doubao-seedance-2-0-260128'), false, '绝不写到直连火山的 SKU 上');
  assert.equal(db.prepare('SELECT provider FROM provider_price_syncs WHERE id=?').get(sync.id).provider, 'richbest');
}));

test('a relay sync is unchanged on identical upstream pricing and locks per provider', async () => withDatabase(async (db) => {
  seedConfigs(db);
  const seen = [];
  const first = await prices.sync(db, 1, { provider: 'richbest', fetchImpl: relayFetch(seen) });
  const second = await prices.sync(db, 1, { provider: 'richbest', fetchImpl: relayFetch(seen) });
  assert.equal(second.status, 'unchanged');
  assert.equal(second.reused_from_sync_id, first.id);
  // 锁按 provider 分行：中转同步进行中只挡住中转，火山仍然可以并行
  let release;
  const pending = prices.sync(db, 1, { provider: 'richbest', fetchImpl: async () => {
    await new Promise((resolve) => { release = resolve; });
    return relayResponse();
  } });
  await assert.rejects(() => prices.sync(db, 1, { provider: 'richbest', fetchImpl: relayFetch(seen) }), /中转站价目同步正在运行/);
  await assert.rejects(() => prices.sync(db, 1, { provider: 'volcengine' }), /ModelArk/);
  release();
  await pending;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM provider_price_sync_locks').get().n, 0, '同步结束必须释放锁');
}));

test('relay candidates review, draft and publish without cloning the Volcengine book', async () => withDatabase(async (db) => {
  seedConfigs(db);
  const at = new Date('2020-01-01T00:00:00.000Z').toISOString();
  const volcBook = db.prepare(`INSERT INTO billing_price_books (name,owner_user_id,status,effective_from,created_by,created_at,updated_at,version,system_managed,provider)
    VALUES ('火山引擎同步价目 v9',NULL,'published',?,1,?,?,9,1,'volcengine')`).run(at, at, at).lastInsertRowid;
  db.prepare(`INSERT INTO billing_price_book_items (price_book_id,service_type,model,meter,unit_price_micro,is_free,conditions_json,created_at,updated_at)
    VALUES (?, 'video', 'doubao-seedance-2-0-260128', 'second', 9990000, 0, '{}', ?, ?)`).run(volcBook, at, at);

  const sync = await prices.sync(db, 1, { provider: 'richbest', fetchImpl: relayFetch([]) });
  assert.throws(() => prices.createDraft(db, 1, sync.id), /未完成人工审核/);
  for (const row of sync.candidates) {
    prices.updateCandidate(db, 1, sync.id, row.id, row.mapping_status === 'mapped'
      ? { review_status: 'accepted', service_type: row.service_type, billing_key: row.billing_key, meter: row.meter, unit_size: row.unit_size, unit_price_micro: row.new_unit_price_micro }
      : { review_status: 'rejected' });
  }
  const draft = prices.createDraft(db, 1, sync.id);
  assert.equal(draft.provider, 'richbest');
  assert.match(draft.name, /^瑞池中转同步价目 v/);
  assert.equal(draft.parent_price_book_id, null, '不能把火山书当作父版本');
  const models = draft.items.map((item) => `${item.model}/${item.meter}`).sort();
  assert.deepEqual(models, ['doubao-seedance-2.0-fast/second', 'doubao-seedance-2.0/second', 'glm-5.2/input_token', 'glm-5.2/output_token']);
  const inputToken = draft.items.find((item) => item.meter === 'input_token');
  assert.equal(inputToken.unit_price_micro, 6400000, '¥6.4 按 1:1 落成 6,400,000 微积分');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM billing_price_book_items WHERE price_book_id=?').get(volcBook).n, 1, '火山书未被改写');

  const published = prices.publish(db, 1, draft.id, { confirm: true, reason: '上线中转价目', idempotency_key: 'relay-publish-1' });
  assert.equal(published.price_book.status, 'published');
  const notice = db.prepare('SELECT body FROM system_notices WHERE price_book_id=?').get(draft.id);
  assert.match(notice.body, /瑞池中转价格已完成审核/);
  assert.doesNotMatch(notice.body, /火山引擎账号价格/);

  // 发布后中转模型才真正可报价
  catalog.save(db, 1, { service_type: 'video', model: 'doubao-seedance-2.0', display_name: 'Doubao Seedance 2.0', status: 'active' }, log);
  const priced = billing.quote(db, { id: 1, role: 'admin' }, { service_type: 'video', model: 'doubao-seedance-2.0', usage: { second: 5 } });
  assert.equal(priced.usage.second, 5);
  assert.ok(priced.amount_micro > 0);
}));

const TEXT_ONLY_PRICING = { object: 'list', month: '2026-09', currency: 'CNY', tax_inclusive: false, billing_enabled: true, discount_bps: 8000, data: [
  { id: 'glm-5.2', display_name: 'GLM 5.2', provider: 'volcengine_ark', modality: 'text', configured: true, prices: [
    { metric: 'input_tokens', dimension: null, unit_size: 1000000, list_price_yuan: '8.000000', effective_price_yuan: '6.400000' },
    { metric: 'cached_input_tokens', dimension: null, unit_size: 1000000, list_price_yuan: '2.000000', effective_price_yuan: '1.600000' },
    { metric: 'output_tokens', dimension: null, unit_size: 1000000, list_price_yuan: '28.000000', effective_price_yuan: '22.400000' },
  ] },
] };

test('admin price routes take the source from the URL and keep the two sources apart', async () => {
  const f = await modelCatalogFixture();
  const originalFetch = global.fetch;
  try {
    const cookie = (await f.request('POST', '/auth/login', { username: f.admin.username, password: 'fixture-password' })).cookie;
    aiConfigs.createConfig(f.db, f.log, { service_type: 'text', provider: 'richbest', name: 'relay route', base_url: 'https://api.richbest.cn/v1',
      api_key: 'vap_live_route', model: ['glm-5.2'], default_model: 'glm-5.2', is_default: true });
    const urls = [];
    global.fetch = async (url, init) => {
      if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, init);
      urls.push(String(url));
      return new Response(JSON.stringify(TEXT_ONLY_PRICING), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req-route-1' } });
    };
    const relay = await f.request('POST', '/admin/provider-prices/richbest/sync', {}, cookie);
    assert.equal(relay.status, 200, JSON.stringify(relay.body));
    assert.equal(relay.body.data.provider, 'richbest');
    assert.deepEqual(urls, ['https://api.richbest.cn/v1/pricing'], 'URL 段决定同步哪个来源');
    assert.equal(f.db.prepare("SELECT id FROM provider_price_syncs WHERE status='failed'").get(), undefined, '失败批次不能来自另一个来源');
    // 火山路径仍是旧行为：只走方舟，缺 IAM 凭据时不会改用中转配置
    assert.match(JSON.stringify((await f.request('POST', '/admin/provider-prices/volcengine/sync', {}, cookie)).body), /ModelArk/);
    assert.equal((await f.request('POST', '/admin/provider-prices/openrouter/sync', {}, cookie)).status, 400, '未知来源必须拒绝');

    const sources = await f.request('GET', '/admin/provider-price-sources', undefined, cookie);
    assert.deepEqual(sources.body.data.map((row) => row.provider), ['volcengine', 'richbest']);
    assert.deepEqual(sources.body.data.map((row) => row.requires_source_check), [true, false]);
    // 中转来源没有方舟权限诊断
    assert.equal((await f.request('POST', '/admin/provider-prices/richbest/probe', {}, cookie)).status, 400);
    assert.equal((await f.request('GET', '/admin/provider-prices/richbest/probe', undefined, cookie)).body.data, null);
    f.db.prepare(`INSERT INTO provider_price_source_checks(provider,ark_status,billing_status,checked_at,detail_json,updated_at)
      VALUES ('volcengine','success','success','2026-09-20T00:00:00.000Z','{}','2026-09-20T00:00:00.000Z')`).run();
    assert.equal((await f.request('GET', '/admin/provider-prices/volcengine/probe', undefined, cookie)).body.data.ark_status, 'success');

    const filtered = await f.request('GET', '/admin/provider-price-syncs?provider=richbest&limit=10', undefined, cookie);
    assert.deepEqual(filtered.body.data.map((row) => row.provider), ['richbest']);
    assert.equal((await f.request('GET', '/admin/provider-price-syncs?provider=openai', undefined, cookie)).status, 400);
    const all = await f.request('GET', '/admin/provider-price-syncs?limit=10', undefined, cookie);
    assert.deepEqual(all.body.data.map((row) => row.provider), ['richbest'], '不带来源时保留列出全部来源的旧行为');

    for (const row of relay.body.data.candidates) {
      prices.updateCandidate(f.db, f.admin.id, relay.body.data.id, row.id, row.mapping_status === 'mapped'
        ? { review_status: 'accepted', service_type: row.service_type, billing_key: row.billing_key, meter: row.meter, unit_size: row.unit_size, unit_price_micro: row.new_unit_price_micro }
        : { review_status: 'rejected' });
    }
    const draft = prices.createDraft(f.db, f.admin.id, relay.body.data.id);
    assert.equal(draft.provider, 'richbest');
    assert.equal(draft.parent_price_book_id, null, '未标来源的旧价目书不能成为中转价目的父版本');
    const published = prices.publish(f.db, f.admin.id, draft.id, { confirm: true, reason: '路由验收', idempotency_key: 'relay-route-publish-1' });
    assert.equal(published.price_book.status, 'published');
    assert.match(f.db.prepare('SELECT body FROM system_notices WHERE price_book_id=?').get(draft.id).body, /瑞池中转/);
  } finally {
    global.fetch = originalFetch;
    await f.close();
  }
});
