'use strict';
const billing = require('./billingService');
const ledger = require('./costLedgerService');
const supplierSnapshots = require('./supplierCostSnapshotService');
const supplierRates = require('./supplierCostRates');
const DAILY_BASIS = 'supplier_daily_v1';
const { boundary } = require('./costQueryService');
const parse = value => { try { return JSON.parse(value || '{}'); } catch (_) { return {}; } };
const METERS = ['input_token', 'cache_token', 'output_token', 'image', 'input_image', 'millisecond', 'second', 'character', 'request'];
const OFFICIAL_PRODUCT_SOURCES = new Set(['https://www.volcengine.com/product/yunque', 'https://www.volcengine.com/product/doubao/']);

// One business record per usage log or unsettled authorization. Attempt evidence
// stays attached to that record; historical imports never become extra usage.
const SOURCE = `WITH activity AS (
 SELECT 'usage:'||l.id id,l.id usage_id,l.authorization_id,l.user_id,l.organization_id,l.drama_id,
 l.project_title_snapshot project_title,l.source_kind,l.service_type,l.model,l.created_at occurred_at,
 l.snapshot_json, a.snapshot_json authorization_snapshot,l.usage_json,l.charged_micro,
 s.snapshot_json settlement_snapshot,s.amount_micro settlement_amount,s.authorization_id settlement_authorization_id,
 l.provider_request_id,'settled' status,NULL call_id
 FROM billing_usage_logs l LEFT JOIN billing_transactions a ON a.id=l.authorization_id AND a.type='authorization'
 LEFT JOIN billing_transactions s ON s.id=l.transaction_id AND s.type='settlement'
 UNION ALL
 SELECT 'authorization:'||a.id,NULL,a.id,a.user_id,a.organization_id,a.drama_id,a.project_title_snapshot,
 a.source_kind,json_extract(a.snapshot_json,'$.service_type'),json_extract(a.snapshot_json,'$.model'),a.created_at,
 a.snapshot_json,a.snapshot_json,NULL,NULL,NULL,NULL,NULL,NULL,
 CASE WHEN EXISTS(SELECT 1 FROM billing_transactions v WHERE v.authorization_id=a.id AND v.type='void') THEN 'released'
 WHEN EXISTS(SELECT 1 FROM billing_reconciliation_cases b WHERE b.authorization_id=a.id AND b.status='pending') THEN 'reconciliation' ELSE 'processing' END,NULL
 FROM billing_transactions a WHERE a.type='authorization' AND NOT EXISTS(SELECT 1 FROM billing_usage_logs l WHERE l.authorization_id=a.id)
 UNION ALL
 SELECT 'attempt:'||c.id,NULL,c.authorization_id,c.user_id,c.organization_id,c.drama_id,c.project_title,c.source_kind,
 c.service_type,c.model,c.submitted_at,'{}','{}',r.usage_json,NULL,NULL,NULL,NULL,c.provider_request_id,c.status,c.id
 FROM cost_calls c LEFT JOIN cost_revisions r ON r.id=c.latest_revision_id
 WHERE c.origin='live' AND NOT EXISTS(SELECT 1 FROM billing_transactions a WHERE a.id=c.authorization_id AND a.type='authorization')
 AND NOT EXISTS(SELECT 1 FROM billing_usage_logs l WHERE l.authorization_id=c.authorization_id)
)
SELECT x.*,(SELECT a.created_at FROM billing_transactions a WHERE a.id=x.authorization_id AND a.type='authorization') authorization_at,c.submitted_at,c.config_id,c.connection_id,c.provider,c.user_name recorded_user_name,c.organization_name recorded_organization_name,
 c.context_json,c.status attempt_status,r.usage_json observed_usage_json,
 (SELECT b.observed_usage_json FROM billing_reconciliation_cases b WHERE b.authorization_id=x.authorization_id AND b.observed_usage_json IS NOT NULL ORDER BY b.created_at DESC LIMIT 1) reconciliation_usage,
 COALESCE((SELECT SUM(-t.amount_micro) FROM billing_transactions t WHERE t.authorization_id=x.authorization_id AND t.type='adjustment'
 AND t.idempotency_key LIKE 'settlement-supplement:'||x.authorization_id||':%'),0) supplement_micro,
 cfg.name config_name,d.owner_user_id project_owner_id,owner.username project_owner_username
 FROM activity x LEFT JOIN cost_calls c ON c.id=COALESCE(x.call_id,
 (SELECT cc.id FROM cost_calls cc WHERE cc.authorization_id=x.authorization_id AND cc.origin='live' ORDER BY cc.submitted_at DESC,cc.id DESC LIMIT 1))
 LEFT JOIN cost_revisions r ON r.id=c.latest_revision_id LEFT JOIN ai_service_configs cfg ON cfg.id=c.config_id
 LEFT JOIN dramas d ON d.id=x.drama_id LEFT JOIN users owner ON owner.id=d.owner_user_id`;

