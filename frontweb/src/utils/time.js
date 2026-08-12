/**
 * Business timestamps are stored and transported as UTC ISO strings.  Always
 * render them as China Standard Time so browser and server locales cannot
 * change what a user sees.
 */
export const CHINA_TIME_ZONE = 'Asia/Shanghai'

function asDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatChinaDateTime(value, fallback = '刚刚') {
  const date = asDate(value)
  if (!date) return fallback
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

export function formatChinaDate(value, fallback = '') {
  const date = asDate(value)
  if (!date) return fallback
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

export function formatChinaTime(value, fallback = '') {
  const date = asDate(value)
  if (!date) return fallback
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}
