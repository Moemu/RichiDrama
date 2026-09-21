'use strict';

/**
 * 瑞池中转站（Star Proxy，https://api.richbest.cn）生成链路适配器。
 * 中转专属知识全部收在这里：模型参数画像、请求体构造、幂等键、状态解析、探测与错误语义；
 * 各 client 只加一处早返回分支，且生成请求的 HTTP 仍由宿主 client 的记账传输发出。
 * 契约以 CLIENT_API v5.8 为准：只用 doubao-* 稳定别名（短别名已无兼容转发）、
 * 视频只发 ratio、图片不接受 negative_prompt、上游未返回 usage 时不得伪造计量。
 */

const PROVIDER = 'richbest';
const DEFAULT_BASE_URL = 'https://api.richbest.cn';
const PATHS = {
  health: '/health',
  authMe: '/api/auth/me',
  models: '/v1/models',
  pricing: '/v1/pricing',
  image: '/v1/images/generations',
  videoTasks: '/api/v3/contents/generations/tasks',
};

class RichbestError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'RichbestError';
    this.status = options.status || null;
    this.code = options.code || null;
    this.requestId = options.requestId || null;
    this.retryAfterMs = Number.isFinite(options.retryAfterMs) ? options.retryAfterMs : null;
    this.unauthorizedModel = !!options.unauthorizedModel;
    this.conflict = !!options.conflict;
    // 写请求已发出但终态未知：只能复用同一幂等键复查，不能当作未发生去释放额度。
    this.ambiguous = !!options.ambiguous;
  }
}

const SEEDANCE_FIELDS = [
  'duration', 'frames', 'resolution', 'ratio', 'generate_audio', 'draft', 'seed',
  'camera_fixed', 'watermark', 'return_last_frame', 'service_tier',
  'execution_expires_after', 'task_type',
];

/**
 * maxImages 为 null 表示数量与像素规格由既有 seedanceInputValidation.rulesForModel 把关；
 * wan / minimax 不在该表的模型名里，因此这里给出显式上限与 scheme 限制。
 */
const SEEDANCE_PROFILE = {
  key: 'seedance',
  label: '火山 Seedance',
  fields: SEEDANCE_FIELDS,
  imageRoles: ['first_frame', 'last_frame', 'reference_image'],
  maxImages: null,
  schemes: ['https', 'asset', 'data'],
  maxVideos: 3,
  maxAudios: 3,
  supportsCancel: true,
  defaults: {},
};

/**
 * 未列入此表的别名一律按 Seedance 画像处理。
 *
 * 待核实（不要在真机验证前擅自改口径）：文档 §10.1.1 把 wan 的取值写成 `1080P`、
 * minimax 写成 `768P`（大写 P），而应用侧与价目 dimension 都是小写 `480p/720p/1080p`。
 * 这里原样透传调用方的取值，只在小写缺省时补画像默认值；若中转站区分大小写，
 * 需要在 buildVideoBody 里按画像加一层取值映射。
 */
const VIDEO_PROFILES = {
  'wan3.0-video': {
    key: 'wan',
    label: '阿里百炼 Wan3.0',
    fields: ['duration', 'resolution', 'ratio', 'generate_audio', 'watermark'],
    imageRoles: ['first_frame'],
    maxImages: 1,
    schemes: ['https'],
    maxVideos: 0,
    maxAudios: 0,
    supportsCancel: false,
    defaults: { resolution: '1080P', ratio: 'adaptive', generate_audio: true },
  },
  'minimax-h3': {
    key: 'minimax',
    label: 'MiniMax H3',
    fields: ['duration', 'resolution', 'ratio', 'seed', 'watermark'],
    imageRoles: ['reference_image'],
    maxImages: 20,
    schemes: ['https'],
    maxVideos: 0,
    maxAudios: 0,
    supportsCancel: false,
    defaults: { resolution: '768P', ratio: 'adaptive' },
  },
};

