'use strict';

const crypto = require('crypto');
const { randomUUID } = require('crypto');

const PROVIDER = 'volcengine';
const ARK_VERSION = '2024-01-01';
const BILLING_VERSION = '2022-01-01';
const POINTS_PER_CNY = 100;
const MICRO_PER_POINT = 10000;
const LOCK_MS = 10 * 60 * 1000;
const MAPPING_RULE_VERSION = 'verified-platform-models-v2';

function now() { return new Date().toISOString(); }
function parse(value, fallback = {}) { try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } }
function json(value) { return JSON.stringify(value == null ? {} : value); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hmac(key, value, encoding) { return crypto.createHmac('sha256', key).update(value).digest(encoding); }

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sanitize(value, keyName = '') {
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (/(?:secret|access.?key|authorization|session.?token|credential)/i.test(key) || /(?:secret|access.?key|authorization|session.?token|credential)/i.test(keyName)) continue;
    out[key] = sanitize(child, key);
  }
  return out;
}

function encodeRFC3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(params) {
  return Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeRFC3986(key)}=${encodeRFC3986(value)}`).join('&');
}

function signedHeaders({ accessKeyId, secretAccessKey, region, service, action, version, body, date = new Date() }) {
  const bodyText = JSON.stringify(body || {});
  const payloadHash = sha256(bodyText);
  const xDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = xDate.slice(0, 8);
  const host = 'open.volcengineapi.com';
  const contentType = 'application/json; charset=utf-8';
  // Volcengine excludes content-type from signed headers. The generic
  // OpenAPI endpoint also signs only headers explicitly supplied here.
  const signed = 'x-content-sha256;x-date';
  const headersText = `x-content-sha256:${payloadHash}\nx-date:${xDate}\n`;
  const query = canonicalQuery({ Action: action, Version: version });
  const canonicalRequest = `POST\n/\n${query}\n${headersText}\n${signed}\n${payloadHash}`;
  const scope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = `HMAC-SHA256\n${xDate}\n${scope}\n${sha256(canonicalRequest)}`;
  const dateKey = hmac(secretAccessKey, shortDate);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, 'request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  return {
    url: `https://${host}/?${query}`,
    bodyText,
    headers: {
      'Content-Type': contentType,
      'X-Content-Sha256': payloadHash,
      'X-Date': xDate,
      Authorization: `HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    },
  };
}

function credentials(db) {
  const row = db.prepare(`SELECT id, name, settings FROM ai_service_configs
    WHERE deleted_at IS NULL AND service_type='model_ark_asset' AND is_active=1
    ORDER BY is_default DESC, priority DESC, id ASC LIMIT 1`).get();
  if (!row) throw new Error('未找到可用的 ModelArk 资产库配置');
  const settings = parse(row.settings, {});
  const accessKeyId = String(settings.access_key_id || '').trim();
  const secretAccessKey = String(settings.secret_access_key || '').trim();
  if (!accessKeyId || !secretAccessKey) throw new Error('ModelArk 资产库配置缺少 IAM AK/SK');
  return { configId: row.id, configName: row.name, accessKeyId, secretAccessKey, region: String(settings.sign_region || 'cn-beijing').trim() || 'cn-beijing' };
}

async function callOpenApi(credential, options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 运行时不支持 fetch');
  const signed = signedHeaders({
    accessKeyId: credential.accessKeyId,
    secretAccessKey: credential.secretAccessKey,
    region: options.region || credential.region || 'cn-beijing',
    service: options.service,
    action: options.action,
    version: options.version,
    body: options.body,
    date: options.date,
  });
  const response = await fetchImpl(signed.url, { method: 'POST', headers: signed.headers, body: signed.bodyText, redirect: 'manual' });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch (_) { payload = { _raw: text.slice(0, 1000) }; }
  const upstreamError = payload?.ResponseMetadata?.Error;
  if (!response.ok || upstreamError) {
    const error = new Error(String(upstreamError?.Message || payload?.message || `火山 OpenAPI HTTP ${response.status}`).slice(0, 1000));
    error.status = response.status;
    error.code = upstreamError?.Code || 'VOLCENGINE_OPENAPI_ERROR';
    error.requestId = payload?.ResponseMetadata?.RequestId || null;
    throw error;
  }
  return { payload, requestId: payload?.ResponseMetadata?.RequestId || null };
}

async function fetchAllActivations(credential, options = {}) {
  const items = [];
  const requestIds = [];
  let page = 1;
  let total = Infinity;
  while (items.length < total && page <= 100) {
    const result = await callOpenApi(credential, {
      ...options, service: 'ark', action: 'ListModelActivations', version: ARK_VERSION,
      body: { PageNumber: page, PageSize: 100, WithPrice: true, WithFreeUsage: false, Filter: { States: ['Available'], IncludeDeprecatedModels: true } },
    });
    if (result.requestId) requestIds.push(result.requestId);
    const pageItems = Array.isArray(result.payload?.Result?.Items) ? result.payload.Result.Items : [];
    items.push(...pageItems);
    total = Number(result.payload?.Result?.TotalCount ?? items.length);
    if (!pageItems.length) break;
    page += 1;
  }
  return { items, requestIds };
}

function currentBillPeriod(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shanghaiDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '').slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function platformUsageSummary(db, billPeriod) {
  const start = `${billPeriod}-01T00:00:00.000Z`;
  const next = new Date(`${billPeriod}-01T00:00:00.000Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  const groups = new Map();
  const rows = db.prepare('SELECT created_at,model,usage_json FROM billing_usage_logs WHERE created_at>=? AND created_at<?').all(start, next.toISOString());
  for (const row of rows) {
    const usage = parse(row.usage_json, {});
    for (const [meter, amount] of Object.entries(usage)) {
      const numeric = Number(amount); if (!Number.isFinite(numeric)) continue;
      const date = shanghaiDate(row.created_at); const key = `${date}\0${row.model}\0${meter}`;
      const current = groups.get(key) || { date, model: row.model, charge_item: meter, usage: 0 };
      current.usage += numeric; groups.set(key, current);
    }
  }
  return [...groups.values()].sort((a, b) => `${a.date}\0${a.model}\0${a.charge_item}`.localeCompare(`${b.date}\0${b.model}\0${b.charge_item}`));
}

