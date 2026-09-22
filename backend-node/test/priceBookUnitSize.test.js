const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const billing = require('../src/services/billingService');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-mini-drama-unit-size-'));
  const db = getDb({ path: path.join(root, 'test.db'), type: 'sqlite' });
  runMigrationsAndEnsure(db);
  const admin = auth.ensureBootstrapAdmin(db, log);
  const user = auth.createUser(db, { username: `unitsize-${Date.now()}`, password: '1' }, admin.id);
  return { db, root, admin, user };
}

function publish(db, adminId, name, conditions) {
  return billing.savePriceBook(db, adminId, { name, status: 'published', items: [
    { service_type: 'video_postprocess', model: 'las-video-translate', meter: 'millisecond', unit_price: 2, conditions_json: conditions },
  ] });
}

function quoteMinute(db, user) {
  return billing.quote(db, { id: user.id }, { service_type: 'video_postprocess', model: 'las-video-translate', provider: 'las', usage: { millisecond: 90_000 } });
}

test('单位数量 60000 让毫秒计量按每分钟收费', () => {
  const { db, root, admin, user } = setup();
  try {
    publish(db, admin.id, 'unit-size-minute', { unit_size: 60000 });
    const result = quoteMinute(db, user);
    assert.equal(result.rates[0].unit_size, 60000);
    // 90 秒 = 1.5 个计价单位，每单位 2 积分（1 积分 = 10000 micro）。
    assert.equal(result.amount_micro, 30_000);
    assert.equal(result.amount, 3);
  } finally {
    closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('不填单位数量时按每毫秒收费，差额正好是 60000 倍', () => {
  const { db, root, admin, user } = setup();
  try {
    publish(db, admin.id, 'unit-size-default', null);
    const result = quoteMinute(db, user);
    assert.equal(result.rates[0].unit_size, 1);
    assert.equal(result.amount_micro, 30_000 * 60_000);
  } finally {
    closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('单位数量非法时在保存价目时拒绝，而不是等到报价', () => {
  const { db, root, admin } = setup();
  try {
    for (const bad of [0, -60000, 1.5, '60000.5']) {
      assert.throws(() => publish(db, admin.id, `unit-size-bad-${bad}`, { unit_size: bad }), /计价单位数量必须是正整数/, `未拒绝 ${bad}`);
    }
    // 其它计价条件必须原样保留，新增字段不能顺手改写它们。
    billing.savePriceBook(db, admin.id, { name: 'unit-size-keep', status: 'published', items: [
      { service_type: 'video_postprocess', model: 'las-video-translate', meter: 'millisecond', unit_price: 2, conditions_json: { unit_size: 60000, pricing_note: '每分钟' } },
    ] });
    const stored = billing.listPriceBooks(db).find((book) => book.name === 'unit-size-keep');
    assert.deepEqual(stored.items[0].conditions_json, { unit_size: 60000, pricing_note: '每分钟' });
  } finally {
    closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
