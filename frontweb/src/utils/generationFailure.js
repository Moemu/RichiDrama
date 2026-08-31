const REQUEST_ID_PATTERN = /(?:request[\s_-]*id|x-request-id|响应\s*id)\s*[:=：]\s*([a-z0-9][a-z0-9._:-]{5,})/i

export function extractRequestId(value) {
  const match = String(value || '').match(REQUEST_ID_PATTERN)
  return match?.[1]?.replace(/[.,;，。；]+$/, '') || ''
}

export function shortRequestId(value) {
  const requestId = String(value || '').trim()
  if (requestId.length <= 20) return requestId
  return `${requestId.slice(0, 8)}…${requestId.slice(-6)}`
}

const RULES = [
  { test: /has not activated the model|model.+not activated|模型.+未开通/i, title: '当前模型未开通', message: '当前火山账号不能使用此模型。', action: '请联系管理员开通模型，或选择已开通的模型。' },
  { test: /forbidden by ip whitelist|ip whitelist|白名单/i, title: '服务访问地址不在白名单中', message: '火山账号的 IP 白名单阻止了本次请求。', action: '请联系管理员更新白名单后重试。' },
  { test: /may contain real person|real[- ]?person|trusted material|真人|认证素材/i, title: '真人素材需要授权', message: '参考素材可能包含真人。火山要求先完成可信素材授权。', action: '请确认素材声明，并使用已授权的清晰正脸素材。' },
  { test: /InputTextSensitiveContentDetected|InputImageSensitiveContentDetected|input.+sensitive|输入.+审核|输入.+敏感/i, title: '输入内容未通过审核', message: '提示词或参考素材可能包含受限制内容。', action: '请修改提示词，或更换参考素材后重试。' },
  { test: /OutputVideoSensitiveContentDetected|output.+sensitive|输出.+审核|输出.+敏感/i, title: '生成结果未通过审核', message: '生成结果触发了内容审核。', action: '请调整提示词或素材后重试。' },
  { test: /PolicyViolation|copyright|content policy|内容合规|版权限制|restriction/i, title: '内容不符合生成规则', message: '提示词、素材或生成结果可能包含受限制内容。', action: '请删除相关内容，或更换素材后重试。' },
  { test: /audio.+(?:below|less than).+1\.8|audio.+too short|音频.+(?:过短|1\.8)/i, title: '音频时长太短', message: '参考音频少于模型要求的最短时长。', action: '请使用至少 1.8 秒的有效音频。' },
  { test: /reference audio.+only reference|audio.+only.+reference|音频.+唯一.+参考/i, title: '不能只使用音频参考', message: '当前生成方式还需要图片、视频或文本输入。', action: '请添加一种视觉素材，或改用支持的生成方式。' },
  { test: /invalid audio url|audio url.+invalid|无效.+音频.+url/i, title: '音频链接无效', message: '火山不能读取当前音频链接。', action: '请重新上传音频，或使用可公开访问的链接。' },
  { test: /asset.+not found|素材.+不存在/i, title: '参考素材不存在', message: '任务引用的素材已删除，或当前账号不能访问它。', action: '请重新选择素材后再生成。' },
  { test: /resource.+download.+failed|failed to download|download.+(?:image|video|audio)|素材.+下载失败/i, title: '参考素材读取失败', message: '火山不能下载本次使用的参考素材。', action: '请重新上传素材，或检查素材链接后重试。' },
  { test: /not supported.+model|unsupported.+(?:parameter|model)|camera_fixed.+not supported|invalid parameter|InvalidParameter|参数.+不支持/i, title: '当前模型不支持此参数', message: '生成参数与所选模型或生成方式不匹配。', action: '请恢复默认参数，或选择支持此功能的模型。' },
  { test: /QuotaExceeded|rate.?limit|too many requests|qps|concurrency|限流|并发.+上限|配额.+超限/i, title: '当前任务较多', message: '火山的排队、并发或调用配额已达到上限。', action: '请稍后重试。重复提交不会加快处理。' },
  { test: /unauthorized|invalid api.?key|authentication|permission denied|access denied|鉴权|密钥.+无效/i, title: '模型服务认证失败', message: '火山账号、密钥或权限配置无效。', action: '请联系管理员检查模型服务配置。' },
  { test: /ECONNRESET|EACCES|fetch failed|network|timeout|timed out|socket|网络|连接.+失败/i, title: '模型服务连接失败', message: '系统暂时不能连接火山服务。', action: '请稍后重试。如果问题持续，请联系管理员。' },
  { test: /missing provider task id|restart recovery|恢复.+任务.+ID|重启.+恢复/i, title: '任务状态恢复失败', message: '系统重启后找不到此任务的服务端编号。', action: '请联系管理员检查任务记录，再决定是否重新生成。' },
  { test: /internal error|InternalError|server error|service unavailable|\b5\d\d\b|内部错误|服务暂不可用/i, title: '模型服务暂时异常', message: '火山服务没有完成本次任务。', action: '请稍后重试。问题持续时，请复制完整失败信息。' },
]

export function presentGenerationFailure(job = {}) {
  const rawReason = String(job.error_msg || job.errorMsg || job.message || '').trim()
  const requestId = String(job.provider_request_id || job.request_id || extractRequestId(rawReason)).trim()
  let result
  if (job.status === 'unknown' && !rawReason) result = { title: '任务状态暂不可用', message: '系统暂时不能取得最新任务状态。', action: '请手动刷新状态。问题持续时，请联系管理员。' }
  else if (job.status === 'billing_reconciliation' && !rawReason) result = { title: '任务等待计费对账', message: '生成状态需要后台确认。', action: '请手动刷新状态。确认完成前不要重复提交。' }
  else if (job.status === 'invalid' && !rawReason) result = { title: '任务信息无效', message: '当前任务缺少继续处理所需的信息。', action: '请联系管理员检查任务记录。' }
  else if (job.upscale_status === 'failed') result = { title: '视频超分失败', message: '原始视频已保留。', action: '你可以仅重试超分，或直接采用原始视频。' }
  else if (job.interpolation_status === 'failed') result = { title: '视频插帧失败', message: '上一阶段的视频已保留。', action: '你可以仅重试插帧，或采用已生成的视频。' }
  else result = RULES.find((rule) => rule.test.test(rawReason)) || { title: '视频生成失败', message: '系统没有识别出明确原因。', action: requestId ? '请复制完整失败信息，并提供给管理员或火山技术支持。' : '请重试。问题持续时，请联系管理员。' }
  return { ...result, rawReason: rawReason || '服务未返回详细失败原因。', requestId, shortRequestId: shortRequestId(requestId) }
}

export function generationFailureCopyText(job = {}) {
  const failure = presentGenerationFailure(job)
  const taskId = job.video_generation_id || job.id || job.omni_job_id
  return [failure.title, taskId ? `本地任务 ID: ${taskId}` : '', failure.requestId ? `火山响应 ID: ${failure.requestId}` : '', `原始失败原因: ${failure.rawReason}`].filter(Boolean).join('\n')
}