function providerBillSummary(rows) {
  return rows.map((row) => ({
    date: row.ExpenseDate || row.BillPeriod || null,
    model: row.InstanceName || row.InstanceNo || row.Configuration || row.ConfigurationCode || null,
    charge_item: row.Element || row.ElementCode || null,
    usage: row.Count == null ? null : String(row.Count),
    unit: row.Unit || null,
    unit_price: row.Price == null ? null : String(row.Price),
    price_unit: row.PriceUnit || null,
    product: row.Product || row.ProductZh || null,
    currency: row.Currency || 'CNY',
  }));
}

async function fetchBillDetails(credential, billPeriod, options = {}) {
  const rows = []; const requestIds = []; const limit = 300; let total = Infinity; let offset = 0;
  while (rows.length < total && offset < 30000) {
    const bill = await callOpenApi(credential, {
      ...options, region: 'cn-north-1', service: 'billing', action: 'ListBillDetail', version: BILLING_VERSION,
      body: { BillPeriod: billPeriod, Limit: limit, Offset: offset, NeedRecordNum: 1, IgnoreZero: 0, GroupTerm: 0, GroupPeriod: 1 },
    });
    if (bill.requestId) requestIds.push(bill.requestId);
    const page = Array.isArray(bill.payload?.Result?.List) ? bill.payload.Result.List : [];
    rows.push(...page); total = Number(bill.payload?.Result?.Total ?? rows.length);
    if (!page.length || page.length < limit) break;
    offset += page.length;
    if (options.fetchImpl == null) await new Promise((resolve) => setTimeout(resolve, 220));
  }
  const uniqueRows = [...new Map(rows.map((row) => [String(row.BillDetailId || sha256(JSON.stringify(stable(row)))), row])).values()];
  return { rows: uniqueRows, requestIds, total: Number.isFinite(total) ? total : uniqueRows.length };
}

async function probe(db, actorId, options = {}) {
  const credential = credentials(db);
  const checkedAt = now();
  let arkStatus = 'failed'; let billingStatus = 'failed'; let arkRequestId = null; let billingRequestId = null;
  let arkError = null; let billingError = null; let activationCount = 0; let billRows = 0; let billSummary = []; let billingRequestIds = [];
  try {
    const ark = await callOpenApi(credential, {
      ...options, service: 'ark', action: 'ListModelActivations', version: ARK_VERSION,
      body: { PageNumber: 1, PageSize: 1, WithPrice: true, WithFreeUsage: false, Filter: { States: ['Available'] } },
    });
    arkStatus = 'success'; arkRequestId = ark.requestId; activationCount = Number(ark.payload?.Result?.TotalCount || 0);
  } catch (error) { arkError = `${error.code || 'ERROR'}: ${error.message}`; arkRequestId = error.requestId || null; }
  try {
    const bills = await fetchBillDetails(credential, options.billPeriod || currentBillPeriod(), options);
    billingStatus = 'success'; billingRequestIds = bills.requestIds; billingRequestId = bills.requestIds[0] || null; billRows = bills.rows.length; billSummary = providerBillSummary(bills.rows);
  } catch (error) { billingError = `${error.code || 'ERROR'}: ${error.message}`; billingRequestId = error.requestId || null; }
  const billPeriod = options.billPeriod || currentBillPeriod();
  const detail = { source_config_id: credential.configId, source_config_name: credential.configName, activation_count: activationCount, bill_rows: billRows, bill_period: billPeriod, billing_request_ids: billingRequestIds, bill_summary_count: billSummary.length, bill_summary_truncated: billRows > billSummary.length, bill_summary: billSummary, platform_usage_summary: platformUsageSummary(db, billPeriod) };
  db.prepare(`INSERT INTO provider_price_source_checks
    (provider,ark_status,billing_status,ark_request_id,billing_request_id,checked_at,error_summary,detail_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET ark_status=excluded.ark_status,billing_status=excluded.billing_status,
    ark_request_id=excluded.ark_request_id,billing_request_id=excluded.billing_request_id,checked_at=excluded.checked_at,
    error_summary=excluded.error_summary,detail_json=excluded.detail_json,updated_at=excluded.updated_at`)
    .run(PROVIDER, arkStatus, billingStatus, arkRequestId, billingRequestId, checkedAt, [arkError, billingError].filter(Boolean).join(' | ') || null, json(detail), checkedAt);
  require('./billingService').audit(db, actorId, 'provider_price.probe', 'provider', PROVIDER, { ark_status: arkStatus, billing_status: billingStatus, ark_request_id: arkRequestId, billing_request_id: billingRequestId, ...detail });
  return { provider: PROVIDER, ark_status: arkStatus, billing_status: billingStatus, ark_request_id: arkRequestId, billing_request_id: billingRequestId, checked_at: checkedAt, errors: { ark: arkError, billing: billingError }, ...detail };
}

function sourceCheck(db) {
  const row = db.prepare('SELECT * FROM provider_price_source_checks WHERE provider=?').get(PROVIDER);
  if (!row) return null;
  const detail = parse(row.detail_json, {});
  const { bill_summary: _billSummary, platform_usage_summary: platformSummary, ...publicDetail } = detail;
  return { ...row, detail_json: undefined, ...publicDetail, platform_usage_group_count: Array.isArray(platformSummary) ? platformSummary.length : 0, errors: row.error_summary ? { summary: row.error_summary } : { ark: null, billing: null } };
}

function acquireLock(db, provider = PROVIDER) {
  const token = randomUUID(); const at = now(); const until = new Date(Date.now() + LOCK_MS).toISOString();
  const result = db.prepare(`INSERT INTO provider_price_sync_locks(provider,lock_token,locked_until,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(provider) DO UPDATE SET lock_token=excluded.lock_token,locked_until=excluded.locked_until,updated_at=excluded.updated_at
    WHERE provider_price_sync_locks.locked_until <= excluded.updated_at`).run(provider, token, until, at);
  if (!result.changes) return null;
  return token;
}

function releaseLock(db, token, provider = PROVIDER) {
  db.prepare('DELETE FROM provider_price_sync_locks WHERE provider=? AND lock_token=?').run(provider, token);
}

