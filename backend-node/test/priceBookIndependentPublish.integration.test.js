/**
 * 独立价目书的发布安全边界：
 * 无父版本和同步来源的手工草稿只是「新增一本价目」，即使标注供应商也不能把系统价目表
 * 归档并把分组绑定改指到它 —— 那是全站其它模型当场变成未定价的事故路径。
 * 同时钉住 LAS 视频本地化三个价目项的口径：视频后处理 + millisecond + unit_size=60000。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const billing = require('../src/services/billingService');
const tenants = require('../src/services/tenantService');
const providerPrices = require('../src/services/providerPriceService');

const log = { info() {}, warn() {}, error() {} };
const MINUTE_MS = 60_000;
// 火山引擎 LAS 合同价（元/分钟）→ 积分（1 元 = 100 积分），单位数量 60000 毫秒。
const LAS_ITEMS = [
  { service_type: 'video_postprocess', model: 'las-video-translate', meter: 'millisecond', unit_price: 150, conditions_json: { unit_size: MINUTE_MS } },
  { service_type: 'video_postprocess', model: 'las-video-inpaint-lite', meter: 'millisecond', unit_price: 40, conditions_json: { unit_size: MINUTE_MS } },
  { service_type: 'video_postprocess', model: 'las-video-inpaint-pro', meter: 'millisecond', unit_price: 100, conditions_json: { unit_size: MINUTE_MS } },
];

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-mini-drama-independent-price-'));
  const dbPath = path.join(root, 'test.db');
  const db = getDb({ path: dbPath, type: 'sqlite' });
  runMigrationsAndEnsure(db);
  const admin = auth.ensureBootstrapAdmin(db, log);
  return { db, root, dbPath, admin };
}

function teardown(root) {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}

/** 平台系统价目表（迁移自带的火山官方价目）与它的一个真实计价项。 */
function platformBook(db) {
  const book = db.prepare("SELECT * FROM billing_price_books WHERE provider='volcengine' AND system_managed=1 AND status='published' ORDER BY id LIMIT 1").get();
  assert.ok(book, '迁移应已生成平台火山系统价目表');
  const item = db.prepare("SELECT * FROM billing_price_book_items WHERE price_book_id=? AND meter='input_token' ORDER BY id LIMIT 1").get(book.id);
  assert.ok(item, '平台火山价目表应含按 token 计价的文本模型');
  return { book, item };
}

function memberOfNewGroup(db, admin, name) {
  const group = tenants.writeTenant(db, admin.id, { name });
  const user = auth.createUser(db, { username: `${name}-${Date.now()}-${Math.floor(Math.random() * 1000)}`, password: 'user123456' }, admin.id);
  tenants.setMember(db, group.id, user.id);
  return { group, user };
}

function draft(db, admin, input) {
  return billing.savePriceBook(db, admin.id, { ...input, status: 'draft' });
}

function latestNotice(db) {
  return db.prepare('SELECT title, body FROM system_notices ORDER BY rowid DESC LIMIT 1').get() || null;
}

test('无父版本、无供应商标签的手工草稿发布时不得归档平台系统价目表', () => {
  const { db, root, admin } = setup();
  try {
    const { book, item } = platformBook(db);
    const { group, user } = memberOfNewGroup(db, admin, 'independent-book');
    tenants.replaceBindings(db, group.id, { price_book_id: book.id });
    assert.ok(billing.quote(db, user, { service_type: item.service_type, model: item.model, provider: 'volcengine', usage: { input_token: 1000 } }).amount > 0);

    const manual = draft(db, admin, { name: '手工独立价目', items: [LAS_ITEMS[1]] });
    assert.equal(manual.provider, null, '未标注供应商的手工草稿不应带供应商归属');
    providerPrices.publish(db, admin.id, manual.id, { confirm: true, reason: '新增独立价目', idempotency_key: 'independent-publish-1', notify_users: true });

    assert.equal(db.prepare('SELECT status FROM billing_price_books WHERE id=?').get(book.id).status, 'published', '平台系统价目表必须保持已发布');
    assert.deepEqual(
      db.prepare('SELECT provider, price_book_id FROM tenant_provider_price_book_bindings WHERE tenant_id=?').all(group.id),
      [{ provider: 'volcengine', price_book_id: book.id }],
      '分组绑定不得被改指到独立价目书',
    );
    assert.ok(billing.quote(db, user, { service_type: item.service_type, model: item.model, provider: 'volcengine', usage: { input_token: 1000 } }).amount > 0,
      '发布独立价目后平台火山价目必须仍可用');

    const notice = latestNotice(db);
    assert.ok(notice, '发布应产生价格通知');
    assert.doesNotMatch(notice.body, /火山引擎/, '未标注供应商的独立价目不得被写成火山引擎价格');
    assert.match(notice.body, /las-video-inpaint-lite/);
  } finally { teardown(root); }
});

