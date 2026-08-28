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
const organizations = require('../src/services/customerOrganizationService');

function openDatabase(dbPath) {
  const db = getDb({ path: dbPath, type: 'sqlite' });
  runMigrationsAndEnsure(db);
  return db;
}

function removeDatabase(dbPath) {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
}

test('organization members share one account and authorization snapshots survive membership changes', () => {
  const dbPath = path.join(os.tmpdir(), `local-mini-drama-organization-${Date.now()}-${Math.random()}.db`);
  let db = openDatabase(dbPath);
  try {
    const log = { info() {}, warn() {} };
    const admin = auth.ensureBootstrapAdmin(db, log);
    const first = auth.createUser(db, { username: 'shared-first', password: 'user123456' }, admin.id);
    const second = auth.createUser(db, { username: 'shared-second', password: 'user123456' }, admin.id);
    billing.savePriceBook(db, admin.id, { name: '共享额度测试价目', status: 'published', items: [{ service_type: 'image', model: 'shared-image', meter: 'image', unit_price: 25 }] });
    const tenant = tenants.tenantForUser(db, first.id);
    const primary = organizations.saveOrganization(db, admin.id, { name: '客户企业 A', config_tenant_id: tenant.id });
    organizations.replaceMembers(db, primary.id, [{ user_id: first.id, role: 'organization_admin' }, { user_id: second.id, role: 'member' }]);
    billing.adjustOrganizationBalance(db, admin.id, primary.id, 100, '共享额度', { operation: 'grant', idempotency_key: 'org-grant-1' });

    assert.equal(billing.account(db, first.id).balance_micro, 0);
    assert.equal(billing.account(db, second.id).balance_micro, 0);
    assert.equal(billing.payerAccount(db, first.id).balance_micro, 1000000);
    assert.equal(billing.payerAccount(db, second.id).organization_id, primary.id);

    const authorization = billing.createAuthorization(db, { id: first.id, role: 'user' }, {
      idempotency_key: 'shared-image-1', service_type: 'image', model: 'shared-image', usage: { image: 1 },
    });
    const secondAuthorization = billing.createAuthorization(db, { id: second.id, role: 'user' }, {
      idempotency_key: 'shared-image-2', service_type: 'image', model: 'shared-image', usage: { image: 1 },
    });
    assert.equal(organizations.account(db, primary.id).frozen_micro, authorization.amount_micro + secondAuthorization.amount_micro);
    assert.equal(db.prepare('SELECT organization_id FROM billing_transactions WHERE id=?').get(authorization.authorization_id).organization_id, primary.id);
    billing.voidAuthorization(db, { id: second.id, role: 'user' }, secondAuthorization.authorization_id, '共享额度测试释放');
    assert.equal(organizations.account(db, primary.id).frozen_micro, authorization.amount_micro);

    const secondary = organizations.saveOrganization(db, admin.id, { name: '客户企业 B', config_tenant_id: tenant.id });
    billing.adjustOrganizationBalance(db, admin.id, secondary.id, 10, '独立共享额度', { operation: 'grant', idempotency_key: 'org-grant-1' });
    organizations.replaceMembers(db, secondary.id, [{ user_id: first.id, role: 'member' }]);
    billing.settleAuthorization(db, { id: first.id, role: 'user' }, authorization.authorization_id, { usage: { image: 1 }, provider_request_id: 'org-provider-1' });
    assert.equal(organizations.account(db, primary.id).frozen_micro, 0);
    assert.equal(organizations.account(db, primary.id).balance_micro, 750000);
    assert.equal(organizations.account(db, secondary.id).balance_micro, 100000);
    assert.equal(db.prepare('SELECT organization_id FROM billing_usage_logs WHERE authorization_id=?').get(authorization.authorization_id).organization_id, primary.id);

    closeDb();
    db = openDatabase(dbPath);
    assert.equal(organizations.organizationDetail(db, primary.id).account.balance_micro, 750000);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM billing_transactions WHERE organization_id=?').get(primary.id).count, 5);
  } finally { removeDatabase(dbPath); }
});

test('existing personal balances and ledger rows stay personal until explicit membership', () => {
  const dbPath = path.join(os.tmpdir(), `local-mini-drama-personal-compat-${Date.now()}-${Math.random()}.db`);
  const db = openDatabase(dbPath);
  try {
    const admin = auth.ensureBootstrapAdmin(db, { info() {}, warn() {} });
    const user = auth.createUser(db, { username: 'personal-compatible', password: 'user123456' }, admin.id);
    billing.adjustBalance(db, admin.id, user.id, 50, '历史个人额度', { operation: 'grant', idempotency_key: 'personal-grant-1' });
    assert.equal(billing.payerAccount(db, user.id).account_scope, 'personal');
    assert.equal(billing.payerAccount(db, user.id).balance_micro, 500000);
    assert.equal(db.prepare('SELECT organization_id FROM billing_transactions WHERE user_id=?').get(user.id).organization_id, null);
  } finally { removeDatabase(dbPath); }
});

