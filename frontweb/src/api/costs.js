import request from '@/utils/request'
const base = '/admin/costs'
export const costsAPI = {
  activity: params => request.get(`${base}/activity`, { params }),
  activityDetail: id => request.get(`${base}/activity/${encodeURIComponent(id)}`),
  reports: params => request.get(`${base}/reports`, { params }),
  report: id => request.get(`${base}/reports/${id}`),
  saveReport: data => request.post(`${base}/reports`, data),
}