function normalizeName(value) { return String(value || '').trim().toLowerCase().replace(/[._\s]+/g, '-'); }
function configuredTargets(db, providerModel) {
  const needle = normalizeName(providerModel);
  const rows = db.prepare(`SELECT service_type,provider,model,billing_key FROM ai_service_configs
    WHERE deleted_at IS NULL AND is_active=1`).all();
  const targets = [];
  for (const row of rows) {
    if (!/(?:volc|doubao|火山)/i.test(String(row.provider || ''))) continue;
    const models = (() => { const parsedModels = parse(row.model, null); return Array.isArray(parsedModels) ? parsedModels : String(row.model || '').split(','); })();
    const modelKeys = models.filter(Boolean).map((item) => String(item).trim());
    const keys = [...modelKeys, row.billing_key].filter(Boolean).map((item) => String(item).trim());
    const exact = keys.some((item) => normalizeName(item) === needle);
    const family = keys.some((item) => normalizeName(item).startsWith(`${needle}-`) || needle.startsWith(`${normalizeName(item)}-`));
    const matchedModel = modelKeys.find((item) => normalizeName(item) === needle)
      || modelKeys.find((item) => normalizeName(item).startsWith(`${needle}-`) || needle.startsWith(`${normalizeName(item)}-`));
    if (exact || family) targets.push({ service_type: row.service_type, billing_key: String(row.billing_key || matchedModel || providerModel).trim(), exact });
  }
  const unique = [...new Map(targets.map((item) => [`${item.service_type}\0${item.billing_key}`, item])).values()];
  const exact = unique.filter((item) => item.exact);
  return exact.length ? exact : unique;
}

function missingConfiguredModelRows(db, providerItems) {
  const providerNames = providerItems.map((item) => normalizeName(item.FoundationModelName || item.Name)).filter(Boolean);
  const rows = db.prepare(`SELECT service_type,provider,model,billing_key FROM ai_service_configs
    WHERE deleted_at IS NULL AND is_active=1`).all();
  const warnings = [];
  const seen = new Set();
  for (const row of rows) {
    if (!/(?:volc|doubao|火山)/i.test(String(row.provider || ''))) continue;
    if (!['text', 'image', 'storyboard_image', 'video', 'tts', 'video_postprocess'].includes(String(row.service_type || ''))) continue;
    const configured = (() => { const parsedModels = parse(row.model, null); return Array.isArray(parsedModels) ? parsedModels : String(row.model || '').split(','); })();
    for (const modelValue of configured) {
      const model = String(modelValue || '').trim();
      if (!model) continue;
      const needle = normalizeName(model);
      const exists = providerNames.some((name) => name === needle || name.startsWith(`${needle}-`) || needle.startsWith(`${name}-`));
      const billingKey = String(row.billing_key || model).trim();
      const key = `${row.service_type}\0${billingKey}`;
      if (exists || seen.has(key)) continue;
      seen.add(key);
      warnings.push({ provider_model: model, display_name: model, charge_type: 'MissingFromProvider', unit_code: null, provider_unit_price: null, service_type: row.service_type, billing_key: billingKey, meter: null, unit_size: null, new_unit_price_micro: null, mapping_status: 'unmapped', error_summary: '供应商未返回此现有模型。系统不会删除或停用当前价格', raw_item_json: json({ configured_model: model, service_type: row.service_type, billing_key: billingKey }) });
    }
  }
  return warnings;
}

function chargeMeter(type, unitCode) {
  const t = String(type || '').toLowerCase(); const u = String(unitCode || '').toLowerCase();
  if (t === 'inferenceprompt') return 'input_token';
  if (t === 'inferencecompletion') return 'output_token';
  if (['imagegeneration', 'inferenceimage', 'image'].includes(t) && /张|image/.test(u)) return 'image';
  if (['speechsynthesis', 'tts', 'character'].includes(t) && /字符|character/.test(u)) return 'character';
  if (['videogenerationsecond', 'video'].includes(t) && /秒|second/.test(u)) return 'second';
  return null;
}

function sourceUnitSize(unitCode, meter) {
  const u = String(unitCode || '').toLowerCase().replace(/,/g, '');
  if (/百万|1m|million/.test(u)) return 1000000;
  if (/千|1k|thousand/.test(u)) return 1000;
  if (/万/.test(u)) return 10000;
  if (meter === 'image' || meter === 'second' || /每|\/|per/.test(u)) return 1;
  return null;
}

function normalizedPriceMicro(price, sourceSize, meter) {
  const numeric = Number(price);
  if (!Number.isFinite(numeric) || numeric < 0 || !Number.isSafeInteger(sourceSize) || sourceSize <= 0) return null;
  const targetSize = ['input_token', 'output_token'].includes(meter) ? 1000000 : sourceSize;
  const micro = Math.round(numeric * (targetSize / sourceSize) * POINTS_PER_CNY * MICRO_PER_POINT);
  return Number.isSafeInteger(micro) ? { micro, unitSize: targetSize } : null;
}

function activeItem(db, serviceType, model, meter) {
  return db.prepare(`SELECT pbi.* FROM billing_price_book_items pbi JOIN billing_price_books pb ON pb.id=pbi.price_book_id
    WHERE pb.status='published' AND (pb.effective_from IS NULL OR pb.effective_from<=?) AND (pb.effective_to IS NULL OR pb.effective_to>?)
      AND pbi.service_type=? AND pbi.model=? AND pbi.meter=?
    ORDER BY pb.system_managed DESC,pb.updated_at DESC,pbi.id DESC LIMIT 1`).get(now(), now(), serviceType, model, meter);
}

function verifiedTargets(db, providerModel, serviceTypes) {
  const providerName = normalizeName(providerModel);
  const rows = db.prepare(`SELECT service_type,provider,model,billing_key FROM ai_service_configs
    WHERE deleted_at IS NULL AND is_active=1`).all();
  const targets = [];
  for (const row of rows) {
    if (!/(?:volc|doubao|火山)/i.test(String(row.provider || ''))) continue;
    if (!serviceTypes.includes(String(row.service_type || ''))) continue;
    const models = (() => { const parsedModels = parse(row.model, null); return Array.isArray(parsedModels) ? parsedModels : String(row.model || '').split(','); })();
    const matchedModel = models.filter(Boolean).map((value) => String(value).trim()).find((value) => normalizeName(value).replace(/-\d{6}$/, '') === providerName);
    const billingKeyMatches = row.billing_key && normalizeName(row.billing_key).replace(/-\d{6}$/, '') === providerName;
    if (!matchedModel && !billingKeyMatches) continue;
    targets.push({ service_type: String(row.service_type), billing_key: String(row.billing_key || matchedModel || providerModel).trim() });
  }
  return [...new Map(targets.map((target) => [`${target.service_type}\0${target.billing_key}`, target])).values()];
}

