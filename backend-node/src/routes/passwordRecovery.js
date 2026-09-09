const response = require('../response');
const { createEmailService } = require('../services/emailService');
const { createPasswordRecoveryService } = require('../services/passwordRecoveryService');

module.exports = function passwordRecoveryRoutes(db) {
  const mail = createEmailService();
  const service = createPasswordRecoveryService(db, mail);
  const guard = (fn) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch (error) { response.error(res, error.status || 500, error.status ? error.code : 'INTERNAL_ERROR', error.status ? error.message : '服务繁忙，请稍后重试'); }
  };
  const generic = { message: '如邮箱已绑定且可用，您将收到验证码，请查收邮件。' };
  return {
    capabilities: (_req, res) => { res.set('Cache-Control', 'no-store'); response.success(res, { email_enabled: mail.enabled }); },
    email: (req, res) => { res.set('Cache-Control', 'no-store'); response.success(res, { email_enabled: mail.enabled, email: db.prepare('SELECT verified_email FROM users WHERE id = ?').get(req.auth.id).verified_email }); },
    resetCode: guard((req, res) => {
      const { delivery } = service.requestCode({ purpose: 'reset', email: req.body?.email, sourceIp: req.ip });
      // The public response does not depend on account existence or SMTP outcome.
      delivery.catch(() => {});
      response.success(res, generic);
    }),
    resetConfirm: guard((req, res) => {
      service.confirm({ purpose: 'reset', email: req.body?.email, code: req.body?.code, newPassword: req.body?.new_password });
      res.clearCookie('lmd_session', { path: '/' });
      response.success(res, { message: '密码已重置，请重新登录' });
    }),
    bindCode: guard(async (req, res) => {
      const { delivery } = service.requestCode({ purpose: 'bind', email: req.body?.email, password: req.body?.password, userId: req.auth.id, sourceIp: req.ip });
      await delivery;
      response.success(res, { message: '验证码已发送' });
    }),
    bindConfirm: guard((req, res) => {
      service.confirm({ purpose: 'bind', email: req.body?.email, code: req.body?.code, password: req.body?.password, userId: req.auth.id });
      response.success(res, { message: '邮箱已绑定' });
    }),
    adminReset: guard((req, res) => {
      if (req.body?.confirm !== true) return response.badRequest(res, '请确认重置目标账号');
      response.success(res, service.adminReset(req.auth.id, Number(req.params.id)));
    }),
  };
};
