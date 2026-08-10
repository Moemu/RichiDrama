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
    assert.equal(authorization.amount_micro, 25);
    assert.equal(billing.account(db, user.id).frozen_micro, 25);
    const settled = billing.settleAuthorization(db, actor, authorization.authorization_id, { usage: { image: 2 }, provider_request_id: 'provider-image-1' });
    assert.equal(settled.charged_micro, 25);
    assert.equal(settled.overage_micro, 25);
    assert.equal(billing.account(db, user.id).balance_micro, 175);
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
    billing.setBalance(db, admin.id, user.id, 75, 'set target');
    assert.equal(billing.account(db, user.id).balance_micro, 75);
    assert.equal(billing.account(db, user.id).total_recharged_micro, 200);
    const transaction = billing.listTransactions(db, { user_id: user.id })[0];
    assert.equal(transaction.type, 'adjustment');
    assert.equal(transaction.amount_micro, -125);
    assert.equal(transaction.snapshot.operation, 'set_balance');
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
    assert.equal(billing.quote(db, user, { service_type: 'video', model: 'seedance', usage: { input_token: 250000 }, pricing_context: { has_video_input: true } }).amount_micro, 700);
    assert.equal(billing.quote(db, user, { service_type: 'video', model: 'seedance', usage: { input_token: 250000 }, pricing_context: { has_video_input: false } }).amount_micro, 1150);
    assert.throws(() => billing.quote(db, user, { service_type: 'video', model: 'seedance', usage: { input_token: 1.5 } }), /整数/);
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
    assert.equal(billing.quote(db, admin, { service_type: 'image', model: a.billing_key, usage: { image: 1 } }).amount_micro, 10);
    assert.equal(billing.quote(db, admin, { service_type: 'image', model: b.billing_key, usage: { image: 1 } }).amount_micro, 20);
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
    assert.equal(usage[0].charged_micro, 35);
    assert.equal(billing.account(db, user.id).frozen_micro, 0);
    sendUsage = false;
    await billingContext.run({ actor: { id: user.id, role: 'user' }, db, log }, () => aiClient.generateText(db, log, 'text', 'missing', 'system', { max_tokens: 100 }));
    assert.equal(billing.listUsage(db, { user_id: user.id }).length, 1);
    assert.equal(billing.account(db, user.id).balance_micro, 965);
    assert.ok(billing.account(db, user.id).frozen_micro > 0);
    const cases = billing.listReconciliationCases(db, { user_id: user.id, status: 'pending' });
    assert.equal(cases.length, 1);
    assert.equal(cases[0].service_type, 'text');
    billing.settleReconciliationCase(db, { id: admin.id, role: 'admin' }, cases[0].id, {
      usage: { input_token: 2, output_token: 1 }, provider_request_id: 'reconciled-provider-usage',
    });
    assert.equal(billing.account(db, user.id).frozen_micro, 0);
    assert.equal(billing.account(db, user.id).balance_micro, 958);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    teardown(dbPath);
  }
});
