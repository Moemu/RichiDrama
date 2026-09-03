const response = require('../response');

module.exports = function paymentRoutes(service, log) {
  function fail(res, error) {
    const status = Number(error.status) || 400;
    return response.error(res, status, error.code || 'PAYMENT_ERROR', error.message || '支付处理失败');
  }
  return {
    alipayCallback: (req, res) => {
      try {
        service.notify('alipay', { body: req.body || {}, headers: req.headers });
        res.type('text/plain').send('success');
      } catch (error) {
        log?.warn?.('alipay callback rejected', { request_id: req.requestId, code: error.code, error: error.message });
        res.status(Number(error.status) || 400).type('text/plain').send('failure');
      }
    },
    wechatCallback: (req, res) => {
      try {
        service.notify('wechat', { body: req.body || {}, rawBody: req.rawBody, headers: req.headers });
        res.status(204).end();
      } catch (error) {
        log?.warn?.('wechat callback rejected', { request_id: req.requestId, code: error.code, error: error.message });
        res.status(Number(error.status) || 400).json({ code: error.code || 'FAIL', message: error.message || '支付通知处理失败' });
      }
    },
    options: (req, res) => response.success(res, service.options(req.auth.id)),
    create: async (req, res) => { try { response.created(res, await service.create(req.auth, req.body || {})); } catch (error) { fail(res, error); } },
    list: (req, res) => response.success(res, service.list({ ...req.query, user_id: req.auth.id })),
    detail: (req, res) => {
      const item = service.getForUser(req.params.id, req.auth);
      return item ? response.success(res, item) : response.notFound(res, '充值订单不存在');
    },
    sync: async (req, res) => {
      try { const item = await service.sync(req.params.id, req.auth); return item ? response.success(res, item) : response.notFound(res, '充值订单不存在'); }
      catch (error) { return fail(res, error); }
    },
    close: async (req, res) => {
      try { const item = await service.close(req.params.id, req.auth); return item ? response.success(res, item) : response.notFound(res, '充值订单不存在'); }
      catch (error) { return fail(res, error); }
    },
    adminList: (req, res) => response.success(res, service.list(req.query, true)),
    adminDetail: (req, res) => {
      const item = service.getForUser(req.params.id, { id: req.auth.id, role: 'admin' });
      return item ? response.success(res, item) : response.notFound(res, '充值订单不存在');
    },
    adminSync: async (req, res) => {
      try { const item = await service.sync(req.params.id, req.auth, true); return item ? response.success(res, item) : response.notFound(res, '充值订单不存在'); }
      catch (error) { return fail(res, error); }
    },
  };
};
