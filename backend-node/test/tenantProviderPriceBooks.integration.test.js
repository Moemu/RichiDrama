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

    const quoteRich = billing.quote(db, user, { service_type: 'text', model: 'rich-model', provider: 'richbest', usage: { request: 1 } });
    assert.equal(quoteRich.amount, 20, 'richbest call falls through to the platform richbest book instead of being rejected');
    assert.equal(quoteRich.rates[0].price_book_id, richBook);

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

    // Provider-unaware callers keep legacy single-book resolution.
    assert.doesNotThrow(() => billing.quote(db, user, { service_type: 'text', model: 'volc-model', usage: { request: 1 } }));

    // Catch-all ('') binding applies to any provider without a specific slot.
    const catchAll = book(db, '兜底书', '', [{ service_type: 'text', model: 'any-model', meter: 'request', unit_price: 1 }]);
    tenants.replaceBindings(db, group.id, { price_book_bindings: [{ provider: 'volcengine', price_book_id: volcBook }, { provider: '', price_book_id: catchAll }] });
    assert.equal(billing.quote(db, user, { service_type: 'text', model: 'any-model', provider: 'someone-else', usage: { request: 1 } }).amount, 1, 'catch-all serves unknown providers');
    assert.equal(billing.quote(db, user, { service_type: 'text', model: 'volc-model', provider: 'volcengine', usage: { request: 1 } }).amount, 10, 'exact provider slot still wins over catch-all');
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
