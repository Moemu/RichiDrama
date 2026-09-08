import request from '@/utils/request'

export const providerConnectionsAPI = {
  list: () => request.get('/admin/provider-connections'),
  save: (body, id) => id ? request.patch(`/admin/provider-connections/${id}`, body) : request.post('/admin/provider-connections', body),
  convert: configId => request.post('/admin/provider-connections/convert', { config_id: configId }),
}
