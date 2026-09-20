const test = require('node:test');
const assert = require('node:assert/strict');
const richbest = require('../src/services/richbestProvider');

const CONFIG = { provider: 'richbest', base_url: 'https://api.richbest.cn/v1', api_key: 'vap_live_test' };

test('relay text/image/video requests keep the stable alias and never reuse the Ark dated id', () => {
  const { body } = richbest.buildVideoBody({
    model: 'doubao-seedance-2.0', prompt: '海边日出', references: [], params: { duration: 5 },
  });
  assert.equal(body.model, 'doubao-seedance-2.0');
  assert.ok(!/-\d{6}$/.test(body.model), '不得把中转别名翻成带日期的上游 Model ID');
});

test('relay video body sends only ratio and never aspect_ratio', () => {
  const built = richbest.buildVideoBody({
    model: 'doubao-seedance-2.0', prompt: 'p', references: [],
    params: { ratio: '16:9', aspect_ratio: '16:9', duration: 5 },
  });
  assert.equal(built.body.ratio, '16:9');
  assert.equal(built.body.aspect_ratio, undefined);
  assert.deepEqual(built.dropped, ['aspect_ratio']);
});

test('relay video body maps the internal aspect ratio onto ratio when no ratio is given', () => {
  const built = richbest.buildVideoBody({
    model: 'doubao-seedance-2.0', prompt: 'p', references: [], params: { aspect_ratio: '9:16' },
  });
  assert.equal(built.body.ratio, '9:16');
  assert.equal(built.body.aspect_ratio, undefined);
});

test('relay video content parts use the documented roles and keep asset references verbatim', () => {
  const built = richbest.buildVideoBody({
    model: 'doubao-seedance-2.0',
    prompt: '参考图与素材',
    references: [
      { kind: 'image', role: 'first_frame', url: 'https://cdn.example.test/a.png' },
      { kind: 'image', role: 'last_frame', url: 'asset://asset-last' },
      { kind: 'image', role: 'reference_image', url: 'data:image/jpeg;base64,AAAA' },
      { kind: 'video', role: 'reference_video', url: 'asset://asset-video' },
      { kind: 'audio', role: 'reference_audio', url: 'data:audio/mpeg;base64,BBBB' },
    ],
    params: { duration: 5 },
  });
  assert.deepEqual(built.body.content.map((part) => part.role).slice(1),
    ['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio']);
  assert.equal(built.body.content[1].image_url.url, 'https://cdn.example.test/a.png');
  assert.equal(built.body.content[2].image_url.url, 'asset://asset-last', 'asset:// 必须原样发送');
  assert.equal(built.body.task_type, 'i2v');
});

test('text-to-video relay requests are typed as t2v only for models that accept task_type', () => {
  assert.equal(richbest.buildVideoBody({ model: 'doubao-seedance-2.0', prompt: 'p', references: [], params: {} }).body.task_type, 't2v');
  const minimax = richbest.buildVideoBody({ model: 'minimax-h3', prompt: 'p', references: [], params: {} }).body;
  assert.equal(minimax.task_type, undefined, 'MiniMax 不接受 task_type');
});

test('Wan only accepts one public first frame and rejects unsupported parameters before submission', () => {
  const built = richbest.buildVideoBody({
    model: 'wan3.0-video', prompt: 'p',
    references: [{ kind: 'image', role: 'first_frame', url: 'https://cdn.example.test/f.jpg' }],
    params: { seed: 12, camera_fixed: true, duration: 8, ratio: '16:9' },
  });
  assert.equal(built.body.seed, undefined);
  assert.equal(built.body.camera_fixed, undefined);
  assert.deepEqual(built.dropped.sort(), ['camera_fixed', 'seed']);
  assert.equal(built.body.resolution, '1080P', 'Wan 的中转侧默认分辨率');
  assert.equal(built.body.generate_audio, true);

  assert.throws(() => richbest.buildVideoBody({
    model: 'wan3.0-video', prompt: 'p',
    references: [
      { kind: 'image', role: 'first_frame', url: 'https://a.test/1.jpg' },
      { kind: 'image', role: 'first_frame', url: 'https://a.test/2.jpg' },
    ],
    params: {},
  }), /最多接受 1 张参考图/);
});