test('标注火山供应商的独立手工草稿也不得替换火山系统价目', () => {
  const { db, root, admin } = setup();
  try {
    const { book, item } = platformBook(db);
    const { group, user } = memberOfNewGroup(db, admin, 'volc-manual-book');
    tenants.replaceBindings(db, group.id, { price_book_id: book.id });
    const manual = draft(db, admin, { name: '火山独立手工价目', provider: 'volcengine', items: [
      { service_type: 'video_postprocess', model: 'volc-independent-test', meter: 'millisecond', unit_price: 1, conditions_json: { unit_size: MINUTE_MS } },
    ] });
    providerPrices.publish(db, admin.id, manual.id, { confirm: true, reason: '新增独立供应商价目', idempotency_key: 'volc-independent-publish', notify_users: false });

    assert.equal(db.prepare('SELECT status FROM billing_price_books WHERE id=?').get(book.id).status, 'published');
    assert.deepEqual(db.prepare('SELECT provider, price_book_id FROM tenant_provider_price_book_bindings WHERE tenant_id=?').all(group.id),
      [{ provider: 'volcengine', price_book_id: book.id }]);
    assert.ok(billing.quote(db, user, { service_type: item.service_type, model: item.model, provider: 'volcengine', usage: { input_token: 1000 } }).amount > 0);
  } finally { teardown(root); }
});

test('标注供应商的 LAS 独立价目书按供应商解析，且不动平台火山价目', () => {
  const { db, root, admin } = setup();
  try {
    const { book, item } = platformBook(db);
    const bound = memberOfNewGroup(db, admin, 'las-bound');
    tenants.replaceBindings(db, bound.group.id, { price_book_id: book.id });
    const loose = memberOfNewGroup(db, admin, 'las-unbound');

    const las = draft(db, admin, { name: '火山引擎 LAS 本地化价目', provider: 'las', items: LAS_ITEMS });
    assert.equal(las.provider, 'las');
    assert.equal(las.version, 1);
    providerPrices.publish(db, admin.id, las.id, { confirm: true, reason: '发布 LAS 合同价', idempotency_key: 'las-publish-1', notify_users: true });

    assert.equal(db.prepare('SELECT status FROM billing_price_books WHERE id=?').get(book.id).status, 'published');
    assert.ok(billing.quote(db, bound.user, { service_type: item.service_type, model: item.model, provider: 'volcengine', usage: { input_token: 1000 } }).amount > 0);

    for (const user of [bound.user, loose.user]) {
      // 90 秒 = 1.5 个计价单位：翻译 150 积分/分钟 → 225 积分
      assert.equal(quoteLas(db, user, 'las-video-translate', 90_000).amount, 225);
      assert.equal(quoteLas(db, user, 'las-video-inpaint-lite', 90_000).amount, 60);
      assert.equal(quoteLas(db, user, 'las-video-inpaint-pro', 90_000).amount, 150);
    }
    assert.deepEqual(billing.activeMeters(db, loose.user, 'video_postprocess', 'las-video-translate', 'las'), ['millisecond']);

    const notice = latestNotice(db);
    assert.match(notice.body, /火山引擎 LAS/, '标注 las 的价目通知应使用它自己的来源文案');
    assert.doesNotMatch(notice.body, /火山引擎价格已完成审核/, '不得沿用火山同步价的文案');
  } finally { teardown(root); }
});

function quoteLas(db, user, model, milliseconds) {
  return billing.quote(db, user, { service_type: 'video_postprocess', model, provider: 'las', usage: { millisecond: milliseconds } });
}

