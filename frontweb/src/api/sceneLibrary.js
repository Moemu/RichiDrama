import request from '@/utils/request'

export const sceneLibraryAPI = {
  list(params) {
    return request.get('/scene-library', { params })
  },
  get(id) {
    return request.get(`/scene-library/${id}`)
  },
  create(data) {
    return request.post('/scene-library', data)
  },
  update(id, data, config) {
    return request.put(`/scene-library/${id}`, data, config)
  },
  delete(id) {
    return request.delete(`/scene-library/${id}`)
  }
}