test('https-only relay models reject inlined and asset references before credits are frozen', () => {
  assert.throws(() => richbest.buildVideoBody({
    model: 'wan3.0-video', prompt: 'p',
    references: [{ kind: 'image', role: 'first_frame', url: 'data:image/png;base64,AAA' }], params: {},
  }), /只接受公网 HTTP\(S\) 地址参考素材/);
  assert.throws(() => richbest.buildVideoBody({
    model: 'minimax-h3', prompt: 'p',
    references: [{ kind: 'image', role: 'reference_image', url: 'asset://asset-1' }], params: {},
  }), /只接受公网 HTTP\(S\) 地址参考素材/);
  assert.throws(() => richbest.buildVideoBody({
    model: 'wan3.0-video', prompt: 'p',
    references: [{ kind: 'image', role: 'reference_image', url: 'https://a.test/1.jpg' }], params: {},
  }), /不支持图片角色 reference_image/);
  assert.throws(() => richbest.buildVideoBody({
    model: 'doubao-seedance-2.0', prompt: 'p',
    references: [{ kind: 'image', role: 'first_frame', url: '/static/relative/path.png' }], params: {},
  }), /参考素材地址无效/);
});

test('relay image bodies drop non-forwarded fields and reject negative_prompt outright', () => {
  const prepared = richbest.assertImageSubmission({
    model: 'doubao-seedream-5.0-lite', prompt: '产品摄影', quality: 'high', style: 'natural',
    user: 'u-1', unknown_field: 1, n: 1, watermark: false, response_format: 'url',
  });
  assert.equal(prepared.body.quality, undefined);
  assert.equal(prepared.body.style, undefined);
  assert.equal(prepared.body.user, undefined);
  assert.equal(prepared.body.unknown_field, undefined);
  assert.equal(prepared.body.watermark, false, 'watermark 是真实生效的中转字段');
  assert.deepEqual(prepared.dropped.sort(), ['quality', 'style', 'unknown_field', 'user']);
  assert.throws(() => richbest.assertImageSubmission({ model: 'm', prompt: 'p', negative_prompt: 'no text' }),
    /不接受 negative_prompt/);
  assert.throws(() => richbest.assertImageSubmission({ model: 'm', prompt: 'p', stream: true }), /不提供流式响应/);
  assert.throws(() => richbest.assertImageSubmission({ model: 'm', prompt: '' }), /提示词不能为空/);
});

test('relay text bodies strip internal routing overrides and unknown fields', () => {
  const { body, dropped } = richbest.mutateChatBody(CONFIG, {
    model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }], temperature: 0.2,
    provider: 'volcengine', base_url: 'https://attacker.test', api_key: 'sk-x', channel: 3,
    project_name: 'p', not_in_whitelist: true,
  });
  assert.deepEqual(Object.keys(body), ['model', 'messages', 'temperature']);
  assert.deepEqual(dropped.sort(), ['not_in_whitelist']);
});

test('idempotency keys are stable per attempt and change when a new authorization is issued', () => {
  const row = { id: 42, billing_authorization_id: 'a1b2c3d4-e5f6-7890' };
  assert.equal(richbest.idempotencyKey('v', row), richbest.idempotencyKey('v', row));
  assert.notEqual(richbest.idempotencyKey('v', row),
    richbest.idempotencyKey('v', { id: 42, billing_authorization_id: 'ffffffff-0000' }));
  assert.equal(richbest.idempotencyKey('i', { id: 7 }), 'rd-i-7');
  assert.equal(richbest.idempotencyKey('v', null), null);
  assert.ok(richbest.idempotencyKey('v', { id: 1, billing_authorization_id: 'x'.repeat(200) }).length <= 128);
});

test('relay video status maps the five documented states without inventing a result', () => {
  assert.equal(richbest.parseVideoTask({ status: 'queued' }).pending, true);
  assert.equal(richbest.parseVideoTask({ status: 'running' }).pending, true);
  const done = richbest.parseVideoTask({ status: 'succeeded', content: { video_url: 'https://p.test/v.mp4' }, usage: { total_tokens: 9 } });
  assert.equal(done.video_url, 'https://p.test/v.mp4');
  assert.equal(done.pending, false);
  assert.deepEqual(done.usage, { total_tokens: 9 });
  assert.equal(richbest.parseVideoTask({ status: 'cancelled' }).failed, true);
  const failed = richbest.parseVideoTask({ status: 'failed', error: { message: '内容策略拒绝' } });
  assert.equal(failed.failed, true);
  assert.equal(failed.error_message, '内容策略拒绝');
});

test('an absent or empty provider usage block stays unknown instead of an estimate', () => {
  assert.equal(richbest.parseVideoTask({ status: 'succeeded', content: { video_url: 'https://p.test/v.mp4' }, usage: {} }).usage, null);
  assert.equal(richbest.parseVideoTask({ status: 'succeeded' }).usage, null);
  assert.equal(richbest.parseImageResult({ data: [{ url: 'https://p.test/i.png' }], usage: {} }).usage, null);
});

