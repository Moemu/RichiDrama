const response = require('../response');
const authService = require('../services/authService');

function readCookie(req, name) {
  const encoded = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!encoded) return null;
  try { return decodeURIComponent(encoded.slice(name.length + 1)); } catch (_) { return null; }
}

function requireAuth(db) {
  return (req, res, next) => {
    const raw = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(raw);
    const token = match?.[1] || readCookie(req, 'lmd_session');
    if (!token) return response.error(res, 401, 'UNAUTHORIZED', '请先登录');
    try { req.auth = authService.authenticate(db, token); return next(); }
    catch (_) { return response.error(res, 401, 'UNAUTHORIZED', '登录已过期，请重新登录'); }
  };
}

function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin') return response.forbidden(res, '需要管理员权限');
  next();
}

module.exports = { requireAuth, requireAdmin };
