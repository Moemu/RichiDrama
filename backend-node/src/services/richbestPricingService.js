'use strict';

/**
 * 瑞池中转站价目源（GET /v1/pricing）。
 * 只做「拉取 + 度量映射 + 十进制金额换算」，不写库：候选行交给 providerPriceService
 * 的同一套 sync / 审核 / 草稿 / 发布链路，避免再造一条价目流水线。
 *
 * 换算沿用仓库既有的固定比例，没有毛利：1 元 = 100 积分 = 1,000,000 微积分。
 * 中转单价是 ≤6 位小数的十进制字符串，其放大 1e6 的整数恰好等于微积分金额，
 * 所以这里用 BigInt 精确换算，不走浮点（文档明确要求金额不得转二进制浮点再算）。
 */

const richbest = require('./richbestProvider');

const PROVIDER = richbest.PROVIDER;
const SOURCE = 'relay_pricing';
const POINTS_PER_CNY = 100;
const MICRO_PER_POINT = 10000;
const YUAN_SCALE = POINTS_PER_CNY * MICRO_PER_POINT; // 1,000,000 微积分 / 元

/** 中转 metric → 内部 meter；不在表内的一律 unmapped，绝不猜。 */
const METERS = {
  input_tokens: 'input_token',
  output_tokens: 'output_token',
  image: 'image',
  generated_images: 'image',
  images: 'image',
  video_duration: 'second',
  video_seconds: 'second',
  duration_seconds: 'second',
  character: 'character',
  characters: 'character',
};
/**
 * 上游确有、但不生成价目条目的指标。
 * cached_input_tokens 必须排除在这里：它若映射到 input_token，会和真正的 input_tokens
 * 撞同一个 (价目书, 服务类型, 模型, meter) 唯一键，createDraft 里后写入者覆盖前者，
 * 输入价会被缓存价悄悄压低。已定决策是缓存输入按 input_token 全价结算、不单独定价。
 */
const UNSUPPORTED_METERS = {
  cached_input_tokens: '缓存输入按 input_token 全价结算，不单独定价',
  audio_duration: '内部价目暂无音频时长计量，未生成条目',
  embedding: '内部价目暂无向量计量，未生成条目',
};

const MODALITY_SERVICE_TYPES = { text: 'text', image: 'image', video: 'video', embedding: null, audio: null };

function parseYuan(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(text)) return null;
  const [units, fraction = ''] = text.split('.');
  return { scaled: BigInt(units) * 1000000n + BigInt((fraction + '000000').slice(0, 6)), text };
}

/**
 * 元 → 微积分，全程 BigInt 不碰浮点。
 * parseYuan 的 scaled 是「元 × 1e6」，再乘 YUAN_SCALE（1 元对应的微积分）并除回 1e6，
 * 让换算式里的比例常量保持显式，改费率只需动上面两个常量。
 */
