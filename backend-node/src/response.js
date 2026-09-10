// 和 Go 端 pkg/response 保持一致，方便前端复用
const INTERNAL_ERROR_MESSAGE = '服务器内部错误，请稍后重试';

function clientMessage(errorOrMessage, fallback = '请求处理失败，请稍后重试') {
  const message = String(errorOrMessage?.message || errorOrMessage || '').trim();
  if (!message) return fallback;
  if (/UNIQUE constraint failed/i.test(message)) return '该数据已存在，请检查后重试';
  if (/NOT NULL constraint failed/i.test(message)) return '提交的数据不完整，请检查后重试';
  if (/FOREIGN KEY constraint failed/i.test(message)) return '关联数据不存在或仍在使用';
  if (/CHECK constraint failed/i.test(message)) return '提交的数据不符合要求';
  const technical = [
    /\bSQLITE_[A-Z_]+\b/i,
    /\b(?:database is locked|no such (?:table|column)|has no column named|SQL logic error)\b/i,
    /\bnear ["'][^"']+["']:\s*syntax error\b/i,
    /\b(?:ENOENT|EACCES|EPERM|ECONNREFUSED)\b/,
    /node_modules/i,
    /\n\s*at\s+(?:async\s+)?[^\n]+/,
    /(?:[A-Za-z]:\\|\/(?:home|usr|var|etc|opt)\/)/,
  ];
  return technical.some((pattern) => pattern.test(message)) ? fallback : message;
}
function send(res, statusCode, body) {
  const payload = {
    ...body,
    timestamp: new Date().toISOString(),
  };
  res.status(statusCode).json(payload);
}

function success(res, data) {
  send(res, 200, { success: true, data });
}

function created(res, data) {
  send(res, 201, { success: true, data });
}

function successWithPagination(res, items, total, page, pageSize) {
  const totalPages = Math.ceil(total / pageSize) || 0;
  send(res, 200, {
    success: true,
    data: {
      items,
      pagination: { page, page_size: pageSize, total, total_pages: totalPages },
    },
  });
}

function error(res, statusCode, code, message, details) {
  const safeMessage = clientMessage(message, statusCode >= 500 ? INTERNAL_ERROR_MESSAGE : undefined);
  send(res, statusCode, {
    success: false,
    error: { code, message: safeMessage, ...(details && { details }) },
  });
}

function badRequest(res, message) {
  error(res, 400, 'BAD_REQUEST', message);
}

function notFound(res, message) {
  error(res, 404, 'NOT_FOUND', message);
}

function forbidden(res, message) {
  error(res, 403, 'FORBIDDEN', message);
}

function internalError(res, message) {
  error(res, 500, 'INTERNAL_ERROR', clientMessage(message, INTERNAL_ERROR_MESSAGE));
}

module.exports = {
  success,
  created,
  successWithPagination,
  error,
  badRequest,
  notFound,
  forbidden,
  internalError,
  clientMessage,
  INTERNAL_ERROR_MESSAGE,
};
