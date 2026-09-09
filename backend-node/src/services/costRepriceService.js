'use strict';
const { randomUUID } = require('node:crypto');
const query = require('./costQueryService');
const prices = require('./costPriceService');
const ledger = require('./costLedgerService');
const parse = value => JSON.parse(value || '{}');

function candidates(db, input) {
  if (!input.date_from || !input.date_to) throw new Error('请选择待估算记录的日期范围');
  const { where, args } = query.filters(input);
  const rows = db.prepare(`SELECT c.*,r.usage_json FROM cost_calls c JOIN cost_revisions r ON r.id=c.latest_revision_id
    ${where} AND r.cost_status='missing_price' ORDER BY c.submitted_at,c.id LIMIT 1001`).all(...args);
  if (rows.length > 1000) throw new Error('单批最多 1000 条，请缩小查询范围');
  return rows.map(row => {
    const price = prices.select(db, row), usage = parse(row.usage_json), context = parse(row.context_json);
    if (usage.input_token != null) context.input_tokens = usage.input_token + (usage.cache_token || 0);
    const calculation = prices.calculate(price, usage, context);
    return { call_id: row.id, revision_id: row.latest_revision_id, model: row.model, drama_id: row.drama_id,
      submitted_at: row.submitted_at, usage, price_id: price?.id || null, calculation,
      eligible: calculation.cost_status === 'calculated' };
  });
}
function get(db, id) {
  const row = db.prepare('SELECT * FROM cost_reprice_batches WHERE id=?').get(id);
  return row ? { ...row, filters: parse(row.filters_json), preview: parse(row.preview_json), result: row.result_json ? parse(row.result_json) : null } : null;
}
function preview(db, actor, input) {
  const items = candidates(db, input), id = randomUUID(), currencies = new Map();
  for (const item of items.filter(x => x.eligible)) currencies.set(item.calculation.currency, (currencies.get(item.calculation.currency) || 0) + item.calculation.amount_micro);
  const result = { items, eligible: items.filter(x => x.eligible).length, skipped: items.filter(x => !x.eligible).length,
    currencies: [...currencies].map(([currency, amount_micro]) => ({ currency, amount_micro })) };
  db.prepare('INSERT INTO cost_reprice_batches(id,created_at,created_by,filters_json,preview_json) VALUES(?,?,?,?,?)')
    .run(id, new Date().toISOString(), actor, JSON.stringify(input), JSON.stringify(result));
  return get(db, id);
}
function execute(db, actor, id, reason) {
  if (!reason?.trim()) throw new Error('请填写批量估算原因');
  return db.transaction(() => {
    const batch = get(db, id); if (!batch) throw new Error('估算批次不存在');
    if (batch.status === 'executed') return batch;
    const fresh = new Map(candidates(db, batch.filters).map(x => [x.call_id, x]));
    const result = { updated: 0, skipped: 0, reason: reason.trim(), executed_by: actor };
    for (const item of batch.preview.items) {
      const current = fresh.get(item.call_id);
      if (!item.eligible || !current?.eligible || current.revision_id !== item.revision_id || current.price_id !== item.price_id
        || prices.hash(current.calculation) !== prices.hash(item.calculation)) { result.skipped++; continue; }
      ledger.reprice(db, actor, item.call_id, `批量估算 ${id}：${reason.trim()}`);
      result.updated++;
    }
    db.prepare("UPDATE cost_reprice_batches SET status='executed',executed_at=?,result_json=? WHERE id=?")
      .run(new Date().toISOString(), JSON.stringify(result), id);
    return get(db, id);
  })();
}
module.exports = { preview, execute, get };
