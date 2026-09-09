'use strict';
const { randomUUID } = require('node:crypto');
const prices = require('./costPriceService');
const contextStore = require('./billingRequestContext');
const now = () => new Date().toISOString();
const parse = value => JSON.parse(value || '{}');
function enabled(db) { return typeof db?.prepare === 'function' && db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cost_calls'").get()?.name === 'cost_calls'; }
function normalizeUsage(raw, type) {
  if (!raw || typeof raw !== 'object') return null;
  const usage = {};
  for (const meter of prices.METERS) if (raw[meter] != null && Number.isFinite(Number(raw[meter])) && Number(raw[meter]) >= 0) usage[meter] = Number(raw[meter]);
  const input = raw.prompt_tokens ?? raw.input_tokens ?? raw.input_token_count ?? raw.promptTokenCount;
  const output = raw.completion_tokens ?? raw.output_tokens ?? raw.output_token_count ?? raw.candidatesTokenCount;
  const cache = raw.prompt_tokens_details?.cached_tokens ?? raw.input_tokens_details?.cached_tokens ?? raw.cachedContentTokenCount;
  if (input != null && Number.isSafeInteger(Number(input)) && Number(input) >= 0) {
    usage.input_token = Number(input);
    if (cache != null && Number.isSafeInteger(Number(cache)) && Number(cache) >= 0 && Number(cache) <= usage.input_token) {
      usage.cache_token = Number(cache); usage.input_token -= Number(cache);
    }
  }
  if (raw.cache_read_input_tokens != null && Number.isSafeInteger(Number(raw.cache_read_input_tokens)) && Number(raw.cache_read_input_tokens) >= 0) usage.cache_token = Number(raw.cache_read_input_tokens);
  if (output != null && Number.isSafeInteger(Number(output)) && Number(output) >= 0) usage.output_token = Number(output);
  // total_tokens is a checksum, never an additional billable meter.
  return Object.keys(usage).length ? usage : null;
}
function usageEvidence(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const result = {};
  for (const key of [...prices.METERS, 'prompt_tokens','input_tokens','completion_tokens','output_tokens','input_token_count','output_token_count','total_tokens','promptTokenCount','candidatesTokenCount','totalTokenCount','cachedContentTokenCount','cache_read_input_tokens']) {
    if (raw[key] != null && Number.isFinite(Number(raw[key]))) result[key] = Number(raw[key]);
  }
  for (const key of ['prompt_tokens_details','input_tokens_details']) if (Number.isFinite(Number(raw[key]?.cached_tokens))) result[key] = { cached_tokens: Number(raw[key].cached_tokens) };
  return Object.keys(result).length ? result : null;
}
function begin(db, input) {
  if (!enabled(db)) return null;
  const ctx = contextStore.current() || {};
  const authId = input.authorization_id || ctx.cost_authorization_id;
  const auth = authId ? db.prepare("SELECT * FROM billing_transactions WHERE id=? AND type='authorization'").get(authId) : null;
  const snapshot = auth ? parse(auth.snapshot_json) : {};
  const userId = auth?.user_id || input.user_id || ctx.actor?.id;
  const operation = input.operation_id || snapshot.cost_operation_id || authId || ctx.cost_operation_id || ctx.request_id || randomUUID();
  const firstCall = db.prepare('SELECT * FROM cost_calls WHERE operation_id=? ORDER BY attempt LIMIT 1');
  const previous = firstCall.get(operation) || (input.parent_operation_id ? firstCall.get(input.parent_operation_id) : null);
  const user = userId ? db.prepare('SELECT username,display_name FROM users WHERE id=?').get(userId) : null;
  const membership = auth ? null : require('./customerOrganizationService').membershipForUser(db, userId);
  const organizationId = auth ? auth.organization_id : membership?.id || null;
  const org = organizationId ? db.prepare('SELECT name FROM customer_organizations WHERE id=?').get(organizationId) : null;
  const dramaId = auth?.drama_id || input.drama_id || ctx.drama_id || null;
  const project = dramaId ? db.prepare('SELECT title FROM dramas WHERE id=?').get(dramaId) : null;
  const config = input.config || {};
  const binding = config.id ? db.prepare('SELECT account_id FROM cost_account_bindings WHERE config_id=?').get(config.id) : null;
  const at = now();
  const call = {
    id: randomUUID(), source_key: input.source_key || randomUUID(), operation_id: operation, parent_operation_id: input.parent_operation_id || null,
    attempt: Number(db.prepare('SELECT COALESCE(MAX(attempt),0)+1 n FROM cost_calls WHERE operation_id=?').get(operation).n),
    authorization_id: authId || null, organization_id: previous ? previous.organization_id : organizationId,
    customer_kind: previous?.customer_kind || (organizationId ? 'customer' : userId ? 'personal' : 'unknown'), organization_name: previous ? previous.organization_name : auth ? snapshot.cost_attribution?.organization_name || null : org?.name || null,
    drama_id: previous ? previous.drama_id : dramaId, project_title: previous ? previous.project_title : auth?.project_title_snapshot || project?.title || null,
    user_id: previous ? previous.user_id : userId || null, user_name: previous ? previous.user_name : auth ? snapshot.cost_attribution?.user_name || null : user?.display_name || user?.username || null,
    source_kind: auth?.source_kind || input.source_kind || ctx.billing_source_kind || input.service_type,
    source_id: auth?.source_id || input.source_id?.toString() || ctx.billing_source_id?.toString() || null,
    provider: config.provider || null, config_id: config.id || null, connection_id: config.provider_connection_id || null, account_id: binding?.account_id || null,
    model: input.model || snapshot.provider_model || snapshot.model || '', service_type: input.service_type || snapshot.service_type,
    context_json: JSON.stringify({ ...(snapshot.pricing_context || {}), ...(input.pricing_context || {}) }), submitted_at: at, observed_at: at,
  };
  const price = prices.select(db, call); call.price_id = price?.id || null;
  const keys = Object.keys(call);
  db.prepare(`INSERT INTO cost_calls(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(k => call[k]));
  return call.id;
}
function get(db, id) {
  const row = db.prepare('SELECT * FROM cost_calls WHERE id=?').get(id);
  if (!row) return null;
  return { ...row, context: parse(row.context_json), revisions: db.prepare('SELECT * FROM cost_revisions WHERE call_id=? ORDER BY id').all(id).map(r => ({ ...r, usage: r.usage_json ? parse(r.usage_json) : null, evidence: parse(r.evidence_json), price: r.price_id ? prices.get(db, r.price_id) : null })) };
}
function observe(db, id, input) {
  if (!id) return null;
  const call = db.prepare('SELECT * FROM cost_calls WHERE id=?').get(id); if (!call) return null;
  const prior = call.latest_revision_id ? db.prepare('SELECT * FROM cost_revisions WHERE id=?').get(call.latest_revision_id) : null;
  const incoming = normalizeUsage(input.usage, call.service_type);
  const previousUsage = prior?.usage_json ? parse(prior.usage_json) : null;
  const usage = incoming || previousUsage ? { ...(previousUsage || {}), ...(incoming || {}) } : null;
  const context = { ...parse(call.context_json), ...(input.pricing_context || {}) };
  if (usage?.input_token != null) context.input_tokens = usage.input_token + (usage.cache_token || 0);
  const priceId = prior ? prior.price_id : call.price_id;
  const price = input.reprice ? prices.select(db, call) : priceId ? prices.get(db, priceId) : null;
  const status = prior && ['completed', 'failed'].includes(prior.status) && input.status === 'processing' ? prior.status : input.status || call.status;
  const evidence = { kind: input.evidence_kind || 'provider_usage', usage: incoming, reported_usage: usageEvidence(input.usage), context: input.pricing_context || {}, provider_request_id: input.provider_request_id || null, provider_task_id: input.provider_task_id || null };
  const key = input.event_key || prices.hash({ status, usage, evidence, price_id: price?.id || null, reason: input.reason || '' });
  const existing = db.prepare('SELECT * FROM cost_revisions WHERE call_id=? AND event_key=?').get(id, key);
  if (existing) return existing;
  let calculation;
  try { calculation = prices.calculate(price, usage, context); }
  catch (_) { calculation = { cost_status: 'calculation_error', amount_micro: null }; }
  if (!usage && status === 'processing') calculation.cost_status = 'processing';
  if (!usage && ['failed', 'unknown'].includes(status)) calculation.cost_status = 'unverified';
  return db.transaction(() => {
    const info = db.prepare(`INSERT INTO cost_revisions(call_id,event_key,observed_at,usage_json,evidence_json,status,cost_status,price_id,currency,amount_micro,reason,actor_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, key, now(), usage ? JSON.stringify(usage) : null, JSON.stringify(evidence), status, calculation.cost_status, price?.id || null, price?.currency || null, calculation.amount_micro, input.reason || '供应商用量记录', input.actor_id || null);
    db.prepare(`UPDATE cost_calls SET latest_revision_id=?,status=?,context_json=?,provider_task_id=COALESCE(?,provider_task_id),provider_request_id=COALESCE(?,provider_request_id),
      completed_at=COALESCE(completed_at,?),first_usage_at=COALESCE(first_usage_at,?) WHERE id=?`)
      .run(info.lastInsertRowid, status, JSON.stringify(context), input.provider_task_id || null, input.provider_request_id || null,
        ['completed','failed'].includes(status) ? now() : null, incoming ? now() : null, id);
    return db.prepare('SELECT * FROM cost_revisions WHERE id=?').get(info.lastInsertRowid);
  })();
}
function forAuthorization(db, authorizationId, input) {
  if (!enabled(db) || !authorizationId) return;
  const call = db.prepare('SELECT id FROM cost_calls WHERE authorization_id=? ORDER BY submitted_at DESC,attempt DESC LIMIT 1').get(authorizationId);
  if (call) record(db, call.id, input);
}
function byTask(db, taskId, input, configId) {
  if (!enabled(db) || !taskId) return;
  const matches = db.prepare('SELECT id FROM cost_calls WHERE provider_task_id=? AND (? IS NULL OR config_id=?) ORDER BY submitted_at DESC LIMIT 2').all(taskId, configId || null, configId || null);
  if (matches.length !== 1) return;
  const call = matches[0];
  if (call) record(db, call.id, input);
}
function record(db, id, input) {
  try { return observe(db, id, input); }
  catch (error) {
    // The supplier may already have charged. A bookkeeping failure must never
    // make callers retry generation. The persisted attempt stays unresolved.
    console.error('Cost observation persistence failed', { call_id: id, error: error.message });
    return null;
  }
}
async function track(db, input, send, resultInfo) {
  const id = begin(db, input);
  let result;
  try { result = await send(); }
  catch (error) { record(db, id, { status: 'unknown', reason: '供应商提交未取得确定结果' }); throw error; }
  record(db, id, resultInfo(result));
  return result;
}
function reprice(db, actor, id, reason) {
  if (!reason?.trim()) throw new Error('请填写修订原因');
  const row = get(db, id); if (!row) throw new Error('调用不存在');
  const latest = row.revisions.at(-1);
  return observe(db, id, { status: row.status, usage: latest?.usage, evidence_kind: latest?.evidence.kind || 'unknown', reprice: true, reason: reason.trim(), actor_id: actor });
}
module.exports = { enabled, normalizeUsage, begin, observe, record, get, forAuthorization, byTask, track, reprice };
