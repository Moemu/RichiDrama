import request from '@/utils/request'
import { createClientRequestId } from '@/utils/requestId'

export const creativeBoardAPI = {
  list() { return request.get('/creative-boards') },
  create(name) { return request.post('/creative-boards', { name }) },
  get(id) { return request.get(`/creative-boards/${id}`) },
  update(id, body) { return request.put(`/creative-boards/${id}`, body) },
  remove(id) { return request.delete(`/creative-boards/${id}`) },
  deliveries(id) { return request.get(`/creative-boards/${id}/deliveries`) },
  createDelivery(id, body) { return request.post(`/creative-boards/${id}/deliveries`, { ...body, idempotency_key: body.idempotency_key || createClientRequestId() }) },
  delivery(id, deliveryId) { return request.get(`/creative-boards/${id}/deliveries/${deliveryId}`) },
}
