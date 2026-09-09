'use strict';
const { randomUUID } = require('node:crypto');
const prices = require('./costPriceService');
const ledger = require('./costLedgerService');
const query = require('./costQueryService');
function parse(value) { try { return JSON.parse(value || '{}'); } catch (_) { return {}; } }

function candidates(db, input) {
  const args = [], clauses = [];
  if (!input.date_from || !input.date_to) throw new Error('请选择历史账本结算日期范围');
  if (input.date_from > input.date_to) throw new Error('开始日期不能晚于结束日期');
  clauses.push('l.created_at>=? AND l.created_at<?');
  args.push(query.boundary(input.date_from), query.boundary(input.date_to, true));
  for (const key of ['organization_id', 'drama_id', 'user_id']) {
    if (input[key]) { clauses.push(`l.${key}=?`); args.push(Number(input[key])); }
  }
  const rows = db.prepare(`SELECT l.*,a.created_at AS authorized_at,a.snapshot_json AS authorization_snapshot,
    s.snapshot_json AS settlement_snapshot,s.amount_micro AS settlement_amount,s.authorization_id AS settlement_authorization_id
    FROM billing_usage_logs l LEFT JOIN billing_transactions a ON a.id=l.authorization_id
    LEFT JOIN billing_transactions s ON s.id=l.transaction_id AND s.type='settlement'
    WHERE ${clauses.join(' AND ')} ORDER BY l.created_at,l.id LIMIT 1001`).all(...args);
  if (rows.length > 1000) throw new Error('单批最多 1000 条历史汇总，请缩小日期或客户范围');
  return rows.map(row => {
    const snapshot = parse(row.snapshot_json), auth = parse(row.authorization_snapshot);
    const evidence = snapshot.cost_evidence || auth.cost_evidence || {};
    const source = `legacy_usage:${row.id}`;
    const loggedUsage = ledger.normalizeUsage(parse(row.usage_json), row.service_type);
    const settledUsage = ledger.normalizeUsage(parse(row.settlement_snapshot).actual_usage, row.service_type);
    const usage = loggedUsage || settledUsage;
    const time = evidence.submitted_at || row.authorized_at;
    const submitted = typeof time === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(time) && Number.isFinite(Date.parse(time)) ? new Date(time).toISOString() : null;
    const identity = snapshot.cost_attribution || auth.cost_attribution || {};
    const call = {
      source_key: source, operation_id: row.authorization_id || source, authorization_id: row.authorization_id,
      organization_id: row.organization_id, customer_kind: row.organization_id ? 'customer' : evidence.personal_account === true || (snapshot.account_scope || auth.account_scope) === 'personal' ? 'personal' : 'unknown',
      organization_name: identity.organization_name || (row.organization_id ? `客户 #${row.organization_id}（缺少历史名称）` : null), drama_id: row.drama_id, project_title: row.project_title_snapshot,
      user_id: row.user_id, user_name: identity.user_name || (row.user_id ? `用户 #${row.user_id}（缺少历史名称）` : null), source_kind: row.source_kind || 'historical_summary', source_id: row.source_id,
      account_id: evidence.account_id || null, config_id: evidence.config_id || null, connection_id: evidence.connection_id || null, provider: evidence.provider || null,
      provider_request_id: row.provider_request_id || null,
      model: evidence.model || snapshot.provider_model || auth.provider_model || row.model, service_type: row.service_type,
      submitted_at: submitted ? new Date(submitted).toISOString() : null, time_basis: evidence.submitted_at ? 'supplier_submission' : 'authorization_approximation',
      context_json: JSON.stringify(evidence.pricing_context || snapshot.pricing_context || auth.pricing_context || {}),
    };
    const reasons = [], warnings = [];
    if (db.prepare('SELECT 1 FROM cost_calls WHERE source_key=? OR (authorization_id=? AND origin=?)').get(source, row.authorization_id, 'live')) reasons.push('已有成本记录');
    if (!submitted) reasons.push('缺少供应商提交或预授权时间');
    if (!usage) reasons.push('缺少真实用量');
    if (loggedUsage && settledUsage && Object.keys({ ...loggedUsage, ...settledUsage }).some(key => loggedUsage[key] !== settledUsage[key])) reasons.push('用量日志与结算实际用量冲突');
    if (row.settlement_amount != null && (row.settlement_amount !== -row.charged_micro || row.settlement_authorization_id !== row.authorization_id)) reasons.push('结算金额或预授权关联冲突');
    if (!call.account_id) warnings.push('历史供应商账号未确定；不影响用量入账');
    if (call.customer_kind === 'unknown') warnings.push('历史客户归属未知；保留项目与用户 ID');
    const price = submitted ? prices.select(db, call) : null;
    const calculation = prices.calculate(price, usage, { ...parse(call.context_json), ...(usage?.input_token != null ? { input_tokens: usage.input_token + (usage.cache_token || 0) } : {}) });
    if (calculation.cost_status !== 'calculated') warnings.push(calculation.cost_status === 'missing_usage' ? '缺少规则要求的计量证据；已有用量保留' : '待补有效期内的适用审核价格或规格');
    return { source_id: row.id, source_key: source, label: '历史汇总记录', eligible: !reasons.length, reasons, warnings,
      source_hash: prices.hash(row), call, usage, price_id: price?.id || null, calculation };
  });
}
function preview(db, actor, input) {
  const items = candidates(db, input), id = randomUUID();
  const result = { items, eligible: items.filter(x => x.eligible).length, skipped: items.filter(x => !x.eligible).length,
    priced: items.filter(x => x.eligible && x.calculation.cost_status === 'calculated').length,
    unpriced: items.filter(x => x.eligible && x.calculation.cost_status !== 'calculated').length };
  db.prepare('INSERT INTO cost_backfill_batches(id,created_at,created_by,filters_json,preview_json) VALUES(?,?,?,?,?)')
    .run(id, new Date().toISOString(), actor, JSON.stringify(input), JSON.stringify(result));
  return get(db, id);
}
function get(db, id) {
  const row = db.prepare('SELECT * FROM cost_backfill_batches WHERE id=?').get(id);
  return row ? { ...row, filters: parse(row.filters_json), preview: parse(row.preview_json), result: row.result_json ? parse(row.result_json) : null } : null;
}
function execute(db, actor, id) {
  return db.transaction(() => {
    const batch = get(db, id); if (!batch) throw new Error('补算批次不存在');
    if (batch.status === 'executed') return batch;
    const fresh = new Map(candidates(db, batch.filters).map(x => [x.source_key, x]));
    const result = { inserted: 0, skipped: [], executed_by: actor };
    for (const item of batch.preview.items) {
      const current = fresh.get(item.source_key);
      if (!item.eligible || !current?.eligible || current.source_hash !== item.source_hash || current.price_id !== item.price_id) {
        result.skipped.push({ source_id: item.source_id, reasons: current?.reasons.length ? current.reasons : ['证据或价格已变化，请重新预览'] }); continue;
      }
      const call = { ...item.call, id: randomUUID(), attempt: 1, observed_at: new Date().toISOString(), origin: 'historical_summary', price_id: item.price_id };
      const keys = Object.keys(call);
      db.prepare(`INSERT INTO cost_calls(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(k => call[k] ?? null));
      ledger.observe(db, call.id, { status: 'completed', usage: item.usage, evidence_kind: 'historical_summary', reason: `历史补算批次 ${id}`, actor_id: actor });
      result.inserted++;
    }
    db.prepare("UPDATE cost_backfill_batches SET status='executed',executed_at=?,result_json=? WHERE id=?")
      .run(new Date().toISOString(), JSON.stringify(result), id);
    return get(db, id);
  })();
}
module.exports = { preview, get, execute };
