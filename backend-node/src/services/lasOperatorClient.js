const OPERATORS = Object.freeze({
  translate: 'las_video_translate',
  inpaint: 'las_video_inpaint_pro',
  viral: 'las_viral_clip_gen',
});

const OUTPUT_LANGUAGES = new Set(['en-US', 'ja-JP', 'ko-KR', 'es-MX', 'pt-BR', 'id-ID', 'th-TH', 'vi-VN', 'fr-FR', 'de-DE']);

function configuration(source = {}) {
  const region = String(source.region || 'cn-beijing').trim();
  const apiKey = String(source.apiKey || '').trim();
  const bucket = String(source.bucket || '').trim();
  if (!/^[a-z]+-[a-z]+(?:-\d+)?$/.test(region)) throw new Error('LAS 地域格式无效');
  if (!apiKey) throw new Error('未填写 LAS API Key，不能提交付费任务');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('未填写有效的 TOS Bucket，不能提交付费任务');
  return { region, apiKey, bucket, baseUrl: `https://operator.las.${region}.volces.com` };
}

function outputPath(config, jobId, stage) {
  if (!/^[a-f0-9-]{36}$/i.test(String(jobId)) || !OPERATORS[stage]) throw new Error('LAS 输出路径参数无效');
  return `tos://${config.bucket}/richidrama/las/${jobId}/${stage}/`;
}

function inputPath(config, value) {
  const input = String(value || '').trim();
  if (input.startsWith(`tos://${config.bucket}/`) && !input.endsWith('/')) return input;
  throw new Error('LAS 输入必须是同账号、同地域 Bucket 中的 TOS 文件');
}

function submitPayload(config, stage, input) {
  if (!OPERATORS[stage]) throw new Error('不支持的 LAS 算子');
  if (stage === 'viral') {
    return { operator_id: OPERATORS.viral, operator_version: 'v1', data: viralSubmitData(config, input) };
  }
  const videoUrl = inputPath(config, input.video_url);
  const outputTosPath = outputPath(config, input.job_id, stage);
  if (stage === 'translate') {
    const source = String(input.audio_language || 'zh-CN');
    const target = String(input.output_language || '');
    if (source !== 'zh-CN' || !OUTPUT_LANGUAGES.has(target)) throw new Error('LAS 翻译语言尚未开放');
    return {
      operator_id: OPERATORS.translate,
      operator_version: 'v1',
      data: {
        video_url: videoUrl,
        audio_language: source,
        output_languages: [target],
        caption_formats: ['.srt'],
        output_dubbing_audio: false,
        lip_translate: false,
        burn_translated_subtitles: true,
        output_tos_path: outputTosPath,
      },
    };
  }
  if (!['lite', 'pro'].includes(input.model_level)) throw new Error('LAS 擦除档位无效');
  return {
    operator_id: OPERATORS.inpaint,
    operator_version: 'v1',
    data: {
      video_url: videoUrl,
      output_tos_path: outputTosPath,
      model_level: input.model_level,
      detection_mode: 'standard_subtitle',
    },
  };
}

function integerInRange(value, min, max, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`LAS ${label} 须在 ${min}–${max} 之间`);
  return number;
}