function selection(input) {
  const clauses = [], args = [];
  for (const key of ['organization_id', 'drama_id', 'user_id', 'model', 'service_type', 'source_kind', 'id']) {
    if (input[key] == null || input[key] === '') continue;
    if (key.endsWith('_id')) {
      if (!Number.isSafeInteger(Number(input[key])) || Number(input[key]) < 0) throw new Error('筛选 ID 无效');
      if (Number(input[key]) === 0) { clauses.push(`x.${key} IS NULL`); continue; }
    }
    clauses.push(key === 'model' ? "COALESCE(json_extract(x.snapshot_json,'$.provider_model'),json_extract(x.authorization_snapshot,'$.provider_model'),x.model)=?" : `x.${key}=?`); args.push(input[key]);
  }
  if (input.date_from) { clauses.push('x.occurred_at>=?'); args.push(boundary(input.date_from)); }
  if (input.date_to) { clauses.push('x.occurred_at<?'); args.push(boundary(input.date_to, true)); }
  if (input.date_from && input.date_to && input.date_from > input.date_to) throw new Error('开始日期不能晚于结束日期');
  return { sql: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', args };
}

function providerSource(rate) {
  const c = rate.conditions || {};
  return c.currency === 'CNY' && c.provider === 'volcengine' &&
    ((c.source === 'ListModelActivations' && !!c.source_sync_id) || OFFICIAL_PRODUCT_SOURCES.has(c.source) || /^https:\/\/www\.volcengine\.com\/docs\//.test(c.source || ''));
}

function present(row) {
  const log = parse(row.snapshot_json), auth = parse(row.authorization_snapshot), settlement = parse(row.settlement_snapshot);
  const snapshot = Array.isArray(log.rates) && log.rates.length ? log : auth;
  const logged = ledger.normalizeUsage(parse(row.usage_json), row.service_type);
  const settled = ledger.normalizeUsage(settlement.actual_usage, row.service_type);
  const raw = logged ? parse(row.usage_json) : settled ? settlement.actual_usage
    : row.status === 'settled' ? {} : parse(row.reconciliation_usage || row.observed_usage_json);
  const usage = ledger.normalizeUsage(raw, row.service_type);
  const identity = log.cost_attribution || auth.cost_attribution || {};
  const result = {
    id: row.id, authorization_id: row.authorization_id, usage_id: row.usage_id, user_id: row.user_id,
    user_name: identity.user_name || row.recorded_user_name || (row.user_id ? `用户 #${row.user_id}` : '未知用户'),
    organization_id: row.organization_id, organization_name: identity.organization_name || row.recorded_organization_name || null,
    customer_kind: row.organization_id ? 'customer' : (log.account_scope || auth.account_scope) === 'personal' ? 'personal' : 'unknown',
    drama_id: row.drama_id, project_title: row.project_title, project_owner_id: row.project_owner_id,
    project_owner_username: row.project_owner_username, source_kind: row.source_kind, service_type: row.service_type,
    model: log.provider_model || auth.provider_model || row.model, billing_model: row.model, occurred_at: row.occurred_at,
    time_basis: row.status === 'settled' ? 'settlement' : row.call_id ? 'supplier_submission' : 'authorization',
    status: row.status, usage, pricing_context: { ...parse(row.context_json), ...snapshot.pricing_context },
    price_at: row.submitted_at || row.authorization_at || row.occurred_at,
    config_id: row.config_id, connection_id: row.connection_id, config_name: row.config_name, provider: row.provider,
    provider_request_id: row.provider_request_id, original_charged_micro: row.charged_micro == null ? null : row.charged_micro - row.supplement_micro,
    supplement_micro: row.supplement_micro, charged_micro: row.charged_micro,
    model_amount_micro: null, supplier_amount_micro: null, difference_micro: null, rates: [],
    cost_status: usage ? 'missing_price' : 'missing_usage', reason: usage ? '缺少调用时的价格快照' : '尚无实际用量，预授权用量不计入消耗',
  };
  if (logged && settled && Object.keys({ ...logged, ...settled }).some(k => logged[k] !== settled[k]) ||
      row.settlement_amount != null && (row.settlement_amount !== -(row.charged_micro - row.supplement_micro) || row.settlement_authorization_id !== row.authorization_id)) {
    return { ...result, usage: null, usage_evidence: { logged, settled }, cost_status: 'unverified', reason: '原用量或结算关联存在冲突，用量与估算暂不汇总' };
  }
  if (!usage && row.status === 'released') return { ...result, cost_status: 'released', reason: '预授权已释放，没有实际用量记录' };
  if (!usage || !snapshot.rates?.length) return result;
  try {
    const calculation = billing.snapshotCalculation(snapshot, raw);
    result.rates = calculation.rates;
    result.model_amount_micro = calculation.amount_micro;
    result.cost_status = 'calculated';
    result.difference_micro = result.charged_micro == null ? null : result.charged_micro - calculation.amount_micro;
    // Platform-free calls and custom prices cannot establish supplier cost.
    if (calculation.rates.every(rate => !rate.is_free && providerSource(rate))) result.supplier_amount_micro = calculation.amount_micro;
    result.reason = result.difference_micro == null ? '实际用量已记录，业务扣费尚未结算'
      : result.difference_micro === 0 ? '与原模型计价一致'
      : '原扣费（含关联补扣）与实际用量按原价计值不同；请核对结算记录';
  } catch (error) { result.cost_status = 'unverified'; result.reason = error.message; }
  return result;
}

function* records(db, input = {}, cursor = {}) {
  const daily = input.basis === DAILY_BASIS;
  const sources = daily ? supplierSnapshots.snapshots(db) : null;
  let { sql, args } = selection(input);
  if (cursor.after) { sql += (sql ? ' AND ' : ' WHERE ') + '(x.occurred_at,x.id)<(?,?)'; args.push(cursor.after.occurred_at, cursor.after.id); }
  const limit = cursor.limit ? ' LIMIT ?' : '';
  if (cursor.limit) args.push(cursor.limit);
  for (const raw of db.prepare(SOURCE + sql + ' ORDER BY x.occurred_at DESC,x.id DESC' + limit).iterate(...args)) {
    const row = present(raw);
    if (daily) {
      row.supplier = supplierRates.estimate(row, sources);
      row.platform_reason = row.reason; row.platform_cost_status = row.cost_status;
      row.supplier_amount_micro = row.supplier.amount_micro; row.cost_status = row.supplier.status; row.reason = row.supplier.reason;
    }
    if (input.customer_kind && input.customer_kind !== row.customer_kind || input.cost_status && input.cost_status !== row.cost_status || input.status && input.status !== row.status) continue;
    yield row;
  }
}
function totals() {
  return { calls: 0, calculated_calls: 0, supplier_priced_calls: 0, charged_calls: 0, processing_calls: 0, released_calls: 0, missing_usage_calls: 0,
    missing_price_calls: 0, unverified_calls: 0, model_amount_micro: 0, supplier_amount_micro: 0, charged_micro: 0,
    supplier_stale_calls: 0, supplier_fixed_calls: 0, difference_calls: 0, total_tokens: 0, video_output_token: 0, ...Object.fromEntries(METERS.map(k => [k, 0])) };
}
function add(total, row) {
  total.calls++;
  for (const [amount, count] of [['model_amount_micro', 'calculated_calls'], ['supplier_amount_micro', 'supplier_priced_calls'], ['charged_micro', 'charged_calls']]) {
    if (row[amount] == null) continue;
    if (!Number.isSafeInteger(row[amount]) || !Number.isSafeInteger(total[amount] + row[amount])) throw new Error('汇总金额超出安全范围，请缩小查询范围');
    total[count]++; total[amount] += row[amount];
  }
  if (row.supplier?.stale && row.supplier_amount_micro != null) total.supplier_stale_calls++;
  if (row.supplier?.source === 'mediakit_bill_202609') total.supplier_fixed_calls++;
  if (row.difference_micro) total.difference_calls++;
  if (['processing', 'reconciliation'].includes(row.status)) total.processing_calls++;
  if (row.cost_status === 'released') total.released_calls++;
  if (row.cost_status === 'missing_usage') total.missing_usage_calls++;
  if (row.cost_status === 'missing_price') total.missing_price_calls++;
  if (row.cost_status === 'unverified') total.unverified_calls++;
  for (const key of METERS) total[key] += row.usage?.[key] || 0;
  total.total_tokens = total.input_token + total.cache_token + total.output_token;
  if (row.service_type === 'video') total.video_output_token += row.usage?.output_token || 0;
}
function group(row, key) {
  const fields = { customer: ['organization_id', 'organization_name'], project: ['drama_id', 'project_title'], user: ['user_id', 'user_name'], model: ['model', 'model'], operation: ['source_kind', 'source_kind'] };
  if (fields[key]) {
    const [id, label] = fields[key];
    return { key: String(row[id] ?? (key === 'customer' ? row.customer_kind : 'unknown')), label: row[label] || (key === 'customer' ? row.customer_kind === 'personal' ? '个人账户' : row.organization_id ? `客户 #${row.organization_id}` : '未知客户' : null) };
  }
  const date = new Date(Date.parse(row.occurred_at) + 28800000).toISOString();
  const value = key === 'hour' ? date.slice(0, 13).replace('T', ' ') + ':00' : date.slice(0, key === 'month' ? 7 : 10);
  return { key: value, label: value };
}
function activity(db, input = {}) {
  const key = input.group_by || 'project';
  if (!['customer', 'project', 'user', 'model', 'operation', 'hour', 'day', 'month'].includes(key)) throw new Error('不支持的分组维度');
  const page = Math.max(1, Math.trunc(Number(input.page) || 1)), size = 20;
  const groupPage = Math.max(1, Math.trunc(Number(input.group_page) || 1));
  const summary = totals(), items = [], groups = new Map();
  for (const row of records(db, input)) {
    if (summary.calls >= (page - 1) * size && items.length < size) items.push(row);
    add(summary, row);
    const g = group(row, key);
    if (!groups.has(g.key)) groups.set(g.key, { ...g, ...totals(), owners: [], has_unknown_owner: false });
    if (!groups.get(g.key).label && g.label) groups.get(g.key).label = g.label;
    const grouped = groups.get(g.key);
    if (row.project_owner_id == null) grouped.has_unknown_owner = true;
    else if (!grouped.owners.some(owner => owner.id === row.project_owner_id)) {
      grouped.owners.push({ id: row.project_owner_id, username: row.project_owner_username || null });
    }
    add(groups.get(g.key), row);
  }
  return { basis: input.basis === DAILY_BASIS ? DAILY_BASIS : 'billing_activity_v1', ...(input.basis === DAILY_BASIS ? { supplier_prices: supplierSnapshots.status(db) } : {}), generated_at: new Date().toISOString(), timezone: 'Asia/Shanghai', summary,
    calls: { items, total: summary.calls, page, page_size: size },
    breakdown: { items: Array.from(groups.values()).sort((a, b) => (input.basis === DAILY_BASIS ? b.supplier_amount_micro - a.supplier_amount_micro : b.model_amount_micro - a.model_amount_micro) || a.key.localeCompare(b.key)).slice((groupPage - 1) * size, groupPage * size).map(g => ({ ...g, label: g.label || (g.key === 'unknown' ? '未关联' : `#${g.key}`) })), total: groups.size, page: groupPage, page_size: size } };
}
function detail(db, id, input = {}) {
  let row;
  for (const item of records(db, { id, basis: input.basis })) { row = item; break; }
  if (!row) throw new Error('调用记录不存在');
  row.attempts = db.prepare('SELECT id FROM cost_calls WHERE authorization_id=? OR id=? OR source_key=? ORDER BY submitted_at,id')
    .all(row.authorization_id, id.startsWith('attempt:') ? id.slice(8) : '', row.usage_id ? `legacy_usage:${row.usage_id}` : '').map(x => ledger.get(db, x.id));
  return row;
}
function createReport(db, actor, input) {
  if (!/^\d{4}-\d{2}$/.test(input.month || '')) throw new Error('月份格式必须为 YYYY-MM');
  const from = input.month + '-01'; boundary(from);
  const last = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const organization = db.prepare('SELECT id,name FROM customer_organizations WHERE id=?').get(Number(input.organization_id));
  if (!organization) throw new Error('客户不存在');
  const filters = { organization_id: organization.id, date_from: from, date_to: last, ...(input.basis === DAILY_BASIS ? { basis: DAILY_BASIS } : {}) };
  return db.transaction(() => {
    const id = require('node:crypto').randomUUID(), at = new Date().toISOString();
    const version = db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM cost_reports WHERE organization_id=? AND month=?').get(organization.id, input.month).n;
    const summary = { ...totals(), basis: input.basis === DAILY_BASIS ? DAILY_BASIS : 'billing_activity_v1', organization_name: organization.name, filters, generated_at: at };
    db.prepare('INSERT INTO cost_reports VALUES(?,?,?,?,?,?,?)').run(id, organization.id, input.month, version, at, actor, '{}');
    const insert = db.prepare('INSERT INTO cost_report_items VALUES(?,?,NULL,?)');
    let after;
    for (;;) {
      const rows = Array.from(records(db, filters, { after, limit: 500 }));
      if (!rows.length) break;
      for (const row of rows) { add(summary, row); insert.run(id, row.id, JSON.stringify(row)); }
      after = rows.at(-1);
    }
    db.prepare('UPDATE cost_reports SET summary_json=? WHERE id=?').run(JSON.stringify(summary), id);
    return require('./costQueryService').report(db, id);
  })();
}
function filterOptions(db) {
  const projects = db.prepare(`WITH candidates AS (
    SELECT id, title, 1 current FROM dramas
    UNION ALL SELECT drama_id, project_title_snapshot, 0 FROM billing_usage_logs
    UNION ALL SELECT drama_id, project_title_snapshot, 0 FROM billing_transactions WHERE type='authorization'
    UNION ALL SELECT drama_id, project_title, 0 FROM cost_calls WHERE origin='live'
  ) SELECT id, COALESCE(MAX(CASE WHEN current=1 THEN NULLIF(title,'') END), MAX(NULLIF(title,''))) title
    FROM candidates WHERE id IS NOT NULL AND id>0 GROUP BY id ORDER BY id DESC`).all();
  const users = db.prepare(`WITH ids AS (
    SELECT id FROM users UNION SELECT user_id FROM billing_usage_logs
    UNION SELECT user_id FROM billing_transactions WHERE type='authorization'
    UNION SELECT user_id FROM cost_calls WHERE origin='live'
  ) SELECT ids.id,u.username FROM ids LEFT JOIN users u ON u.id=ids.id
    WHERE ids.id IS NOT NULL AND ids.id>0 ORDER BY ids.id`).all();
  return { projects, users };
}

module.exports = { activity, detail, records, createReport, filterOptions };
