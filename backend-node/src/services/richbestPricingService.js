'use strict';

/**
 * 瑞池中转站价目源（GET /v1/pricing）。
 * 只做「拉取 + 指标/维度映射 + 十进制金额换算」，不写库：候选行交给 providerPriceService
 * 的同一套 sync / 审核 / 草稿 / 发布链路，避免再造一条价目流水线。
 *
 * 契约以真实响应为准，不以文档为准：2026-09-20 通过鉴权 admin 路由做过一次只读拉取，
 * 响应快照存在 test/helpers/richbestPricingLive.json。真实上游只有四种 metric，且把
 * 分档与条件价放在 dimension 上；文档里的 video_duration / 折扣口径在这枚 key 上不存在。
 *
 * 换算沿用仓库既有的固定比例，没有毛利：1 元 = 100 积分 = 1,000,000 微积分。
 * 中转单价是 ≤6 位小数的十进制字符串，其放大 1e6 的整数恰好等于微积分金额，
 * 所以这里用 BigInt 精确换算，不走浮点（文档明确要求金额不得转二进制浮点再算）。
 */

const richbest = require('./richbestProvider');
const seedream = require('./seedreamProPricing');

const PROVIDER = richbest.PROVIDER;
const SOURCE = 'relay_pricing';
const POINTS_PER_CNY = 100;
const MICRO_PER_POINT = 10000;
const YUAN_SCALE = POINTS_PER_CNY * MICRO_PER_POINT; // 1,000,000 微积分 / 元

/** 中转 metric → 内部 meter；不在表内的一律 unmapped，绝不猜。
 *
 * 2026-09-20 用真实 /v1/pricing 响应核对过（test/helpers/richbestPricingLive.json，23 模型 91 条价格）：
 * 上游只有 input_tokens / cached_input_tokens / output_tokens / image 四种指标，
 * 连按时长（video_duration / second）这种指标都不存在——视频同样是 output_tokens 每百万 token 计价，
 * 再按「分辨率 × 是否带视频输入」分条。所以这里不能凭文档想象指标名。
 */
const METERS = {
  input_tokens: 'input_token',
  cached_input_tokens: 'cache_token',
  output_tokens: 'output_token',
  image: 'image',
};
/**
 * 上游确有、但暂时不能生成用户价目条目的指标。
 * cached_input_tokens 已单独映射为 cache_token。最终结算只在完成响应返回可信缓存
 * 明细时拆分；没有明细时保持普通输入用量，不估算缓存命中。
 */
const UNSUPPORTED_METERS = {
  audio_duration: '内部价目暂无音频时长计量，未生成条目',
  embedding: '内部价目暂无向量计量，未生成条目',
};

const RESOLUTIONS = ['480p', '720p', '1080p'];
const PIXEL_BAND_BY_OPERATOR = { le: 'small', gt: 'large' };

/**
 * dimension 是承载定价语义的字段，不是备注：真实响应用它表达 token 分档、
 * 视频分辨率/输入条件、图像像素档位。同一 meter 的多条 dimension 必须编译成
 * 一条带条件的价目，绝不能只留一条（那是最坏 3 倍的错价）。
 */
function parseDimension(meter, dimension) {
  const raw = String(dimension ?? '').trim();
  if (!raw || raw === 'null') return { kind: 'base' };
  const tier = /^tokens:(\d+)-(\d+)$/.exec(raw);
  if (tier) {
    if (!['input_token', 'cache_token', 'output_token'].includes(meter)) return { kind: 'unknown', reason: `计量 ${meter} 不支持 token 分档：${raw}` };
    const min = Number(tier[1]); const max = Number(tier[2]);
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min) return { kind: 'unknown', reason: `token 分档边界不是有效整数：${raw}` };
    return { kind: 'tier', id: `tokens:${min}-${max}`, min_inclusive: min, max_inclusive: max };
  }
  const video = /^(\d+p):(video|no_video)$/.exec(raw);
  if (video) {
    if (meter !== 'output_token') return { kind: 'unknown', reason: `计量 ${meter} 不支持视频条件价：${raw}` };
    if (!RESOLUTIONS.includes(video[1])) return { kind: 'unknown', reason: `未识别的分辨率档位 ${video[1]}（内部只支持 ${RESOLUTIONS.join('/')}）` };
    return { kind: 'rate', id: raw, when: { resolution: video[1], has_video_input: video[2] === 'video' } };
  }
  const band = /^output:(le|gt)(\d+)$/.exec(raw);
  if (band) {
    if (meter !== 'image') return { kind: 'unknown', reason: `计量 ${meter} 不支持像素档位：${raw}` };
    if (Number(band[2]) !== seedream.PIXEL_THRESHOLD) return { kind: 'unknown', reason: `像素档位阈值 ${band[2]} 与内部 ${seedream.PIXEL_THRESHOLD} 不一致，不能套用` };
    return { kind: 'rate', id: raw, when: { pixel_band: PIXEL_BAND_BY_OPERATOR[band[1]] } };
  }
  if (raw === 'input:after_first') {
    return { kind: 'unsupported', reason: '上游把「首张输入图免费、之后按张」写成 image 的一个维度，内部价目没有该计量语义，需人工定价' };
  }
  return { kind: 'unknown', reason: `未识别的计价维度 ${raw}` };
}

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
 * 元 → 积分的十进制字符串（1 元 = 100 积分）。价目条目的 rates/usage_tiers 用的是
 * 「积分」口径且最多四位小数，这里只移动小数点，不经过浮点，保证零误差。
 */
