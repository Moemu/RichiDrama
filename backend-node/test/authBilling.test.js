const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const billing = require('../src/services/billingService');
const drama = require('../src/services/dramaService');
const sequences = require('../src/services/omniSequenceService');
const tools = require('../src/services/toolRunService');
const aiConfigs = require('../src/services/aiConfigService');
const aiClient = require('../src/services/aiClient');
const billingContext = require('../src/services/billingRequestContext');

function setup() {
  const dbPath = path.join(os.tmpdir(), `local-mini-drama-billing-${Date.now()}-${Math.random()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  runMigrationsAndEnsure(db);
  const log = { warn() {}, info() {} };
  const admin = auth.ensureBootstrapAdmin(db, log);
  return { db, dbPath, admin, log };
}

function teardown(dbPath) {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
}

test('billing freezes, caps settlement at the frozen amount, and rejects unpriced models', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'creator', password: 'creator123', display_name: 'Creator' }, admin.id);
    const actor = { id: user.id, role: 'user' };
    billing.savePriceBook(db, admin.id, { name: 'default', status: 'published', items: [{ service_type: 'image', model: 'seedream', meter: 'image', unit_price: 25 }] });
    billing.adjustBalance(db, admin.id, user.id, 200, 'test points');

    const authorization = billing.createAuthorization(db, actor, { idempotency_key: 'one-image', service_type: 'image', model: 'seedream', usage: { image: 1 } });
    assert.equal(authorization.amount_micro, 250000);
    assert.equal(authorization.amount, 25);
    assert.equal(billing.account(db, user.id).frozen_micro, 250000);
    const settled = billing.settleAuthorization(db, actor, authorization.authorization_id, { usage: { image: 2 }, provider_request_id: 'provider-image-1' });
    assert.equal(settled.charged_micro, 250000);
    assert.equal(settled.overage_micro, 250000);
    assert.equal(billing.account(db, user.id).balance_micro, 1750000);
    assert.equal(billing.account(db, user.id).frozen_micro, 0);
    assert.equal(billing.settleAuthorization(db, actor, authorization.authorization_id, { usage: { image: 1 } }).reused, true);
    assert.throws(() => billing.quote(db, actor, { service_type: 'image', model: 'unapproved', usage: { image: 1 } }), /未定价/);
    assert.throws(() => billing.quote(db, actor, { service_type: 'image', model: 'unpriced', usage: { image: 1 } }), /未定价/);
  } finally { teardown(dbPath); }
});

test('setting a balance targets the requested amount instead of adding to it', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'set-balance-user', password: '1' }, admin.id);
    billing.adjustBalance(db, admin.id, user.id, 200, 'initial credit');
    billing.setBalance(db, admin.id, user.id, 75, 'set target', { idempotency_key: 'correction-1' });
    billing.setBalance(db, admin.id, user.id, 75, 'retry target', { idempotency_key: 'correction-1' });
    assert.equal(billing.account(db, user.id).balance_micro, 750000);
    assert.equal(billing.account(db, user.id).total_recharged_micro, 2000000);
    const transaction = billing.listTransactions(db, { user_id: user.id })[0];
    assert.equal(transaction.type, 'adjustment');
    assert.equal(transaction.amount_micro, -1250000);
    assert.equal(transaction.snapshot.operation, 'set_balance');
    assert.equal(billing.listTransactions(db, { user_id: user.id }).filter((row) => row.idempotency_key === 'correction-1').length, 1);
  } finally { teardown(dbPath); }
});

test('admin grants are additive and idempotent while lifetime consumption remains independent', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'grant-idempotent-user', password: '1' }, admin.id);
    billing.adjustBalance(db, admin.id, user.id, 100, 'first grant', { operation: 'grant', idempotency_key: 'grant-1' });
    billing.adjustBalance(db, admin.id, user.id, 100, 'retry grant', { operation: 'grant', idempotency_key: 'grant-1' });
    const listed = billing.listUsers(db).find((row) => row.id === user.id);
    assert.equal(listed.balance, 100);
    assert.equal(listed.total_granted, 100);
    assert.equal(listed.total_consumed, 0);
    assert.throws(() => billing.adjustBalance(db, admin.id, user.id, 10, 'invalid debit', { operation: 'debit' }), /必须为负数/);
    billing.adjustBalance(db, admin.id, user.id, 5, '', { operation: 'grant', idempotency_key: 'blank-reason' });
    const blankReasonTransaction = billing.listTransactions(db, { user_id: user.id }).find((row) => row.idempotency_key === 'blank-reason');
    assert.equal(blankReasonTransaction.reason, '管理员余额调整');
  } finally { teardown(dbPath); }
});

test('billing, usage, and audit logs expose stable server-side pagination', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'paged-logs-user', password: '1' }, admin.id);
    billing.savePriceBook(db, admin.id, { name: 'paged logs price', status: 'published', items: [
      { service_type: 'image', model: 'paged-image', meter: 'image', unit_price: 1 },
    ] });
    billing.adjustBalance(db, admin.id, user.id, 100, 'pagination seed');
    for (let i = 0; i < 12; i += 1) {
      billing.adjustBalance(db, admin.id, user.id, 1, `audit page seed ${i}`);
    }
    for (let i = 0; i < 12; i += 1) {
      const actor = { id: user.id, role: 'user' };
      const authorization = billing.createAuthorization(db, actor, {
        idempotency_key: `paged-log-${i}`, service_type: 'image', model: 'paged-image', usage: { image: 1 },
      });
      billing.settleAuthorization(db, actor, authorization.authorization_id, { usage: { image: 1 }, provider_request_id: `page-${i}` });
    }

    const transactions = billing.pagedTransactions(db, { user_id: user.id, page: 2, page_size: 10 });
    assert.equal(transactions.page, 2);
    assert.equal(transactions.page_size, 10);
    assert.ok(transactions.total >= 25);
    assert.equal(transactions.items.length, 10);
    assert.notEqual(transactions.items[0].id, billing.pagedTransactions(db, { user_id: user.id, page: 1, page_size: 10 }).items[0].id);

    const usage = billing.pagedUsage(db, { user_id: user.id, page: 2, page_size: 10 });
    assert.equal(usage.total, 12);
    assert.equal(usage.items.length, 2);
    assert.equal(usage.items[0].username, 'paged-logs-user');

    const audits = billing.pagedAuditLogs(db, { page: 2, page_size: 10 });
    assert.ok(audits.total >= 14);
    assert.ok(audits.items.length > 0 && audits.items.length <= 10);
    assert.ok(audits.items.every((row) => row.actor_username));
  } finally { teardown(dbPath); }
});

test('expired reconciliation releases the frozen authorization and leaves an audit trail', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'reconcile-expire', password: '1' }, admin.id);
    billing.savePriceBook(db, admin.id, { name: 'reconcile price', status: 'published', items: [
      { service_type: 'text', model: 'reconcile-model', meter: 'input_token', unit_price: 2 },
    ] });
    billing.adjustBalance(db, admin.id, user.id, 100, 'test points');
    const authorization = billing.createAuthorization(db, user, {
      idempotency_key: 'reconcile-expire', service_type: 'text', model: 'reconcile-model', usage: { input_token: 10 },
    });
    const pending = billing.markPendingReconciliation(db, user, authorization.authorization_id, {
      due_at: '2000-01-01T00:00:00.000Z', reason: 'test missing usage',
    });
    assert.equal(billing.expireReconciliationCases(db, admin.id).expired, 1);
    assert.equal(billing.account(db, user.id).frozen_micro, 0);
    assert.equal(billing.listReconciliationCases(db, { user_id: user.id })[0].status, 'expired');
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing_audit_logs WHERE target_id = ? AND action = 'billing.reconciliation.expired'").get(pending.id).count, 1);
  } finally { teardown(dbPath); }
});

test('three pending reconciliations for one model rate-limit later calls', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'reconcile-limit', password: '1' }, admin.id);
    billing.savePriceBook(db, admin.id, { name: 'reconcile limit price', status: 'published', items: [
      { service_type: 'text', model: 'reconcile-limit-model', meter: 'input_token', unit_price: 1 },
    ] });
    billing.adjustBalance(db, admin.id, user.id, 100, 'test points');
    for (let i = 0; i < 3; i += 1) {
      const authorization = billing.createAuthorization(db, user, {
        idempotency_key: `reconcile-limit-${i}`, service_type: 'text', model: 'reconcile-limit-model', usage: { input_token: 1 },
      });
      billing.markPendingReconciliation(db, user, authorization.authorization_id);
    }
    assert.throws(() => billing.createAuthorization(db, user, {
      idempotency_key: 'reconcile-limit-blocked', service_type: 'text', model: 'reconcile-limit-model', usage: { input_token: 1 },
    }), /待对账调用/);
  } finally { teardown(dbPath); }
});

test('passwords have no format rule beyond being non-empty', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'short-password-user', password: '1' }, admin.id);
    assert.ok(user.id);
    assert.ok(auth.login(db, 'short-password-user', '1'));
    assert.throws(() => auth.createUser(db, { username: 'empty-password-user', password: '' }, admin.id), /密码不能为空/);
  } finally { teardown(dbPath); }
});

test('self registration creates a normal user and an authenticated session', () => {
  const { db, dbPath } = setup();
  try {
    const session = auth.register(db, { username: 'new-creator', password: '1', display_name: 'New Creator' });
    assert.equal(session.user.username, 'new-creator');
    assert.equal(session.user.role, 'user');
    assert.ok(auth.authenticate(db, session.token));
  } finally { teardown(dbPath); }
});

test('a user can change a unique username and receives a session for the new identity', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'original-name', password: '1' }, admin.id);
    const changed = auth.changeUsername(db, user.id, 'renamed-user');
    const session = auth.issueSession(db, changed);
    assert.equal(changed.username, 'renamed-user');
    assert.equal(auth.login(db, 'original-name', '1'), null);
    assert.equal(auth.authenticate(db, session.token).username, 'renamed-user');
    assert.throws(() => auth.changeUsername(db, admin.id, 'renamed-user'), /已被使用/);
  } finally { teardown(dbPath); }
});

test('published price books require explicit, positive or free prices', () => {
  const { db, dbPath, admin } = setup();
  try {
    assert.throws(() => billing.savePriceBook(db, admin.id, { name: 'empty', status: 'published', items: [] }), /至少需要一个价目/);
    assert.throws(() => billing.savePriceBook(db, admin.id, {
      name: 'implicit free', status: 'published', items: [{ service_type: 'image', model: 'image-model', meter: 'image', unit_price: 0 }],
    }), /显式勾选免费/);
    const book = billing.savePriceBook(db, admin.id, {
      name: 'explicit free', status: 'published', items: [{ service_type: 'image', model: 'image-model', meter: 'image', unit_price: 0, is_free: true }],
    });
    assert.equal(book.status, 'published');
  } finally { teardown(dbPath); }
});

test('conditional video token rates use integer points with no floating point drift', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'video-creator', password: '1' }, admin.id);
    billing.savePriceBook(db, admin.id, {
      name: 'video official', status: 'published', items: [{
        service_type: 'video', model: 'seedance', meter: 'input_token', unit_price: 4600,
        conditions_json: { unit_size: 1000000, default_rate_id: 'no_video', rates: [
          { id: 'with_video', when: { has_video_input: true }, unit_price_points: 2800, unit_size: 1000000 },
          { id: 'no_video', when: { has_video_input: false }, unit_price_points: 4600, unit_size: 1000000 },
        ] },
      }],
    });
    assert.equal(billing.quote(db, user, { service_type: 'video', model: 'seedance', usage: { input_token: 250000 }, pricing_context: { has_video_input: true } }).amount_micro, 7000000);
    assert.equal(billing.quote(db, user, { service_type: 'video', model: 'seedance', usage: { input_token: 250000 }, pricing_context: { has_video_input: false } }).amount_micro, 11500000);
    assert.throws(() => billing.quote(db, user, { service_type: 'video', model: 'seedance', usage: { input_token: 1.5 } }), /整数/);
  } finally { teardown(dbPath); }
});

test('conditional video rates prefer the most specific matching rule and reject ambiguity', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'specific-video-rate-user', password: '1' }, admin.id);
    billing.savePriceBook(db, admin.id, {
      name: 'specific video rates', status: 'published', items: [{
        service_type: 'video', model: 'specific-seedance', meter: 'output_token', unit_price: 4600,
        conditions_json: { unit_size: 1000000, rates: [
          { id: 'generic', when: { has_video_input: true }, unit_price_points: 2800, unit_size: 1000000 },
          { id: 'specific-1080p', when: { has_video_input: true, resolution: '1080p' }, unit_price_points: 3100, unit_size: 1000000 },
        ] },
      }],
    });
    assert.equal(billing.quote(db, user, { service_type: 'video', model: 'specific-seedance', usage: { output_token: 1000000 }, pricing_context: { has_video_input: true, resolution: '1080p', has_audio: false } }).amount_micro, 31000000);
    assert.throws(() => billing.savePriceBook(db, admin.id, {
      name: 'ambiguous video rates', status: 'published', items: [{
        service_type: 'video', model: 'ambiguous-seedance', meter: 'output_token', unit_price: 1,
        conditions_json: { rates: [
          { id: 'a', when: { has_video_input: true }, unit_price_points: 1, unit_size: 1 },
          { id: 'b', when: { has_video_input: true }, unit_price_points: 2, unit_size: 1 },
        ] },
      }],
    }), /相同优先级/);
  } finally { teardown(dbPath); }
});

test('token price tiers use only canonical usage and reject uncovered ranges', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'tiered-text-user', password: '1' }, admin.id);
    const tiers = [
      { id: 'up-to-32k', selector_meter: 'input_token', min_inclusive: 0, max_inclusive: 32000, unit_price_points: 10, unit_size: 1000000 },
      { id: '32k-to-50k', selector_meter: 'input_token', min_inclusive: 32001, max_inclusive: 50000, unit_price_points: 20, unit_size: 1000000 },
    ];
    billing.savePriceBook(db, admin.id, { name: 'tiered text', status: 'published', items: [
      { service_type: 'text', model: 'tiered-text', meter: 'input_token', unit_price: 10, conditions_json: { unit_size: 1000000, usage_tiers: tiers } },
      { service_type: 'text', model: 'tiered-text', meter: 'output_token', unit_price: 10, conditions_json: { unit_size: 1000000, usage_tiers: tiers } },
    ] });
    billing.adjustBalance(db, admin.id, user.id, 100, 'test points');
    const authorization = billing.createAuthorization(db, user, {
      idempotency_key: 'tier-reservation', service_type: 'text', model: 'tiered-text', usage: { input_token: 40000, output_token: 1000 },
    });
    assert.equal(authorization.amount_micro, 8200);
    const settled = billing.settleAuthorization(db, user, authorization.authorization_id, { usage: { input_token: 1000, output_token: 100 } });
    assert.equal(settled.charged_micro, 110);
    assert.throws(() => billing.quote(db, user, {
      service_type: 'text', model: 'tiered-text', usage: { input_token: 50001, output_token: 1 },
    }), /价目未覆盖实际/);
  } finally { teardown(dbPath); }
});

test('micro-points preserve a non-zero charge for low token usage', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'small-usage-user', password: '1' }, admin.id);
    billing.savePriceBook(db, admin.id, { name: 'low token price', status: 'published', items: [
      { service_type: 'text', model: 'low-token', meter: 'input_token', unit_price: 60, conditions_json: { unit_size: 1000000 } },
    ] });
    const quote = billing.quote(db, user, { service_type: 'text', model: 'low-token', usage: { input_token: 4056 } });
    assert.equal(quote.amount_micro, 2434);
    assert.equal(quote.amount, 0.2434);
  } finally { teardown(dbPath); }
});

test('billing precision migration is idempotent after the ledger is converted', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'precision-migration-user', password: '1' }, admin.id);
    billing.adjustBalance(db, admin.id, user.id, 12.3456, 'exact balance');
    const before = billing.account(db, user.id).balance_micro;
    runMigrationsAndEnsure(db);
    assert.equal(billing.account(db, user.id).balance_micro, before);
    assert.equal(billing.publicAccount(billing.account(db, user.id)).balance, 12.3456);
    const seedream = db.prepare(`SELECT unit_price_micro FROM billing_price_book_items
      WHERE service_type='image' AND model='doubao-seedream-5-0-260128' AND meter='image' LIMIT 1`).get();
    assert.equal(seedream.unit_price_micro, 220000);
    assert.equal(billing.quote(db, user, {
      service_type: 'image', model: 'doubao-seedream-5-0-260128', usage: { image: 1 },
    }).amount, 22);
    const interpolation = db.prepare(`SELECT unit_price_micro FROM billing_price_book_items
      WHERE service_type='video_postprocess' AND model='volcengine-video-frame-interpolation' AND meter='millisecond' LIMIT 1`).get();
    const enhancement = db.prepare(`SELECT unit_price_micro FROM billing_price_book_items
      WHERE service_type='video_postprocess' AND model='volcengine-video-generative-enhancement' AND meter='millisecond' LIMIT 1`).get();
    assert.equal(interpolation.unit_price_micro, 1200000);
    assert.equal(enhancement.unit_price_micro, 10000000);
    assert.equal(billing.quote(db, user, {
      service_type: 'video_postprocess', model: 'volcengine-video-frame-interpolation', usage: { millisecond: 60000 },
      pricing_context: { resolution_tier: '1080p', fps_tier: 'lte60' },
    }).amount, 240);
    assert.equal(billing.quote(db, user, {
      service_type: 'video_postprocess', model: 'volcengine-video-generative-enhancement', usage: { millisecond: 60000 },
      pricing_context: { resolution_tier: '1080p', fps_tier: 'lte30' },
    }).amount, 500);
  } finally { teardown(dbPath); }
});

test('creator model list never exposes provider credentials', () => {
  const { db, dbPath } = setup();
  try {
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO ai_service_configs (service_type, provider, name, base_url, api_key, model, priority, is_default, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('text', 'openai', 'Text model', 'https://provider.example/v1', 'secret-key', '["model-a"]', 1, 1, 1, at, at);
    const config = aiConfigs.listPublicConfigs(db, 'text')[0];
    assert.deepEqual(config.model, ['model-a']);
    assert.equal(Object.hasOwn(config, 'api_key'), false);
    assert.equal(Object.hasOwn(config, 'base_url'), false);
  } finally { teardown(dbPath); }
});

test('custom provider billing keys isolate identical provider model names', () => {
  const { db, dbPath, admin, log } = setup();
  try {
    const first = aiConfigs.createConfig(db, log, { service_type: 'image', provider: 'custom_a', name: 'A', base_url: 'https://a.example', api_key: 'a', model: ['shared-model'], billing_key: 'custom-a-image', is_default: true });
    const second = aiConfigs.createConfig(db, log, { service_type: 'image', provider: 'custom_b', name: 'B', base_url: 'https://b.example', api_key: 'b', model: ['shared-model'], billing_key: 'custom-b-image' });
    billing.savePriceBook(db, admin.id, { name: 'custom prices', status: 'published', items: [
      { service_type: 'image', model: 'custom-a-image', meter: 'image', unit_price: 10 },
      { service_type: 'image', model: 'custom-b-image', meter: 'image', unit_price: 20 },
    ] });
    const a = aiConfigs.resolveBillingTarget(db, 'image', 'shared-model', first.id);
    const b = aiConfigs.resolveBillingTarget(db, 'image', 'shared-model', second.id);
    assert.equal(a.billing_key, 'custom-a-image');
    assert.equal(b.billing_key, 'custom-b-image');
    assert.equal(billing.quote(db, admin, { service_type: 'image', model: a.billing_key, usage: { image: 1 } }).amount_micro, 100000);
    assert.equal(billing.quote(db, admin, { service_type: 'image', model: b.billing_key, usage: { image: 1 } }).amount_micro, 200000);
  } finally { teardown(dbPath); }
});

test('drama listing is scoped by owner', () => {
  const { db, dbPath, admin, log } = setup();
  try {
    const first = auth.createUser(db, { username: 'first-user', password: 'password1' }, admin.id);
    const second = auth.createUser(db, { username: 'second-user', password: 'password2' }, admin.id);
    drama.createDrama(db, log, { title: 'first project', owner_user_id: first.id });
    drama.createDrama(db, log, { title: 'second project', owner_user_id: second.id });
    assert.equal(drama.listDramas(db, { owner_user_id: first.id }).total, 1);
    assert.equal(drama.listDramas(db, { owner_user_id: second.id }).dramas[0].title, 'second project');
  } finally { teardown(dbPath); }
});

test('omni sequences and tool runs stay scoped and settle their authorization', () => {
  const { db, dbPath, admin } = setup();
  try {
    const first = auth.createUser(db, { username: 'omni-first', password: 'password1' }, admin.id);
    const second = auth.createUser(db, { username: 'omni-second', password: 'password2' }, admin.id);
    const firstDefault = sequences.ensureDefault(db, first.id);
    sequences.ensureDefault(db, second.id);
    assert.equal(sequences.list(db, { owner_user_id: first.id }).length, 1);
    assert.equal(sequences.list(db, { owner_user_id: first.id })[0].id, firstDefault.id);

    billing.savePriceBook(db, admin.id, { name: 'tool prices', status: 'published', items: [{ service_type: 'text', model: 'text-model', meter: 'request', unit_price: 10 }] });
    billing.adjustBalance(db, admin.id, first.id, 100, 'test points');
    const actor = { id: first.id, role: 'user' };
    const authorization = billing.createAuthorization(db, actor, { idempotency_key: 'tool-one', service_type: 'text', model: 'text-model', usage: { request: 1 } });
    const run = tools.create(db, { tool_type: 'script_analysis', model: 'text-model', owner_user_id: first.id, billing_authorization_id: authorization.authorization_id, input: { script: 'test' } });
    tools.set(db, run.id, { status: 'completed', output: { ok: true } });
    assert.equal(billing.account(db, first.id).frozen_micro, 0);
    assert.equal(billing.listUsage(db, { user_id: first.id }).length, 1);
    assert.equal(tools.list(db, { owner_user_id: second.id }).length, 0);
  } finally { teardown(dbPath); }
});

test('authenticated text calls settle exact provider usage and hold missing usage for reconciliation', async () => {
  const { db, dbPath, admin, log } = setup();
  let sendUsage = true;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'x-request-id': 'provider-usage-test' });
      const usageEvent = sendUsage ? 'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n' : '';
      res.end(`data: {"id":"provider-usage-test","choices":[{"delta":{"content":"ok"}}]}\n\n${usageEvent}data: [DONE]\n\n`);
    });
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const user = auth.createUser(db, { username: 'metered-text', password: '1' }, admin.id);
    aiConfigs.createConfig(db, log, { service_type: 'text', provider: 'openai', name: 'metered', base_url: `http://127.0.0.1:${port}`, endpoint: '/chat', api_key: 'test', model: ['metered-model'], default_model: 'metered-model', billing_key: 'metered-text-key', is_default: true });
    billing.savePriceBook(db, admin.id, { name: 'metered text', status: 'published', items: [
      { service_type: 'text', model: 'metered-text-key', meter: 'input_token', unit_price: 2 },
      { service_type: 'text', model: 'metered-text-key', meter: 'output_token', unit_price: 3 },
    ] });
    billing.adjustBalance(db, admin.id, user.id, 1000, 'test points');
    const result = await billingContext.run({ actor: { id: user.id, role: 'user' }, db, log }, () => aiClient.generateText(db, log, 'text', 'hello', 'system', { max_tokens: 100 }));
    assert.equal(result, 'ok');
    const usage = billing.listUsage(db, { user_id: user.id });
    assert.deepEqual(usage[0].usage, { input_token: 10, output_token: 5 });
    assert.equal(usage[0].charged_micro, 350000);
    assert.equal(billing.account(db, user.id).frozen_micro, 0);
    sendUsage = false;
    await billingContext.run({ actor: { id: user.id, role: 'user' }, db, log }, () => aiClient.generateText(db, log, 'text', 'missing', 'system', { max_tokens: 100 }));
    assert.equal(billing.listUsage(db, { user_id: user.id }).length, 1);
    assert.equal(billing.account(db, user.id).balance_micro, 9650000);
    assert.ok(billing.account(db, user.id).frozen_micro > 0);
    const cases = billing.listReconciliationCases(db, { user_id: user.id, status: 'pending' });
    assert.equal(cases.length, 1);
    assert.equal(cases[0].service_type, 'text');
    billing.settleReconciliationCase(db, { id: admin.id, role: 'admin' }, cases[0].id, {
      usage: { input_token: 2, output_token: 1 }, provider_request_id: 'reconciled-provider-usage',
    });
    assert.equal(billing.account(db, user.id).frozen_micro, 0);
    assert.equal(billing.account(db, user.id).balance_micro, 9580000);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    teardown(dbPath);
  }
});

