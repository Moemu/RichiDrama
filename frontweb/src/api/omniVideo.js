import request from '@/utils/request'
import { createClientRequestId } from '@/utils/requestId'

export const omniVideoAPI = {
  upload(file, options = {}) {
    const form = new FormData()
    form.append('file', file)
    form.append('name', options.name || file.name || '')
    if (options.category) form.append('category', options.category)
    if (options.drama_id) form.append('drama_id', String(options.drama_id))
    return request.post('/media/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  capabilities() { return request.get('/video-model-capabilities') },
  create(body) { return request.post('/omni-video-jobs', { ...body, idempotency_key: body?.idempotency_key || createClientRequestId() }) },
  quoteBilling(body) { return request.post('/billing/quotes', body) },
  polishPrompt(body) { return request.post('/omni-video-jobs/polish-prompt', body) },
  retry(id) { return request.post(`/omni-video-jobs/${id}/retry`) },
  cancel(id) { return request.post(`/omni-video-jobs/${id}/cancel`) },
  hide(id) { return request.delete(`/omni-video-jobs/${id}`) },
  retryPostprocess(id, stage) { return request.post(`/omni-video-jobs/${id}/retry-postprocess`, { stage }) },
  adoptSource(id) { return request.post(`/omni-video-jobs/${id}/adopt-source`) },
  adopt(id) { return request.post(`/omni-video-jobs/${id}/adopt`) },
  extractFrame(id, position) { return request.post(`/omni-video-jobs/${id}/extract-frame`, { position }) },
  extractVideoFrame(id, position) { return request.post(`/video-generations/${id}/extract-frame`, { position }) },
  list(params) { return request.get('/omni-video-jobs', { params: params || {} }) },
  get(id) { return request.get(`/omni-video-jobs/${id}`) },
  assets(params) { return request.get('/assets', { params: params || {} }) },
  /** 创建素材记录（如把场景/角色/道具图导入素材池统一管理） */
  createAsset(body) { return request.post('/assets', body || {}) },
  linkProjectResource(body) { return request.post('/assets/project-resource-link', body || {}) },
  listResourceLinks(params) { return request.get('/asset-resource-links', { params: params || {} }) },
  restoreResourceLink(id) { return request.post(`/asset-resource-links/${id}/restore`) },
  updateAsset(id, body) { return request.put(`/assets/${id}`, body) },
  deleteAsset(id) { return request.delete(`/assets/${id}`) },
  forceDetachAsset(id) { return request.post(`/assets/${id}/force-detach`) },
  assetLineage(id) { return request.get(`/assets/${id}/lineage`) },
  trimAsset(id, body) { return request.post(`/assets/${id}/trim`, body) },
  concatAssets(assetIds) { return request.post('/assets/concat', { asset_ids: assetIds }) },
  uploadLimits() { return request.get('/upload-limits') },
  certifyAsset(id) { return request.post(`/assets/${id}/sd2-certify`) },
  certifyAssetsBatch(ids) { return request.post('/assets/sd2-certify/batch', { ids }) },
  refreshAssetCertification(id) { return request.post(`/assets/${id}/sd2-certify/refresh`) },
  listSequences() { return request.get('/omni-video-sequences') },
  listDeletedSequences() { return request.get('/omni-video-sequences/deleted') },
  createSequence(body = {}) { return request.post('/omni-video-sequences', body) },
  defaultSequence() {
    const sequenceId = Number(new URLSearchParams(window.location.search).get('sequence_id'))
    return Number.isInteger(sequenceId) && sequenceId > 0
      ? request.get(`/omni-video-sequences/${sequenceId}`)
      : request.get('/omni-video-sequences/default')
  },
  getSequence(sequenceId) { return request.get(`/omni-video-sequences/${sequenceId}`) },
  updateSequence(sequenceId, body) { return request.put(`/omni-video-sequences/${sequenceId}`, body) },
  deleteSequence(sequenceId) { return request.delete(`/omni-video-sequences/${sequenceId}`) },
  restoreSequence(sequenceId) { return request.post(`/omni-video-sequences/${sequenceId}/restore`) },
  purgeSequence(sequenceId) { return request.delete(`/omni-video-sequences/${sequenceId}/purge`) },
  addShot(sequenceId, body = {}) { return request.post(`/omni-video-sequences/${sequenceId}/shots`, body) },
  updateShot(sequenceId, shotId, body) { return request.put(`/omni-video-sequences/${sequenceId}/shots/${shotId}`, body) },
  deleteShot(sequenceId, shotId) { return request.delete(`/omni-video-sequences/${sequenceId}/shots/${shotId}`) },
  reorderShots(sequenceId, shotIds) { return request.put(`/omni-video-sequences/${sequenceId}/shots/reorder`, { shot_ids: shotIds }) },
}
