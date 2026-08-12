import request from '@/utils/request'

export const accountAPI = {
  me: () => request.get('/billing/me'),
  transactions: () => request.get('/billing/transactions'),
  usage: () => request.get('/billing/usage'),
  models: () => request.get('/models/available'),
  changePassword: (data) => request.post('/auth/change-password', data),
  changeUsername: (data) => request.patch('/auth/username', data),
}

export const adminAPI = {
  users: () => request.get('/admin/users'),
  createUser: (data) => request.post('/admin/users', data),
  updateUser: (id, data) => request.patch(`/admin/users/${id}`, data),
  adjustBalance: (id, data) => request.post(`/admin/users/${id}/balance-adjustments`, data),
  priceBooks: () => request.get('/admin/price-books'),
  createPriceBook: (data) => request.post('/admin/price-books', data),
  updatePriceBook: (id, data) => request.patch(`/admin/price-books/${id}`, data),
  transactions: () => request.get('/admin/transactions'),
  usage: () => request.get('/admin/usage'),
  audit: () => request.get('/admin/audit-logs'),
}
