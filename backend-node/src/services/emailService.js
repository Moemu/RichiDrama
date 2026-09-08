const nodemailer = require('nodemailer');

function createEmailService(env = process.env) {
  const host = env.SMTP_HOST;
  const from = env.SMTP_FROM;
  const secure = env.SMTP_SECURE === 'true';
  const port = Number(env.SMTP_PORT || (secure ? 465 : 587));
  const enabled = !!(host && from && Number.isInteger(port) && port > 0 && port <= 65535);
  const transport = enabled ? nodemailer.createTransport({
    host, port, secure,
    requireTLS: env.SMTP_REQUIRE_TLS !== 'false',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true,
  }) : null;
  return {
    enabled,
    async sendCode(email, code, purpose) {
      if (!transport) throw new Error('邮件功能尚未配置');
      const result = await transport.sendMail({
        from, to: email, subject: '瑞池传媒账号验证码',
        text: `您正在${purpose === 'bind' ? '绑定或更换邮箱' : '重置密码'}。验证码：${code}\n10 分钟内有效。请勿向他人提供验证码。如非本人操作，请忽略。`,
      });
      if (!result.accepted?.length) throw new Error('邮件未被接收');
    },
  };
}

module.exports = { createEmailService };
