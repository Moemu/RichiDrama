import axios from 'axios'
import { ElMessage } from 'element-plus'
import { loginRouteForCurrentLocation } from './routeRecovery'

const request = axios.create({
  baseURL: '/api/v1',
  timeout: 600000,
  headers: { 'Content-Type': 'application/json' }
})

let observedSessionToken = localStorage.getItem('lmd_auth_token') || ''
let preferCookieSession = false

request.interceptors.request.use((config) => {
  const token = localStorage.getItem('lmd_auth_token') || ''
  if (token !== observedSessionToken) {
    observedSessionToken = token
    preferCookieSession = false
  }
  // Must not occupy Authorization: behind Basic-Auth preview proxies nginx
  // validates that header itself and any Bearer value breaks the challenge.
  // The backend accepts X-LMD-Session identically.
  if (token && !preferCookieSession && !config._lmdUseCookieOnly) {
    config.headers['X-LMD-Session'] = token
    config._lmdSessionToken = token
  } else {
    delete config.headers['X-LMD-Session']
    config._lmdSessionToken = ''
  }
  return config
})

const ERROR_MESSAGES = {
  401: '登录已过期，请重新登录', 402: '余额不足，请前往账户中心查看余额或调整任务规格', 403: '没有权限执行此操作', 404: '请求的资源不存在',
  413: '上传文件过大，请压缩后重试', 429: '请求过于频繁，请稍后再试',
  500: '服务器内部错误，请稍后重试', 502: '服务暂时不可用，请稍后重试', 503: '服务正在维护，请稍后重试',
}

async function probeCookieSession() {
  try {
    const response = await axios.post('/api/v1/auth/session-cookie', null, {
      timeout: 10000,
      withCredentials: true,
      validateStatus: () => true,
      headers: { 'Content-Type': 'application/json' },
    })
    if (response.status >= 200 && response.status < 300) return true
    if (response.status === 401 || response.status === 403) return false
    return null
  } catch (_) {
    return null
  }
}

function clearCurrentSession() {
  localStorage.removeItem('lmd_auth_token')
  localStorage.removeItem('lmd_auth_user')
  observedSessionToken = ''
  preferCookieSession = false
  if (window.location.pathname !== '/login') window.location.replace(loginRouteForCurrentLocation(window.location))
}

request.interceptors.response.use(
  (response) => {
    // blob 类型直接返回原始数据，不做 JSON 解包
    if (response.config?.responseType === 'blob') {
      return response.data
    }
    const res = response.data
    if (res.success !== false) {
      return res.data !== undefined ? res.data : res
    }
    return Promise.reject(new Error(res.error?.message || '请求失败'))
  },
  async (error) => {
    // 提取后端实际错误信息（优先 API 返回的 message，而非 axios 通用 "status code 500"）
    const status = error.response?.status
    if (status === 401 && !error.config?.url?.includes('/auth/login') && !error.config?._lmdAuthRecovery) {
      const failedToken = error.config?._lmdSessionToken || ''
      const currentToken = localStorage.getItem('lmd_auth_token') || ''
      // A response can arrive after another tab has replaced the session.
      // Never let that stale response remove the newer shared credential.
      if (failedToken && currentToken && failedToken !== currentToken) {
        error.message = '请求使用了旧登录状态，请重试'
        return Promise.reject(error)
      }

      // API requests prefer X-LMD-Session, while media elements use the
      // HttpOnly cookie. If only the header is stale, keep the valid browser
      // session and retry this request once with the cookie.
      if (failedToken && currentToken === failedToken) {
        const cookieSession = await probeCookieSession()
        if (cookieSession === true) {
          preferCookieSession = true
          const retryConfig = {
            ...error.config,
            headers: { ...error.config.headers },
            _lmdUseCookieOnly: true,
            _lmdAuthRecovery: true,
          }
          delete retryConfig.headers['X-LMD-Session']
          return request(retryConfig)
        }
        // Do not destroy a possibly valid session when the confirmation
        // request failed because of a network or server problem.
        if (cookieSession === null) return Promise.reject(error)
      }

      if (!failedToken || currentToken === failedToken) clearCurrentSession()
    }
    if (status === 403 && window.location.pathname.startsWith('/admin')) {
      // Server-side access is authoritative. Clear only the cached display
      // identity so a demoted account cannot keep seeing administrator UI.
      localStorage.removeItem('lmd_auth_user')
      window.location.replace('/')
    }
    // 413 通常由 nginx 反代层返回（HTML 响应体，非 JSON），需单独给出可读提示
    const backendMsg = error.response?.data?.error?.message
    const msg = status >= 500 ? (ERROR_MESSAGES[status] || ERROR_MESSAGES[500]) : (backendMsg || ERROR_MESSAGES[status] || error.message || '网络错误')
    ElMessage.error(msg)
    // 将真实错误信息写回 message，使组件 catch 块可直接用 e.message 获取可读内容
    error.message = msg
    return Promise.reject(error)
  }
)

export default request
