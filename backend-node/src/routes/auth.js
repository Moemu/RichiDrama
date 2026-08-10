const authService = require('../services/authService');
const response = require('../response');

module.exports = function authRoutes(db) {
  return {
    login: (req, res) => {
      const session = authService.login(db, req.body?.username, req.body?.password);
      if (!session) return response.error(res, 401, 'INVALID_CREDENTIALS', '用户名或密码错误');
      res.cookie('lmd_session', session.token, authService.sessionCookieOptions());
      response.success(res, session);
    },
    register: (req, res) => {
      try {
        const session = authService.register(db, req.body || {});
        res.cookie('lmd_session', session.token, authService.sessionCookieOptions());
        response.created(res, session);
      } catch (err) { response.badRequest(res, err.message); }
    },
    logout: (_req, res) => {
      res.clearCookie('lmd_session', { path: '/' });
      response.success(res, { message: '已退出登录' });
    },
    me: (req, res) => response.success(res, req.auth),
    changePassword: (req, res) => {
      try {
        authService.changePassword(db, req.auth.id, req.body?.old_password, req.body?.new_password);
        response.success(res, { message: '密码已更新' });
      } catch (err) { response.badRequest(res, err.message); }
    },
  };
};