function yuanToMicroPoints(yuan) {
  const parsed = parseYuan(yuan);
  if (parsed === null) return null;
  const asNumber = Number(parsed.scaled * BigInt(YUAN_SCALE) / 1000000n);
  return Number.isSafeInteger(asNumber) ? asNumber : null;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * 上游同时给了 list 与 effective 时以 effective 为准（那就是本项目的实际成本），
 * 但会校验它与 list × discount_bps 是否自洽；不自洽说明响应或折扣口径有问题，置 unmapped。
 */
function assertConsistent(list, effective, discountBps) {
  if (list == null || effective == null || discountBps == null) return null;
  const listMicro = yuanToMicroPoints(list);
  const effectiveMicro = yuanToMicroPoints(effective);
  const bps = Number(discountBps);
  if (listMicro === null || effectiveMicro === null || !Number.isSafeInteger(bps) || bps <= 0) return '价格字段无法解析';
  const derived = Math.round(listMicro * bps / 10000);
  return Math.abs(derived - effectiveMicro) <= 1 ? null : `effective_price_yuan 与 list × discount_bps 不一致（推导 ${derived}，返回 ${effectiveMicro}）`;
}

function meterFor(metric) {
  const key = String(metric || '').trim().toLowerCase();
  if (METERS[key]) return { meter: METERS[key], metric: key };
  return { meter: null, metric: key, reason: UNSUPPORTED_METERS[key] || null };
}

function serviceTypeFor(modality, configuredTypes) {
  const mapped = MODALITY_SERVICE_TYPES[String(modality || '').toLowerCase()];
  if (mapped && configuredTypes.includes(mapped)) return mapped;
  const hits = configuredTypes.filter(Boolean);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 一个 price 条目 → 候选行。
 * target 由调用方用「exact 匹配」解析（中转别名必须对到自己的 billing_key，
 * 不允许 family 前缀命中直连火山的带日期 SKU）。
 */
function mapPriceEntry(entry, price, context) {
  const { target, discountBps, syncId, at } = context;
  const model = String(entry?.id || '').trim();
  const displayName = String(entry?.display_name || model).trim();
  const { meter, metric, reason } = meterFor(price?.metric);
  const base = {
    provider_model: model,
    display_name: displayName,
    charge_type: metric || 'unknown',
    unit_code: null,
    currency: String(price?.currency || entry?.currency || 'CNY'),
    provider_unit_price: price?.effective_price_yuan ?? price?.list_price_yuan ?? null,
    raw_item_json: JSON.stringify({ entry_id: model, modality: entry?.modality || null, price }),
  };
  if (!meter) {
    return { ...base, mapping_status: 'unmapped', error_summary: reason || `未知计价指标 ${metric || '(空)'}` };
  }
  if (!target) {
    return { ...base, meter, mapping_status: 'unmapped', error_summary: `找不到模型 ${model} 的中转 billing_key，请先在供应商连接中导入该模型` };
  }
  const serviceType = serviceTypeFor(entry?.modality, target.configuredTypes || []);
  if (!serviceType) {
    return { ...base, meter, mapping_status: 'unmapped', error_summary: `模型 ${model} 的服务类型无法确定` };
  }
  const unitSize = toNumber(price?.unit_size) || 1;
  const micro = yuanToMicroPoints(price?.effective_price_yuan ?? price?.list_price_yuan);
  if (micro === null) {
    return { ...base, meter, service_type: serviceType, billing_key: target.billing_key, mapping_status: 'unmapped', error_summary: `单价不是 ≤6 位小数的十进制字符串：${price?.effective_price_yuan ?? price?.list_price_yuan ?? '(空)'}` };
  }
  const mismatch = assertConsistent(price?.list_price_yuan, price?.effective_price_yuan, discountBps);
  if (mismatch) {
    return { ...base, meter, service_type: serviceType, billing_key: target.billing_key, mapping_status: 'unmapped', error_summary: mismatch };
  }
  const conditions = {
    unit_size: unitSize,
    provider: PROVIDER,
    currency: 'CNY',
    tax_inclusive: entry?.tax_inclusive === true,
    source: SOURCE,
    source_sync_id: syncId || null,
    provider_model: model,
    provider_metric: metric,
    provider_dimension: price?.dimension ?? null,
    list_price_yuan: String(price?.list_price_yuan ?? ''),
    effective_price_yuan: String(price?.effective_price_yuan ?? ''),
    discount_bps: Number.isSafeInteger(Number(discountBps)) ? Number(discountBps) : null,
    pricing_note: '瑞池中转站税前价；实际结算以服务端记录的成功用量与对应账期价格为准',
  };
  return {
    ...base,
    service_type: serviceType,
    billing_key: target.billing_key,
    meter,
    unit_size: unitSize,
    new_unit_price_micro: micro,
    new_conditions_json: JSON.stringify(conditions),
    conditions_changed: 0,
    mapping_status: 'mapped',
    error_summary: null,
  };
}

/** 上游条目 → 候选行数组；configured:false 或空 prices 只产出 unmapped，绝不产出免费条目。 */
function buildCandidates(entries, { resolveTarget, discountBps, syncId = null, at = null } = {}) {
  const rows = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const model = String(entry?.id || '').trim();
    if (!model) continue;
    const target = resolveTarget ? resolveTarget(model) : null;
    if (entry?.configured === false || !Array.isArray(entry?.prices) || !entry.prices.length) {
      rows.push({
        provider_model: model,
        display_name: String(entry?.display_name || model).trim(),
        charge_type: 'NotConfigured',
        unit_code: null,
        currency: 'CNY',
        provider_unit_price: null,
        service_type: target?.service_type || null,
        billing_key: target?.billing_key || null,
        meter: null,
        unit_size: null,
        new_unit_price_micro: null,
        mapping_status: 'unmapped',
        error_summary: '上游未配置该模型价格；未配置不等于免费',
        raw_item_json: JSON.stringify({ entry_id: model, modality: entry?.modality || null, configured: entry?.configured ?? null }),
      });
      continue;
    }
    for (const price of entry.prices) {
      rows.push(mapPriceEntry(entry, price, { target, discountBps, syncId, at }));
    }
  }
  return dedupeMeterCollisions(rows);
}

/**
 * 同一 (服务类型, billing_key, meter) 只能有一条价目条目；上游若给出多个映射到同一
 * meter 的指标，保留第一条，其余标 unmapped，避免 createDraft 静默覆盖成更低的价格。
 */
function dedupeMeterCollisions(rows) {
  const seen = new Map();
  for (const row of rows) {
    if (row.mapping_status !== 'mapped' || !row.meter) continue;
    const key = `${row.service_type}\u0000${row.billing_key}\u0000${row.meter}`;
    const first = seen.get(key);
    if (!first) { seen.set(key, row); continue; }
    row.mapping_status = 'unmapped';
    row.new_unit_price_micro = null;
    row.new_conditions_json = null;
    row.error_summary = `与 ${first.charge_type} 映射到同一计量 ${row.meter}，仅保留单价 ${first.new_unit_price_micro} 的那条`;
  }
  return rows;
}

/** 取一枚可用的中转凭据：任一启用的 richbest 配置都代表同一项目 Key。 */
function pricingContext(db) {
  const ai = require('./aiConfigService');
  const rows = db.prepare(`SELECT id FROM ai_service_configs WHERE deleted_at IS NULL AND provider=? AND is_active=1
    ORDER BY is_default DESC, priority DESC, id ASC`).all(PROVIDER).map((row) => ai.getConfig(db, row.id)).filter(Boolean);
  const withKey = rows.find((config) => String(config.api_key || '').trim());
  if (!withKey) throw new Error('未找到可用的瑞池中转配置，请先在供应商连接中添加并启用');
  return { config: withKey, configs: rows };
}

async function fetchPricing(db, options = {}) {
  const { config } = pricingContext(db);
  const result = await richbest.listPrices({ baseUrl: config.base_url, apiKey: config.api_key, fetchImpl: options.fetchImpl }, options.model);
  const payload = result.payload || {};
  if (!Array.isArray(payload.data)) throw new Error('中转站价目响应不包含 data 列表');
  return {
    items: payload.data,
    month: String(payload.month || '').trim() || null,
    currency: String(payload.currency || 'CNY'),
    taxInclusive: payload.tax_inclusive === true,
    billingEnabled: payload.billing_enabled === true,
    discountBps: Number.isSafeInteger(Number(payload.discount_bps)) ? Number(payload.discount_bps) : null,
    requestId: result.requestId,
    configId: config.id,
  };
}

module.exports = {
  PROVIDER, SOURCE, METERS, UNSUPPORTED_METERS,
  parseYuan, yuanToMicroPoints, meterFor, assertConsistent, mapPriceEntry, buildCandidates,
  dedupeMeterCollisions, fetchPricing, pricingContext,
};
