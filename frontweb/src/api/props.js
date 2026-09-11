import request from '@/utils/request'

export const propAPI = {
  get(id) {
    return request.get(`/props/${id}`)
  },
  list(dramaId) {
    return request.get(`/dramas/${dramaId}/props`)
  },
  create(data) {
    return request.post('/props', data)
  },
  update(id, data, config) {
    return request.put(`/props/${id}`, data, config)
  },
  generatePrompt(id, model, style) {
    return request.post(`/props/${id}/generate-prompt`, { model, style })
  },
  generateImage(id, model, style, useQuadGrid) {
    const body = {}
    if (model !== undefined && model !== null) body.model = model
    if (style !== undefined && style !== null) body.style = style
    if (useQuadGrid !== undefined) body.use_quad_grid = !!useQuadGrid
    return Object.keys(body).length
      ? request.post(`/props/${id}/generate`, body)
      : request.post(`/props/${id}/generate`)
  },
  extractFromScript(episodeId) {
    return request.post(`/episodes/${episodeId}/props/extract`)
  },
  delete(id) {
    return request.delete(`/props/${id}`)
  },
  addToLibrary(id, body = {}) {
    return request.post(`/props/${id}/add-to-library`, body)
  },
  addToMaterialLibrary(id) {
    return request.post(`/props/${id}/add-to-material-library`, {})
  },
  extractFromImage(id) {
    return request.post(`/props/${id}/extract-from-image`, {})
  },
  putRefImage(id, refImagePath) {
    return request.put(`/props/${id}`, { ref_image: refImagePath ?? null })
  },
  certifySd2(id) {
    return request.post(`/props/${id}/sd2-certify`, {})
  },
  refreshSd2(id) {
    return request.post(`/props/${id}/sd2-certify/refresh`, {})
  }
}