test('a tool retry replaces the settled authorization with a newly frozen one', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'tool-retry-user', password: '1' }, admin.id);
    const actor = { id: user.id, role: 'user' };
    billing.savePriceBook(db, admin.id, { name: 'tool retry price', status: 'published', items: [
      { service_type: 'text', model: 'tool-retry-model', meter: 'request', unit_price: 10 },
    ] });
    billing.adjustBalance(db, admin.id, user.id, 100, 'test points');
    const first = billing.createAuthorization(db, actor, { idempotency_key: 'tool-retry-first', service_type: 'text', model: 'tool-retry-model', usage: { request: 1 } });
    const run = tools.create(db, { tool_type: 'script_analysis', model: 'tool-retry-model', owner_user_id: user.id, billing_authorization_id: first.authorization_id, input: { script: 'test' } });
    tools.set(db, run.id, { status: 'completed', output: { ok: true } });
    const second = billing.createAuthorization(db, actor, { idempotency_key: 'tool-retry-second', service_type: 'text', model: 'tool-retry-model', usage: { request: 1 } });
    const retried = tools.retryWithAuthorization(db, run.id, second.authorization_id);
    assert.equal(retried.billing_authorization_id, second.authorization_id);
    assert.equal(retried.continuation_count, 1);
    assert.equal(billing.account(db, user.id).frozen_micro, 100000);
    tools.set(db, run.id, { status: 'completed', output: { ok: true } });
    assert.equal(billing.listUsage(db, { user_id: user.id }).length, 2);
    assert.equal(billing.account(db, user.id).frozen_micro, 0);
  } finally { teardown(dbPath); }
});

