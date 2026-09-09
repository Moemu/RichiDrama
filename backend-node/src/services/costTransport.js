'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const ledger = require('./costLedgerService');
const storage = new AsyncLocalStorage();

function envelope(result) {
  let data = result?.body ?? result?.raw ?? result;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { data = {}; } }
  const failed = Number(result?.status ?? result?.statusCode) >= 400 || !!data?.error || ['failed','error','cancelled'].includes(data?.status || data?.data?.task_status);
  const task = data?.task_id || data?.data?.task_id || data?.output?.task_id || (data?.id && !data?.choices && !data?.data ? data.id : null);
  const usage = result?.usage || data?.usage || data?.data?.usage || data?.output?.usage || data?.result?.usage || data?.usageMetadata;
  const outputImages = Array.isArray(data?.data) ? data.data : data?.data?.task_result?.images || [];
  const images = outputImages.filter(x => x.url || x.b64_json).length;
  const phase = String(data?.status || data?.data?.task_status || data?.output?.task_status || '').toLowerCase();
  const finished = images > 0 || !!data?.video_url || ['completed','succeeded','succeed','success','done'].includes(phase);
  return {
    status: failed ? 'failed' : finished ? 'completed' : task || ['processing','pending','running','queued','submitted'].includes(phase) ? 'processing' : 'completed',
    usage: { ...(usage || {}), ...(!failed ? { request: 1 } : {}), ...(images ? { image: images } : {}) },
    provider_request_id: result?.provider_request_id || result?.headers?.['x-request-id'] || result?.headers?.['x-tt-logid'] || data?.request_id || null,
    provider_task_id: task,
  };
}

// Scope belongs to one business call. Only the explicitly wrapped submission
// transports consume it; uploads and status retrieval do not create attempts.
async function run(db, input, send) {
  const scope = { db, input, calls: [] };
  return storage.run(scope, async () => {
    const result = await send();
    const id = scope.calls.at(-1);
    if (id && result && typeof result === 'object') {
      const usage = ledger.normalizeUsage(result.usage);
      ledger.record(db, id, {
        status: result.error ? (scope.latest?.status === 'unknown' ? 'unknown' : 'failed') : result.task_id ? 'processing' : 'completed',
        usage: usage || (input.service_type === 'image' && result.image_url && !scope.latest?.usage?.image ? { image: 1, request: 1 } : null),
        provider_task_id: result.task_id, provider_request_id: result.provider_request_id,
      });
    }
    return result;
  });
}
async function submit(send, body) {
  const scope = storage.getStore();
  if (!scope) return send();
  const authorization = scope.input.authorization_id && scope.input.service_type === 'image' ? require('./billingService').imageAuthorization(scope.db, scope.input.authorization_id) : null;
  const id = ledger.begin(scope.db, { ...scope.input, authorization_id: authorization?.id || scope.input.authorization_id, model: body?.model || scope.input.model });
  scope.calls.push(id);
  let result;
  try { result = await send(); }
  catch (error) {
    scope.latest = error.cost_evidence ? envelope(error.cost_evidence) : { status: 'unknown', reason: '供应商提交未取得确定结果' };
    ledger.record(scope.db, id, scope.latest);
    throw error;
  }
  scope.latest = envelope(result);
  ledger.record(scope.db, id, scope.latest);
  return result;
}
function observeResponse(result) {
  const scope = storage.getStore(), id = scope?.calls.at(-1);
  if (id) { scope.latest = envelope(result); ledger.record(scope.db, id, scope.latest); }
}
async function fetchSubmission(url, options) {
  if (!storage.getStore() || String(options?.method).toUpperCase() !== 'POST') return globalThis.fetch(url, options);
  let body; try { body = JSON.parse(options.body); } catch (_) {}
  let response;
  await submit(async () => {
    response = await globalThis.fetch(url, options);
    return { status: response.status, body: await response.clone().text(), provider_request_id: response.headers.get('x-request-id') };
  }, body);
  return response;
}
module.exports = { run, submit, fetchSubmission, envelope, observeResponse };