test('relay errors keep status, code and request id for support follow-up', () => {
  const unauthorized = richbest.errorFrom(403, { error: { code: 'model_not_allowed', message: '未开通' } }, { 'x-request-id': 'req-1' });
  assert.equal(unauthorized.unauthorizedModel, true);
  assert.equal(unauthorized.requestId, 'req-1');
  assert.equal(richbest.errorFrom(409, { error: { code: 'idempotency_key_conflict' } }, {}).conflict, true);
  const limited = richbest.errorFrom(429, { error: { code: 'rate_limit_exceeded' } }, { 'retry-after': '7' });
  assert.equal(limited.retryAfterMs, 7000);
  const ambiguous = richbest.errorFrom(502, { error: { code: 'provider_unreachable' } }, {});
  assert.equal(ambiguous.ambiguous, true, '写请求 5xx 之后不能当作未发生');
  assert.equal(richbest.errorFrom(422, { error: { code: 'video_parameter_unsupported' } }, {}).ambiguous, false);
});

test('relay endpoints are built from the site origin so a /v1 base url cannot corrupt them', () => {
  assert.equal(richbest.urlFor(CONFIG, richbest.PATHS.videoTasks), 'https://api.richbest.cn/api/v3/contents/generations/tasks');
  assert.equal(richbest.videoTaskUrl({ ...CONFIG, base_url: 'https://api.richbest.cn' }, 'vid_1/2'),
    'https://api.richbest.cn/api/v3/contents/generations/tasks/vid_1%2F2');
  assert.equal(richbest.urlFor({ ...CONFIG, base_url: 'https://api.richbest.cn/v1/' }, richbest.PATHS.image),
    'https://api.richbest.cn/v1/images/generations');
});

test('model catalog parsing keeps the id used for requests separate from the display name', () => {
  const items = richbest.parseModelCatalog({ data: [
    { id: 'doubao-seedance-2.0', display_name: 'Doubao Seedance 2.0', modality: 'video', capabilities: { maxN: 1 } },
    { id: 'wan3.0-video', modality: 'VIDEO' },
    { id: '' },
  ] });
  assert.deepEqual(items.map((item) => item.id), ['doubao-seedance-2.0', 'wan3.0-video']);
  assert.equal(items[0].display_name, 'Doubao Seedance 2.0');
  assert.equal(items[1].display_name, 'wan3.0-video', '缺少 display_name 时回落到 id');
  assert.equal(items[1].modality, 'video');
});

test('connection probe only reads documented free endpoints', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), method: init.method });
    if (String(url).endsWith('/health')) return { ok: true, status: 200, headers: new Map(), text: async () => '{"status":"ok"}' };
    if (String(url).includes('/api/auth/me')) return { ok: true, status: 200, headers: new Map(), text: async () => '{"authenticated":true,"apiKeyId":"key-1"}' };
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ object: 'list', data: [{ id: 'glm-5.2', modality: 'text' }] }) };
  };
  const result = await richbest.probe({ baseUrl: 'https://api.richbest.cn/v1', apiKey: ' vap_live_test ', fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.apiKeyId, 'key-1');
  assert.equal(result.models.total, 1);
  assert.deepEqual(result.models.by_modality, { text: 1 });
  assert.deepEqual(seen.map((item) => item.method), ['GET', 'GET', 'GET'], '连接测试绝不能发 POST');
});

test('connection probe reports an invalid key without falling back to a generation call', async () => {
  const fetchImpl = async (url) => ({
    ok: true, status: 200, headers: new Map(),
    text: async () => (String(url).includes('/api/auth/me') ? '{"authenticated":false}' : '{"status":"ok"}'),
  });
  const result = await richbest.probe({ baseUrl: 'https://api.richbest.cn', apiKey: 'vap_live_bad', fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /业务 API Key/);
});

test('relay protocol detection wins over the volcengine model-name guess', () => {
  const imageClient = require('../src/services/imageClient');
  const videoClient = require('../src/services/videoClient');
  assert.equal(imageClient.inferProtocol('richbest', 'doubao-seedream-5.0-lite'), 'richbest');
  assert.equal(videoClient.resolveVideoProtocol({ provider: 'richbest', base_url: 'https://api.richbest.cn/v1' }, 'doubao-seedance-2.0'), 'richbest');
  assert.equal(videoClient.resolveVideoProtocol({ provider: 'volcengine', base_url: 'https://ark.example.test/api/v3' }, 'doubao-seedance-2.0'), 'volcengine_omni');
});
