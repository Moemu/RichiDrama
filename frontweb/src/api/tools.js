import request from '@/utils/request'
import { createClientRequestId } from '@/utils/requestId'

export const toolsAPI = {
  list(params) { return request.get('/tool-runs', { params }) },
  get(id) { return request.get(`/tool-runs/${id}`) },
  run(type, body) { return request.post(`/tools/${type}/runs`, { ...body, idempotency_key: body?.idempotency_key || createClientRequestId() }) },
  retry(id) { return request.post(`/tool-runs/${id}/retry`) },
  remove(id) { return request.delete(`/tool-runs/${id}`) },
  restore(id) { return request.post(`/tool-runs/${id}/restore`) },
  importDrama(id, body) { return request.post(`/tool-runs/${id}/import-drama`, body) },
  templates(type) { return request.get('/tool-templates', { params: { tool_type: type } }) },
  saveTemplate(body) { return request.post('/tool-templates', body) },
}
