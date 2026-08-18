import request from '@/utils/request'
import { createClientRequestId } from '@/utils/requestId'

export const imagesAPI = {
  list(params) {
    return request.get('/images', { params: params || {} })
  },
  create(data) {
    return request.post('/images', { ...data, idempotency_key: data?.idempotency_key || createClientRequestId() })
  },
  upload(data) {
    return request.post('/images/upload', data)
  },
  delete(id) {
    return request.delete(`/images/${id}`)
  }
}
