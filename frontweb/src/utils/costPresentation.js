export const costStatuses = { calculated: '已计算', missing_usage: '缺用量', missing_price: '缺价格或规格', processing: '未完成', unverified: '待核实', calculation_error: '计算待修复' }
export const callStatuses = { processing: '处理中', completed: '已完成', failed: '失败', unknown: '提交结果不明' }
export const meterNames = { input_token: '文本输入 Token', cache_token: '缓存 Token', output_token: '输出 Token', image: '输出图片', input_image: '输入图片', request: '请求', millisecond: '毫秒', second: '秒', character: '字符' }
const sourceNames = {
  single_video_tool: '单视频生成', omni_sequence_shot: '全能创作', omni_video: '全能创作', creative_board: '创作画布',
  video_generation: '视频生成', image_generation: '图片生成', storyboard: '项目分镜', storyboard_video: '分镜视频', storyboard_image: '分镜图片', story_generation: '剧本生成',
  project_text_generation: '项目文本生成', text_generation: '文本生成', tool_run: 'AI 工具箱',
  video_upscale: '画质增强', video_interpolation: '视频插帧', las_media_job: '视频本地化', storyboard_tts: '分镜配音',
  other: '来源未记录或其他历史',
}
const serviceNames = { text: '文本', image: '图片', storyboard_image: '分镜图片', video: '视频', video_postprocess: '视频后处理', tts: '语音' }
export function sourceKindLabel(value) { return value ? sourceNames[value] || value : '来源未记录' }
export function serviceTypeLabel(value) { return value ? serviceNames[value] || value : '服务未记录' }
export function chinaDate(at = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at)) }
export function chinaTime(at) { return at ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(at)) : '—' }
export function costMoney(micro, currency = 'CNY') { return micro == null ? '未确定' : `${currency} ${(micro / 1e6).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
export function usageText(usage) { return usage ? Object.entries(usage).map(([key, value]) => `${meterNames[key] || key} ${Number(value).toLocaleString('zh-CN')}`).join(' · ') : '缺少计量证据' }
