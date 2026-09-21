import request from '@/utils/request'

export const modelDiscoveryAPI = {
  connections: () => request.get('/admin/model-discovery/connections'),
  fetch: (id, body) => request.post(`/admin/model-discovery/${id}/fetch`, body),
  import: (id, models, capabilities, source, displayNames) => request.post(`/admin/model-discovery/${id}/import`, { models, ...(source ? { source } : {}), ...(capabilities ? { capabilities } : {}), ...(displayNames ? { display_names: displayNames } : {}) }),
}
