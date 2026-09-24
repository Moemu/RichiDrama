const test = require('node:test');
const assert = require('node:assert/strict');
const las = require('../src/services/lasOperatorClient');

const jobId = 'a106ecad-410b-4a0b-a250-838a047a1d8f';
const config = { region: 'cn-beijing', apiKey: 'test-only', bucket: 'example-bucket', baseUrl: 'https://operator.las.cn-beijing.volces.com' };
const video = 'tos://example-bucket/richidrama/input.mp4';

test('LAS configuration fails closed without both API key and TOS bucket', () => {
  assert.throws(() => las.configuration({ region: 'cn-beijing', apiKey: 'test-only' }), /TOS Bucket/);
  assert.throws(() => las.configuration({ region: 'cn-beijing', bucket: 'example-bucket' }), /LAS API Key/);
  assert.throws(() => las.configuration({ region: 'cn beijing', apiKey: 'test-only', bucket: 'example-bucket' }), /地域/);
  assert.equal(las.configuration({ region: 'cn-beijing', apiKey: 'test-only', bucket: 'example-bucket' }).baseUrl, config.baseUrl);
});

test('translation and subtitle inpaint use isolated output prefixes and supported options', () => {
  const translate = las.submitPayload(config, 'translate', { job_id: jobId, video_url: video, output_language: 'en-US' });
  assert.equal(translate.operator_id, 'las_video_translate');
  assert.deepEqual(translate.data.output_languages, ['en-US']);
  assert.equal(translate.data.lip_translate, false);
  assert.equal(translate.data.output_tos_path, `tos://example-bucket/richidrama/las/${jobId}/translate/`);
  const inpaint = las.submitPayload(config, 'inpaint', { job_id: jobId, video_url: video, model_level: 'pro' });
  assert.equal(inpaint.operator_id, 'las_video_inpaint_pro');
  assert.equal(inpaint.data.detection_mode, 'standard_subtitle');
  assert.equal(inpaint.data.output_tos_path, `tos://example-bucket/richidrama/las/${jobId}/inpaint/`);
  assert.throws(() => las.submitPayload(config, 'translate', { job_id: jobId, video_url: 'tos://other-bucket/a.mp4', output_language: 'en-US' }), /同账号/);
  assert.throws(() => las.submitPayload(config, 'inpaint', { job_id: jobId, video_url: video, model_level: 'precise' }), /档位/);
});

test('poll response validates task identity, terminal status, and business code', async () => {
  const payload = las.pollPayload('inpaint', 'task-123');
  const result = await las.request(config, 'poll', payload, async (url, options) => {
    assert.equal(url, `${config.baseUrl}/api/v1/poll`);
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    return { ok: true, json: async () => ({ metadata: { task_id: 'task-123', task_status: 'COMPLETED', business_code: '0' }, data: { inpainted_video_path: 'tos://example-bucket/out.mp4' } }) };
  });
  assert.equal(result.status, 'COMPLETED');
  assert.throws(() => las.taskResponse({ metadata: { task_id: 'task-other', task_status: 'COMPLETED' } }, 'task-123'), /任务 ID/);
  assert.throws(() => las.taskResponse({ metadata: { task_id: 'task-123', task_status: 'COMPLETED', business_code: 'Failed' } }), /业务码/);
});

test('LAS task IDs are opaque strings and supplier request IDs survive invalid responses', async () => {
  const taskId = '06ecbd66031e7006022d';
  const submitted = await las.request(config, 'submit', {}, async () => ({
    ok: true,
    json: async () => ({ metadata: { task_id: taskId, task_status: 'PENDING', business_code: '0' } }),
  }));
  assert.equal(submitted.task_id, taskId);
  assert.equal(las.pollPayload('inpaint', taskId).task_id, taskId);
  assert.equal(las.taskResponse({ metadata: { task_id: taskId, task_status: 'TIMEOUT', business_code: 'Video.Timeout' } }, taskId).status, 'TIMEOUT');
  assert.throws(() => las.pollPayload('inpaint', 'bad\nidentifier'), /任务 ID/);
  assert.throws(() => las.pollPayload('inpaint', 'x'.repeat(257)), /任务 ID/);
  assert.throws(() => las.taskResponse({ metadata: { task_status: 'PENDING', request_id: 'req-123', business_code: 'TaskId.Missing' } }), /request_id=req-123.*business_code=TaskId.Missing/);
  assert.throws(() => las.taskResponse({ metadata: { task_status: 'PENDING', request_id: 'req-123' } }), (error) => error.providerRequestId === 'req-123');
});

test('HTTP 提交失败保留可核验的供应商请求 ID，而非把它当任务 ID', async () => {
  await assert.rejects(
    () => las.request(config, 'submit', {}, async () => ({ ok: false, status: 500, headers: { get: (name) => name === 'x-request-id' ? 'req-http-456' : null } })),
    (error) => error.providerRequestId === 'req-http-456' && /HTTP 500/.test(error.message),
  );
});