function yuanToPointsText(yuan) {
  const parsed = parseYuan(yuan);
  if (parsed === null) return null;
  const whole = parsed.scaled / 10000n;
  const fraction = parsed.scaled % 10000n;
  return fraction === 0n ? String(whole) : `${whole}.${String(fraction).padStart(4, '0').replace(/0+$/, '')}`;
}

/**
 * 上游只给 metric + unit_size，不给火山那样的 UnitCode 文案；面板的「供应商价」列
 * 按 `{价} CNY / {unit_code}` 渲染，留空就会显示成"未知单位"。这里按指标与计量单位补出
 * 与火山侧同一套中文口径，让管理员看到单价到底按什么收费。
 */
function unitCodeFor(metric, meter, unitSize) {
  const name = String(metric || '').toLowerCase();
  if (name.endsWith('tokens') || name.endsWith('token')) {
    if (unitSize === 1000) return '千tokens';
    if (unitSize === 1000000) return '百万tokens';
    return unitSize ? `每 ${unitSize} tokens` : 'tokens';
  }
  if (name === 'image' || name === 'images' || name === 'generated_images') return '张';
  return { second: '秒', millisecond: '毫秒', character: '字符', request: '次' }[meter] || null;
}

/** 计费项列宽有限，维度去掉与 metric 重复的前缀后再拼上去，避免多条分档行看起来一模一样。 */
function chargeTypeFor(metric, dimension) {
  const raw = String(dimension ?? '').trim();
  if (!raw || raw === 'null') return metric || 'unknown';
  const brief = raw.replace(/^(?:tokens|output|input):/, '');
  return `${metric || 'unknown'}（${brief}）`;
}

/** 单条上游价格 → 片段。解析失败或语义不支持时只带 reason，由分组阶段落成 unmapped 行。 */
function pricePiece(entry, price, context = {}) {
  const { meter, metric, reason } = meterFor(price?.metric);
  const model = String(entry?.id || '').trim();
  const base = {
    provider_model: model,
    display_name: String(entry?.display_name || model).trim(),
    metric,
    meter,
    charge_type: chargeTypeFor(metric, price?.dimension),
    unit_code: unitCodeFor(metric, meter, toNumber(price?.unit_size)),
    currency: String(price?.currency || entry?.currency || 'CNY'),
    provider_unit_price: price?.effective_price_yuan ?? price?.list_price_yuan ?? null,
    raw_item_json: JSON.stringify({ entry_id: model, modality: entry?.modality || null, price }),
  };
  if (!meter) return { ...base, reason: reason || `未知计价指标 ${metric || '(空)'}` };
  const unitSize = toNumber(price?.unit_size) || 1;
  const source = price?.effective_price_yuan ?? price?.list_price_yuan;
  const micro = yuanToMicroPoints(source);
  if (micro === null) return { ...base, meter, reason: `单价不是 ≤6 位小数的十进制字符串：${source ?? '(空)'}` };
  const mismatch = assertConsistent(price?.list_price_yuan, price?.effective_price_yuan, context.discountBps);
  if (mismatch) return { ...base, meter, reason: mismatch };
  const points = yuanToPointsText(source);
  if (points === null) return { ...base, meter, reason: `单价无法换算成四位小数以内的积分：${source}` };
  const selector = parseDimension(meter, price?.dimension);
  if (selector.kind === 'unsupported' || selector.kind === 'unknown') return { ...base, meter, reason: selector.reason };
  return { ...base, unit_size: unitSize, micro, points, selector };
}

