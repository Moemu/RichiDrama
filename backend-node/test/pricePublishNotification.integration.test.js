const test = require('node:test');
const assert = require('node:assert/strict');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');

test('HTTP price publication supports silent updates, preserves old notices and stays idempotent after restart', async () => {
  const f = await modelCatalogFixture();
  try {
    const cookie = (await f.request('POST', '/auth/login', { username: f.admin.username, password: 'fixture-password' })).cookie;
    const call = (method, route, body) => f.request(method, route, body, cookie);
    async function draft(bookId, price) {
      const result = await call('POST', '/admin/model-catalog/price-draft', { service_type: 'image', model: 'existing-image', price_book_id: bookId, items: [{ meter: 'image', unit_price: price }] });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      return result.body.data;
    }
    const first = await draft(f.book.id, 2);
    const notified = await call('POST', `/admin/price-books/${first.id}/publish`, { confirm: true, reason: 'legacy request', idempotency_key: 'legacy-notify' });
    assert.equal(notified.status, 200, JSON.stringify(notified.body));
    assert.ok(notified.body.data.notice_id);
    const notices = (await call('GET', '/notices/active')).body.data;
    assert.equal(notices.length, 1);
    const second = await draft(first.id, 3);
    const route = `/admin/price-books/${second.id}/publish`;
    const body = { confirm: true, reason: 'silent price update', idempotency_key: 'silent-notify', notify_users: false, notice_title: ' ', notice_body: ' ' };
    assert.equal((await call('POST', route, { ...body, notify_users: 'false' })).status, 400);
    assert.equal((await call('POST', route, { ...body, notify_users: true })).status, 400);
    const silent = await call('POST', route, body);
    assert.equal(silent.status, 200, JSON.stringify(silent.body));
    assert.equal(silent.body.data.notice_id, null);
    assert.equal(silent.body.data.price_book.status, 'published');
    assert.deepEqual((await call('GET', '/notices/active')).body.data, notices);
    const third = await draft(second.id, 4);
    await f.restart();
    const quote = await call('POST', '/billing/quotes', { service_type: 'image', model: 'existing-image', usage: { image: 1 } });
    assert.equal(quote.body.data.amount, 3);
    const retry = await call('POST', route, { ...body, notify_users: true });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.data.reused, true);
    assert.deepEqual((await call('GET', '/notices/active')).body.data, notices);
    const explicit = await call('POST', `/admin/price-books/${third.id}/publish`, { confirm: true, reason: 'explicit notice', idempotency_key: 'explicit-notify', notify_users: true, notice_title: 'New price', notice_body: 'Price updated' });
    assert.equal(explicit.status, 200);
    assert.ok(explicit.body.data.notice_id);
    assert.equal((await call('GET', '/notices/active')).body.data.length, 2);
  } finally { await f.close(); }
});

test('HTTP rollback accepts silent publication without creating notifications', async () => {
  const f = await modelCatalogFixture();
  try {
    const cookie = (await f.request('POST', '/auth/login', { username: f.admin.username, password: 'fixture-password' })).cookie;
    const call = (route, body) => f.request('POST', route, body, cookie);
    const previous = f.book;
    f.db.prepare('UPDATE billing_price_books SET system_managed=1,version=100 WHERE id=?').run(previous.id);
    const draft = await call('/admin/model-catalog/price-draft', { service_type: 'image', model: 'existing-image', price_book_id: previous.id, items: [{ meter: 'image', unit_price: 7 }] });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    assert.equal((await call(`/admin/price-books/${draft.body.data.id}/publish`, { confirm: true, reason: 'fixture', idempotency_key: 'before-rollback', notify_users: false })).status, 200);
    const body = { confirm: true, reason: 'silent rollback', idempotency_key: 'rollback-silent', notify_users: false };
    const route = `/admin/price-books/${previous.id}/rollback`;
    const count = f.db.prepare('SELECT count(*) n FROM billing_price_books').get().n;
    assert.equal((await call(route, { ...body, notify_users: 'false' })).status, 400);
    assert.equal(f.db.prepare('SELECT count(*) n FROM billing_price_books').get().n, count);
    const rolled = await call(route, body);
    assert.equal(rolled.status, 200, JSON.stringify(rolled.body));
    assert.equal(rolled.body.data.notice_id, null);
    assert.equal(rolled.body.data.price_book.status, 'published');
    assert.equal(f.db.prepare('SELECT count(*) n FROM system_notices').get().n, 0);
    await f.restart();
    assert.equal((await call(route, body)).body.data.reused, true);
    assert.equal(f.db.prepare('SELECT count(*) n FROM system_notices').get().n, 0);
  } finally { await f.close(); }
});
