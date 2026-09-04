const response = require('../response');
const authService = require('../services/authService');
const logger = require('../logger');
const crypto = require('crypto');
const { TokenExpiredError, JsonWebTokenError } = require('jsonwebtoken');

function readCookie(req, name) {
  const encoded = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!encoded) return null;
  try { return decodeURIComponent(encoded.slice(name.length + 1)); } catch (_) { return null; }
}

function requireAuth(db) {
  return (req, res, next) => {
    const raw = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(raw);
    // X-LMD-Session carries the same token for browsers sitting behind a
    // reverse proxy with HTTP Basic Auth (nginx rejects non-Basic
    // Authorization headers before the app ever sees them).
    const bearerToken = match?.[1] || null;
    const headerToken = req.headers['x-lmd-session'] || null;
    const cookieToken = readCookie(req, 'lmd_session');
    const token = bearerToken || headerToken || cookieToken;
    const credentialSource = bearerToken ? 'bearer' : headerToken ? 'x-lmd-session' : cookieToken ? 'cookie' : 'none';
    const credentialFingerprint = token
      ? crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 12)
      : null;
    const clientIp = String(req.get?.('x-real-ip') || req.ip || '').split(',')[0].trim() || null;
    const rejectAuth = (status, code, message, err) => {
      res.locals.authErrorCode = code;
      logger.warn('Authentication rejected', {
        request_id: req.requestId,
        path: req.originalUrl,
        client_ip: clientIp,
        credential_source: credentialSource,
        credential_fingerprint: credentialFingerprint,
        auth_error_code: code,
        error_name: err?.name || null,
        error_code: err?.code || null,
      });
      return response.error(res, status, code, message);
    };
    if (!token) return rejectAuth(401, 'UNAUTHORIZED', '请先登录');
    try {
      req.auth = authService.authenticate(db, token);
      // Keep the authenticated credential available to routes that need to
      // establish a browser cookie for protected static media.
      req.authToken = token;
      return next();
    }
    catch (err) {
      // 只有 JWT 自身失效或账号被停用才是真正的登录态问题。数据库繁忙等
      // 瞬时故障必须与登录态区分：前端对任何 401 都会清除会话并跳转登录页，
      // 把瞬时错误误报成 401 会把所有已登录标签页同时强制下线。
      if (err instanceof TokenExpiredError) return rejectAuth(401, 'TOKEN_EXPIRED', '登录已过期，请重新登录', err);
      if (err instanceof JsonWebTokenError) return rejectAuth(401, 'INVALID_TOKEN', '登录状态无效，请重新登录', err);
      if (err?.code === 'ACCOUNT_DISABLED') return rejectAuth(401, 'ACCOUNT_DISABLED', err.message, err);
      res.locals.authErrorCode = 'SERVICE_BUSY';
      logger.error('Authentication skipped by non-auth error', {
        request_id: req.requestId,
        path: req.originalUrl,
        client_ip: clientIp,
        credential_source: credentialSource,
        credential_fingerprint: credentialFingerprint,
        error: err.message,
        code: err.code,
      });
      return response.error(res, 503, 'SERVICE_BUSY', '服务繁忙，请稍后重试');
    }
  };
}

function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin' || !req.auth?.console_access) return response.forbidden(res, '需要运营后台账号权限');
  next();
}

module.exports = { requireAuth, requireAdmin };
