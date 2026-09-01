function hasTable(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function membershipForUser(db, userId) {
  if (!userId || !hasTable(db, 'customer_organization_memberships')) return null;
  return db.prepare(`SELECT o.id, o.name, o.status, o.config_tenant_id,
      m.role AS membership_role
    FROM customer_organization_memberships m
    JOIN customer_organizations o ON o.id=m.organization_id
    WHERE m.user_id=?`).get(Number(userId)) || null;
}

function account(db, organizationId) {
  const id = Number(organizationId);
  const at = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO organization_billing_accounts (organization_id,updated_at) VALUES (?,?)').run(id, at);
  return db.prepare('SELECT * FROM organization_billing_accounts WHERE organization_id=?').get(id);
}

function listOrganizations(db) {
  if (!hasTable(db, 'customer_organizations')) return [];
  return db.prepare(`SELECT o.*, t.name AS config_tenant_name,
      COUNT(m.user_id) AS member_count,
      COALESCE(a.balance_micro,0) AS balance_micro,
      COALESCE(a.frozen_micro,0) AS frozen_micro,
      COALESCE(a.total_recharged_micro,0) AS total_recharged_micro,
      COALESCE(a.total_consumed_micro,0) AS total_consumed_micro
    FROM customer_organizations o
    JOIN tenants t ON t.id=o.config_tenant_id
    LEFT JOIN customer_organization_memberships m ON m.organization_id=o.id
    LEFT JOIN organization_billing_accounts a ON a.organization_id=o.id
    GROUP BY o.id ORDER BY o.id`).all().map((row) => ({ ...row, member_count: Number(row.member_count || 0) }));
}

function organizationDetail(db, organizationId) {
  if (!hasTable(db, 'customer_organizations')) return null;
  const row = db.prepare(`SELECT o.*,t.name AS config_tenant_name
    FROM customer_organizations o JOIN tenants t ON t.id=o.config_tenant_id
    WHERE o.id=?`).get(Number(organizationId));
  if (!row) return null;
  const members = db.prepare(`SELECT u.id,u.username,u.display_name,u.is_active,m.role AS membership_role
    FROM customer_organization_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=? ORDER BY u.id`).all(row.id).map((item) => ({ ...item, is_active: !!item.is_active }));
  return { ...row, members, account: account(db, row.id) };
}

function saveOrganization(db, actorId, input, organizationId) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('客户账户名称必填');
  const tenantId = Number(input.config_tenant_id);
  const tenant = db.prepare("SELECT id FROM tenants WHERE id=? AND status='active'").get(tenantId);
  if (!tenant) throw new Error('请选择有效的配置组');
  const status = input.status === 'disabled' ? 'disabled' : 'active';
  const at = new Date().toISOString();
  let id = Number(organizationId);
  if (id) {
    const changed = db.prepare('UPDATE customer_organizations SET name=?,status=?,config_tenant_id=?,updated_at=? WHERE id=?')
      .run(name, status, tenantId, at, id);
    if (!changed.changes) return null;
    const members = db.prepare('SELECT user_id,role FROM customer_organization_memberships WHERE organization_id=?').all(id);
    for (const member of members) {
      require('./tenantService').setMember(db, tenantId, member.user_id, member.role === 'organization_admin' ? 'tenant_admin' : 'creator');
    }
  } else {
    const result = db.prepare('INSERT INTO customer_organizations (name,status,config_tenant_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(name, status, tenantId, actorId || null, at, at);
    id = Number(result.lastInsertRowid);
    account(db, id);
  }
  return organizationDetail(db, id);
}

function replaceMembers(db, organizationId, members) {
  const organization = organizationDetail(db, organizationId);
  if (!organization) throw new Error('客户账户不存在');
  const requested = Array.isArray(members) ? members : [];
  const seen = new Set();
  const normalized = requested.map((item) => {
    const userId = Number(typeof item === 'object' ? item.user_id : item);
    if (!Number.isSafeInteger(userId) || userId <= 0 || seen.has(userId)) throw new Error('成员列表无效');
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId)) throw new Error('成员不存在');
    seen.add(userId);
    return { user_id: userId, role: item?.role === 'organization_admin' ? 'organization_admin' : 'member' };
  });
  const at = new Date().toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM customer_organization_memberships WHERE organization_id=?').run(organization.id);
    const insert = db.prepare(`INSERT INTO customer_organization_memberships (organization_id,user_id,role,created_at,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET organization_id=excluded.organization_id,role=excluded.role,updated_at=excluded.updated_at`);
    for (const member of normalized) {
      insert.run(organization.id, member.user_id, member.role, at, at);
      require('./tenantService').setMember(db, organization.config_tenant_id, member.user_id, member.role === 'organization_admin' ? 'tenant_admin' : 'creator');
    }
  })();
  return organizationDetail(db, organization.id);
}

function usageMembers(db, organizationId) {
  const id = Number(organizationId);
  if (!Number.isSafeInteger(id) || id <= 0) return [];
  return db.prepare(`SELECT u.id,u.username,u.display_name,u.is_active,
      CASE WHEN current_member.user_id IS NULL THEN 0 ELSE 1 END AS is_current
    FROM users u
    JOIN (
      SELECT user_id FROM customer_organization_memberships WHERE organization_id=?
      UNION
      SELECT user_id FROM billing_usage_logs WHERE organization_id=?
    ) consumer ON consumer.user_id=u.id
    LEFT JOIN customer_organization_memberships current_member
      ON current_member.organization_id=? AND current_member.user_id=u.id
    ORDER BY is_current DESC,COALESCE(NULLIF(u.display_name,''),u.username),u.id`).all(id, id, id)
    .map((row) => ({ ...row, is_active: !!row.is_active, is_current: !!row.is_current }));
}

module.exports = { hasTable, membershipForUser, account, listOrganizations, organizationDetail, saveOrganization, replaceMembers, usageMembers };
