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

test('viral clip submit assembles whitelisted fields and keeps episode order', () => {
  const input = {
    job_id: jobId,
    video_urls: ['tos://example-bucket/richidrama/las/j/input/ep1.mp4', 'tos://example-bucket/richidrama/las/j/input/ep2.mp4'],
    min_clip_duration: 120, max_clip_duration: 240, max_clip_count: 8, mode: 'jump_cut',
  };
  const viral = las.submitPayload(config, 'viral', input);
  assert.equal(viral.operator_id, 'las_viral_clip_gen');
  assert.equal(viral.data.output_tos_path, `tos://example-bucket/richidrama/las/${jobId}/viral/`);
  assert.deepEqual(viral.data.video_urls, input.video_urls, '剧集序号按物理索引判定，不能重排');
  assert.equal(viral.data.max_clip_count, 8);
  assert.equal('preset_intro' in viral.data, false, '未显式开启时不发开关');
  assert.equal('aspect_ratio' in viral.data, false);
  const full = las.submitPayload(config, 'viral', { ...input, mode: 'sequential', preset_intro: true, aspect_ratio: '9:16', video_bitrate_kbps: 2000 });
  assert.equal(full.data.preset_intro, true);
  assert.equal(full.data.aspect_ratio, '9:16');
  assert.equal(full.data.video_bitrate_kbps, 2000);
  assert.throws(() => las.submitPayload(config, 'viral', { ...input, video_urls: [] }), /1–100/);
  assert.throws(() => las.submitPayload(config, 'viral', { ...input, video_urls: ['tos://other-bucket/a.mp4'] }), /同账号/);
  assert.throws(() => las.submitPayload(config, 'viral', { ...input, mode: 'preset_intro' }), /模式/);
  assert.throws(() => las.submitPayload(config, 'viral', { ...input, min_clip_duration: 300, max_clip_duration: 240 }), /上限不能小于下限/);
  assert.throws(() => las.submitPayload(config, 'viral', { ...input, max_clip_count: 301 }), /目标素材条数/);
  assert.throws(() => las.submitPayload(config, 'viral', { ...input, aspect_ratio: '16:9' }), /9:16/);
  assert.equal(las.pollPayload('viral', 'task-v').operator_id, 'las_viral_clip_gen');
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