function conditionMeta(entry, target, syncId, discountBps) {
  return {
    unit_size: 1,
    provider: PROVIDER,
    currency: String(entry?.currency || 'CNY'),
    tax_inclusive: entry?.tax_inclusive === true,
    source: SOURCE,
    source_sync_id: syncId || null,
    provider_model: String(entry?.id || '').trim(),
    provider_charge_type: 'relay_pricing',
    discount_bps: Number.isSafeInteger(Number(discountBps)) ? Number(discountBps) : null,
    pricing_note: '瑞池中转站税前价（1 元 = 100 积分）；实际结算以服务端记录的成功用量与对应账期价格为准',
  };
}

function unmappedRow(piece, reason) {
  return { ...piece, mapping_status: 'unmapped', error_summary: reason || piece.reason, new_unit_price_micro: null, new_conditions_json: null };
}

/**
 * 同一 (模型, meter) 的多条维度价格 → 一条候选。
 * 分档走 usage_tiers（引擎按实际 token 用量命中，未覆盖即拒绝调用），
 * 条件价走 rates（按 pricing_context 的 resolution / has_video_input / pixel_band 命中）。
 */
function compileGroup(entry, target, pieces, context) {
  const { syncId, discountBps } = context;
  const { meter, metric } = pieces[0];
  const serviceType = serviceTypeFor(entry?.modality, target.configuredTypes || []);
  if (!serviceType) return pieces.map((piece) => unmappedRow(piece, `模型 ${pieces[0].provider_model} 的服务类型无法确定`));
  const tiers = pieces.filter((piece) => piece.selector.kind === 'tier');
  const rates = pieces.filter((piece) => piece.selector.kind === 'rate');
  const bases = pieces.filter((piece) => piece.selector.kind === 'base');
  const label = `${target.billing_key}/${meter}`;
  if (tiers.length && rates.length) return pieces.map((piece) => unmappedRow(piece, `${label} 同时带有 token 分档和条件价，内部价目不支持叠加，请人工定价`));
  if (bases.length > 1) return pieces.map((piece) => unmappedRow(piece, `${label} 有多条无条件价格，无法判定基准价，请人工定价`));
  const orderedTiers = tiers.slice().sort((a, b) => a.selector.min_inclusive - b.selector.min_inclusive);
  for (let index = 1; index < orderedTiers.length; index += 1) {
    const previous = orderedTiers[index - 1].selector; const current = orderedTiers[index].selector;
    if (current.min_inclusive <= previous.max_inclusive) return pieces.map((piece) => unmappedRow(piece, `${label} 的 token 分档区间重叠，请人工核对上游价目`));
    if (current.micro < previous.micro) return pieces.map((piece) => unmappedRow(piece, `${label} 的更高用量档位价格低于前一档，与内部档位规则冲突，请人工定价`));
  }
  const conditions = conditionMeta(entry, target, syncId, discountBps);
  const meta = { service_type: serviceType, billing_key: target.billing_key, meter, mapping_status: 'mapped', error_summary: null };
  const rawItem = { entry_id: pieces[0].provider_model, modality: entry?.modality || null, prices: pieces.map((piece) => piece.raw_item_json ? JSON.parse(piece.raw_item_json).price : null).filter(Boolean) };
  if (tiers.length) {
    const selectorMeter = meter === 'input_token' || meter === 'cache_token' ? 'total_input_token' : meter;
    conditions.usage_tiers = orderedTiers.map((piece) => ({
      id: piece.selector.id, selector_meter: selectorMeter, min_inclusive: piece.selector.min_inclusive, max_inclusive: piece.selector.max_inclusive,
      unit_price_points: piece.points, unit_size: piece.unit_size,
    }));
    const anchor = bases[0] || orderedTiers[0];
    conditions.unit_size = anchor.unit_size;
    return { ...meta, provider_model: pieces[0].provider_model, display_name: pieces[0].display_name, currency: pieces[0].currency,
      charge_type: `${metric}（${orderedTiers.length} 档）`, unit_code: unitCodeFor(metric, meter, anchor.unit_size), provider_unit_price: anchor.provider_unit_price,
      unit_size: anchor.unit_size, new_unit_price_micro: anchor.micro, new_conditions_json: JSON.stringify(conditions),
      conditions_changed: 0, raw_item_json: JSON.stringify(rawItem) };
  }
  if (rates.length) {
    conditions.rates = rates.map((piece) => ({ id: piece.selector.id, when: piece.selector.when, unit_price_points: piece.points, unit_size: piece.unit_size }));
    // 报价上下文缺少对应档位时引擎会退回基准价，这里把基准价设为最贵的一条，宁可多冻结也不漏收。
    const top = rates.reduce((best, piece) => (piece.micro > best.micro ? piece : best), bases[0] || rates[0]);
    conditions.unit_size = top.unit_size;
    return { ...meta, provider_model: pieces[0].provider_model, display_name: pieces[0].display_name, currency: pieces[0].currency,
      charge_type: `${metric}（${rates.length} 条件）`, unit_code: unitCodeFor(metric, meter, top.unit_size), provider_unit_price: top.provider_unit_price,
      unit_size: top.unit_size, new_unit_price_micro: top.micro, new_conditions_json: JSON.stringify(conditions),
      conditions_changed: 0, raw_item_json: JSON.stringify(rawItem) };
  }
  const piece = bases[0];
  conditions.unit_size = piece.unit_size;
  conditions.provider_metric = metric;
  return { ...meta, provider_model: piece.provider_model, display_name: piece.display_name, currency: piece.currency,
    charge_type: piece.charge_type, unit_code: piece.unit_code, provider_unit_price: piece.provider_unit_price,
    unit_size: piece.unit_size, new_unit_price_micro: piece.micro, new_conditions_json: JSON.stringify(conditions),
    conditions_changed: 0, raw_item_json: piece.raw_item_json };
}

