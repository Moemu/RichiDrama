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

function setup() {
  const dbPath = path.join(os.tmpdir(), `local-mini-drama-tenant-provider-books-${Date.now()}-${Math.random()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  runMigrationsAndEnsure(db);
  const log = { info() {}, warn() {} };
  return { db, dbPath, admin: auth.ensureBootstrapAdmin(db, log), log };
}
function teardown(dbPath) {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
}

function book(db, name, provider, items) {
  const id = Number(billing.savePriceBook(db, 1, { name, status: 'published', items }).id || billing.listPriceBooks(db).find((b) => b.name === name).id);
  db.prepare('UPDATE billing_price_books SET provider=? WHERE id=?').run(provider, id);
  return id;
}

test('provider-scoped tenant price books price each provider by the book actually serving the call', () => {
  const { db, dbPath } = setup();
  try {
    const volcBook = book(db, '组内火山书', 'volcengine', [{ service_type: 'text', model: 'volc-model', meter: 'request', unit_price: 10 }]);
    const richBook = book(db, '平台中转书', 'richbest', [{ service_type: 'text', model: 'rich-model', meter: 'request', unit_price: 20 }]);
    const customBook = book(db, '自定义供应商书', 'Acme', [{ service_type: 'text', model: 'acme-model', meter: 'request', unit_price: 3 }]);
    const group = tenants.writeTenant(db, 1, { name: '多供应商组' });
    const user = auth.createUser(db, { username: 'multi-provider-user', password: 'user123456' }, 1);
    tenants.setMember(db, group.id, user.id);

    // Legacy 1:1 binding: the volcengine book becomes the (group, 'volcengine') slot.
    tenants.replaceBindings(db, group.id, { price_book_id: volcBook });
    const bindings = tenants.priceBookBindingsForTenant(db, group.id);
    assert.deepEqual(bindings.map((row) => row.provider), ['volcengine'], 'migration-era binding lands on the book provider slot');

    const quoteVolc = billing.quote(db, user, { service_type: 'text', model: 'volc-model', provider: 'volcengine', usage: { request: 1 } });
    assert.equal(quoteVolc.amount, 10, 'volcengine call keeps using the group-bound volcengine book');
    assert.equal(quoteVolc.rates[0].price_book_id, volcBook);
    for (const alias of ['volces', 'volc']) {
      assert.deepEqual(billing.activeMeters(db, user, 'text', 'volc-model', alias), ['request']);
      const quote = billing.quote(db, user, { service_type: 'text', model: 'volc-model', provider: alias, usage: { request: 1 } });
      assert.equal(quote.rates[0].price_book_id, volcBook, `${alias} must use the existing volcengine binding`);
    }
    const unboundGroup = tenants.writeTenant(db, 1, { name: '未绑定价目组' });
    const unboundUser = auth.createUser(db, { username: 'unbound-price-user', password: 'user123456' }, 1);
    tenants.setMember(db, unboundGroup.id, unboundUser.id);
    assert.equal(billing.quote(db, unboundUser, { service_type: 'text', model: 'volc-model', provider: 'volces', usage: { request: 1 } }).rates[0].price_book_id, volcBook,
      'legacy alias must also find the platform volcengine book without a tenant binding');
    assert.deepEqual(billing.activeMeters(db, unboundUser, 'video', 'doubao-seedance-2-0-260128', 'volces'), ['output_token']);
    assert.equal(billing.quote(db, unboundUser, { service_type: 'video', model: 'doubao-seedance-2-0-260128', provider: 'volces', usage: { output_token: 1 } }).rates[0].meter, 'output_token');

    const quoteRich = billing.quote(db, user, { service_type: 'text', model: 'rich-model', provider: 'richbest', usage: { request: 1 } });
    assert.equal(quoteRich.amount, 20, 'richbest call falls through to the platform richbest book instead of being rejected');
    assert.equal(quoteRich.rates[0].price_book_id, richBook);
    assert.equal(billing.quote(db, user, { service_type: 'text', model: 'acme-model', provider: 'Acme', usage: { request: 1 } }).rates[0].price_book_id, customBook,
      'unrelated provider names retain their stored spelling');

    // A group binding for richbest now overrides only that provider. The SKU
    // conflict check only guards platform books, so create the tenant-owned
    // book with a placeholder SKU, take ownership, then reuse the model.
    const groupRichBook = book(db, '组内中转书', 'richbest', [{ service_type: 'text', model: 'rich-group-placeholder', meter: 'request', unit_price: 5 }]);
    db.prepare('UPDATE billing_price_books SET owner_user_id=1 WHERE id=?').run(groupRichBook);
    db.prepare("UPDATE billing_price_book_items SET model='rich-model' WHERE price_book_id=?").run(groupRichBook);
    tenants.replaceBindings(db, group.id, {
      price_book_bindings: [
        { provider: 'volcengine', price_book_id: volcBook },
        { provider: 'richbest', price_book_id: groupRichBook },
      ],
    });
    assert.equal(billing.quote(db, user, { service_type: 'text', model: 'rich-model', provider: 'richbest', usage: { request: 1 } }).amount, 5, 'richbest now uses the group richbest book');
    assert.equal(billing.quote(db, user, { service_type: 'text', model: 'volc-model', provider: 'volcengine', usage: { request: 1 } }).amount, 10, 'volcengine binding untouched');

    // Unbinding richbest restores the platform fall-through.
    tenants.replaceBindings(db, group.id, { price_book_bindings: [{ provider: 'volcengine', price_book_id: volcBook }] });
    assert.equal(billing.quote(db, user, { service_type: 'text', model: 'rich-model', provider: 'richbest', usage: { request: 1 } }).amount, 20);
    assert.deepEqual(billing.activeMeters(db, user, 'text', 'rich-model', 'volces'), [], 'volcengine aliases must not borrow relay prices');

    // Provider-unaware callers keep legacy single-book resolution.
    assert.doesNotThrow(() => billing.quote(db, user, { service_type: 'text', model: 'volc-model', usage: { request: 1 } }));

    // Catch-all ('') binding applies to any provider without a specific slot.
    const catchAll = book(db, '兜底书', '', [{ service_type: 'text', model: 'any-model', meter: 'request', unit_price: 1 }]);
    tenants.replaceBindings(db, group.id, { price_book_bindings: [{ provider: 'volcengine', price_book_id: volcBook }, { provider: '', price_book_id: catchAll }] });
    assert.equal(billing.quote(db, user, { service_type: 'text', model: 'any-model', provider: 'someone-else', usage: { request: 1 } }).amount, 1, 'catch-all serves unknown providers');
    assert.equal(billing.quote(db, user, { service_type: 'text', model: 'volc-model', provider: 'volcengine', usage: { request: 1 } }).amount, 10, 'exact provider slot still wins over catch-all');
  } finally { teardown(dbPath); }
});

test('legacy provider pricing remains readable after a database restart', () => {
  const { db, dbPath } = setup();
  try {
    const priceBookId = db.prepare(`SELECT pb.id FROM billing_price_books pb
      JOIN billing_price_book_items item ON item.price_book_id=pb.id
      WHERE pb.provider='volcengine' AND pb.status='published'
        AND item.service_type='video' AND item.model='doubao-seedance-2-0-260128' AND item.meter='output_token'`).get()?.id;
    assert.ok(priceBookId, 'existing published Volcengine video pricing is present');
    const config = db.prepare(`INSERT INTO ai_service_configs
      (service_type, provider, name, base_url, api_key, model, default_model, created_at, updated_at)
      VALUES ('video', 'volces', '历史视频配置', 'https://ark.cn-beijing.volces.com/api/v3', '', ?, ?, ?, ?)`)
      .run('["doubao-seedance-2-0-260128"]', 'doubao-seedance-2-0-260128', new Date().toISOString(), new Date().toISOString());
    closeDb();

    const reopened = getDb({ path: dbPath, type: 'sqlite' });
    runMigrationsAndEnsure(reopened);
    const historical = reopened.prepare('SELECT provider, default_model FROM ai_service_configs WHERE id=?').get(config.lastInsertRowid);
    assert.deepEqual(historical, { provider: 'volces', default_model: 'doubao-seedance-2-0-260128' });
    const quote = billing.quote(reopened, 1, {
      service_type: 'video', model: historical.default_model, provider: historical.provider, usage: { output_token: 1 },
    });
    assert.equal(quote.rates[0].price_book_id, priceBookId);
  } finally { teardown(dbPath); }
});

test('migration 83 is re-runnable after a partial failure (preview restart recovery)', () => {
  const { db, dbPath } = setup();
  try {
    const volcBook = book(db, '火山书', 'volcengine', [{ service_type: 'text', model: 'volc-model', meter: 'request', unit_price: 10 }]);
    const group = tenants.writeTenant(db, 1, { name: '回填组' });
    db.prepare('INSERT INTO tenant_price_book_bindings (tenant_id,price_book_id,active_at,created_by,updated_at) VALUES (?,?,?,?,?)')
      .run(group.id, volcBook, new Date().toISOString(), null, new Date().toISOString());
    const raw = fs.readFileSync(path.join(__dirname, '..', 'migrations', '83_tenant_provider_price_books.sql'), 'utf8');
    const sql = raw.split('\n').filter((line) => { const t = line.trim(); return t.length > 0 && !t.startsWith('--'); }).join('\n');
    db.exec(sql);
    const count1 = db.prepare('SELECT COUNT(*) AS n FROM tenant_provider_price_book_bindings WHERE tenant_id=?').get(group.id).n;
    assert.equal(count1, 1);
    // Simulate the second boot re-running the whole file after a partial failure.
    db.exec(sql);
    const rows = db.prepare('SELECT provider, price_book_id FROM tenant_provider_price_book_bindings WHERE tenant_id=?').all(group.id);
    assert.deepEqual(rows, [{ provider: 'volcengine', price_book_id: volcBook }], 're-run must not duplicate or corrupt backfill');
  } finally { teardown(dbPath); }
});

test('发布新版价目时 provider 维度的绑定也必须跟着重指', () => {
  const { db, dbPath } = setup();
  try {
    const providerPrices = require('../src/services/providerPriceService');
    // 系统书 v1 → 分组绑定 → 再发布 v2：绑定必须留在最新一版，
    // 否则精确匹配会因 v1 变 archived 而落空，分组静默掉到平台价目。
    const v1 = book(db, '系统书 v1', 'richbest', [{ service_type: 'text', model: 'relay-model', meter: 'request', unit_price: 20 }]);
    db.prepare("UPDATE billing_price_books SET system_managed=1, version=1 WHERE id=?").run(v1);
    const group = tenants.writeTenant(db, 1, { name: '跟随发布的组' });
    const user = auth.createUser(db, { username: 'publish-follower', password: 'user123456' }, 1);
    tenants.setMember(db, group.id, user.id);
    tenants.replaceBindings(db, group.id, { price_book_bindings: [{ provider: 'richbest', price_book_id: v1 }] });
    assert.equal(billing.quote(db, user, { service_type: 'text', model: 'relay-model', provider: 'richbest', usage: { request: 1 } }).amount, 20);

    // 同一 SKU 不能并存两本已发布价目，所以先建草稿（占位 SKU），再改成同一个模型。
    const v2 = billing.savePriceBook(db, 1, { name: '系统书 v2', status: 'draft', items: [{ service_type: 'text', model: 'placeholder-model', meter: 'request', unit_price: 30 }] }).id;
    db.prepare('UPDATE billing_price_book_items SET model=? WHERE price_book_id=?').run('relay-model', v2);
    db.prepare("UPDATE billing_price_books SET provider='richbest', system_managed=1, version=2, parent_price_book_id=? WHERE id=?").run(v1, v2);
    providerPrices.publish(db, 1, v2, { confirm: true, reason: '中转价目例行更新', idempotency_key: `pub-${v2}`, notify_users: false });

    const rows = db.prepare('SELECT provider, price_book_id FROM tenant_provider_price_book_bindings WHERE tenant_id=?').all(group.id);
    assert.deepEqual(rows, [{ provider: 'richbest', price_book_id: Number(v2) }], '绑定要重指到新发布的价目书');
    const quote = billing.quote(db, user, { service_type: 'text', model: 'relay-model', provider: 'richbest', usage: { request: 1 } });
    assert.equal(quote.amount, 30, '分组按新价目计价');
    assert.equal(quote.rates[0].price_book_id, Number(v2));
  } finally { teardown(dbPath); }
});

test('回滚留在被回滚价目自己的供应商上，不再接回火山系统书', () => {
  const { db, dbPath } = setup();
  try {
    const providerPrices = require('../src/services/providerPriceService');
    const relayV1 = book(db, '中转书 v1', 'richbest', [{ service_type: 'text', model: 'relay-model', meter: 'request', unit_price: 20 }]);
    db.prepare("UPDATE billing_price_books SET system_managed=1, version=1 WHERE id=?").run(relayV1);
    const relayV2 = billing.savePriceBook(db, 1, { name: '中转书 v2', status: 'draft', items: [{ service_type: 'text', model: 'placeholder-model', meter: 'request', unit_price: 25 }] }).id;
    db.prepare('UPDATE billing_price_book_items SET model=? WHERE price_book_id=?').run('relay-model', relayV2);
    db.prepare("UPDATE billing_price_books SET provider='richbest', system_managed=1, version=2, parent_price_book_id=? WHERE id=?").run(relayV1, relayV2);
    providerPrices.publish(db, 1, relayV2, { confirm: true, reason: '中转价目更新', idempotency_key: `pub-${relayV2}`, notify_users: false });
    // 火山系统书同时存在：修复前的回滚会拿它当父版本，并把新草稿的 provider 留成 NULL。
    const volcBook = book(db, '火山系统书', 'volcengine', [{ service_type: 'text', model: 'volc-model', meter: 'request', unit_price: 10 }]);
    db.prepare("UPDATE billing_price_books SET system_managed=1, version=1 WHERE id=?").run(volcBook);

    const result = providerPrices.rollback(db, 1, relayV1, { confirm: true, reason: '中转价格回滚', idempotency_key: 'rb-1', notify_users: false });
    const rolled = db.prepare('SELECT name, provider, parent_price_book_id, system_managed FROM billing_price_books WHERE id=?').get(Number(result.price_book.id));
    assert.equal(rolled.provider, 'richbest', '回滚必须留在中转自己的价目源上');
    assert.equal(rolled.parent_price_book_id, Number(relayV2), '父版本应是中转的当前版本，而不是火山系统书');
    assert.equal(rolled.system_managed, 1);
    assert.match(rolled.name, /瑞池中转回滚价目/, '名称跟着供应商走');
  } finally { teardown(dbPath); }
});