test('customer account is the only payer while membership is active', () => {
  const dbPath = path.join(os.tmpdir(), `local-mini-drama-payer-priority-${Date.now()}-${Math.random()}.db`);
  const db = openDatabase(dbPath);
  try {
    const admin = auth.ensureBootstrapAdmin(db, { info() {}, warn() {} });
    const user = auth.createUser(db, { username: 'payer-priority', password: 'user123456' }, admin.id);
    billing.adjustBalance(db, admin.id, user.id, 100, '个人额度', { operation: 'grant', idempotency_key: 'personal-priority-grant' });
    billing.savePriceBook(db, admin.id, { name: '账户优先级测试价目', status: 'published', items: [{ service_type: 'image', model: 'priority-image', meter: 'image', unit_price: 25 }] });
    const tenant = tenants.tenantForUser(db, user.id);
    const organization = organizations.saveOrganization(db, admin.id, { name: '优先级测试企业', config_tenant_id: tenant.id });
    organizations.replaceMembers(db, organization.id, [{ user_id: user.id, role: 'member' }]);
    billing.adjustOrganizationBalance(db, admin.id, organization.id, 24, '共享额度不足', { operation: 'grant', idempotency_key: 'organization-priority-grant' });

    assert.throws(() => billing.createAuthorization(db, { id: user.id, role: 'user' }, {
      idempotency_key: 'priority-insufficient', service_type: 'image', model: 'priority-image', usage: { image: 1 },
    }), /余额不足/);
    assert.equal(billing.account(db, user.id).balance_micro, 1000000);
    assert.equal(organizations.account(db, organization.id).balance_micro, 240000);
    assert.equal(organizations.account(db, organization.id).frozen_micro, 0);

    billing.adjustOrganizationBalance(db, admin.id, organization.id, 1, '补足共享额度', { operation: 'grant', idempotency_key: 'organization-priority-top-up' });
    const authorization = billing.createAuthorization(db, { id: user.id, role: 'user' }, {
      idempotency_key: 'priority-shared-charge', service_type: 'image', model: 'priority-image', usage: { image: 1 },
    });
    billing.settleAuthorization(db, { id: user.id, role: 'user' }, authorization.authorization_id, { usage: { image: 1 } });
    assert.equal(organizations.account(db, organization.id).balance_micro, 0);
    assert.equal(billing.account(db, user.id).balance_micro, 1000000);

    organizations.saveOrganization(db, admin.id, { name: organization.name, status: 'disabled', config_tenant_id: tenant.id }, organization.id);
    assert.throws(() => billing.createAuthorization(db, { id: user.id, role: 'user' }, {
      idempotency_key: 'priority-disabled-account', service_type: 'image', model: 'priority-image', usage: { image: 1 },
    }), /客户共享账户已停用/);
    assert.equal(billing.account(db, user.id).balance_micro, 1000000);

    organizations.replaceMembers(db, organization.id, []);
    assert.equal(billing.payerAccount(db, user.id).account_scope, 'personal');
    const personalAuthorization = billing.createAuthorization(db, { id: user.id, role: 'user' }, {
      idempotency_key: 'priority-personal-after-removal', service_type: 'image', model: 'priority-image', usage: { image: 1 },
    });
    assert.equal(billing.account(db, user.id).frozen_micro, 250000);
    billing.voidAuthorization(db, { id: user.id, role: 'user' }, personalAuthorization.authorization_id, '个人额度恢复测试');
  } finally { removeDatabase(dbPath); }
});

test('shared authorization cannot overspend and balance arithmetic rejects overflow', () => {
  const dbPath = path.join(os.tmpdir(), `local-mini-drama-overflow-${Date.now()}-${Math.random()}.db`);
  const db = openDatabase(dbPath);
  try {
    const admin = auth.ensureBootstrapAdmin(db, { info() {}, warn() {} });
    const first = auth.createUser(db, { username: 'overflow-first', password: 'user123456' }, admin.id);
    const second = auth.createUser(db, { username: 'overflow-second', password: 'user123456' }, admin.id);
    billing.savePriceBook(db, admin.id, { name: '超扣测试价目', status: 'published', items: [{ service_type: 'image', model: 'overflow-image', meter: 'image', unit_price: 25 }] });
    const tenant = tenants.tenantForUser(db, first.id);
    const organization = organizations.saveOrganization(db, admin.id, { name: '溢出测试企业', config_tenant_id: tenant.id });
    organizations.replaceMembers(db, organization.id, [{ user_id: first.id }, { user_id: second.id }]);
    billing.adjustOrganizationBalance(db, admin.id, organization.id, 25, '单次调用额度', { operation: 'grant', idempotency_key: 'overspend-grant' });

    const firstAuthorization = billing.createAuthorization(db, { id: first.id, role: 'user' }, {
      idempotency_key: 'overspend-first', service_type: 'image', model: 'overflow-image', usage: { image: 1 },
    });
    assert.throws(() => billing.createAuthorization(db, { id: second.id, role: 'user' }, {
      idempotency_key: 'overspend-second', service_type: 'image', model: 'overflow-image', usage: { image: 1 },
    }), /余额不足/);
    assert.equal(organizations.account(db, organization.id).frozen_micro, 250000);
    billing.voidAuthorization(db, { id: first.id, role: 'user' }, firstAuthorization.authorization_id, '释放测试冻结');

    billing.adjustOrganizationBalance(db, admin.id, organization.id, 900719925449.0991, '安全整数上界', { operation: 'grant', idempotency_key: 'safe-limit-grant' });
    const beforeOverflow = organizations.account(db, organization.id).balance_micro;
    assert.equal(beforeOverflow, Number.MAX_SAFE_INTEGER);
    assert.throws(() => billing.adjustOrganizationBalance(db, admin.id, organization.id, 0.0001, '越界调整', {
      operation: 'grant', idempotency_key: 'overflow-grant',
    }), /积分超出安全范围/);
    assert.equal(organizations.account(db, organization.id).balance_micro, Number.MAX_SAFE_INTEGER);
  } finally { removeDatabase(dbPath); }
});