test('authenticated text requests send the same default output cap that billing freezes', async () => {
  const { db, dbPath, admin, log } = setup();
  let requestBody = null;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requestBody = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\ndata: [DONE]\n\n');
    });
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const user = auth.createUser(db, { username: 'default-cap-user', password: '1' }, admin.id);
    aiConfigs.createConfig(db, log, { service_type: 'text', provider: 'openai', name: 'default cap', base_url: `http://127.0.0.1:${server.address().port}`, endpoint: '/chat', api_key: 'test', model: ['default-cap-model'], default_model: 'default-cap-model', billing_key: 'default-cap-key', is_default: true });
    billing.savePriceBook(db, admin.id, { name: 'default cap price', status: 'published', items: [
      { service_type: 'text', model: 'default-cap-key', meter: 'input_token', unit_price: 1 },
      { service_type: 'text', model: 'default-cap-key', meter: 'output_token', unit_price: 1 },
    ] });
    billing.adjustBalance(db, admin.id, user.id, 10000, 'test points');
    await billingContext.run({ actor: { id: user.id, role: 'user' }, db, log }, () => aiClient.generateText(db, log, 'text', 'hello', 'system'));
    assert.equal(requestBody.max_tokens, 8192);
    const authorization = billing.listTransactions(db, { user_id: user.id }).find((row) => row.type === 'authorization');
    assert.equal(authorization.snapshot.usage.output_token, 8192);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    teardown(dbPath);
  }
});
