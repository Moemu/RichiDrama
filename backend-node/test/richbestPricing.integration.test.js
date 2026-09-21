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

/**
 * 结构与 dimension 取值全部取自 2026-09-20 的真实 /v1/pricing 响应
 * （test/helpers/richbestPricingLive.json）：只有 input_tokens / cached_input_tokens /
 * output_tokens / image 四种指标，list 与 effective 相等（该 key 无折扣），
 * 分档与条件价写在 dimension 上。
 */
const PRICING = {
  object: 'list', data: [
    { id: 'glm-5.2', object: 'model_price', display_name: 'GLM 5.2', provider: 'volcengine_ark', modality: 'text', currency: 'CNY', tax_inclusive: false, configured: true, prices: [
      { metric: 'input_tokens', dimension: null, unit_size: 1000000, list_price_yuan: '8.000000', effective_price_yuan: '8.000000' },
      { metric: 'cached_input_tokens', dimension: null, unit_size: 1000000, list_price_yuan: '2.000000', effective_price_yuan: '2.000000' },
      { metric: 'output_tokens', dimension: null, unit_size: 1000000, list_price_yuan: '28.000000', effective_price_yuan: '28.000000' },
    ] },
    { id: 'doubao-seed-2.0-code', object: 'model_price', display_name: 'Doubao Seed 2.0 Code', modality: 'text', currency: 'CNY', tax_inclusive: false, configured: true, prices: [
      { metric: 'input_tokens', dimension: 'tokens:0-32000', unit_size: 1000000, list_price_yuan: '3.200000', effective_price_yuan: '3.200000' },
      { metric: 'input_tokens', dimension: 'tokens:32001-128000', unit_size: 1000000, list_price_yuan: '4.800000', effective_price_yuan: '4.800000' },
      { metric: 'input_tokens', dimension: 'tokens:128001-256000', unit_size: 1000000, list_price_yuan: '9.600000', effective_price_yuan: '9.600000' },
      { metric: 'cached_input_tokens', dimension: 'tokens:0-32000', unit_size: 1000000, list_price_yuan: '0.640000', effective_price_yuan: '0.640000' },
      { metric: 'cached_input_tokens', dimension: 'tokens:32001-128000', unit_size: 1000000, list_price_yuan: '0.960000', effective_price_yuan: '0.960000' },
      { metric: 'cached_input_tokens', dimension: 'tokens:128001-256000', unit_size: 1000000, list_price_yuan: '1.920000', effective_price_yuan: '1.920000' },
      { metric: 'output_tokens', dimension: 'tokens:0-32000', unit_size: 1000000, list_price_yuan: '16.000000', effective_price_yuan: '16.000000' },
      { metric: 'output_tokens', dimension: 'tokens:32001-128000', unit_size: 1000000, list_price_yuan: '24.000000', effective_price_yuan: '24.000000' },
      { metric: 'output_tokens', dimension: 'tokens:128001-256000', unit_size: 1000000, list_price_yuan: '48.000000', effective_price_yuan: '48.000000' },
    ] },
    { id: 'doubao-seedance-2.0', object: 'model_price', display_name: 'Doubao Seedance 2.0', modality: 'video', currency: 'CNY', tax_inclusive: false, configured: true, prices: [
      { metric: 'output_tokens', dimension: '480p:video', unit_size: 1000000, list_price_yuan: '28.000000', effective_price_yuan: '28.000000' },
      { metric: 'output_tokens', dimension: '480p:no_video', unit_size: 1000000, list_price_yuan: '46.000000', effective_price_yuan: '46.000000' },
      { metric: 'output_tokens', dimension: '720p:video', unit_size: 1000000, list_price_yuan: '28.000000', effective_price_yuan: '28.000000' },
      { metric: 'output_tokens', dimension: '720p:no_video', unit_size: 1000000, list_price_yuan: '46.000000', effective_price_yuan: '46.000000' },
      { metric: 'output_tokens', dimension: '1080p:video', unit_size: 1000000, list_price_yuan: '31.000000', effective_price_yuan: '31.000000' },
      { metric: 'output_tokens', dimension: '1080p:no_video', unit_size: 1000000, list_price_yuan: '51.000000', effective_price_yuan: '51.000000' },
    ] },
    { id: 'doubao-seedance-2.0-fast', object: 'model_price', display_name: 'Doubao Seedance 2.0 Fast', modality: 'video', currency: 'CNY', tax_inclusive: false, configured: true, prices: [
      { metric: 'output_tokens', dimension: '480p:video', unit_size: 1000000, list_price_yuan: '16.500000', effective_price_yuan: '16.500000' },
      { metric: 'output_tokens', dimension: '480p:no_video', unit_size: 1000000, list_price_yuan: '27.750000', effective_price_yuan: '27.750000' },
      { metric: 'output_tokens', dimension: '720p:video', unit_size: 1000000, list_price_yuan: '16.500000', effective_price_yuan: '16.500000' },
      { metric: 'output_tokens', dimension: '720p:no_video', unit_size: 1000000, list_price_yuan: '27.750000', effective_price_yuan: '27.750000' },
    ] },
    { id: 'doubao-seedream-5.0-pro', object: 'model_price', display_name: 'Doubao Seedream 5.0 Pro', modality: 'image', currency: 'CNY', tax_inclusive: false, configured: true, prices: [
      { metric: 'image', dimension: 'output:le2610000', unit_size: 1, list_price_yuan: '0.300000', effective_price_yuan: '0.300000' },
      { metric: 'image', dimension: 'output:gt2610000', unit_size: 1, list_price_yuan: '0.600000', effective_price_yuan: '0.600000' },
      { metric: 'image', dimension: 'input:after_first', unit_size: 1, list_price_yuan: '0.020000', effective_price_yuan: '0.020000' },
    ] },
    { id: 'doubao-seedasr-2.0', object: 'model_price', display_name: 'ASR', modality: 'audio', currency: 'CNY', tax_inclusive: false, configured: false, prices: [] },
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
    api_key: 'vap_live_price', model: ['glm-5.2', 'doubao-seed-2.0-code'], default_model: 'glm-5.2', is_default: true });
  // 同族别名必须在一张配置里，才能验证价格不会串到 -fast 上
  aiConfigs.createConfig(db, log, { service_type: 'video', provider: 'richbest', name: 'relay video', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_price', model: ['doubao-seedance-2.0', 'doubao-seedance-2.0-fast'], default_model: 'doubao-seedance-2.0', is_default: true });
  aiConfigs.createConfig(db, log, { service_type: 'image', provider: 'richbest', name: 'relay image', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_price', model: ['doubao-seedream-5.0-pro'], default_model: 'doubao-seedream-5.0-pro', is_default: true });
  // 直连火山的带日期 SKU：中转价目绝不能落到它的 billing_key 上
  aiConfigs.createConfig(db, log, { service_type: 'video', provider: 'volcengine', name: 'direct volc', base_url: 'https://ark.example.test/api/v3',
    api_key: 'ark-key', model: ['doubao-seedance-2-0-260128'], default_model: 'doubao-seedance-2-0-260128', billing_key: 'doubao-seedance-2-0-260128' });
}

const rowOf = (rows, model, chargeType) => rows.find((row) => row.provider_model === model && row.charge_type === chargeType);
const jsonOf = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const conditionsOf = (row) => jsonOf(row.new_conditions_json);

test('relay price sync compiles dimensions into tiers and rates instead of collapsing them', async () => withDatabase(async (db) => {
  seedConfigs(db);
  const seen = [];
  const sync = await prices.sync(db, 1, { provider: 'richbest', fetchImpl: relayFetch(seen) });
  assert.deepEqual(seen, ['https://api.richbest.cn/v1/pricing']);
  assert.equal(sync.status, 'completed');
  // 25 条上游价格 → 10 条候选：同一计量的分档必须编译成一条完整价目。
  assert.equal(sync.candidate_count, 10);
  assert.equal(sync.mapped_count, 9);
  const rows = sync.candidates;

  const plain = rowOf(rows, 'glm-5.2', 'input_tokens');
  assert.equal(plain.new_unit_price_micro, 8000000, '¥8/百万 token → 8,000,000 微积分（1:1，无折扣）');
  assert.equal(plain.unit_size, 1000000);
  const plainConditions = conditionsOf(plain);
  assert.equal(plainConditions.usage_tiers, undefined);
  assert.equal(plainConditions.rates, undefined);
  assert.equal(plainConditions.tax_inclusive, false);
  assert.equal(plainConditions.currency, 'CNY');

  const inputTiers = rowOf(rows, 'doubao-seed-2.0-code', 'input_tokens（3 档）');
  assert.deepEqual(conditionsOf(inputTiers).usage_tiers, [
    { id: 'tokens:0-32000', selector_meter: 'total_input_token', min_inclusive: 0, max_inclusive: 32000, unit_price_points: '320', unit_size: 1000000 },
    { id: 'tokens:32001-128000', selector_meter: 'total_input_token', min_inclusive: 32001, max_inclusive: 128000, unit_price_points: '480', unit_size: 1000000 },
    { id: 'tokens:128001-256000', selector_meter: 'total_input_token', min_inclusive: 128001, max_inclusive: 256000, unit_price_points: '960', unit_size: 1000000 },
  ], '三档价格必须完整落到 usage_tiers，不能只留一条');
  assert.equal(rowOf(rows, 'doubao-seed-2.0-code', 'output_tokens（3 档）').new_unit_price_micro, 16000000);
  assert.equal(inputTiers.unit_code, '百万tokens');
  const cached = rowOf(rows, 'doubao-seed-2.0-code', 'cached_input_tokens（3 档）');
  assert.equal(cached.meter, 'cache_token');
  assert.equal(conditionsOf(cached).usage_tiers.length, 3);
  assert.ok(conditionsOf(cached).usage_tiers.every((tier) => tier.selector_meter === 'total_input_token'));
  assert.equal(cached.unit_code, '百万tokens');

  const video = rowOf(rows, 'doubao-seedance-2.0', 'output_tokens（6 条件）');
  const videoRates = conditionsOf(video).rates;
  assert.equal(videoRates.length, 6);
  assert.equal(video.meter, 'output_token', '中转视频按输出 token 计价，内部没有 second 这条上游指标');
  assert.deepEqual(videoRates.find((rate) => rate.when.resolution === '1080p' && rate.when.has_video_input === false),
    { id: '1080p:no_video', when: { resolution: '1080p', has_video_input: false }, unit_price_points: '5100', unit_size: 1000000 });
  assert.equal(video.new_unit_price_micro, 51000000, '缺少上下文时退回最贵档位，宁可多冻结也不漏收');
  const fast = rowOf(rows, 'doubao-seedance-2.0-fast', 'output_tokens（4 条件）');
  assert.equal(fast.billing_key, 'doubao-seedance-2.0-fast', '同族别名各自精确匹配');
  assert.equal(rows.some((row) => row.billing_key === 'doubao-seedance-2-0-260128'), false, '绝不写到直连火山的 SKU 上');

  const image = rowOf(rows, 'doubao-seedream-5.0-pro', 'image（2 条件）');
  assert.deepEqual(conditionsOf(image).rates.map((rate) => [rate.when.pixel_band, rate.unit_price_points]), [['small', '30'], ['large', '60']]);
  assert.equal(image.unit_code, '张', '供应商价必须带计费单位，不能显示成"未知单位"');
  const afterFirst = rowOf(rows, 'doubao-seedream-5.0-pro', 'image（after_first）');
  assert.equal(afterFirst.mapping_status, 'unmapped');
  assert.match(afterFirst.error_summary, /首张输入图免费/);
  // 上游有、但本项目没导入的模型不进清单（与火山侧 buildCandidateRows 直接 return [] 同源）
  assert.equal(rows.some((row) => row.provider_model === 'doubao-seedasr-2.0'), false);
  assert.equal(db.prepare('SELECT provider FROM provider_price_syncs WHERE id=?').get(sync.id).provider, 'richbest');
}));

test('a relay model that is imported but missing upstream still surfaces as a warning row', async () => withDatabase(async (db) => {
  seedConfigs(db);
  aiConfigs.createConfig(db, log, { service_type: 'video', provider: 'richbest', name: 'relay extra', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_price', model: ['doubao-seedance-9.9'], default_model: 'doubao-seedance-9.9' });
  const sync = await prices.sync(db, 1, { provider: 'richbest', fetchImpl: relayFetch([]) });
  const missing = sync.candidates.filter((row) => row.charge_type === 'MissingFromProvider');
  assert.deepEqual(missing.map((row) => row.billing_key), ['doubao-seedance-9.9']);
  assert.equal(missing[0].mapping_status, 'unmapped');
  assert.match(missing[0].error_summary, /不会删除或停用当前价格/);
  // 提醒行不能被当成"已接受的价格变化"塞进草案，也不能卡住草案生成
  for (const row of sync.candidates) {
    prices.updateCandidate(db, 1, sync.id, row.id, row.mapping_status === 'mapped'
      ? { review_status: 'accepted', service_type: row.service_type, billing_key: row.billing_key, meter: row.meter, unit_size: row.unit_size, unit_price_micro: row.new_unit_price_micro }
      : { review_status: 'rejected' });
  }
  const draft = prices.createDraft(db, 1, sync.id);
  assert.equal(draft.items.some((item) => item.model === 'doubao-seedance-9.9'), false);
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
  assert.deepEqual(models, ['doubao-seed-2.0-code/cache_token', 'doubao-seed-2.0-code/input_token', 'doubao-seed-2.0-code/output_token', 'doubao-seedance-2.0-fast/output_token',
    'doubao-seedance-2.0/output_token', 'doubao-seedream-5.0-pro/image', 'glm-5.2/cache_token', 'glm-5.2/input_token', 'glm-5.2/output_token']);
  assert.equal(draft.items.find((item) => item.meter === 'input_token' && item.model === 'glm-5.2').unit_price_micro, 8000000, '¥8 按 1:1 落成 8,000,000 微积分');
  assert.equal(jsonOf(draft.items.find((item) => item.model === 'doubao-seed-2.0-code' && item.meter === 'input_token').conditions_json).usage_tiers.length, 3, '草稿必须带上分档条件');
  assert.equal(jsonOf(draft.items.find((item) => item.model === 'doubao-seedance-2.0').conditions_json).rates.length, 6, '草稿必须带上视频条件价');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM billing_price_book_items WHERE price_book_id=?').get(volcBook).n, 1, '火山书未被改写');

  const published = prices.publish(db, 1, draft.id, { confirm: true, reason: '上线中转价目', idempotency_key: 'relay-publish-1' });
  assert.equal(published.price_book.status, 'published');
  const notice = db.prepare('SELECT body FROM system_notices WHERE price_book_id=?').get(draft.id);
  assert.match(notice.body, /瑞池中转价格已完成审核/);
  assert.doesNotMatch(notice.body, /火山引擎账号价格/);

  // 发布后按真实档位/条件价命中，而不是取某一条代表价
  catalog.save(db, 1, { service_type: 'text', model: 'doubao-seed-2.0-code', display_name: 'Doubao Seed 2.0 Code', status: 'active' }, log);
  catalog.save(db, 1, { service_type: 'video', model: 'doubao-seedance-2.0', display_name: 'Doubao Seedance 2.0', status: 'active' }, log);
  catalog.save(db, 1, { service_type: 'image', model: 'doubao-seedream-5.0-pro', display_name: 'Doubao Seedream 5.0 Pro', status: 'active' }, log);
  const tiered = billing.quote(db, { id: 1, role: 'admin' }, { service_type: 'text', model: 'doubao-seed-2.0-code', usage: { input_token: 40000, output_token: 40000 } });
  assert.deepEqual(tiered.rates.map((rate) => rate.rate_id), ['tokens:32001-128000', 'tokens:32001-128000', 'tokens:32001-128000']);
  assert.equal(tiered.amount_micro, 1152000, '40k 落在 32001-128000 档：输入 480 + 输出 2400 积分/百万');
  const cachedSettlement = billing.snapshotCalculation(tiered, { input_token: 30000, cache_token: 10000, output_token: 40000 });
  assert.equal(cachedSettlement.amount_micro, 1113600, '总输入仍按 40k 选档，其中 10k 按缓存输入价结算');
  assert.deepEqual(cachedSettlement.usage, { input_token: 30000, cache_token: 10000, output_token: 40000 });
  assert.throws(() => billing.quote(db, { id: 1, role: 'admin' }, { service_type: 'text', model: 'doubao-seed-2.0-code', usage: { input_token: 300000 } }), /未覆盖/);
  const videoOut = billing.quote(db, { id: 1, role: 'admin' }, { service_type: 'video', model: 'doubao-seedance-2.0', usage: { output_token: 100000 }, pricing_context: { resolution: '720p', has_video_input: false } });
  assert.equal(videoOut.rates[0].rate_id, '720p:no_video');
  assert.equal(videoOut.amount_micro, 4600000, '¥46/百万 token × 10 万');
  const videoIn = billing.quote(db, { id: 1, role: 'admin' }, { service_type: 'video', model: 'doubao-seedance-2.0', usage: { output_token: 100000 }, pricing_context: { resolution: '480p', has_video_input: true } });
  assert.equal(videoIn.amount_micro, 2800000);
  const small = billing.quote(db, { id: 1, role: 'admin' }, { service_type: 'image', model: 'doubao-seedream-5.0-pro', usage: { image: 1 }, pricing_context: { pixel_band: 'small' } });
  assert.equal(small.amount_micro, 300000);
  const large = billing.quote(db, { id: 1, role: 'admin' }, { service_type: 'image', model: 'doubao-seedream-5.0-pro', usage: { image: 1 }, pricing_context: { pixel_band: 'large' } });
  assert.equal(large.amount_micro, 600000);
}));

const livePricing = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'helpers', 'richbestPricingLive.json'), 'utf8'));

test('a repeated relay sync compares against the published book instead of calling everything new', async () => withDatabase(async (db) => {
  seedConfigs(db);
  const first = await prices.sync(db, 1, { provider: 'richbest', fetchImpl: relayFetch([]) });
  for (const row of first.candidates) {
    prices.updateCandidate(db, 1, first.id, row.id, row.mapping_status === 'mapped'
      ? { review_status: 'accepted', service_type: row.service_type, billing_key: row.billing_key, meter: row.meter, unit_size: row.unit_size, unit_price_micro: row.new_unit_price_micro }
      : { review_status: 'rejected' });
  }
  const draft = prices.createDraft(db, 1, first.id);
  prices.publish(db, 1, draft.id, { confirm: true, reason: '首轮上线', idempotency_key: 'relay-baseline-1' });

  // 缓存价已是正式计费项，单价变化必须被识别。
  const cachedOnly = structuredClone(PRICING);
  cachedOnly.data[0].prices[1].effective_price_yuan = '9.900000';
  const second = await prices.sync(db, 1, { provider: 'richbest', fetchImpl: async () => relayResponse(cachedOnly) });
  assert.equal(second.status, 'completed');
  const secondMapped = second.candidates.filter((row) => row.mapping_status === 'mapped');
  assert.equal(secondMapped.filter((row) => !row.is_unchanged).length, 1);
  assert.equal(secondMapped.find((row) => !row.is_unchanged).meter, 'cache_token');
  assert.equal(second.changed_count, 1);

  // 改掉其中一个档位价：条件差异必须被识别出来，否则旧档位会一直留在生效价目里
  const tierChanged = structuredClone(PRICING);
  const target = tierChanged.data[1].prices.find((price) => price.metric === 'input_tokens' && price.dimension === 'tokens:32001-128000');
  target.effective_price_yuan = '5.000000'; target.list_price_yuan = '5.000000';
  const third = await prices.sync(db, 1, { provider: 'richbest', fetchImpl: async () => relayResponse(tierChanged) });
  const changed = third.candidates.find((row) => row.billing_key === 'doubao-seed-2.0-code' && row.meter === 'input_token');
  assert.equal(changed.is_unchanged, false);
  assert.equal(changed.conditions_changed, true, '档位价格变了，仅单价相同不能算无变化');
  assert.equal(third.changed_count, 1);
}));

test('the captured live /v1/pricing payload compiles every graded price without collapsing any', async () => withDatabase(async (db) => {
  const entries = livePricing();
  const relay = require('../src/services/richbestPricingService');
  aiConfigs.createConfig(db, log, { service_type: 'text', provider: 'richbest', name: 'live models', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_price', model: entries.map((entry) => entry.id), default_model: entries[0].id, is_default: true });
  const sync = await prices.sync(db, 1, { provider: 'richbest', fetchImpl: async () => relayResponse({ object: 'list', data: entries }) });
  assert.equal(sync.status, 'completed');
  // 真实响应 91 条价格：分档/条件必须编译成候选的 conditions，而不是被折叠或被丢掉
  assert.ok(sync.candidate_count > 0);
  const grouped = new Map();
  for (const row of sync.candidates.filter((item) => item.mapping_status === 'mapped')) {
    const key = `${row.provider_model}\u0000${row.meter}`;
    assert.equal(grouped.has(key), false, `同一 (模型, 计量) 只能有一条候选：${key}`);
    grouped.set(key, row);
  }
  const usableCount = new Map();
  for (const entry of entries) for (const price of entry.prices) {
    const meter = relay.METERS[price.metric];
    if (!meter || relay.parseDimension(meter, price.dimension).reason) continue;
    const key = `${entry.id}\u0000${meter}`;
    usableCount.set(key, (usableCount.get(key) || 0) + 1);
  }
  assert.deepEqual([...grouped.keys()].sort(), [...usableCount.keys()].sort(), '可编译的 (模型, 计量) 必须各自成一条候选');
  for (const [key, row] of grouped) {
    const conditions = JSON.parse(row.new_conditions_json);
    const compiled = (conditions.usage_tiers?.length || 0) + (conditions.rates?.length || 0) || 1;
    assert.equal(compiled, usableCount.get(key), `${key} 只编译进 ${compiled} 条，上游有 ${usableCount.get(key)} 条同计量价格`);
  }
  assert.equal([...grouped.values()].some((row) => row.meter === 'second'), false, '上游没有按时长计价的指标');
  const videoRow = grouped.get('doubao-seedance-2.0\u0000output_token');
  assert.deepEqual(JSON.parse(videoRow.new_conditions_json).rates.map((rate) => rate.id).sort(),
    ['1080p:no_video', '1080p:video', '480p:no_video', '480p:video', '720p:no_video', '720p:video']);
  const cachedRows = sync.candidates.filter((row) => row.mapping_status === 'mapped' && row.meter === 'cache_token');
  assert.ok(cachedRows.length > 0 && cachedRows.every((row) => row.charge_type.startsWith('cached_input_tokens') && row.unit_code === '百万tokens'));

  // 生成的条件价必须通过内部价目校验，否则发布后会在报价时炸开
  for (const row of grouped.values()) {
    const book = billing.savePriceBook(db, 1, { name: 'live 条件校验', status: 'draft', items: [{
      service_type: row.service_type, model: row.billing_key, meter: row.meter,
      unit_price: row.new_unit_price_micro / 10000, conditions_json: JSON.parse(row.new_conditions_json),
    }] });
    assert.ok(book.id);
  }
}));

const TEXT_ONLY_PRICING = { object: 'list', data: [
  { id: 'glm-5.2', object: 'model_price', display_name: 'GLM 5.2', provider: 'volcengine_ark', modality: 'text', currency: 'CNY', tax_inclusive: false, configured: true, prices: [
    { metric: 'input_tokens', dimension: null, unit_size: 1000000, list_price_yuan: '8.000000', effective_price_yuan: '8.000000' },
    { metric: 'cached_input_tokens', dimension: null, unit_size: 1000000, list_price_yuan: '2.000000', effective_price_yuan: '2.000000' },
    { metric: 'output_tokens', dimension: null, unit_size: 1000000, list_price_yuan: '28.000000', effective_price_yuan: '28.000000' },
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
