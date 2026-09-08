import request from '@/utils/request'

export const modelDiscoveryAPI = {
  connections: () => request.get('/admin/model-discovery/connections'),
  fetch: (id, body) => request.post(`/admin/model-discovery/${id}/fetch`, body),
  import: (id, models) => request.post(`/admin/model-discovery/${id}/import`, { models }),
}