/**
 * 上游条目 → 候选行数组。
 * 一个 (模型, meter) 只产出一条候选：多条维度价格在 compileGroup 里编译成条件价。
 * configured:false 或空 prices 只产出 unmapped，绝不产出免费条目。
 */
function buildCandidates(entries, { resolveTarget, discountBps, syncId = null } = {}) {
  const rows = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const model = String(entry?.id || '').trim();
    if (!model) continue;
    const target = resolveTarget ? resolveTarget(model) : null;
    // 与火山同源（providerPriceService.buildCandidateRows 对未配置模型直接 return []）：
    // 上游有、但本项目没导入的模型不进候选清单，否则整张上游价目都会变成待办噪声。
    if (!target) continue;
    const prices = Array.isArray(entry?.prices) ? entry.prices : [];
    if (entry?.configured === false || !prices.length) {
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
    const groups = new Map();
    for (const price of prices) {
      const piece = pricePiece(entry, price, { discountBps });
      const key = piece.meter || `metric:${piece.metric}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(piece);
    }
    for (const pieces of groups.values()) {
      const meter = pieces[0].meter;
      if (!meter) {
        rows.push(...pieces.map((piece) => unmappedRow(piece)));
        continue;
      }
      const usable = pieces.filter((piece) => !piece.reason);
      rows.push(...pieces.filter((piece) => piece.reason).map((piece) => unmappedRow(piece)));
      if (usable.length) rows.push(compileGroup(entry, target, usable, { syncId, discountBps }));
    }
  }
  return rows;
}

/**
 * 取一枚可用的中转凭据。
 *
 * 注意：中转站的价目与 discount_bps 都是**按项目**返回的，而同一套部署里可能同时存在多枚
 * 属于不同瑞池项目的 richbest Key（多租户各配各的）。同步产出的是平台级价目书，因此优先用
 * 平台级配置（未绑定租户的那条）；只有租户级配置时退而用第一枚，并把实际使用的 config_id
 * 落进同步批次（providerPriceService 已回填 source_config_id），便于事后核对是哪枚 Key 拉的价。
 */
function pricingContext(db) {
  const ai = require('./aiConfigService');
  const rows = db.prepare(`SELECT id FROM ai_service_configs WHERE deleted_at IS NULL AND provider=? AND is_active=1
    ORDER BY (COALESCE(owner_tenant_id, 0) = 0) DESC, is_default DESC, priority DESC, id ASC`)
    .all(PROVIDER).map((row) => ai.getConfig(db, row.id)).filter(Boolean);
  const withKey = rows.filter((config) => !config.owner_tenant_id && String(config.api_key || '').trim());
  if (!withKey.length) throw new Error('未找到平台级瑞池中转配置；租户项目 Key 的价格不能发布为全局价目');
  return { config: withKey[0] };
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
  PROVIDER, SOURCE, METERS, UNSUPPORTED_METERS, RESOLUTIONS,
  parseYuan, yuanToMicroPoints, yuanToPointsText, meterFor, parseDimension, unitCodeFor, chargeTypeFor, assertConsistent, pricePiece, buildCandidates,
  fetchPricing, pricingContext,
};