test('复制为新版本后发布：归档前版并把分组绑定改指到新版本', () => {
  const { db, root, admin } = setup();
  try {
    const { group, user } = memberOfNewGroup(db, admin, 'las-version');
    const first = draft(db, admin, { name: '火山引擎 LAS 本地化价目', provider: 'las', items: LAS_ITEMS });
    providerPrices.publish(db, admin.id, first.id, { confirm: true, reason: '首版', idempotency_key: 'las-v1', notify_users: false });
    tenants.replaceBindings(db, group.id, { price_book_bindings: [{ provider: 'las', price_book_id: first.id }] });

    const clone = billing.clonePriceBook(db, admin.id, first.id);
    assert.equal(clone.status, 'draft');
    assert.equal(clone.parent_price_book_id, first.id);
    assert.equal(clone.provider, 'las');
    assert.equal(clone.version, 2);
    assert.equal(clone.items.length, LAS_ITEMS.length, '复制必须带上全部计价项');

    billing.savePriceBook(db, admin.id, {
      name: clone.name,
      provider: 'las',
      items: clone.items.map((row) => ({
        service_type: row.service_type, model: row.model, meter: row.meter,
        unit_price: row.model === 'las-video-translate' ? 180 : row.unit_price,
        conditions_json: row.conditions_json,
      })),
    }, clone.id);
    providerPrices.publish(db, admin.id, clone.id, { confirm: true, reason: '合同价调整', idempotency_key: 'las-v2', notify_users: false });

    assert.equal(db.prepare('SELECT status FROM billing_price_books WHERE id=?').get(first.id).status, 'archived');
    assert.equal(quoteLas(db, user, 'las-video-translate', 90_000).amount, 270, '新版本 180 积分/分钟：90 秒应收 270');
    assert.deepEqual(
      db.prepare('SELECT provider, price_book_id FROM tenant_provider_price_book_bindings WHERE tenant_id=?').all(group.id),
      [{ provider: 'las', price_book_id: Number(clone.id) }],
      '绑定必须改指到新版本，避免上一版归档后静默掉到平台价目',
    );
  } finally { teardown(root); }
});

test('只有已发布价目能复制新版本，非法供应商标识在保存阶段被拒', () => {
  const { db, root, admin } = setup();
  try {
    const manual = draft(db, admin, { name: '未发布草稿', provider: 'LAS', items: [LAS_ITEMS[0]] });
    assert.equal(manual.provider, 'las', '供应商标识应统一小写');
    assert.throws(() => billing.clonePriceBook(db, admin.id, manual.id), /只能基于已发布价目/);
    assert.throws(() => billing.savePriceBook(db, admin.id, { name: '非法供应商', provider: 'las 本地化', items: [LAS_ITEMS[2]] }), /供应商标识/);

    // 更新草稿未携带 provider 时不得清空既有归属。
    billing.savePriceBook(db, admin.id, { name: '未发布草稿改名', items: [LAS_ITEMS[0]] }, manual.id);
    assert.equal(db.prepare('SELECT provider FROM billing_price_books WHERE id=?').get(manual.id).provider, 'las');
  } finally { teardown(root); }
});

test('重启后 LAS 价目与平台火山价目仍按各自供应商解析', () => {
  const { db, root, dbPath, admin } = setup();
  try {
    const { book, item } = platformBook(db);
    const { group, user } = memberOfNewGroup(db, admin, 'restart-read');
    const las = draft(db, admin, { name: '火山引擎 LAS 本地化价目', provider: 'las', items: LAS_ITEMS });
    providerPrices.publish(db, admin.id, las.id, { confirm: true, reason: '重启读取验证', idempotency_key: 'las-restart', notify_users: false });
    tenants.replaceBindings(db, group.id, { price_book_bindings: [{ provider: 'volcengine', price_book_id: book.id }, { provider: 'las', price_book_id: las.id }] });

    closeDb();
    const reopened = getDb({ path: dbPath, type: 'sqlite' });
    runMigrationsAndEnsure(reopened);
    assert.equal(quoteLas(reopened, user, 'las-video-translate', 120_000).amount, 300);
    assert.ok(billing.quote(reopened, user, { service_type: item.service_type, model: item.model, provider: 'volcengine', usage: { input_token: 1000 } }).amount > 0);
  } finally {
    teardown(root);
  }
});
