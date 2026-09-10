import request from '@/utils/request'
const base = '/admin/costs'
export const costsAPI = {
  filterOptions: () => request.get(`${base}/filter-options`),
  activity: params => request.get(`${base}/activity`, { params }),
  activityDetail: (id, params) => request.get(`${base}/activity/${encodeURIComponent(id)}`, { params }),
  supplierPrices: () => request.get(`${base}/supplier-prices`),
  syncSupplierPrices: () => request.post(`${base}/supplier-prices/sync`),
  reports: params => request.get(`${base}/reports`, { params }),
  report: id => request.get(`${base}/reports/${id}`),
  saveReport: data => request.post(`${base}/reports`, data),
}
