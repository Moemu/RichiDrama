const OPERATORS = Object.freeze({
  translate: 'las_video_translate',
  inpaint: 'las_video_inpaint_pro',
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
    throw new Error(`LAS 返回的任务 ID 无效${details ? `（${details}）` : ''}`);
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
    throw new Error(`LAS ${action} 请求失败：HTTP ${response.status}${requestId ? `（request_id=${requestId}）` : ''}`);
  }
  return taskResponse(await response.json(), action === 'poll' ? payload.task_id : null);
}

module.exports = { OPERATORS, configuration, outputPath, inputPath, submitPayload, pollPayload, taskResponse, request };