function providerModelIsConfigured(db, providerModel) {
  const providerName = normalizeName(providerModel);
  const rows = db.prepare(`SELECT provider,model,billing_key FROM ai_service_configs
    WHERE deleted_at IS NULL AND is_active=1`).all();
  return rows.some((row) => {
    if (!/(?:volc|doubao|火山)/i.test(String(row.provider || ''))) return false;
    const models = (() => { const parsedModels = parse(row.model, null); return Array.isArray(parsedModels) ? parsedModels : String(row.model || '').split(','); })();
    return [...models, row.billing_key].filter(Boolean).some((value) => normalizeName(value).replace(/-\d{6}$/, '') === providerName);
  });
}

function contractPrice(charge) {
  const hasDatedDiscount = Boolean(charge?.DiscountPriceStartTime && charge?.DiscountPriceEndTime);
  const value = hasDatedDiscount && Number.isFinite(Number(charge?.OriginalPrice)) ? charge.OriginalPrice : charge?.Price;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function chargeIn(groups, type, index = null) {
  const selected = index == null ? groups : [groups[index]].filter(Boolean);
  for (const group of selected) {
    const found = (Array.isArray(group?.ChargeItems) ? group.ChargeItems : []).find((charge) => charge.Type === type);
    if (found) return found;
  }
  return null;
}

function normalizedCharge(charge, meter) {
  if (!charge) return null;
  const sourceSize = sourceUnitSize(charge.UnitCode, meter);
  return sourceSize ? normalizedPriceMicro(contractPrice(charge), sourceSize, meter) : null;
}

function priceCore(value) {
  const conditions = typeof value === 'string' ? parse(value, {}) : (value || {});
  return stable({
    unit_size: conditions.unit_size ?? null,
    default_rate_id: conditions.default_rate_id ?? null,
    rates: Array.isArray(conditions.rates) ? conditions.rates : [],
    usage_tiers: Array.isArray(conditions.usage_tiers) ? conditions.usage_tiers : [],
  });
}

function samePriceCore(left, right) { return JSON.stringify(priceCore(left)) === JSON.stringify(priceCore(right)); }

function mappedCandidate(db, item, target, spec) {
  const model = String(item.FoundationModelName || item.Name || '').trim();
  const current = activeItem(db, target.service_type, target.billing_key, spec.meter);
  const conditionsChanged = !samePriceCore(current?.conditions_json, spec.conditions);
  return {
    provider_model: model,
    display_name: String(item.DisplayName || model).trim(),
    charge_type: spec.chargeType,
    unit_code: spec.unitCode,
    provider_unit_price: spec.providerPrice,
    service_type: target.service_type,
    billing_key: target.billing_key,
    meter: spec.meter,
    unit_size: spec.unitSize,
    new_unit_price_micro: spec.unitPriceMicro,
    new_conditions_json: json(spec.conditions),
    conditions_changed: conditionsChanged ? 1 : 0,
    current_unit_price_micro: current?.unit_price_micro ?? null,
    current_price_book_item_id: current?.id ?? null,
    change_ratio: current?.unit_price_micro ? (spec.unitPriceMicro - current.unit_price_micro) / current.unit_price_micro : null,
    mapping_status: 'mapped',
    error_summary: null,
    raw_item_json: json({ mapping_rule: MAPPING_RULE_VERSION, source: spec.raw }),
  };
}

function compoundSpec(groups, meter, chargeType, charges, rates, defaultRateId) {
  const normalized = charges.map((charge) => normalizedCharge(charge, meter));
  if (charges.some((charge) => !charge) || normalized.some((price) => !price)) return null;
  const unitSize = normalized[0].unitSize;
  const rateRows = rates.map((rate, index) => ({ ...rate, unit_price_points: normalized[index].micro / MICRO_PER_POINT, unit_size: unitSize }));
  const defaultIndex = Math.max(0, rateRows.findIndex((rate) => rate.id === defaultRateId));
  return {
    meter, chargeType, unitCode: charges[0].UnitCode, unitSize,
    unitPriceMicro: normalized[defaultIndex].micro,
    providerPrice: charges.map((charge) => `${charge.Type}=${contractPrice(charge)}`).join('; '),
    conditions: { unit_size: unitSize, default_rate_id: defaultRateId, rates: rateRows }, raw: groups,
  };
}

function verifiedMultiChargeRows(db, item, groups) {
  const model = normalizeName(item.FoundationModelName || item.Name);
  let serviceTypes = []; let specs = [];
  if (model === 'doubao-seedream-5-0') {
    serviceTypes = ['image', 'storyboard_image'];
    specs = [compoundSpec(groups, 'image', 'VerifiedImageGeneration', [chargeIn(groups, 'I2ICompletion'), chargeIn(groups, 'T2ICompletion')], [
      { id: 'image_to_image', when: { has_image_input: true } },
      { id: 'text_to_image', when: { has_image_input: false } },
    ], 'text_to_image')];
  } else if (model === 'doubao-seed-2-0-lite') {
    serviceTypes = ['text'];
    for (const [type, meter] of [['InferencePrompt', 'input_token'], ['InferenceCompletion', 'output_token']]) {
      const charges = [0, 1, 2].map((index) => chargeIn(groups, type, index));
      const normalized = charges.map((charge) => normalizedCharge(charge, meter));
      if (charges.some((charge) => !charge) || normalized.some((price) => !price)) { specs.push(null); continue; }
      const tiers = normalized.map((price, index) => ({
        id: `${meter}_${['32k', '128k', '256k'][index]}`, selector_meter: 'input_token',
        min_inclusive: [0, 32769, 131073][index], max_inclusive: [32768, 131072, 262144][index],
        unit_price_points: price.micro / MICRO_PER_POINT, unit_size: price.unitSize,
      }));
      specs.push({ meter, chargeType: `Verified${type}Tiers`, unitCode: charges[0].UnitCode, unitSize: normalized[0].unitSize, unitPriceMicro: normalized[0].micro, providerPrice: charges.map((charge, index) => `${['≤32K', '≤128K', '≤256K'][index]}=${contractPrice(charge)}`).join('; '), conditions: { unit_size: normalized[0].unitSize, usage_tiers: tiers }, raw: groups });
    }
  } else if (['doubao-seed-2-1-pro', 'doubao-seed-2-1-turbo'].includes(model)) {
    serviceTypes = ['text'];
    for (const [type, meter] of [['InferencePrompt', 'input_token'], ['InferenceCompletion', 'output_token']]) {
      const charge = chargeIn(groups, type); const normalized = normalizedCharge(charge, meter);
      specs.push(charge && normalized ? { meter, chargeType: `Verified${type}`, unitCode: charge.UnitCode, unitSize: normalized.unitSize, unitPriceMicro: normalized.micro, providerPrice: String(contractPrice(charge)), conditions: { unit_size: normalized.unitSize }, raw: groups } : null);
    }
  } else if (model === 'doubao-seedance-1-5-pro') {
    serviceTypes = ['video'];
    specs = [compoundSpec(groups, 'output_token', 'VerifiedVideoAudioRates', [chargeIn(groups, 'ToVSilentCompletion'), chargeIn(groups, 'ToVCompletion')], [
      { id: 'silent_video', when: { has_audio: false } }, { id: 'audio_video', when: { has_audio: true } },
    ], 'silent_video')];
  } else if (['doubao-seedance-2-0', 'doubao-seedance-2-0-fast', 'doubao-seedance-2-0-mini', 'doubao-seedance-2-5'].includes(model)) {
    serviceTypes = ['video'];
    const types = ['V2VCompletion', 'NV2VCompletion'];
    const rates = [{ id: 'with_video_input', when: { has_video_input: true } }, { id: 'no_video_input', when: { has_video_input: false } }];
    if (['doubao-seedance-2-0', 'doubao-seedance-2-5'].includes(model)) {
      types.unshift('NV2V1080Completion'); types.unshift('V2V1080Completion');
      rates.unshift({ id: 'no_video_input_1080p', when: { has_video_input: false, resolution: '1080p' } });
      rates.unshift({ id: 'with_video_input_1080p', when: { has_video_input: true, resolution: '1080p' } });
    }
    if (model === 'doubao-seedance-2-0') {
      types.unshift('NV2V4KCompletion'); types.unshift('V2V4KCompletion');
      rates.unshift({ id: 'no_video_input_4k', when: { has_video_input: false, resolution: '4k' } });
      rates.unshift({ id: 'with_video_input_4k', when: { has_video_input: true, resolution: '4k' } });
    }
    specs = [compoundSpec(groups, 'output_token', 'VerifiedVideoInputResolutionRates', types.map((type) => chargeIn(groups, type)), rates, 'no_video_input')];
  } else return null;
  const targets = verifiedTargets(db, model, serviceTypes);
  if (!targets.length || specs.some((spec) => !spec)) return [];
  return targets.flatMap((target) => specs.map((spec) => mappedCandidate(db, item, target, spec)));
}

function buildCandidateRows(db, item) {
  const model = String(item.FoundationModelName || item.Name || '').trim();
  const displayName = String(item.DisplayName || model).trim();
  if (!providerModelIsConfigured(db, model)) return [];
  const multi = Array.isArray(item.MultiChargeItems) ? item.MultiChargeItems : [];
  const charges = Array.isArray(item.ChargeItems) ? item.ChargeItems : [];
  if (multi.length) {
    const verified = verifiedMultiChargeRows(db, item, multi);
    if (verified?.length) return verified;
    return multi.map((raw, index) => ({ provider_model: model, display_name: displayName, charge_type: `MultiChargeItems[${index}]`, unit_code: raw.UnitCode || null, provider_unit_price: raw.Price == null ? null : String(raw.Price), mapping_status: 'unmapped', error_summary: verified ? '已验证模型的必要计费项或本地 billing_key 缺失，不能自动发布' : '复杂条件价格需要人工映射，不能自动发布', raw_item_json: json(raw) }));
  }
  return charges.map((raw) => {
    const meter = chargeMeter(raw.Type, raw.UnitCode);
    const size = meter ? sourceUnitSize(raw.UnitCode, meter) : null;
    const normalized = meter && size ? normalizedPriceMicro(raw.Price, size, meter) : null;
    const targets = configuredTargets(db, model);
    if (!meter || !normalized || targets.length !== 1) {
      return { provider_model: model, display_name: displayName, charge_type: String(raw.Type || 'unknown'), unit_code: raw.UnitCode || null, provider_unit_price: raw.Price == null ? null : String(raw.Price), meter, unit_size: normalized?.unitSize || null, new_unit_price_micro: normalized?.micro || null, mapping_status: targets.length > 1 ? 'ambiguous' : 'unmapped', error_summary: !meter || !normalized ? '未知计费类型或计量单位' : targets.length > 1 ? '模型对应多个本地计费键' : '找不到本地 billing_key', raw_item_json: json(raw) };
    }
    const target = targets[0]; const current = activeItem(db, target.service_type, target.billing_key, meter);
    return { provider_model: model, display_name: displayName, charge_type: String(raw.Type || 'unknown'), unit_code: raw.UnitCode || null, provider_unit_price: String(raw.Price), service_type: target.service_type, billing_key: target.billing_key, meter, unit_size: normalized.unitSize, new_unit_price_micro: normalized.micro, current_unit_price_micro: current?.unit_price_micro ?? null, current_price_book_item_id: current?.id ?? null, change_ratio: current?.unit_price_micro ? (normalized.micro - current.unit_price_micro) / current.unit_price_micro : null, mapping_status: 'mapped', error_summary: null, raw_item_json: json(raw) };
  });
}

function syncView(db, id) {
  const sync = db.prepare('SELECT * FROM provider_price_syncs WHERE id=?').get(id);
  if (!sync) return null;
  const currentConditions = db.prepare('SELECT conditions_json FROM billing_price_book_items WHERE id=?');
  return { ...sync, provider_request_ids: parse(sync.provider_request_ids_json, []), candidates: db.prepare('SELECT * FROM provider_price_candidates WHERE sync_id=? ORDER BY provider_model,charge_type,id').all(id).map((row) => ({ ...row, conditions_changed: !!row.conditions_changed, current_conditions: parse(currentConditions.get(row.current_price_book_item_id)?.conditions_json, null), new_conditions: parse(row.new_conditions_json, null), raw_item: parse(row.raw_item_json, null) })) };
}

function listSyncs(db, limit = 30) {
  return db.prepare('SELECT id,provider,status,trigger_type,response_hash,candidate_count,mapped_count,changed_count,error_summary,fetched_at,created_at FROM provider_price_syncs ORDER BY created_at DESC LIMIT ?').all(Math.min(100, Math.max(1, Number(limit) || 30)));
}

async function sync(db, actorId, options = {}) {
  const token = acquireLock(db);
  if (!token) throw new Error('火山价目同步正在运行，请稍后再试');
  const id = randomUUID(); const at = now(); let credential;
  try {
    credential = credentials(db);
    db.prepare(`INSERT INTO provider_price_syncs(id,provider,source_config_id,status,trigger_type,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, PROVIDER, credential.configId, 'processing', options.triggerType === 'scheduled' ? 'scheduled' : 'manual', actorId || null, at, at);
    const fetched = await fetchAllActivations(credential, options);
    const clean = sanitize(fetched.items);
    const responseHash = sha256(`${JSON.stringify(stable(clean))}|${MAPPING_RULE_VERSION}`);
    const existing = db.prepare(`SELECT id FROM provider_price_syncs WHERE provider=? AND response_hash=? AND status IN ('completed','unchanged') AND id<>? LIMIT 1`).get(PROVIDER, responseHash, id);
    if (existing) {
      db.prepare(`UPDATE provider_price_syncs SET status='unchanged',response_hash=?,provider_request_ids_json=?,raw_response_json=?,fetched_at=?,updated_at=? WHERE id=?`)
        .run(responseHash, json(fetched.requestIds), json(clean), now(), now(), id);
      return { ...syncView(db, id), reused_from_sync_id: existing.id };
    }
    const rows = [...clean.flatMap((item) => buildCandidateRows(db, item)), ...missingConfiguredModelRows(db, clean)];
    const insert = db.prepare(`INSERT INTO provider_price_candidates
      (sync_id,provider,provider_model,display_name,charge_type,unit_code,currency,provider_unit_price,service_type,billing_key,meter,unit_size,new_unit_price_micro,new_conditions_json,conditions_changed,current_unit_price_micro,current_price_book_item_id,change_ratio,mapping_status,review_status,error_summary,raw_item_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)`);
    db.transaction(() => {
      for (const row of rows) insert.run(id, PROVIDER, row.provider_model, row.display_name, row.charge_type, row.unit_code, 'CNY', row.provider_unit_price, row.service_type || null, row.billing_key || null, row.meter || null, row.unit_size || null, row.new_unit_price_micro ?? null, row.new_conditions_json || null, row.conditions_changed ? 1 : 0, row.current_unit_price_micro ?? null, row.current_price_book_item_id ?? null, row.change_ratio ?? null, row.mapping_status, row.error_summary || null, row.raw_item_json, at, at);
      const mapped = rows.filter((row) => row.mapping_status === 'mapped').length;
      const changed = rows.filter((row) => row.mapping_status === 'mapped' && (row.new_unit_price_micro !== row.current_unit_price_micro || row.conditions_changed)).length;
      db.prepare(`UPDATE provider_price_syncs SET status='completed',response_hash=?,provider_request_ids_json=?,raw_response_json=?,candidate_count=?,mapped_count=?,changed_count=?,fetched_at=?,updated_at=? WHERE id=?`)
        .run(responseHash, json(fetched.requestIds), json(clean), rows.length, mapped, changed, now(), now(), id);
    })();
    return syncView(db, id);
  } catch (error) {
    const exists = db.prepare('SELECT 1 FROM provider_price_syncs WHERE id=?').get(id);
    if (exists) db.prepare(`UPDATE provider_price_syncs SET status='failed',error_summary=?,updated_at=? WHERE id=?`).run(String(error.message || error).slice(0, 1000), now(), id);
    throw error;
  } finally { releaseLock(db, token); }
}

function updateCandidate(db, actorId, syncId, candidateId, input = {}) {
  const row = db.prepare('SELECT * FROM provider_price_candidates WHERE id=? AND sync_id=?').get(candidateId, syncId);
  if (!row) throw new Error('候选价格不存在');
  if (input.review_status === 'rejected') {
    db.prepare("UPDATE provider_price_candidates SET review_status='rejected',updated_at=? WHERE id=?").run(now(), row.id);
    const updated = db.prepare('SELECT * FROM provider_price_candidates WHERE id=?').get(row.id);
    require('./billingService').audit(db, actorId, 'provider_price.candidate.review', 'provider_price_candidate', row.id, { sync_id: syncId, review_status: 'rejected' });
    return updated;
  }
  const serviceType = String(input.service_type || row.service_type || '').trim();
  const billingKey = String(input.billing_key || row.billing_key || '').trim();
  const meter = String(input.meter || row.meter || '').trim();
  const unitSize = Number(input.unit_size || row.unit_size);
  if (!serviceType || !billingKey || !['request','image','second','millisecond','character','input_token','output_token'].includes(meter) || !Number.isSafeInteger(unitSize) || unitSize <= 0 || !Number.isSafeInteger(row.new_unit_price_micro)) throw new Error('请提供有效的服务、计费键、计量器和计量基数');
  const current = activeItem(db, serviceType, billingKey, meter);
  const status = input.review_status === 'rejected' ? 'rejected' : 'accepted';
  db.prepare(`UPDATE provider_price_candidates SET service_type=?,billing_key=?,meter=?,unit_size=?,current_unit_price_micro=?,current_price_book_item_id=?,change_ratio=?,mapping_status='mapped',review_status=?,error_summary=NULL,updated_at=? WHERE id=?`)
    .run(serviceType, billingKey, meter, unitSize, current?.unit_price_micro ?? null, current?.id ?? null, current?.unit_price_micro ? (row.new_unit_price_micro - current.unit_price_micro) / current.unit_price_micro : null, status, now(), row.id);
  const updated = db.prepare('SELECT * FROM provider_price_candidates WHERE id=?').get(row.id);
  require('./billingService').audit(db, actorId, 'provider_price.candidate.review', 'provider_price_candidate', row.id, { sync_id: syncId, review_status: status, service_type: serviceType, billing_key: billingKey, meter, unit_size: unitSize });
  return updated;
}

function cloneItems(db, fromId, toId, at) {
  db.prepare(`INSERT INTO billing_price_book_items(price_book_id,service_type,model,meter,unit_price_micro,is_free,conditions_json,created_at,updated_at)
    SELECT ?,service_type,model,meter,unit_price_micro,is_free,conditions_json,?,? FROM billing_price_book_items WHERE price_book_id=?`).run(toId, at, at, fromId);
}

function currentSystemBook(db) {
  const at = now();
  return db.prepare(`SELECT * FROM billing_price_books WHERE status='published' AND system_managed=1
    AND (effective_from IS NULL OR effective_from<=?) AND (effective_to IS NULL OR effective_to>?) ORDER BY version DESC,updated_at DESC,id DESC LIMIT 1`).get(at, at);
}

function createDraft(db, actorId, syncId) {
  const check = db.prepare('SELECT * FROM provider_price_source_checks WHERE provider=?').get(PROVIDER);
  if (!check || check.ark_status !== 'success' || check.billing_status !== 'success') throw new Error('请先完成方舟价格和费用中心账单的只读权限诊断');
  const syncRow = db.prepare("SELECT * FROM provider_price_syncs WHERE id=? AND status='completed'").get(syncId);
  if (!syncRow) throw new Error('同步批次不存在或没有可审核价格');
  const priorBook = db.prepare('SELECT id,status FROM billing_price_books WHERE source_sync_id=? ORDER BY id DESC LIMIT 1').get(syncId);
  if (priorBook?.status === 'draft') return require('./billingService').listPriceBooks(db).find((book) => book.id === priorBook.id);
  if (priorBook) throw new Error('此同步批次已用于价目版本，不能重复生成草稿');
  const blockers = db.prepare("SELECT COUNT(*) count FROM provider_price_candidates WHERE sync_id=? AND (review_status='pending' OR (review_status='accepted' AND mapping_status<>'mapped'))").get(syncId).count;
  if (blockers) throw new Error(`仍有 ${blockers} 条价格未完成人工审核或映射`);
  const base = currentSystemBook(db);
  if (!base) throw new Error('没有可克隆的系统管理火山价目表');
  const at = now(); let draftId;
  db.transaction(() => {
    draftId = Number(db.prepare(`INSERT INTO billing_price_books
      (name,owner_user_id,status,effective_from,effective_to,created_by,created_at,updated_at,version,parent_price_book_id,source_sync_id,system_managed,reviewed_by,reviewed_at)
      VALUES (?,NULL,'draft',NULL,NULL,?,?,?,?,?,?,1,?,?)`).run(`火山引擎同步价目 v${Number(base.version || 1) + 1}`, actorId, at, at, Number(base.version || 1) + 1, base.id, syncId, actorId, at).lastInsertRowid);
    cloneItems(db, base.id, draftId, at);
    const candidates = db.prepare("SELECT * FROM provider_price_candidates WHERE sync_id=? AND mapping_status='mapped' AND review_status='accepted'").all(syncId);
    for (const candidate of candidates) {
      const existing = db.prepare('SELECT * FROM billing_price_book_items WHERE price_book_id=? AND service_type=? AND model=? AND meter=?').get(draftId, candidate.service_type, candidate.billing_key, candidate.meter);
      const conditions = candidate.new_conditions_json ? parse(candidate.new_conditions_json, {}) : parse(existing?.conditions_json, {});
      Object.assign(conditions, { provider: PROVIDER, currency: 'CNY', unit_size: candidate.unit_size, source: 'ListModelActivations', source_sync_id: syncId, verified_on: at.slice(0, 10), provider_model: candidate.provider_model, provider_charge_type: candidate.charge_type, pricing_note: 'Volcengine account contract unit price; temporary credits and resource packs excluded' });
      if (existing) db.prepare('UPDATE billing_price_book_items SET unit_price_micro=?,conditions_json=?,updated_at=? WHERE id=?').run(candidate.new_unit_price_micro, json(conditions), at, existing.id);
      else db.prepare(`INSERT INTO billing_price_book_items(price_book_id,service_type,model,meter,unit_price_micro,is_free,conditions_json,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?,?)`).run(draftId, candidate.service_type, candidate.billing_key, candidate.meter, candidate.new_unit_price_micro, json(conditions), at, at);
    }
  })();
  require('./billingService').audit(db, actorId, 'provider_price.draft.create', 'price_book', draftId, { sync_id: syncId, parent_price_book_id: base.id });
  return require('./billingService').listPriceBooks(db).find((book) => book.id === draftId);
}

function priceDiff(db, oldId, nextId) {
  const oldRows = db.prepare('SELECT * FROM billing_price_book_items WHERE price_book_id=?').all(oldId);
  const nextRows = db.prepare('SELECT * FROM billing_price_book_items WHERE price_book_id=?').all(nextId);
  const byKey = new Map(oldRows.map((row) => [`${row.service_type}\0${row.model}\0${row.meter}`, row]));
  return nextRows.map((row) => {
    const previous = byKey.get(`${row.service_type}\0${row.model}\0${row.meter}`);
    const oldConditions = parse(previous?.conditions_json, {}); const conditions = parse(row.conditions_json, {});
    return { service_type: row.service_type, model: row.model, meter: row.meter, old_unit_price_micro: previous?.unit_price_micro ?? null, new_unit_price_micro: row.unit_price_micro, changed: previous?.unit_price_micro !== row.unit_price_micro || !samePriceCore(oldConditions, conditions), old_conditions: oldConditions, conditions };
  }).filter((row) => row.changed);
}

function defaultNotice(diff) {
  const lines = diff.slice(0, 20).map((row) => `${row.model}（${row.meter}）：${row.old_unit_price_micro == null ? '新增' : `${row.old_unit_price_micro / MICRO_PER_POINT} 积分`} → ${row.new_unit_price_micro / MICRO_PER_POINT} 积分`);
  if (diff.length > 20) lines.push(`另有 ${diff.length - 20} 项价格变更。`);
  return { title: '模型调用价格已更新', body: `火山引擎账号价格已完成审核并立即生效。\n${lines.join('\n')}` };
}

function publish(db, actorId, bookId, input = {}) {
  if (input.confirm !== true || !String(input.reason || '').trim() || !String(input.idempotency_key || '').trim()) throw new Error('发布必须确认、填写原因并携带幂等键');
  const reused = db.prepare('SELECT * FROM billing_price_books WHERE publish_idempotency_key=?').get(String(input.idempotency_key).trim());
  if (reused) return { reused: true, price_book: require('./billingService').listPriceBooks(db).find((book) => book.id === reused.id) };
  const draft = db.prepare("SELECT * FROM billing_price_books WHERE id=? AND status='draft'").get(bookId);
  if (!draft) throw new Error('只能发布草稿价目表');
  if (draft.source_sync_id) {
    const check = db.prepare('SELECT * FROM provider_price_source_checks WHERE provider=?').get(PROVIDER);
    if (!check || check.ark_status !== 'success' || check.billing_status !== 'success') throw new Error('方舟价格或账单只读权限诊断未通过');
  }
  const previous = draft.parent_price_book_id ? db.prepare("SELECT * FROM billing_price_books WHERE id=? AND status='published'").get(draft.parent_price_book_id) : currentSystemBook(db);
  if (!previous) throw new Error('当前有效价目版本不存在，不能发布');
  const diff = priceDiff(db, previous.id, draft.id);
  if (!diff.length) throw new Error('价目没有变化，无需发布');
  const generated = defaultNotice(diff); const at = now(); const noticeId = randomUUID();
  const title = String(input.notice_title || generated.title).trim(); const body = String(input.notice_body || generated.body).trim();
  if (!title || !body) throw new Error('通知标题和正文必填');
  db.transaction(() => {
    db.prepare("UPDATE billing_price_books SET status='archived',effective_to=?,updated_at=? WHERE id=? AND status='published'").run(at, at, previous.id);
    db.prepare(`UPDATE billing_price_books SET status='published',effective_from=?,effective_to=NULL,published_by=?,published_at=?,publish_reason=?,publish_idempotency_key=?,reviewed_by=COALESCE(reviewed_by,?),reviewed_at=COALESCE(reviewed_at,?),updated_at=? WHERE id=? AND status='draft'`)
      .run(at, actorId, at, String(input.reason).trim(), String(input.idempotency_key).trim(), actorId, at, at, draft.id);
    db.prepare('UPDATE tenant_price_book_bindings SET price_book_id=?,active_at=?,updated_at=? WHERE price_book_id=?').run(draft.id, at, at, previous.id);
    db.prepare(`INSERT INTO system_notices(id,type,title,body,status,price_book_id,effective_at,published_by,published_at,created_at,updated_at) VALUES (?,'pricing',?,?,'active',?,?,?,?,?,?)`).run(noticeId, title, body, draft.id, at, actorId, at, at, at);
    require('./billingService').audit(db, actorId, 'price_book.publish', 'price_book', draft.id, { previous_price_book_id: previous.id, source_sync_id: draft.source_sync_id || null, reason: String(input.reason).trim(), notice_id: noticeId, diff });
  })();
  return { reused: false, notice_id: noticeId, diff, price_book: require('./billingService').listPriceBooks(db).find((book) => book.id === Number(draft.id)) };
}

function rollback(db, actorId, historicalId, input = {}) {
  if (input.confirm !== true || !String(input.reason || '').trim() || !String(input.idempotency_key || '').trim()) throw new Error('回滚必须确认、填写原因并携带幂等键');
  const reused = db.prepare('SELECT * FROM billing_price_books WHERE publish_idempotency_key=?').get(String(input.idempotency_key).trim());
  if (reused) return { reused: true, price_book: require('./billingService').listPriceBooks(db).find((book) => book.id === reused.id) };
  const historical = db.prepare('SELECT * FROM billing_price_books WHERE id=?').get(historicalId);
  const current = currentSystemBook(db);
  if (!historical || !current) throw new Error('历史价目或当前价目不存在');
  const at = now(); let draftId;
  db.transaction(() => {
    draftId = Number(db.prepare(`INSERT INTO billing_price_books(name,owner_user_id,status,created_by,created_at,updated_at,version,parent_price_book_id,system_managed,reviewed_by,reviewed_at)
      VALUES (?,NULL,'draft',?,?,?,?,?,1,?,?)`).run(`火山引擎回滚价目 v${Number(current.version || 1) + 1}`, actorId, at, at, Number(current.version || 1) + 1, current.id, actorId, at).lastInsertRowid);
    cloneItems(db, historical.id, draftId, at);
  })();
  return publish(db, actorId, draftId, { ...input, notice_title: input.notice_title || '模型调用价格已回滚', notice_body: input.notice_body || `价格配置已回滚到历史版本“${historical.name}”。新请求立即使用回滚后的价格。` });
}

function activeNotices(db, userId) {
  return db.prepare(`SELECT n.id,n.type,n.title,n.body,n.price_book_id,n.effective_at,n.published_at
    FROM system_notices n LEFT JOIN system_notice_acknowledgements a ON a.notice_id=n.id AND a.user_id=?
    WHERE n.status='active' AND n.effective_at<=? AND a.notice_id IS NULL ORDER BY n.effective_at DESC`).all(userId, now());
}

function listNotices(db, limit = 50) {
  return db.prepare(`SELECT n.id,n.type,n.title,n.body,n.status,n.price_book_id,n.effective_at,n.published_at,n.archived_at,
    COUNT(a.user_id) AS acknowledgement_count
    FROM system_notices n
    LEFT JOIN system_notice_acknowledgements a ON a.notice_id=n.id
    GROUP BY n.id
    ORDER BY n.created_at DESC LIMIT ?`).all(Math.min(200, Math.max(1, Number(limit) || 50)));
}

function acknowledgeNotice(db, userId, noticeId) {
  const notice = db.prepare("SELECT id FROM system_notices WHERE id=? AND status='active'").get(noticeId);
  if (!notice) throw new Error('通知不存在或已归档');
  const at = now();
  db.prepare('INSERT OR IGNORE INTO system_notice_acknowledgements(notice_id,user_id,acknowledged_at) VALUES (?,?,?)').run(noticeId, userId, at);
  return { notice_id: noticeId, acknowledged_at: db.prepare('SELECT acknowledged_at FROM system_notice_acknowledgements WHERE notice_id=? AND user_id=?').get(noticeId, userId).acknowledged_at };
}

function archiveNotice(db, actorId, noticeId) {
  const at = now(); const result = db.prepare("UPDATE system_notices SET status='archived',archived_by=?,archived_at=?,updated_at=? WHERE id=? AND status='active'").run(actorId, at, at, noticeId);
  if (!result.changes) throw new Error('通知不存在或已归档');
  require('./billingService').audit(db, actorId, 'system_notice.archive', 'system_notice', noticeId, {});
  return { id: noticeId, status: 'archived', archived_at: at };
}

function startHourlySync(db, log = console) {
  const run = () => sync(db, null, { triggerType: 'scheduled' }).catch((error) => log.warn('provider price scheduled sync failed', { provider: PROVIDER, error: error.message }));
  const timer = setInterval(run, 60 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = {
  PROVIDER, signedHeaders, callOpenApi, fetchAllActivations, fetchBillDetails, chargeMeter, sourceUnitSize, normalizedPriceMicro, providerBillSummary, platformUsageSummary,
  contractPrice, verifiedMultiChargeRows, buildCandidateRows,
  probe, sourceCheck, sync, syncView, listSyncs, updateCandidate, createDraft, publish, rollback,
  activeNotices, listNotices, acknowledgeNotice, archiveNotice, startHourlySync, credentials,
};
