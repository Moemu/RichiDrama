export const costStatuses = { calculated: '已计算', missing_usage: '缺用量', missing_price: '缺价格或规格', processing: '未完成', unverified: '待核实', calculation_error: '计算待修复' }
export const callStatuses = { processing: '处理中', completed: '已完成', failed: '失败', unknown: '提交结果不明' }
export const meterNames = { input_token: '文本输入 Token', cache_token: '缓存 Token', output_token: '输出 Token', image: '输出图片', input_image: '输入图片', request: '请求', millisecond: '毫秒', second: '秒', character: '字符' }
export function chinaDate(at = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at)) }
export function chinaTime(at) { return at ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(at)) : '—' }
export function costMoney(micro, currency = 'CNY') { return micro == null ? '未确定' : `${currency} ${(micro / 1e6).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
export function usageText(usage) { return usage ? Object.entries(usage).map(([key, value]) => `${meterNames[key] || key} ${Number(value).toLocaleString('zh-CN')}`).join(' · ') : '缺少计量证据' }
