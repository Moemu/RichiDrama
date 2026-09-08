const test = require('node:test');
const assert = require('node:assert/strict');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const auth = require('../src/services/authService');
const billing = require('../src/services/billingService');

test('console project ledger filters read other owners without granting creative access, including after restart', async () => {
  const fixture = await modelCatalogFixture();
  try {
    const { db, admin } = fixture;
    const owner = auth.createUser(db, { username: 'ledger-owner', password: 'fixture-password' }, admin.id);
    const roleOnly = auth.createUser(db, { username: 'ledger-role-only', password: 'fixture-password' }, admin.id);
    db.prepare("UPDATE users SET role='admin',console_access=0,account_kind='creator' WHERE id=?").run(roleOnly.id);
    const at = '2026-09-08T03:00:00.000Z';
    db.prepare('INSERT INTO dramas (id,title,owner_user_id,created_at,updated_at) VALUES (73,?,?,?,?),(74,?,?,?,?)')
      .run('Ledger project', owner.id, at, at, 'Other project', owner.id, at, at);
    billing.adjustBalance(db, admin.id, owner.id, 100, 'isolated ledger fixture');
    for (const dramaId of [73, 74]) {
      const authorization = billing.createAuthorization(db, owner, {
        idempotency_key: `ledger-${dramaId}`, drama_id: dramaId,
        service_type: 'image', model: 'existing-image', usage: { image: 1 },
      });
      billing.settleAuthorization(db, owner, authorization.authorization_id, {
        usage: { image: 1 }, provider_request_id: `fixture-request-${dramaId}`,
      });
    }
    async function login(username) {
      const result = await fixture.request('POST', '/auth/login', { username, password: 'fixture-password' });
      assert.equal(result.status, 200);
      return result.cookie;
    }
    const adminCookie = await login(admin.username);
    const ownerCookie = await login(owner.username);
    const roleOnlyCookie = await login(roleOnly.username);

    async function verify() {
      // The fixture reruns legacy account migrations on restart; restore this
      // deliberately restricted role to exercise the console-access boundary.
      fixture.db.prepare("UPDATE users SET role='admin',console_access=0,account_kind='creator' WHERE id=?").run(roleOnly.id);
      const overview = await fixture.request('GET', '/admin/project-usage/73', undefined, adminCookie);
      assert.equal(overview.status, 200);
      const usage = await fixture.request('GET', '/admin/usage?drama_id=73&page=1&page_size=20', undefined, adminCookie);
      assert.equal(usage.status, 200, JSON.stringify(usage.body));
      assert.equal(usage.body.data.total, 1);
      assert.equal(usage.body.data.items[0].drama_id, 73);
      assert.equal(usage.body.data.items[0].provider_request_id, 'fixture-request-73');
      const summary = await fixture.request('GET', '/admin/usage-summary?drama_id=73', undefined, adminCookie);
      assert.equal(summary.status, 200);
      assert.equal(summary.body.data.summary.charged, overview.body.data.summary.charged);
      const transactions = await fixture.request('GET', '/admin/transactions?drama_id=73', undefined, adminCookie);
      assert.equal(transactions.status, 200);
      assert.equal(transactions.body.data.total, 2);
      assert.ok(transactions.body.data.items.every(row => row.drama_id === 73));
      for (const cookie of [ownerCookie, roleOnlyCookie]) {
        for (const route of ['/admin/usage', '/admin/usage-summary', '/admin/transactions']) {
          const denied = await fixture.request('GET', `${route}?drama_id=73`, undefined, cookie);
          assert.ok([403, 404].includes(denied.status), `${route}: ${denied.status} ${JSON.stringify(denied.body)}`);
        }
      }
      assert.equal((await fixture.request('GET', '/admin/usage?drama_id=73')).status, 401);
      assert.equal((await fixture.request('GET', '/images?drama_id=73', undefined, adminCookie)).status, 404);
      assert.equal((await fixture.request('POST', '/images', { drama_id: 73 }, adminCookie)).status, 404);
      assert.equal((await fixture.request('GET', '/billing/usage?drama_id=73', undefined, adminCookie)).status, 404);
    }
    await verify();
    await fixture.restart();
    await verify();
  } finally {
    await fixture.close();
  }
});
