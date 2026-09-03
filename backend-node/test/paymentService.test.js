const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const billing = require('../src/services/billingService');
const organizations = require('../src/services/customerOrganizationService');
const { createPaymentService, paymentConfig, paymentNotifyUrl, parseAmountFen } = require('../src/services/paymentService');

function setup() {
  const dbPath = path.join(os.tmpdir(), `minidrama-payments-${Date.now()}-${Math.random()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  runMigrationsAndEnsure(db);
  const log = { info() {}, warn() {} };
  const admin = auth.ensureBootstrapAdmin(db, log);
  const user = auth.createUser(db, { username: `payer-${Date.now()}`, password: 'creator123' }, admin.id);
  const state = { query: 'pending', close: 0 };
  const adapter = {
    async createNativeOrder(order) { return { state: 'pending', code_url: `mock://${order.out_trade_no}` }; },
    async queryOrder(order) { return { state: state.query, provider_status: state.query, provider_trade_no: 'provider-1', amount_fen: order.amount_fen, currency: 'CNY', app_id: 'app', merchant_id: 'merchant' }; },
    async closeOrder() { state.close += 1; return { closed: true }; },
    verifyNotification({ body }) { return { ...body, event_id: body.event_id || 'event-1' }; },
  };
  const cfg = { payments: {
    enabled: true, public_base_url: 'https://pay.example.test', order_expire_minutes: 15,
    min_amount_fen: 100, max_amount_fen: 500000, preset_amounts_fen: [1000, 5000, 10000, 50000],
    alipay: { app_id: 'app', seller_id: 'merchant' }, wechat: { app_id: 'app', mch_id: 'merchant' },
  } };
  const service = createPaymentService(db, cfg, log, { alipay: adapter, wechat: adapter });
  return { db, dbPath, admin, user, service, state };
}

function teardown(dbPath) {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
}

test('channel notification URL supports a fixed HTTPS gateway path', () => {
  const config = {
    public_base_url: 'https://legacy.example.test',
    wechat: { notify_url: 'https://api.example.test/minidrama/payments/callbacks/wechat' },
  };
  assert.equal(paymentNotifyUrl(config, 'wechat'), 'https://api.example.test/minidrama/payments/callbacks/wechat');
  assert.equal(paymentNotifyUrl(config, 'alipay'), 'https://legacy.example.test/api/v1/payments/callbacks/alipay');
  assert.equal(paymentNotifyUrl({ public_base_url: 'https://fallback.example.test', wechat: { notify_url: 'http://unsafe.example.test/callback' } }, 'wechat'), '');
});

test('payment amount validation uses exact fen boundaries', () => {
  const { dbPath, service } = setup();
  try {
    assert.equal(service.parseAmountFen('1'), 100);
    assert.equal(service.parseAmountFen('5000.00'), 500000);
    assert.equal(service.parseAmountFen('10.25'), 1025);
    for (const value of ['0.99', '5000.01', '1.001', '-1', 'abc']) assert.throws(() => service.parseAmountFen(value));
  } finally { teardown(dbPath); }
});

test('preview configuration can lower the payment minimum to one fen', () => {
  const config = paymentConfig({ payments: { min_amount_fen: 1, max_amount_fen: 500000 } });
  assert.equal(parseAmountFen('0.01', config), 1);
  assert.throws(() => parseAmountFen('0.001', config));
});

test('payment creation is idempotent and paid notifications credit once', async () => {
  const { db, dbPath, user, service } = setup();
  try {
    const input = { channel: 'alipay', amount_yuan: '10.25', client_request_id: 'client-request-0001' };
    const first = await service.create(user, input);
    const reused = await service.create(user, input);
    assert.equal(reused.id, first.id);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM payment_orders').get().count, 1);
    const paid = { out_trade_no: first.out_trade_no, state: 'paid', provider_status: 'TRADE_SUCCESS', provider_trade_no: 'ali-trade-1', amount_fen: 1025, currency: 'CNY', app_id: 'app', merchant_id: 'merchant', event_id: 'notify-1' };
    service.notify('alipay', { body: paid });
    service.notify('alipay', { body: { ...paid, event_id: 'notify-2' } });
    assert.equal(service.find(first.id).status, 'paid');
    assert.equal(billing.account(db, user.id).balance_micro, 1025 * 10000);
    assert.equal(billing.account(db, user.id).total_recharged_micro, 1025 * 10000);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM billing_transactions WHERE idempotency_key=?").get(`payment:${first.id}`).count, 1);
  } finally { teardown(dbPath); }
});

test('payment mismatch enters review and never credits balance', async () => {
  const { db, dbPath, user, service } = setup();
  try {
    const order = await service.create(user, { channel: 'wechat', amount_yuan: '50', client_request_id: 'client-request-0002' });
    service.notify('wechat', { body: { out_trade_no: order.out_trade_no, state: 'paid', provider_status: 'SUCCESS', amount_fen: 4999, currency: 'CNY', app_id: 'app', merchant_id: 'merchant' } });
    assert.equal(service.find(order.id).status, 'review_required');
    assert.equal(billing.account(db, user.id).balance_micro, 0);
  } finally { teardown(dbPath); }
});

test('active query recovers payment and expired pending order closes', async () => {
  const { db, dbPath, user, service, state } = setup();
  try {
    const paidOrder = await service.create(user, { channel: 'wechat', amount_yuan: '100', client_request_id: 'client-request-0003' });
    state.query = 'paid';
    const paid = await service.sync(paidOrder.id, user, true);
    assert.equal(paid.status, 'paid');
    const old = await service.create(user, { channel: 'alipay', amount_yuan: '10', client_request_id: 'client-request-0004' });
    db.prepare('UPDATE payment_orders SET expires_at=? WHERE id=?').run(new Date(Date.now() - 60000).toISOString(), old.id);
    state.query = 'pending';
    await service.recover();
    assert.equal(service.find(old.id).status, 'expired');
    assert.equal(state.close, 1);
  } finally { teardown(dbPath); }
});

test('payment orders enforce ownership and exclude organization members', async () => {
  const { db, dbPath, admin, user, service } = setup();
  try {
    const other = auth.createUser(db, { username: `other-${Date.now()}`, password: 'creator123' }, admin.id);
    const order = await service.create(user, { channel: 'alipay', amount_yuan: '10', client_request_id: 'client-request-0005' });
    assert.equal(service.getForUser(order.id, other), null);
    const tenant = require('../src/services/tenantService').newUserDefaultTenant(db);
    const org = organizations.saveOrganization(db, admin.id, { name: '共享客户', config_tenant_id: tenant.id }, null);
    organizations.replaceMembers(db, org.id, [{ user_id: other.id, role: 'member' }]);
    await assert.rejects(() => service.create(other, { channel: 'alipay', amount_yuan: '10', client_request_id: 'client-request-0006' }), /不能充值个人账户/);
  } finally { teardown(dbPath); }
});
