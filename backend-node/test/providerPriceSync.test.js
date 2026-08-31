const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const billing = require('../src/services/billingService');
const configs = require('../src/services/aiConfigService');
const prices = require('../src/services/providerPriceService');

function setup() {
  const dbPath = path.join(os.tmpdir(), `local-mini-drama-provider-price-${Date.now()}-${Math.random()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  runMigrationsAndEnsure(db);
  const log = { info() {}, warn() {} };
  const admin = auth.ensureBootstrapAdmin(db, log);
  configs.createConfig(db, log, { service_type: 'model_ark_asset', provider: 'volcengine', name: 'asset-key', base_url: 'https://ark.cn-beijing.volcengineapi.com/api/v3', model: 'asset', is_default: true, settings: JSON.stringify({ access_key_id: 'AKLT_TEST_KEY', secret_access_key: 'TEST_SECRET', sign_region: 'cn-beijing', asset_group_id: 'group' }) });
  configs.createConfig(db, log, { service_type: 'text', provider: 'volcengine', name: 'seed-text', model: 'doubao-seed-1-6', billing_key: 'doubao-seed-1-6', is_default: true });
  return { db, dbPath, admin, log };
}

function teardown(dbPath) {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
}

function activationResponse() {
  return {
    ResponseMetadata: { RequestId: 'ark-request-1' },
    Result: { TotalCount: 1, PageNumber: 1, PageSize: 100, Items: [{ FoundationModelName: 'doubao-seed-1-6', DisplayName: 'Doubao Seed 1.6', State: 'Available', ChargeItems: [{ Price: 0.0008, UnitCode: '千 tokens', Type: 'InferencePrompt' }, { Price: 0.002, UnitCode: '千 tokens', Type: 'InferenceCompletion' }], MultiChargeItems: [] }] },
  };
}

test('Volcengine price units map to canonical meters and exact micro-points', () => {
  assert.equal(prices.chargeMeter('InferencePrompt', '千 tokens'), 'input_token');
  assert.equal(prices.chargeMeter('InferenceCompletion', '千 tokens'), 'output_token');
  assert.equal(prices.chargeMeter('Unknown', '千 tokens'), null);
  assert.equal(prices.sourceUnitSize('千 tokens', 'input_token'), 1000);
  assert.deepEqual(prices.normalizedPriceMicro(0.0008, 1000, 'input_token'), { micro: 800000, unitSize: 1000000 });
  assert.deepEqual(prices.providerBillSummary([{ ExpenseDate: '2026-08-30', InstanceName: 'model-a', Element: 'InferencePrompt', Count: '12', Unit: '千tokens', Price: '0.8', PriceUnit: '元/千tokens', Currency: 'CNY' }]), [{ date: '2026-08-30', model: 'model-a', charge_item: 'InferencePrompt', usage: '12', unit: '千tokens', unit_price: '0.8', price_unit: '元/千tokens', product: null, currency: 'CNY' }]);
  const handlers = require('../src/routes/admin')({}, { info() {}, warn() {} });
  assert.equal(typeof handlers.providerPriceSync, 'function');
  assert.equal(typeof handlers.providerPriceSyncDetail, 'function');
});

test('provider models not used by the platform stay only in the sanitized raw response', () => {
  const { db, dbPath } = setup();
  try {
    assert.deepEqual(prices.buildCandidateRows(db, { FoundationModelName: 'unused-provider-model', ChargeItems: [{ Type: 'Unknown', UnitCode: 'unknown', Price: 99 }] }), []);
  } finally { teardown(dbPath); }
});

test('native OpenAPI signature matches the installed Volcengine signer', () => {
  const Signer = require('@volcengine/openapi/lib/base/sign').default;
  const date = new Date('2026-08-31T02:00:00.000Z');
  const body = { PageNumber: 1, PageSize: 100, WithPrice: true };
  const native = prices.signedHeaders({ accessKeyId: 'AKLT_TEST_KEY', secretAccessKey: 'TEST_SECRET', region: 'cn-beijing', service: 'ark', action: 'ListModelActivations', version: '2024-01-01', body, date });
  const request = { pathname: '/', params: { Action: 'ListModelActivations', Version: '2024-01-01' }, region: 'cn-beijing', method: 'POST', body: native.bodyText, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Sha256': native.headers['X-Content-Sha256'] } };
  const signer = new Signer(request, 'ark');
  signer.addAuthorization({ accessKeyId: 'AKLT_TEST_KEY', secretKey: 'TEST_SECRET' }, date);
  assert.equal(native.headers.Authorization, request.headers.Authorization);
});

test('bill detail reconciliation reads every daily aggregate page', async () => {
  const offsets = [];
  const fetchImpl = async (_url, init) => {
    const offset = JSON.parse(init.body).Offset; offsets.push(offset);
    const count = offset === 0 ? 300 : 2;
    return { ok: true, status: 200, async text() { return JSON.stringify({ ResponseMetadata: { RequestId: `bill-${offset}` }, Result: { Total: 302, List: Array.from({ length: count }, (_, index) => ({ ExpenseDate: '2026-08-01', InstanceName: `model-${offset + index}`, Element: 'InferencePrompt', Count: '1' })) } }); } };
  };
  const result = await prices.fetchBillDetails({ accessKeyId: 'AK', secretAccessKey: 'SK', region: 'cn-beijing' }, '2026-08', { fetchImpl });
  assert.deepEqual(offsets, [0, 300]);
  assert.equal(result.rows.length, 302);
  assert.deepEqual(result.requestIds, ['bill-0', 'bill-300']);
});

test('verified platform models map complex account prices and exclude dated discounts', () => {
  const { db, dbPath, log } = setup();
  try {
    const modelConfigs = [
      ['image', 'doubao-seedream-5-0-260128'], ['storyboard_image', 'doubao-seedream-5-0-260128'],
      ['text', 'doubao-seed-2-0-lite-260428'], ['text', 'doubao-seed-2-1-pro-250528'], ['text', 'doubao-seed-2-1-turbo-250528'],
      ['video', 'doubao-seedance-1-5-pro-251215'], ['video', 'doubao-seedance-2-0-260128'], ['video', 'doubao-seedance-2-0-fast-260128'],
      ['video', 'doubao-seedance-2-0-mini-260615'], ['video', 'doubao-seedance-2-5-260628'],
    ];
    for (const [serviceType, model] of modelConfigs) configs.createConfig(db, log, { service_type: serviceType, provider: 'volcengine', name: `${serviceType}-${model}`, model, billing_key: model });
    const charge = (Type, Price, extra = {}) => ({ Type, Price, OriginalPrice: extra.OriginalPrice ?? Price, UnitCode: extra.UnitCode || '千tokens', ...extra });
    const item = (FoundationModelName, groups) => ({ FoundationModelName, MultiChargeItems: groups.map((ChargeItems) => ({ ChargeItems })) });
    const fixtures = [
      item('doubao-seedream-5-0', [[charge('I2ICompletion', 0.1716, { UnitCode: '张', OriginalPrice: 0.22 }), charge('T2ICompletion', 0.22, { UnitCode: '张' })]]),
      item('doubao-seed-2-0-lite', [
        [charge('InferencePrompt', 0.0006), charge('InferenceCompletion', 0.0036)],
        [charge('InferencePrompt', 0.0009), charge('InferenceCompletion', 0.0054)],
        [charge('InferencePrompt', 0.0018), charge('InferenceCompletion', 0.0108)],
      ]),
      item('doubao-seed-2-1-pro', [[charge('InferencePrompt', 0.006), charge('InferenceCompletion', 0.03)]]),
      item('doubao-seed-2-1-turbo', [[charge('InferencePrompt', 0.003), charge('InferenceCompletion', 0.015)]]),
      item('doubao-seedance-1-5-pro', [[charge('ToVSilentCompletion', 0.00624, { OriginalPrice: 0.008 }), charge('ToVCompletion', 0.016)]]),
      item('doubao-seedance-2-0', [[charge('V2VCompletion', 0.028), charge('NV2VCompletion', 0.046), charge('V2V1080Completion', 0.031), charge('NV2V1080Completion', 0.051), charge('V2V4KCompletion', 0.016), charge('NV2V4KCompletion', 0.026)]]),
      item('doubao-seedance-2-0-fast', [[charge('V2VCompletion', 0.0165, { OriginalPrice: 0.022 }), charge('NV2VCompletion', 0.02775, { OriginalPrice: 0.037 })]]),
      item('doubao-seedance-2-0-mini', [[charge('V2VCompletion', 0.0056, { OriginalPrice: 0.014, DiscountPriceStartTime: '2026-08-07T14:00:00+08:00', DiscountPriceEndTime: '2026-09-07T14:00:00+08:00' }), charge('NV2VCompletion', 0.0092, { OriginalPrice: 0.023, DiscountPriceStartTime: '2026-08-07T14:00:00+08:00', DiscountPriceEndTime: '2026-09-07T14:00:00+08:00' })]]),
      item('doubao-seedance-2-5', [[charge('V2VCompletion', 0.042), charge('NV2VCompletion', 0.07), charge('V2V1080Completion', 0.03312, { OriginalPrice: 0.046, DiscountPriceStartTime: '2026-08-14T14:00:00+08:00', DiscountPriceEndTime: '2026-09-17T14:00:00+08:00' }), charge('NV2V1080Completion', 0.05544, { OriginalPrice: 0.077, DiscountPriceStartTime: '2026-08-14T14:00:00+08:00', DiscountPriceEndTime: '2026-09-17T14:00:00+08:00' })]]),
    ];
    const rows = fixtures.flatMap((fixture) => prices.buildCandidateRows(db, fixture));
    assert.equal(rows.length, 13);
    assert.ok(rows.every((row) => row.mapping_status === 'mapped'));
    const image = rows.find((row) => row.service_type === 'image');
    assert.equal(image.new_unit_price_micro, 220000);
    assert.equal(JSON.parse(image.new_conditions_json).rates.find((rate) => rate.id === 'image_to_image').unit_price_points, 17.16);
    const liteInput = rows.find((row) => row.provider_model === 'doubao-seed-2-0-lite' && row.meter === 'input_token');
    assert.deepEqual(JSON.parse(liteInput.new_conditions_json).usage_tiers.map((tier) => tier.unit_price_points), [60, 90, 180]);
    const mini = rows.find((row) => row.provider_model === 'doubao-seedance-2-0-mini');
    assert.equal(mini.billing_key, 'doubao-seedance-2-0-mini-260615');
    assert.deepEqual(JSON.parse(mini.new_conditions_json).rates.map((rate) => rate.unit_price_points), [1400, 2300]);
    const seed25 = rows.find((row) => row.provider_model === 'doubao-seedance-2-5');
    assert.equal(seed25.billing_key, 'doubao-seedance-2-5-260628');
    assert.equal(JSON.parse(seed25.new_conditions_json).rates.find((rate) => rate.id === 'with_video_input_1080p').unit_price_points, 4600);
    const full = rows.find((row) => row.provider_model === 'doubao-seedance-2-0');
    assert.equal(JSON.parse(full.new_conditions_json).rates.find((rate) => rate.id === 'no_video_input_4k').unit_price_points, 2600);
  } finally { teardown(dbPath); }
});

test('image rate uses explicit image-input context', () => {
  const { db, dbPath, admin } = setup();
  try {
    billing.savePriceBook(db, admin.id, { name: 'image conditions', status: 'published', items: [{ service_type: 'image', model: 'seedream', meter: 'image', unit_price: 22, conditions_json: { unit_size: 1, default_rate_id: 'text_to_image', rates: [{ id: 'image_to_image', when: { has_image_input: true }, unit_price_points: 17.16, unit_size: 1 }, { id: 'text_to_image', when: { has_image_input: false }, unit_price_points: 22, unit_size: 1 }] } }] });
    const user = auth.createUser(db, { username: 'image-rate-user', password: 'creator123' }, admin.id);
    assert.equal(billing.quote(db, { id: user.id, role: 'user' }, { service_type: 'image', model: 'seedream', usage: { image: 1 }, pricing_context: { has_image_input: true } }).amount, 17.16);
    assert.equal(billing.quote(db, { id: user.id, role: 'user' }, { service_type: 'image', model: 'seedream', usage: { image: 1 }, pricing_context: { has_image_input: false } }).amount, 22);
  } finally { teardown(dbPath); }
});

test('price sync stores sanitized candidates and reuses an identical provider response', async () => {
  const { db, dbPath, admin } = setup();
  try {
    configs.createConfig(db, { info() {}, warn() {} }, { service_type: 'text', provider: 'volcengine', name: 'missing-model-config', model: 'doubao-not-returned-1-0', billing_key: 'doubao-not-returned-1-0', is_default: false });
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, headers: init.headers });
      return { ok: true, status: 200, async text() { return JSON.stringify(activationResponse()); } };
    };
    const first = await prices.sync(db, admin.id, { fetchImpl });
    assert.equal(first.status, 'completed');
    assert.equal(first.candidates.length, 3);
    assert.equal(first.candidates.filter((row) => row.mapping_status === 'mapped').length, 2);
    assert.match(first.candidates.find((row) => row.charge_type === 'MissingFromProvider').error_summary, /不会删除或停用/);
    assert.ok(!db.prepare('SELECT raw_response_json FROM provider_price_syncs WHERE id=?').get(first.id).raw_response_json.includes('TEST_SECRET'));
    assert.match(calls[0].headers.Authorization, /^HMAC-SHA256 Credential=AKLT_TEST_KEY\//);
    const second = await prices.sync(db, admin.id, { fetchImpl });
    assert.equal(second.status, 'unchanged');
    assert.equal(second.reused_from_sync_id, first.id);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM provider_price_candidates").get().count, 3);
  } finally { teardown(dbPath); }
});

test('reviewed provider prices publish atomically and notices persist per user', () => {
  const { db, dbPath, admin } = setup();
  try {
    const base = billing.savePriceBook(db, admin.id, { name: '火山引擎官方公开价目（测试）', status: 'published', items: [{ service_type: 'text', model: 'doubao-seed-1-6', meter: 'input_token', unit_price: 60, conditions_json: { provider: 'volcengine', unit_size: 1000000 } }, { service_type: 'text', model: 'doubao-seed-1-6', meter: 'output_token', unit_price: 200, conditions_json: { provider: 'volcengine', unit_size: 1000000 } }] });
    db.prepare('UPDATE billing_price_books SET system_managed=1 WHERE id=?').run(base.id);
    const user = auth.createUser(db, { username: 'price-notice-user', password: 'creator123' }, admin.id);
    billing.adjustBalance(db, admin.id, user.id, 1000, 'test');
    const oldAuthorization = billing.createAuthorization(db, { id: user.id, role: 'user' }, { idempotency_key: 'old-price', service_type: 'text', model: 'doubao-seed-1-6', usage: { input_token: 1000000 } });
    assert.equal(oldAuthorization.amount, 60);
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO provider_price_source_checks(provider,ark_status,billing_status,checked_at,updated_at) VALUES ('volcengine','success','success',?,?)`).run(at, at);
    const syncId = 'sync-reviewed';
    db.prepare(`INSERT INTO provider_price_syncs(id,provider,status,trigger_type,candidate_count,mapped_count,changed_count,created_at,updated_at) VALUES (?,'volcengine','completed','manual',1,1,1,?,?)`).run(syncId, at, at);
    db.prepare(`INSERT INTO provider_price_candidates(sync_id,provider,provider_model,display_name,charge_type,unit_code,currency,provider_unit_price,service_type,billing_key,meter,unit_size,new_unit_price_micro,new_conditions_json,conditions_changed,current_unit_price_micro,change_ratio,mapping_status,review_status,created_at,updated_at)
      VALUES (?,'volcengine','doubao-seed-1-6','Seed','InferencePrompt','千 tokens','CNY','0.0008','text','doubao-seed-1-6','input_token',1000000,800000,?,1,600000,0.3333,'mapped','accepted',?,?)`).run(syncId, JSON.stringify({ unit_size: 1000000, usage_tiers: [{ id: 'standard', selector_meter: 'input_token', min_inclusive: 0, max_inclusive: 1000000, unit_price_points: 80, unit_size: 1000000 }] }), at, at);
    const draft = prices.createDraft(db, admin.id, syncId);
    assert.equal(draft.status, 'draft');
    assert.equal(draft.items.find((item) => item.meter === 'input_token').conditions_json.usage_tiers[0].unit_price_points, 80);
    assert.throws(() => billing.savePriceBook(db, admin.id, { name: 'mutated', status: 'draft', items: draft.items }, base.id), /不可原地修改/);
    const published = prices.publish(db, admin.id, draft.id, { confirm: true, reason: 'test publish', idempotency_key: 'publish-reviewed', notice_title: '价格变化', notice_body: '输入价格已经变化。' });
    assert.equal(published.price_book.status, 'published');
    assert.equal(db.prepare('SELECT status FROM billing_price_books WHERE id=?').get(base.id).status, 'archived');
    assert.equal(billing.settleAuthorization(db, { id: user.id, role: 'user' }, oldAuthorization.authorization_id, { usage: { input_token: 1000000 } }).charged, 60);
    assert.equal(billing.quote(db, { id: user.id, role: 'user' }, { service_type: 'text', model: 'doubao-seed-1-6', usage: { input_token: 1000000 } }).amount, 80);
    const notices = prices.activeNotices(db, user.id);
    assert.equal(notices.length, 1);
    prices.acknowledgeNotice(db, user.id, notices[0].id);
    assert.equal(prices.activeNotices(db, user.id).length, 0);
    const reused = prices.publish(db, admin.id, draft.id, { confirm: true, reason: 'again', idempotency_key: 'publish-reviewed' });
    assert.equal(reused.reused, true);
    const rolledBack = prices.rollback(db, admin.id, base.id, { confirm: true, reason: 'test rollback', idempotency_key: 'rollback-reviewed' });
    assert.equal(rolledBack.price_book.status, 'published');
    assert.equal(rolledBack.price_book.version, 3);
    assert.equal(billing.quote(db, { id: user.id, role: 'user' }, { service_type: 'text', model: 'doubao-seed-1-6', usage: { input_token: 1000000 } }).amount, 60);
    assert.equal(prices.listNotices(db).length, 2);
    prices.archiveNotice(db, admin.id, rolledBack.notice_id);
    assert.equal(prices.listNotices(db).find((item) => item.id === rolledBack.notice_id).status, 'archived');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM system_notice_acknowledgements').get().count, 1);
    const bookCount = db.prepare('SELECT COUNT(*) count FROM billing_price_books').get().count;
    assert.equal(prices.rollback(db, admin.id, base.id, { confirm: true, reason: 'test rollback again', idempotency_key: 'rollback-reviewed' }).reused, true);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM billing_price_books').get().count, bookCount);
  } finally { teardown(dbPath); }
});
