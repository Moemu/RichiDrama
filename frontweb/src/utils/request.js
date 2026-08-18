import axios from 'axios'
import { ElMessage } from 'element-plus'
import { loginRouteForCurrentLocation } from './routeRecovery'

const request = axios.create({
  baseURL: '/api/v1',
  timeout: 600000,
  headers: { 'Content-Type': 'application/json' }
})

request.interceptors.request.use((config) => {
  const token = localStorage.getItem('lmd_auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

const ERROR_MESSAGES = {
  401: '登录已过期，请重新登录', 402: '余额不足，请前往账户中心查看余额或调整任务规格', 403: '没有权限执行此操作', 404: '请求的资源不存在',
  413: '上传文件过大，请压缩后重试', 429: '请求过于频繁，请稍后再试',
  500: '服务器内部错误，请稍后重试', 502: '服务暂时不可用，请稍后重试', 503: '服务正在维护，请稍后重试',
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
  (error) => {
    // 提取后端实际错误信息（优先 API 返回的 message，而非 axios 通用 "status code 500"）
    const status = error.response?.status
    if (status === 401 && !error.config?.url?.includes('/auth/login')) {
      localStorage.removeItem('lmd_auth_token')
      localStorage.removeItem('lmd_auth_user')
      if (window.location.pathname !== '/login') window.location.replace(loginRouteForCurrentLocation(window.location))
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
