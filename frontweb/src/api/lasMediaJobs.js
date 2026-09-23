import request from '@/utils/request'
import { createClientRequestId } from '@/utils/requestId'

export const lasMediaJobsAPI = {
  capabilities() { return request.get('/las-media-jobs/capabilities') },
  list(dramaId) { return request.get('/las-media-jobs', { params: { drama_id: dramaId } }) },
  create(body) { return request.post('/las-media-jobs', { ...body, idempotency_key: body.idempotency_key || createClientRequestId() }) },
  quote(model, milliseconds) { return request.post('/billing/quotes', { service_type: 'video_postprocess', provider: 'las', model, usage: { millisecond: milliseconds } }) },
  videos(dramaId) { return request.get('/assets', { params: { scope: 'project', drama_id: dramaId, type: 'video', page_size: 100 } }) },
}