// 爆款素材剪辑（viral）：白名单式组装，只发官方文档校验过的字段。
// video_urls 的物理顺序即剧集序号，调用方必须保证有序。
function viralSubmitData(config, input) {
  const videoUrls = Array.isArray(input.video_urls) ? input.video_urls : [];
  if (!videoUrls.length || videoUrls.length > 100) throw new Error('LAS 投流剪辑输入需 1–100 集视频');
  const min = integerInRange(input.min_clip_duration, 5, 2400, '最短素材时长（秒）');
  const max = integerInRange(input.max_clip_duration, 5, 2400, '最长素材时长（秒）');
  if (max < min) throw new Error('LAS 投流剪辑的时长上限不能小于下限');
  const count = integerInRange(input.max_clip_count, 1, 300, '目标素材条数');
  if (!['sequential', 'jump_cut'].includes(input.mode)) throw new Error('LAS 投流剪辑模式无效');
  const data = {
    video_urls: videoUrls.map((url) => inputPath(config, url)),
    output_tos_path: outputPath(config, input.job_id, 'viral'),
    mode: input.mode,
    min_clip_duration: min,
    max_clip_duration: max,
    max_clip_count: count,
  };
  if (input.preset_intro != null) {
    if (typeof input.preset_intro !== 'boolean') throw new Error('LAS 精彩前置开关无效');
    if (input.preset_intro) data.preset_intro = true;
  }
  if (input.aspect_ratio != null) {
    if (input.aspect_ratio !== '9:16') throw new Error('LAS 输出画幅当前仅支持 9:16');
    data.aspect_ratio = '9:16';
  }
  if (input.video_bitrate_kbps != null) data.video_bitrate_kbps = integerInRange(input.video_bitrate_kbps, 100, 50000, '输出码率（Kbps）');
  return data;
}

function pollPayload(stage, taskId) {
  if (!OPERATORS[stage] || !validTaskId(taskId)) throw new Error('LAS 任务 ID 无效');
  return { operator_id: OPERATORS[stage], operator_version: 'v1', task_id: taskId };
}

function validTaskId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

function taskResponse(payload, expectedTaskId = null) {
  const metadata = payload?.metadata;
  const taskId = metadata?.task_id;
  if (!validTaskId(taskId) || (expectedTaskId && taskId !== expectedTaskId)) {
    const requestId = String(metadata?.request_id || '').replace(/[^\w.-]/g, '').slice(0, 80);
    const businessCode = String(metadata?.business_code || '').replace(/[^\w.-]/g, '').slice(0, 80);
    const details = [requestId && `request_id=${requestId}`, businessCode && `business_code=${businessCode}`].filter(Boolean).join('，');
    const error = new Error(`LAS 返回的任务 ID 无效${details ? `（${details}）` : ''}`);
    error.providerRequestId = requestId || null;
    throw error;
  }
  const status = String(metadata.task_status || '').toUpperCase();
  if (!['ACCEPTED', 'PENDING', 'RUNNING', 'PROCESSING', 'COMPLETED', 'FAILED', 'TIMEOUT'].includes(status)) throw new Error('LAS 返回的任务状态无效');
  if (status === 'COMPLETED' && String(metadata.business_code ?? '0') !== '0') throw new Error('LAS 完成状态与业务码不一致');
  return { task_id: taskId, status, business_code: String(metadata.business_code ?? ''), error_msg: String(metadata.error_msg || '').slice(0, 500), data: payload.data || null };
}

// HTTP 失败往往就是「提交结果不确定」的来源：把响应头里的请求 ID 带进错误信息，
// 运营在待对账案件里才能拿它去供应商控制台核对这一笔是否真的被受理。
function providerRequestId(response) {
  try {
    const value = String(response?.headers?.get?.('x-request-id') || response?.headers?.get?.('request-id') || '');
    return value.replace(/[^\w.-]/g, '').slice(0, 80);
  } catch (_) { return ''; }
}

async function request(config, action, payload, fetchImpl = fetch) {
  if (!['submit', 'poll'].includes(action)) throw new Error('LAS API 动作无效');
  const response = await fetchImpl(`${config.baseUrl}/api/v1/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const requestId = providerRequestId(response);
    const error = new Error(`LAS ${action} 请求失败：HTTP ${response.status}${requestId ? `（request_id=${requestId}）` : ''}`);
    error.providerRequestId = requestId || null;
    throw error;
  }
  return taskResponse(await response.json(), action === 'poll' ? payload.task_id : null);
}

module.exports = { OPERATORS, configuration, outputPath, inputPath, submitPayload, pollPayload, taskResponse, request };
