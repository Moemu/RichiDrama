'use strict';
const { createHash } = require('node:crypto');
const METERS = ['input_token', 'cache_token', 'output_token', 'image', 'input_image', 'request', 'millisecond', 'character', 'second'];
const now = () => new Date().toISOString();
const parse = value => JSON.parse(value || '{}');
function decimal(value) {
  if (!/^\d+(?:\.\d{1,12})?$/.test(String(value))) throw new Error('金额和用量必须为非负十进制数，最多十二位小数');
  const [whole, fraction = ''] = String(value).split('.');
  return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)];
}
function prorate(quantity, price, unit, rounding = 'micro') {
  const [q, qd] = decimal(quantity), [p, pd] = decimal(price), [u, ud] = decimal(unit);
  if (!u) throw new Error('计价单位必须大于零');
  const step = rounding === 'cent' ? 10000n : 1n;
  const n = q * p * ud * 1000000n, d = qd * pd * u * step;
  const value = ((n + d / 2n) / d) * step;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金额超出安全范围');
  return Number(value);
}
function validateRules(rules) {
  if (!Array.isArray(rules) || !rules.length || rules.length > 100) throw new Error('请提供 1 到 100 条计费规则');
  for (const rule of rules) {
    if (!METERS.includes(rule.meter)) throw new Error('不支持的计量单位');
    decimal(rule.price); decimal(rule.unit_size);
    if (Number(rule.unit_size) <= 0) throw new Error('单位数量必须大于零');
    if (rule.original_price != null) decimal(rule.original_price);
    if (rule.free_units != null) decimal(rule.free_units);
    if (rule.rounding && !['micro', 'cent'].includes(rule.rounding)) throw new Error('不支持的取整方式');
    if (rule.when && (typeof rule.when !== 'object' || Array.isArray(rule.when))) throw new Error('规格条件必须为对象');
    for (const [key, value] of Object.entries(rule.when || {})) {
      if (!['has_video_input', 'has_audio', 'resolution', 'resolution_tier', 'fps_tier', 'pixel_band', 'image_scene', 'has_image_input', 'input_image_count', 'service_tier'].includes(key)
        || !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('不支持的规格条件');
    }
    if (rule.input_min != null) decimal(rule.input_min);
    if (rule.input_max != null) decimal(rule.input_max);
    if (rule.input_min != null && rule.input_max != null && Number(rule.input_min) >= Number(rule.input_max)) throw new Error('输入档位区间无效');
  }
  return rules;
}
function date(value) { const d = new Date(value); if (!value || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(d.getTime())) throw new Error('生效时间必须包含明确的时区'); return d.toISOString(); }
function saveDraft(db, actor, input) {
  if (!db.prepare('SELECT 1 FROM cost_accounts WHERE id=?').get(Number(input.account_id))) throw new Error('供应商账号不存在');
  if (!input.model?.trim() || !input.service_type?.trim() || !input.source?.trim()) throw new Error('模型、服务和价格来源不能为空');
  if (!/^[A-Z]{3}$/.test(input.currency || 'CNY')) throw new Error('币种必须为三位大写代码');
  const from = date(input.effective_from), to = input.effective_to ? date(input.effective_to) : null;
  if (to && to <= from) throw new Error('结束时间必须晚于开始时间');
  const info = db.prepare(`INSERT INTO cost_prices(account_id,model,service_type,currency,effective_from,effective_to,rules_json,source,created_at,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(Number(input.account_id), input.model.trim(), input.service_type.trim(), input.currency || 'CNY', from, to, JSON.stringify(validateRules(input.rules)), input.source.trim(), now(), actor);
  return get(db, info.lastInsertRowid);
}
function get(db, id) { const row = db.prepare('SELECT * FROM cost_prices WHERE id=?').get(Number(id)); return row ? { ...row, rules: parse(row.rules_json) } : null; }
function publish(db, actor, id) {
  const price = get(db, id); if (!price) throw new Error('价格不存在');
  if (price.status === 'published') return price;
  db.prepare("UPDATE cost_prices SET status='published',reviewed_at=?,reviewed_by=? WHERE id=? AND status='draft'").run(now(), actor, price.id);
  require('./billingService').audit(db, actor, 'cost.price.publish', 'cost_price', price.id, { account_id: price.account_id });
  return get(db, id);
}
function select(db, call) {
  if (!call.account_id) return null;
  return db.prepare(`SELECT * FROM cost_prices WHERE account_id=? AND model=? AND service_type=? AND status='published'
    AND effective_from<=? AND (effective_to IS NULL OR effective_to>?) ORDER BY effective_from DESC,reviewed_at DESC,id DESC LIMIT 1`)
    .get(call.account_id, call.model, call.service_type, call.submitted_at, call.submitted_at) || null;
}
function calculate(price, usage, context) {
  if (!usage || !Object.keys(usage).length) return { cost_status: 'missing_usage', amount_micro: null };
  if (!price) return { cost_status: 'missing_price', amount_micro: null };
  const rules = parse(price.rules_json), meters = [...new Set(rules.map(r => r.meter))];
  let total = 0;
  for (const meter of meters) {
    const quantity = usage[meter] ?? (meter === 'second' && usage.millisecond != null ? usage.millisecond / 1000 : meter === 'millisecond' && usage.second != null ? usage.second * 1000 : null);
    if (quantity == null) return { cost_status: 'missing_usage', amount_micro: null };
    const matched = rules.filter(r => r.meter === meter && Object.entries(r.when || {}).every(([k, v]) => Object.hasOwn(context, k) && context[k] === v)
      && (r.input_min == null || context.input_tokens != null && context.input_tokens >= Number(r.input_min))
      && (r.input_max == null || context.input_tokens != null && context.input_tokens < Number(r.input_max)));
    if (matched.length !== 1) return { cost_status: 'missing_price', amount_micro: null };
    total += prorate(Math.max(0, quantity - Number(matched[0].free_units || 0)), matched[0].price, matched[0].unit_size, matched[0].rounding);
    if (!Number.isSafeInteger(total)) throw new Error('金额超出安全范围');
  }
  return { cost_status: 'calculated', amount_micro: total, currency: price.currency };
}
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
module.exports = { METERS, saveDraft, publish, get, select, calculate, hash, prorate };
