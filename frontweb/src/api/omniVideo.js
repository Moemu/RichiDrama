import request from '@/utils/request'

export const omniVideoAPI = {
  upload(file, options = {}) {
    const form = new FormData()
    form.append('file', file)
    if (options.name) form.append('name', options.name)
    if (options.category) form.append('category', options.category)
    return request.post('/media/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  capabilities() { return request.get('/video-model-capabilities') },
  create(body) { return request.post('/omni-video-jobs', body) },
  retry(id) { return request.post(`/omni-video-jobs/${id}/retry`) },
  list() { return request.get('/omni-video-jobs') },
  get(id) { return request.get(`/omni-video-jobs/${id}`) },
  assets(params) { return request.get('/assets', { params: params || {} }) },
  certifyAsset(id) { return request.post(`/assets/${id}/sd2-certify`) },
  refreshAssetCertification(id) { return request.post(`/assets/${id}/sd2-certify/refresh`) },
  listSequences() { return request.get('/omni-video-sequences') },
  createSequence(body = {}) { return request.post('/omni-video-sequences', body) },
  defaultSequence() {
    const sequenceId = Number(new URLSearchParams(window.location.search).get('sequence_id'))
    return Number.isInteger(sequenceId) && sequenceId > 0
      ? request.get(`/omni-video-sequences/${sequenceId}`)
      : request.get('/omni-video-sequences/default')
  },
  getSequence(sequenceId) { return request.get(`/omni-video-sequences/${sequenceId}`) },
  updateSequence(sequenceId, body) { return request.put(`/omni-video-sequences/${sequenceId}`, body) },
  addShot(sequenceId, body = {}) { return request.post(`/omni-video-sequences/${sequenceId}/shots`, body) },
  updateShot(sequenceId, shotId, body) { return request.put(`/omni-video-sequences/${sequenceId}/shots/${shotId}`, body) },
  deleteShot(sequenceId, shotId) { return request.delete(`/omni-video-sequences/${sequenceId}/shots/${shotId}`) },
  reorderShots(sequenceId, shotIds) { return request.put(`/omni-video-sequences/${sequenceId}/shots/reorder`, { shot_ids: shotIds }) },
}
