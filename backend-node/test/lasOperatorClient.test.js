const test = require('node:test');
const assert = require('node:assert/strict');
const las = require('../src/services/lasOperatorClient');

const jobId = 'a106ecad-410b-4a0b-a250-838a047a1d8f';
const config = { region: 'cn-beijing', apiKey: 'test-only', bucket: 'example-bucket', baseUrl: 'https://operator.las.cn-beijing.volces.com' };
const video = 'tos://example-bucket/richidrama/input.mp4';

test('LAS configuration fails closed without both API key and TOS bucket', () => {
  assert.throws(() => las.configuration({ LAS_REGION: 'cn-beijing', LAS_API_KEY: 'test-only' }), /LAS_TOS_BUCKET/);
  assert.throws(() => las.configuration({ LAS_REGION: 'cn-beijing', LAS_TOS_BUCKET: 'example-bucket' }), /LAS_API_KEY/);
  assert.equal(las.configuration({ LAS_REGION: 'cn-beijing', LAS_API_KEY: 'test-only', LAS_TOS_BUCKET: 'example-bucket' }).baseUrl, config.baseUrl);
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
