const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { callRichbestImageApi } = require('../src/services/imageClient');
const { callRichbestVideoApi, pollVideoTask, cancelVideoTask } = require('../src/services/videoClient');

const log = { info() {}, warn() {}, error() {} };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** 假中转站：只监听 loopback，记录每个入站请求并按脚本应答。 */
function startRelay(script) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = raw; }
      const index = requests.push({ method: req.method, url: req.url, headers: req.headers, body }) - 1;
      const next = typeof script === 'function' ? script(index, req, body) : script[index] ?? script[script.length - 1];
      const payload = typeof next === 'string' ? next : JSON.stringify(next?.body ?? {});
      res.writeHead(next?.status ?? 200, {
        'Content-Type': 'application/json',
        ...(next?.headers || {}),
        'X-Request-Id': `req-${index + 1}`,
      });
      res.end(payload);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function relayConfig(origin, extra = {}) {
  return {
    provider: 'richbest', api_protocol: '', base_url: `${origin}/v1`, api_key: 'vap_live_local-test',
    model: ['doubao-seedance-2.0'], default_model: 'doubao-seedance-2.0', ...extra,
  };
}

test('relay image generation sends the documented body, archives the result locally and returns a static path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richbest-image-'));
  const delivering = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); });
  await new Promise((done) => delivering.listen(0, '127.0.0.1', done));
  const providerUrl = `http://127.0.0.1:${delivering.address().port}/result.png`;
  const relay = await startRelay(() => ({ body: { created: 1, data: [{ url: providerUrl }] } }));
  try {
    const result = await callRichbestImageApi(null, relayConfig(relay.origin), log, {
      model: 'doubao-seedream-5.0-lite',
      prompt: '白色背景上的东方瓷器',
      negative_prompt: '拼贴画面, 分格',
      size: '2048x2048',
      quality: 'high',
      image_gen_id: 77,
      billing_authorization_id: 'auth-abc123',
      storage_local_path: root,
      reference_image_urls: ['https://cdn.example.test/ref.png'],
    });
    assert.equal(relay.requests.length, 1);
    const request = relay.requests[0];
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/images/generations');
    assert.equal(request.headers.authorization, 'Bearer vap_live_local-test');
    assert.equal(request.headers['idempotency-key'], 'rd-i-77-authabc123');
    assert.equal(request.body.negative_prompt, undefined, '中转站会以 422 拒绝 negative_prompt');
    assert.equal(request.body.quality, undefined, 'quality 不会转发给上游，不能作为生效控制项');
    assert.match(request.body.prompt, /Do not include these elements/);
    assert.equal(request.body.watermark, false);
    assert.deepEqual(request.body.image, ['https://cdn.example.test/ref.png']);

    // 供应商地址是临时资源：入库的必须是本地路径
    assert.match(result.image_url, /^\/static\//);
    assert.ok(result.local_path && fs.existsSync(path.join(root, result.local_path)));
    assert.equal(result.provider_request_id, 'req-1');
    assert.equal(result.error, undefined);
  } finally {
    await relay.close();
    await new Promise((done) => delivering.close(done));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('relay image result that cannot be archived is reported as failure instead of a signed url', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richbest-image-lost-'));
  const relay = await startRelay([{ body: { data: [{ url: 'http://127.0.0.1:1/gone.png' }] } }]);
  try {
    const result = await callRichbestImageApi(null, relayConfig(relay.origin), log, {
      model: 'doubao-seedream-5.0', prompt: 'p', image_gen_id: 78, storage_local_path: root,
    });
    assert.match(result.error, /未能保存到本地存储/);
    assert.equal(result.image_url, undefined);
  } finally {
    await relay.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('relay image rejection keeps the provider code and request id visible to the user', async () => {
  const relay = await startRelay([{
    status: 403,
    body: { error: { message: '当前项目未开通该模型或渠道不可用', code: 'model_not_allowed' }, request_id: 'req-x' },
  }]);
  try {
    const result = await callRichbestImageApi(null, relayConfig(relay.origin), log, {
      model: 'doubao-seedream-9.0', prompt: 'p', image_gen_id: 79,
    });
    assert.match(result.error, /未开通/);
    assert.match(result.error, /model_not_allowed/);
  } finally {
    await relay.close();
  }
});

test('relay video creation posts ratio only and stores the relay task id', async () => {
  const relay = await startRelay([{ body: { id: 'vid_0123456789abcdef' } }]);
  try {
    const output = await callRichbestVideoApi(null, relayConfig(relay.origin), log, {
      model: 'doubao-seedance-2.0',
      prompt: '海边日出，镜头缓慢向前推进',
      duration: 5,
      aspect_ratio: '16:9',
      resolution: '720p',
      watermark: false,
      reference_urls: ['asset://asset-authorized'],
      video_gen_id: 41,
      billing_authorization_id: 'auth-video-1',
    }, 'doubao-seedance-2.0');
    assert.equal(output.task_id, 'vid_0123456789abcdef');
    const request = relay.requests[0];
    assert.equal(request.url, '/api/v3/contents/generations/tasks');
    assert.equal(request.headers['idempotency-key'], 'rd-v-41-authvideo1');
    assert.equal(request.body.ratio, '16:9');
    assert.equal(request.body.aspect_ratio, undefined, '同时发 aspect_ratio 会被中转站 422 拒绝');
    assert.equal(request.body.model, 'doubao-seedance-2.0', '绝不经过 VOLC_MODEL_ALIASES');
    assert.deepEqual(request.body.content, [
      { type: 'text', text: '海边日出，镜头缓慢向前推进' },
      { type: 'image_url', image_url: { url: 'asset://asset-authorized' }, role: 'reference_image' },
    ]);
    assert.equal(request.body.task_type, 'i2v');
  } finally {
    await relay.close();
  }
});

test('relay Seedance 2.0 Mini omits camera_fixed from the final reference-image HTTP body', async () => {
  const relay = await startRelay([{ body: { id: 'vid_mini_no_camera' } }]);
  try {
    const output = await callRichbestVideoApi(null, relayConfig(relay.origin, {
      api_protocol: 'volcengine_omni',
      model: ['doubao-seedance-2.0-mini'],
      default_model: 'doubao-seedance-2.0-mini',
    }), log, {
      model: 'doubao-seedance-2.0-mini',
      prompt: '开启铜制种盒',
      duration: 4,
      aspect_ratio: '16:9',
      resolution: '480p',
      camera_fixed: true,
      reference_urls: ['asset://image-558'],
      video_gen_id: 2706,
    }, 'doubao-seedance-2.0-mini');

    assert.equal(output.task_id, 'vid_mini_no_camera');
    assert.equal(relay.requests.length, 1);
    assert.equal(relay.requests[0].body.task_type, 'i2v');
    assert.equal(relay.requests[0].body.camera_fixed, undefined);
    assert.deepEqual(relay.requests[0].body.content[1], {
      type: 'image_url', image_url: { url: 'asset://image-558' }, role: 'reference_image',
    });
    assert.equal(relay.requests[0].body.ratio, '16:9');
    assert.equal(relay.requests[0].body.resolution, '480p');
  } finally {
    await relay.close();
  }
});

test('relay video poll maps queued, running and succeeded without inventing usage', async () => {
  const relay = await startRelay([
    { body: { id: 'vid_1', status: 'queued' } },
    { body: { id: 'vid_1', status: 'running' } },
    { body: { id: 'vid_1', status: 'succeeded', content: { video_url: 'https://provider.invalid/v.mp4' }, usage: { completion_tokens: 1200, total_tokens: 1200 } } },
  ]);
  try {
    const result = await pollVideoTask(null, log, 41, 'vid_1', relayConfig(relay.origin), 5, 1);
    assert.equal(result.video_url, 'https://provider.invalid/v.mp4');
    assert.deepEqual(result.usage, { completion_tokens: 1200, total_tokens: 1200 });
    assert.deepEqual(relay.requests.map((item) => item.method), ['GET', 'GET', 'GET'], '查询不得新建任务');
    assert.equal(relay.requests[0].url, '/api/v3/contents/generations/tasks/vid_1');
  } finally {
    await relay.close();
  }
});

test('relay video poll surfaces the provider failure message verbatim', async () => {
  const relay = await startRelay([{ body: { id: 'vid_2', status: 'failed', error: { code: 'content_policy', message: '涉及真人肖像' } } }]);
  try {
    const result = await pollVideoTask(null, log, 42, 'vid_2', relayConfig(relay.origin), 3, 1);
    assert.match(result.error, /涉及真人肖像/);
    assert.equal(result.video_url, undefined);
  } finally {
    await relay.close();
  }
});

test('relay cancel only deletes queued tasks and reports unsupported cancellation honestly', async () => {
  const unsupported = await startRelay([
    { body: { id: 'vid_3', status: 'running' } },
    { status: 422, body: { error: { code: 'video_cancel_unsupported', message: '未开放取消适配' } } },
  ]);
  try {
    const result = await cancelVideoTask(relayConfig(unsupported.origin), log, 'vid_3');
    assert.equal(result.cancelled, false);
    assert.equal(result.reason, 'unsupported_provider', '不得把仍可能在上游执行的任务伪装成已取消');
    assert.deepEqual(unsupported.requests.map((item) => item.method), ['GET', 'DELETE']);
  } finally {
    await unsupported.close();
  }

  const cancellable = await startRelay([
    { body: { id: 'vid_4', status: 'queued' } },
    { status: 204, body: '' },
  ]);
  try {
    const result = await cancelVideoTask(relayConfig(cancellable.origin), log, 'vid_4');
    assert.equal(result.cancelled, true);
  } finally {
    await cancellable.close();
  }

  const finished = await startRelay([{ body: { id: 'vid_5', status: 'succeeded', content: { video_url: 'https://p.invalid/v.mp4' } } }]);
  try {
    const result = await cancelVideoTask(relayConfig(finished.origin), log, 'vid_5');
    assert.equal(result.cancelled, false);
    assert.equal(result.reason, 'terminal');
    assert.deepEqual(finished.requests.map((item) => item.method), ['GET'], '已结束的任务不应再发 DELETE');
  } finally {
    await finished.close();
  }
});

test('relay video rejects unsupported references before any request leaves the process', async () => {
  const relay = await startRelay([{ body: { id: 'vid_never' } }]);
  try {
    const output = await callRichbestVideoApi(null, relayConfig(relay.origin), log, {
      model: 'wan3.0-video',
      prompt: '海边日出',
      aspect_ratio: '16:9',
      duration: 8,
      storage_local_path: os.tmpdir(),
      image_url: 'data:image/png;base64,AAAA',
      video_gen_id: 43,
    }, 'wan3.0-video');
    assert.match(output.error, /只接受公网 HTTP\(S\) 地址参考素材/);
    assert.equal(relay.requests.length, 0, '本地文件不能被内联发给只支持公网 URL 的模型');
  } finally {
    await relay.close();
  }
});

test('relay expired task is terminal instead of polling until timeout', async () => {
  // expired 在中转站是终态，但通用的 isPollTaskFailed 里没有它 —— 漏判会让任务一直轮询到超时。
  const relay = await startRelay([{ body: { id: 'vid_5', status: 'expired' } }]);
  try {
    const result = await pollVideoTask(null, log, 43, 'vid_5', relayConfig(relay.origin), 5, 1);
    assert.match(result.error, /expired/, '过期任务必须立即终态失败');
    assert.equal(relay.requests.length, 1, '过期任务不该继续轮询');
  } finally {
    await relay.close();
  }
});

test('relay cancelled task is terminal too', async () => {
  const relay = await startRelay([{ body: { id: 'vid_6', status: 'cancelled' } }]);
  try {
    const result = await pollVideoTask(null, log, 44, 'vid_6', relayConfig(relay.origin), 5, 1);
    assert.ok(result.error, 'cancelled 必须按终态返回');
    assert.equal(relay.requests.length, 1);
  } finally {
    await relay.close();
  }
});

test('relay succeeded without a url keeps polling and names the unrecognized status', async () => {
  const relay = await startRelay([
    { body: { id: 'vid_7', status: 'succeeded' } },
    { body: { id: 'vid_7', status: 'succeeded', content: { video_url: 'https://provider.invalid/late.mp4' } } },
  ]);
  try {
    const result = await pollVideoTask(null, log, 45, 'vid_7', relayConfig(relay.origin), 3, 1);
    assert.equal(result.video_url, 'https://provider.invalid/late.mp4', '地址迟到时应继续等待而不是当作失败');
    assert.equal(relay.requests.length, 2);
  } finally {
    await relay.close();
  }
});

test('relay image 5xx and transport failures are reported as ambiguous, definite 4xx is not', async () => {
  const serverError = await startRelay([{ status: 502, body: { error: { code: 'provider_unreachable', message: '上游不可达' } } }]);
  try {
    const result = await callRichbestImageApi(null, relayConfig(serverError.origin), log, {
      model: 'doubao-seedream-5.0-lite', prompt: 'p', image_gen_id: 91,
    });
    assert.equal(result.ambiguous, true, '5xx 不能当成「没发生」，否则会释放预授权并可能重复计费');
    assert.match(result.error, /上游不可达/);
  } finally {
    await serverError.close();
  }

  const badRequest = await startRelay([{ status: 422, body: { error: { code: 'image_parameter_unsupported', message: '不支持该参数' } } }]);
  try {
    const result = await callRichbestImageApi(null, relayConfig(badRequest.origin), log, {
      model: 'doubao-seedream-5.0-lite', prompt: 'p', image_gen_id: 92,
    });
    assert.equal(result.ambiguous, false, '4xx 是确定失败，预授权可以释放');
  } finally {
    await badRequest.close();
  }

  // 端口上没有服务：传输层失败同样是「写请求可能已到达」，必须标 ambiguous。
  const dead = await startRelay([{ body: {} }]);
  const deadOrigin = dead.origin;
  await dead.close();
  const result = await callRichbestImageApi(null, relayConfig(deadOrigin), log, {
    model: 'doubao-seedream-5.0-lite', prompt: 'p', image_gen_id: 93,
  });
  assert.equal(result.ambiguous, true);
  assert.match(result.error, /未能确定结果/);
});

test('relay video 5xx on create is ambiguous while a 422 is definite', async () => {
  const serverError = await startRelay([{ status: 503, body: { error: { code: 'multi_provider_disabled', message: '未启用' } } }]);
  try {
    const result = await callRichbestVideoApi(null, relayConfig(serverError.origin), log, {
      prompt: 'p', video_gen_id: 51, billing_authorization_id: 'auth-1', duration: 5, resolution: '480p',
    });
    assert.equal(result.ambiguous, true);
  } finally {
    await serverError.close();
  }

  const reject = await startRelay([{ status: 422, body: { error: { code: 'video_parameter_unsupported', message: '不支持该参数' } } }]);
  try {
    const result = await callRichbestVideoApi(null, relayConfig(reject.origin), log, {
      prompt: 'p', video_gen_id: 52, billing_authorization_id: 'auth-1', duration: 5, resolution: '480p',
    });
    assert.equal(result.ambiguous, false);
  } finally {
    await reject.close();
  }
});

test('relay video 2xx without a task id is ambiguous, not a silent non-event', async () => {
  const relay = await startRelay([{ body: { unexpected: true } }]);
  try {
    const result = await callRichbestVideoApi(null, relayConfig(relay.origin), log, {
      prompt: 'p', video_gen_id: 53, billing_authorization_id: 'auth-1', duration: 5, resolution: '480p',
    });
    assert.match(result.error, /未返回视频任务 ID/);
    assert.equal(result.ambiguous, true, '中转站已受理但没有可用任务 ID：任务可能已建并计费');
  } finally {
    await relay.close();
  }
});