const IMAGE_ALLOWED = new Set([
  'model', 'prompt', 'image', 'n', 'size', 'output_format', 'watermark', 'response_format',
  'background', 'moderation', 'output_compression', 'guidance_scale', 'seed',
  'sequential_image_generation', 'sequential_image_generation_options',
  'optimize_prompt_options', 'tools',
]);
/** 中转明确拒绝的字段：给出改写建议而不是原样转发去吃 422。 */
const IMAGE_REJECTED = {
  negative_prompt: '中转图片接口不接受 negative_prompt，请把负向要求写进提示词',
  stream: '中转图片接口不提供流式响应',
};
/** 会被接收但不会转发给上游的字段：不得当作已生效的控制项展示。 */
const IMAGE_INEFFECTIVE = ['quality', 'style', 'user'];

const CHAT_ALLOWED = new Set([
  'model', 'messages', 'stream', 'stream_options', 'frequency_penalty', 'function_call',
  'functions', 'logit_bias', 'logprobs', 'top_logprobs', 'max_completion_tokens', 'max_tokens',
  'n', 'parallel_tool_calls', 'presence_penalty', 'reasoning_effort', 'response_format', 'seed',
  'service_tier', 'stop', 'store', 'temperature', 'tool_choice', 'tools', 'top_p', 'user', 'metadata',
]);
/** 请求里出现内部路由字段会返回 422 route_override_forbidden，一律先剥掉。 */
const ROUTE_OVERRIDE_KEYS = ['provider', 'channel', 'base_url', 'api_key', 'project', 'project_name'];

const PENDING_VIDEO_STATUSES = new Set(['queued', 'running', 'pending', 'created', 'processing', 'submitted']);
const FAILED_VIDEO_STATUSES = new Set(['failed', 'failure', 'error', 'cancelled', 'canceled', 'expired']);
const SUCCEEDED_VIDEO_STATUSES = new Set(['succeeded', 'success', 'completed', 'done']);

function isRichbest(config) {
  return String(config?.provider || '').trim().toLowerCase() === PROVIDER;
}

