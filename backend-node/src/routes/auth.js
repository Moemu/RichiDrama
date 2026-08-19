const authService = require('../services/authService');
const response = require('../response');

module.exports = function authRoutes(db) {
  return {
    login: (req, res) => {
      const session = authService.login(db, req.body?.username, req.body?.password);
      if (!session) return response.error(res, 401, 'INVALID_CREDENTIALS', '用户名或密码错误');
      res.cookie('lmd_session', session.token, authService.sessionCookieOptions(req));
      response.success(res, session);
    },
    register: (req, res) => {
      try {
        const session = authService.register(db, req.body || {});
        res.cookie('lmd_session', session.token, authService.sessionCookieOptions(req));
        response.created(res, session);
      } catch (err) { response.badRequest(res, err.message); }
    },
    logout: (_req, res) => {
      res.clearCookie('lmd_session', { path: '/' });
      response.success(res, { message: '已退出登录' });
    },
    me: (req, res) => response.success(res, req.auth),
    sessionCookie: (req, res) => {
      // Existing SPA sessions may predate the protected-media cookie. Refresh
      // it from the already-validated bearer token before mounting media tags.
      res.cookie('lmd_session', req.authToken, authService.sessionCookieOptions(req));
      response.success(res, { message: 'SESSION_COOKIE_REFRESHED' });
    },
    changePassword: (req, res) => {
      try {
        authService.changePassword(db, req.auth.id, req.body?.old_password, req.body?.new_password);
        response.success(res, { message: '密码已更新' });
      } catch (err) { response.badRequest(res, err.message); }
    },
    changeUsername: (req, res) => {
      try {
        const user = authService.changeUsername(db, req.auth.id, req.body?.username);
        const session = authService.issueSession(db, user);
        res.cookie('lmd_session', session.token, authService.sessionCookieOptions(req));
        response.success(res, session);
      } catch (err) { response.badRequest(res, err.message); }
    },
    changeDisplayName: (req, res) => {
      try {
        const user = authService.changeDisplayName(db, req.auth.id, req.body?.display_name);
        const session = authService.issueSession(db, user);
        res.cookie('lmd_session', session.token, authService.sessionCookieOptions(req));
        response.success(res, session);
      } catch (err) { response.badRequest(res, err.message); }
    },
  };
};
