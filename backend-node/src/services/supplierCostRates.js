'use strict';
const { prorate } = require('./costPriceService');

// September 2026 MediaKit bill: CNY per minute, before daily bill rounding.
const FIXED = Object.freeze({
  'volcengine-video-frame-interpolation': Object.freeze({ price: '0.6', label: '视频插帧' }),
  'volcengine-video-generative-enhancement': Object.freeze({ price: '2.5', label: '大模型画质增强' }),
});
const fixedRate = model => Object.hasOwn(FIXED, model) ? FIXED[model] : null;
const modelKey = model => String(model || '').toLowerCase().replace(/-\d{6}$/, '');

function decode(item, at) {
  const provider = require('./providerPriceService');
  const source = structuredClone(item);
  for (const charge of [...(source.ChargeItems || []), ...(source.MultiChargeItems || []).flatMap(g => g.ChargeItems || [])]) {
    if (charge.DiscountPriceStartTime || charge.DiscountPriceEndTime) {
      const from = Date.parse(charge.DiscountPriceStartTime), to = Date.parse(charge.DiscountPriceEndTime);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
      if (Date.parse(at) < from || Date.parse(at) >= to) charge.Price = charge.OriginalPrice;
      delete charge.DiscountPriceStartTime;
      delete charge.DiscountPriceEndTime;
    }
  }
  let groups = source.MultiChargeItems || [];
  if (!groups.length && modelKey(source.FoundationModelName || source.Name) === 'doubao-seedream-5-0-pro') groups = [{ ChargeItems: source.ChargeItems || [] }];
  if (groups.length) {
    const decoded = provider.verifiedMultiChargeSpecs(source, groups);
    return decoded?.specs || [];
  }
  const charges = source.ChargeItems || [];
  const specs = charges.map(charge => {
    const meter = provider.chargeMeter(charge.Type, charge.UnitCode);
    const unitSize = meter && provider.sourceUnitSize(charge.UnitCode, meter);
    const price = meter && unitSize && charge.Price != null ? provider.normalizedPriceMicro(charge.Price, unitSize, meter) : null;
    return price ? { meter, unitSize: price.unitSize, unitPriceMicro: price.micro, conditions: {} } : null;
  });
  return specs.some(spec => !spec) || new Set(specs.map(spec => spec.meter)).size !== specs.length ? [] : specs;
}

function calculate(specs, usage, context = {}) {
  if (!specs.length) return { status: 'missing_price', reason: '供应商价格的计费规格尚未覆盖' };
  if (['input_token', 'output_token', 'cache_token'].some(meter => usage[meter] > 0 && !specs.some(spec => spec.meter === meter))) return { status: 'missing_price', reason: '供应商价格未覆盖全部实际 Token 计费项' };
  let amount = 0; const rates = [];
  for (const spec of specs) {
    const conditions = spec.conditions || {};
    let quantity = usage[spec.meter];
    if (quantity == null && spec.meter === 'input_image' && context.input_image_count != null) quantity = context.input_image_count;
    if (quantity == null && spec.meter === 'second' && usage.millisecond != null) quantity = usage.millisecond / 1000;
    if (quantity == null) return { status: 'missing_usage', reason: `缺少 ${spec.meter} 的实际用量` };
    let unitPrice = spec.unitPriceMicro, unitSize = spec.unitSize, rateId = null;
    if (conditions.rates?.length) {
      const matches = conditions.rates.filter(rate => Object.entries(rate.when || {}).every(([key, value]) => Object.hasOwn(context, key) && context[key] === value))
        .sort((a, b) => Object.keys(b.when || {}).length - Object.keys(a.when || {}).length);
      if (!matches.length || matches.length > 1 && Object.keys(matches[0].when).length === Object.keys(matches[1].when).length) return { status: 'missing_price', reason: '缺少明确的调用规格，未套用默认供应商价格' };
      unitPrice = Math.round(matches[0].unit_price_points * 10000); unitSize = matches[0].unit_size; rateId = matches[0].id;
    }
    if (conditions.usage_tiers?.length) {
      const tier = conditions.usage_tiers.find(t => usage[t.selector_meter] != null && usage[t.selector_meter] >= t.min_inclusive && usage[t.selector_meter] <= t.max_inclusive);
      if (!tier) return { status: 'missing_price', reason: '实际输入用量不在供应商阶梯范围内' };
      unitPrice = Math.round(tier.unit_price_points * 10000); unitSize = tier.unit_size; rateId = tier.id;
    }
    const billable = Math.max(0, quantity - Number(conditions.free_units || 0));
    const subtotal = prorate(billable, String(unitPrice / 1e6), String(unitSize));
    amount += subtotal;
    if (!Number.isSafeInteger(amount)) throw new Error('供应商成本超出安全范围');
    rates.push({ meter: spec.meter, quantity, billable_quantity: billable, unit_price_cny: unitPrice / 1e6, unit_size: unitSize, subtotal_micro: subtotal, rate_id: rateId });
  }
  return { status: 'calculated', amount_micro: amount, rates };
}

function estimate(row, snapshots) {
  if (!row.usage) return { status: row.cost_status === 'released' ? 'released' : row.cost_status === 'unverified' ? 'unverified' : 'missing_usage', amount_micro: null, reason: row.reason, rates: [] };
  const fixed = fixedRate(row.model);
  if (fixed) {
    if (row.price_at < '2026-08-31T16:00:00.000Z') return { status: 'missing_price', amount_micro: null, reason: '账单固定费率仅用于 2026 年 9 月起的成本估算', rates: [] };
    const quantity = row.usage.millisecond ?? (row.usage.second == null ? null : row.usage.second * 1000);
    if (quantity == null) return { status: 'missing_usage', amount_micro: null, reason: '缺少实际处理时长', rates: [] };
    const amount = prorate(quantity, fixed.price, '60000');
    return { status: 'calculated', amount_micro: amount, source: 'mediakit_bill_202609', source_label: `2026 年 9 月账单固定费率 · ${fixed.label}`, price_day: null, stale: false,
      reason: `账单固定费率 ¥${fixed.price}/分钟`, rates: [{ meter: 'millisecond', quantity, billable_quantity: quantity, unit_price_cny: Number(fixed.price), unit_size: 60000, subtotal_micro: amount }] };
  }
  if (row.provider && !/(?:volc|doubao|火山)/i.test(row.provider)) return { status: 'missing_price', amount_micro: null, reason: '当前仅支持火山供应商成本估算', rates: [] };
  const key = modelKey(row.model);
  const day = new Date(Date.parse(row.price_at) + 28800000).toISOString().slice(0, 10);
  // Each day's first complete response is immutable. Never use a future day.
  const snapshot = snapshots.find(s => s.day <= day && s.items.some(item => modelKey(item.FoundationModelName || item.Name) === key));
  if (!snapshot) return { status: 'missing_price', amount_micro: null, reason: '没有调用当日或更早的供应商价格快照', rates: [] };
  const item = snapshot.items.find(item => modelKey(item.FoundationModelName || item.Name) === key);
  const calculation = calculate(decode(item, snapshot.fetched_at), row.usage, row.pricing_context);
  return { amount_micro: null, rates: [], ...calculation, source: snapshot.id, source_label: '火山每日价格快照', price_day: snapshot.day, fetched_at: snapshot.fetched_at, source_config_id: snapshot.source_config_id,
    stale: snapshot.day < day, reason: calculation.reason || (snapshot.day < day ? `沿用 ${snapshot.day} 的供应商价格` : '按当日供应商价格估算') };
}
module.exports = { fixedRate, decode, calculate, estimate };
