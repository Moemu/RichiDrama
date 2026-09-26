import request from '@/utils/request'
import { createClientRequestId } from '@/utils/requestId'

export const viralEditJobsAPI = {
  quote(body) { return request.post('/viral-edit-jobs/quote', body) },
  list(dramaId) { return request.get('/viral-edit-jobs', { params: { drama_id: dramaId } }) },
  get(id) { return request.get(`/viral-edit-jobs/${id}`) },
  create(body) { return request.post('/viral-edit-jobs', { ...body, idempotency_key: body.idempotency_key || createClientRequestId() }) },
  saveAsset(id, clipIndex) { return request.post(`/viral-edit-jobs/${id}/outputs/${clipIndex}/save-asset`) },
  videos(dramaId) { return request.get('/assets', { params: { scope: 'project', drama_id: dramaId, type: 'video', page_size: 100 } }) },
}