/** 文本/图片行常把 base_url 写成 .../v1，视频路径却挂在站点根上：统一取 origin 再拼。 */
function originOf(baseUrl) {
  const raw = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  let url;
  try { url = new URL(raw); } catch (_) { throw new RichbestError(`中转站 Base URL 无效：${raw}`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new RichbestError('中转站仅支持 http(s) Base URL');
  return `${url.protocol}//${url.host}`;
}

function urlFor(config, pathname) {
  return originOf(config?.base_url) + pathname;
}

function videoTaskUrl(config, taskId) {
  return urlFor(config, `${PATHS.videoTasks}/${encodeURIComponent(String(taskId).trim())}`);
}

function headersFor(config, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    // 文档 §1 要求携带 Accept；api_key 可能带着 "Bearer " 前缀被粘贴进来，先剥掉再拼。
    Accept: 'application/json',
    Authorization: `Bearer ${String(config?.api_key || '').trim().replace(/^Bearer\s+/i, '')}`,
  };
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  return headers;
}

/**
 * 幂等键由已有列推出，不需要新字段：同一行 + 同一预授权恒定，因此崩溃重跑复用同键
 * 让中转去重；用户显式重新生成会新建预授权，从而得到新键和新任务。
 */
function idempotencyKey(kind, row) {
  const id = Number(row?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const auth = String(row?.billing_authorization_id || '').replace(/[^0-9a-zA-Z]/g, '').slice(0, 24);
  return `rd-${kind}-${id}${auth ? `-${auth}` : ''}`.slice(0, 128);
}

function videoProfile(model) {
  const name = String(model || '').trim().toLowerCase();
  return VIDEO_PROFILES[name] || SEEDANCE_PROFILE;
}

/**
 * 文档 §13.1 里属于文本/图片/向量/音频的别名族。它们落到视频接口只会吃
 * 422 model_modality_mismatch，而且会先冻结额度再失败；这里提前给出准确原因。
 * 注意 `^doubao-seed-` 不会命中 `doubao-seedance-*`（"seedance" 后面不是连字符）。
 * 未列出的别名仍然按 Seedance 画像兜底，那是 VideoProfile 的既有约定。
 */
const NON_VIDEO_ALIASES = [
  /^doubao-seedream-/, /^gpt-image-/, /^doubao-embedding-/, /^doubao-seed-tts-/,
  /^doubao-seedasr-/, /^doubao-seed-audio-/, /^glm-/, /^deepseek-/, /^doubao-seed-/,
];

function assertVideoModelAlias(model) {
  const name = String(model || '').trim().toLowerCase();
  if (NON_VIDEO_ALIASES.some((pattern) => pattern.test(name))) {
    throw new RichbestError(`中转站模型 ${model} 不是视频模型，不能提交到视频接口`);
  }
}

function referenceScheme(value) {
  const raw = String(value || '').trim();
  if (raw.startsWith('asset://')) return 'asset';
  if (raw.startsWith('data:')) return 'data';
  if (/^https?:\/\//i.test(raw)) return 'https';
  return null;
}

/**
 * 素材形状校验（类型、角色、数量），与地址无关 —— 地址要等本地文件解析成
 * https/data/asset 之后才能判定，那部分留在 assertReferencesAcceptable。
 * 单独拆出来是为了让路由层能在创建预授权之前先挡掉「模型根本不支持这种素材」。
 */
function assertReferenceShape(profile, references) {
  const counts = { image: 0, video: 0, audio: 0 };
  for (const ref of references) {
    if (ref.kind === 'image' && !profile.imageRoles.includes(ref.role)) {
      throw new RichbestError(`${profile.label} 不支持图片角色 ${ref.role || '(空)'}，可用角色：${profile.imageRoles.join('、')}`);
    }
    if (ref.kind === 'image') counts.image += 1;
    if (ref.kind === 'video') counts.video += 1;
    if (ref.kind === 'audio') counts.audio += 1;
  }
  if (profile.maxImages != null && counts.image > profile.maxImages) {
    throw new RichbestError(`${profile.label} 最多接受 ${profile.maxImages} 张参考图，当前 ${counts.image} 张`);
  }
  if (counts.video > profile.maxVideos) throw new RichbestError(`${profile.label} 不支持参考视频素材`);
  if (counts.audio > profile.maxAudios) throw new RichbestError(`${profile.label} 不支持参考音频素材`);
}

/** 路由层提交前校验：把「模型不支持这种素材」挡在冻结额度之前，直接 400 而不是异步失败。 */
function assertVideoRequestShape(input) {
  assertVideoModelAlias(input?.model);
  const profile = videoProfile(input?.model);
  assertReferenceShape(profile, Array.isArray(input?.references) ? input.references : []);
  return profile;
}

function assertReferencesAcceptable(profile, references) {
  for (const ref of references) {
    const scheme = referenceScheme(ref.url);
    if (!scheme) {
      throw new RichbestError(`参考素材地址无效（既不是公网 URL、asset:// 也不是内联数据）：${String(ref.url || '').slice(0, 120)}`);
    }
    if (!profile.schemes.includes(scheme)) {
      const wanted = profile.schemes.map((item) => ({ https: '公网 HTTP(S) 地址', asset: 'asset:// 素材', data: '内联数据' }[item] || item)).join(' 或 ');
      throw new RichbestError(`${profile.label} 只接受${wanted}参考素材${scheme === 'data' ? '，本地文件不能内联提交' : ''}`);
    }
  }
  assertReferenceShape(profile, references);
}

/**
 * 构造视频创建请求体。只发 ratio，绝不发 aspect_ratio；profile 之外的参数在提交前
 * 丢弃并回报，避免冻结额度之后才吃到 422。model 原样使用，不得再翻成带日期的上游 ID。
 */
function buildVideoBody(input) {
  const { model, prompt, references = [], params = {} } = input;
  assertVideoModelAlias(model);
  const profile = videoProfile(model);
  const dropped = [];
  assertReferencesAcceptable(profile, references);

  const body = { model: String(model || '').trim(), content: [{ type: 'text', text: String(prompt || '') }] };
  // 先剔除「未提供」的参数再合并画像默认值：调用方把 duration/resolution/seed 等显式写成
  // undefined 时，展开会把 defaults 的同名键覆盖成 undefined，默认值等于从未生效。
  const provided = Object.fromEntries(Object.entries(params).filter(([, value]) => value != null));
  for (const [key, value] of Object.entries({ ...profile.defaults, ...provided })) {
    if (key === 'aspect_ratio') { dropped.push('aspect_ratio'); continue; }
    if (!profile.fields.includes(key)) { dropped.push(key); continue; }
    body[key] = value;
  }
  // Ark-side rule mirrored for the relay: Seedance 2.0 Mini text-to-video
  // rejects camera_fixed entirely (video_camera_unsupported); omitting is the
  // only accepted form, sending false still fails.
  const isSeedanceMini = /seedance[-_.]?2[-_.]?0[-_.]?mini/i.test(String(model || ''));
  const hasImageReference = (references || []).some((ref) => ref.kind === 'image');
  if (isSeedanceMini && !hasImageReference && body.camera_fixed !== undefined) {
    delete body.camera_fixed;
    if (!dropped.includes('camera_fixed')) dropped.push('camera_fixed');
  }
  if (!body.ratio) {
    const ratio = params.aspect_ratio || params.ratio;
    if (ratio) body.ratio = ratio; else dropped.push('ratio');
  }
  for (const ref of references) {
    const type = ref.kind === 'video' ? 'video_url' : ref.kind === 'audio' ? 'audio_url' : 'image_url';
    body.content.push({ type, [type]: { url: ref.url }, role: ref.role });
  }
  // 与既有 Seedance 全能分支一致：带任意参考素材（含 reference_video / reference_audio）
  // 即按 i2v 提交，纯文本才用 t2v。文档对多模态参考下的 task_type 取值只写"以模型能力为准"，
  // 这是与现有行为对齐的推断；若上游对音视频参考要求其它值，需要在这里按能力拆分。
  const hasReference = references.length > 0;
  if (body.task_type == null && profile.fields.includes('task_type')) body.task_type = hasReference ? 'i2v' : 't2v';
  return { body, profile, dropped };
}

function assertImageSubmission(body) {
  const dropped = [];
  for (const [key, reason] of Object.entries(IMAGE_REJECTED)) {
    if (body[key] === false || body[key] == null || body[key] === '') { delete body[key]; continue; }
    throw new RichbestError(reason);
  }
  for (const key of IMAGE_INEFFECTIVE) {
    if (body[key] != null && body[key] !== '') { dropped.push(key); delete body[key]; }
  }
  for (const key of Object.keys(body)) {
    if (!IMAGE_ALLOWED.has(key)) { dropped.push(key); delete body[key]; }
  }
  for (const key of ROUTE_OVERRIDE_KEYS) delete body[key];
  const prompt = String(body.prompt || '');
  if (!prompt.trim()) throw new RichbestError('提示词不能为空');
  if (prompt.length > 32000) throw new RichbestError('提示词超过 32000 字符上限');
  const refs = Array.isArray(body.image) ? body.image : (body.image ? [body.image] : []);
  return { body, dropped, reference_count: refs.length };
}

/** 中转站拒绝白名单外的顶层字段（422 text_parameter_unsupported / route_override_forbidden）。 */
function mutateChatBody(body) {
  const next = { ...body };
  for (const key of ROUTE_OVERRIDE_KEYS) delete next[key];
  const dropped = [];
  for (const key of Object.keys(next)) {
    if (!CHAT_ALLOWED.has(key)) { dropped.push(key); delete next[key]; }
  }
  return { body: next, dropped };
}

function requestIdFrom(payload, headers) {
  return String(
    payload?.request_id || payload?.requestId
    || payload?.error?.requestId
    || payload?.ResponseMetadata?.RequestId
    || headers?.['x-request-id'] || ''
  ).trim() || null;
}

function errorFrom(status, payload, headers) {
  const error = payload?.error || payload?.ResponseMetadata?.Error || {};
  const code = typeof error === 'string' ? null : (error.code || error.Code || null);
  const message = typeof error === 'string' ? error
    : (error.message || error.Message || payload?.message || `中转站请求失败：HTTP ${status}`);
  const retryAfterHeader = Number(headers?.['retry-after']);
  const requestId = requestIdFrom(payload, headers);
  const ambiguous = status >= 500;
  const detail = code ? `${message}（${code}）` : message;
  if (status === 401) return new RichbestError(`中转站业务 API Key 无效或已停用：${detail}`, { status, code, requestId });
  if (status === 403) return new RichbestError(`当前项目未开通该模型或渠道不可用：${detail}`, { status, code, requestId, unauthorizedModel: true });
  if (status === 404) return new RichbestError(`中转站未找到该模型或任务：${detail}`, { status, code, requestId });
  if (status === 409) return new RichbestError(`中转站拒绝了重复或冲突的请求：${detail}`, { status, code, requestId, conflict: true });
  if (status === 429) return new RichbestError(`中转站额度或限流已用尽：${detail}`, {
    status, code, requestId, retryAfterMs: Number.isFinite(retryAfterHeader) ? Math.round(retryAfterHeader * 1000) : null,
  });
  if (status === 422) return new RichbestError(`中转站不支持该请求参数：${detail}`, { status, code, requestId });
  return new RichbestError(`中转站请求失败：${detail}`, { status, code, requestId, ambiguous });
}

/** 上游给了空的 usage 对象等同于没给：返回 null，交给待对账而不是估算。 */
function usableUsage(value) {
  return value && typeof value === 'object' && Object.keys(value).length ? value : null;
}

function parseVideoTask(payload, headers) {
  const status = String(payload?.status || '').trim().toLowerCase() || null;
  const requestId = requestIdFrom(payload, headers);
  const videoUrl = String(payload?.content?.video_url || '').trim() || null;
  const errorNode = payload?.error;
  const errorMessage = typeof errorNode === 'string' ? errorNode : (errorNode?.message || null);
  return {
    status,
    requestId,
    video_url: SUCCEEDED_VIDEO_STATUSES.has(status) ? videoUrl : null,
    pending: PENDING_VIDEO_STATUSES.has(status) || (!status && !errorMessage),
    failed: FAILED_VIDEO_STATUSES.has(status) || !!errorMessage,
    error_message: errorMessage,
    // 上游没给 usage 就是没有，不补零、不补 request:1
    usage: usableUsage(payload?.usage),
    duration: payload?.duration ?? null,
  };
}

function parseImageResult(payload, headers) {
  const item = Array.isArray(payload?.data) ? payload.data[0] : null;
  const url = String(item?.url || item?.image_url || '').trim() || null;
  // 防御性兜底：提交侧固定 response_format=url，正常不会命中；若上游仍返回 b64_json，
  // downloadImageToLocal 支持 data URL 转存，路径与 URL 结果一致。
  const b64 = item?.b64_json ? `data:image/png;base64,${String(item.b64_json).replace(/\s/g, '')}` : null;
  return {
    url: url || b64,
    requestId: requestIdFrom(payload, headers),
    usage: usableUsage(payload?.usage),
    count: Array.isArray(payload?.data) ? payload.data.length : 0,
  };
}

function parseModelCatalog(payload) {
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return items.map((row) => ({
    id: String(row?.id || '').trim(),
    display_name: String(row?.display_name || row?.id || '').trim(),
    modality: String(row?.modality || '').trim().toLowerCase() || null,
    capabilities: row?.capabilities && typeof row.capabilities === 'object' ? row.capabilities : {},
  })).filter((row) => row.id);
}

function contextOf(input) {
  const baseUrl = String(input?.baseUrl || input?.config?.base_url || DEFAULT_BASE_URL).trim();
  const apiKey = String(input?.apiKey || input?.config?.api_key || '').trim().replace(/^Bearer\s+/i, '').trim();
  if (!apiKey) throw new RichbestError('缺少中转站业务 API Key');
  return { baseUrl, apiKey, fetchImpl: input?.fetchImpl || globalThis.fetch };
}

async function getJson(ctx, pathname, options = {}) {
  const url = new URL(pathname, `${originOf(ctx.baseUrl)}/`);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const headers = { Accept: 'application/json' };
  if (options.auth !== false) headers.Authorization = `Bearer ${ctx.apiKey}`;
  let response;
  try {
    response = await ctx.fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(options.timeoutMs || 15000) });
  } catch (error) {
    throw new RichbestError(`无法连接中转站：${error.message}`);
  }
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch (_) { payload = { _raw: raw.slice(0, 400) }; }
  if (!response.ok) throw errorFrom(response.status, payload, response.headers);
  return { payload, requestId: requestIdFrom(payload, response.headers) };
}

/** 连接测试只发 GET：不创建任务、不产生费用。 */
async function probe(input) {
  const ctx = contextOf(input);
  const checks = [];
  const result = { ok: false, provider: PROVIDER, baseUrl: originOf(ctx.baseUrl), checks, models: null, pricing: null, apiKeyId: null };
  try {
    const health = await getJson(ctx, PATHS.health, { auth: false, timeoutMs: 8000 });
    checks.push({ step: 'health', ok: true, requestId: health.requestId });
  } catch (error) {
    checks.push({ step: 'health', ok: false, error: error.message });
    result.error = error.message;
    return result;
  }
  try {
    const me = await getJson(ctx, PATHS.authMe);
    const authenticated = me.payload?.authenticated === true;
    checks.push({ step: 'auth', ok: authenticated, requestId: me.requestId, error: authenticated ? null : '业务 API Key 未通过验证' });
    result.apiKeyId = me.payload?.apiKeyId || null;
    if (!authenticated) { result.error = '中转站业务 API Key 未通过验证'; return result; }
  } catch (error) {
    checks.push({ step: 'auth', ok: false, error: error.message });
    result.error = error.message;
    return result;
  }
  try {
    const models = await getJson(ctx, PATHS.models);
    const parsed = parseModelCatalog(models.payload);
    const byModality = parsed.reduce((acc, row) => {
      const key = row.modality || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    result.models = { total: parsed.length, by_modality: byModality, items: parsed, has_more: !!models.payload?.has_more };
    checks.push({ step: 'models', ok: true, requestId: models.requestId, total: parsed.length });
  } catch (error) {
    checks.push({ step: 'models', ok: false, error: error.message });
    result.error = error.message;
    return result;
  }
  result.ok = true;
  return result;
}

async function listModels(input) {
  const ctx = contextOf(input);
  const result = await getJson(ctx, PATHS.models);
  return { models: parseModelCatalog(result.payload), requestId: result.requestId, hasMore: !!result.payload?.has_more };
}

async function listPrices(input, model) {
  const ctx = contextOf(input);
  const pricing = await getJson(ctx, PATHS.pricing, { query: model ? { model } : {} });
  return pricing;
}

module.exports = {
  PROVIDER, DEFAULT_BASE_URL, PATHS,
  RichbestError, isRichbest, originOf, urlFor, videoTaskUrl, headersFor,
  idempotencyKey, videoProfile, buildVideoBody, assertVideoRequestShape, assertVideoModelAlias,
  assertImageSubmission, mutateChatBody, errorFrom, requestIdFrom,
  parseVideoTask, parseImageResult, parseModelCatalog, listModels, listPrices, probe,
};
