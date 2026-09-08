const crypto = require('crypto');
const auth = require('./authService');
const billing = require('./billingService');

function failure(message, status = 400, code = 'RECOVERY_REJECTED') {
  return Object.assign(new Error(message), { status, code });
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(email)) {
    throw failure('请输入有效邮箱');
  }
  return email;
}

function createPasswordRecoveryService(db, mail) {
  const at = () => new Date().toISOString();
  function digest(id, code) {
    return crypto.createHmac('sha256', auth.jwtSecret(db)).update(`email-code:${id}:${code}`).digest('hex');
  }
  function audit(actorId, action, targetId, result) {
    billing.audit(db, actorId || 0, action, 'user', targetId || null, { result });
  }
  function currentUser(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }

  function requestCode({ purpose, email: rawEmail, userId = null, password, sourceIp }) {
    if (!mail.enabled) throw failure('邮件功能尚未配置，请联系管理员', 503, 'EMAIL_UNAVAILABLE');
    const email = normalizeEmail(rawEmail);
    const challenge = db.transaction(() => {
      const time = at();
      const hourAgo = new Date(Date.now() - 3600000).toISOString();
      const latest = db.prepare('SELECT created_at FROM auth_email_challenges WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(email);
      const emailCount = db.prepare('SELECT count(*) n FROM auth_email_challenges WHERE email = ? AND created_at > ?').get(email, hourAgo).n;
      const ipCount = db.prepare('SELECT count(*) n FROM auth_email_challenges WHERE source_ip = ? AND created_at > ?').get(sourceIp, hourAgo).n;
      if ((latest && Date.now() - Date.parse(latest.created_at) < 60000) || emailCount >= 5 || ipCount >= 20) {
        throw failure('请求过于频繁，请稍后再试', 429, 'CODE_RATE_LIMITED');
      }
      let user;
      if (purpose === 'bind') {
        user = currentUser(userId);
        if (!user?.is_active || !auth.verifyPassword(password, user.password_hash)) throw failure('当前密码不正确');
        if (db.prepare('SELECT id FROM users WHERE verified_email = ? AND id != ?').get(email, userId)) throw failure('此邮箱无法绑定');
      } else {
        user = db.prepare('SELECT * FROM users WHERE verified_email = ? AND is_active = 1').get(email);
      }
      const id = crypto.randomUUID();
      const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
      // Invalidate both sent and in-flight challenges before reserving the send.
      db.prepare("UPDATE auth_email_challenges SET status = 'consumed' WHERE email = ? AND purpose = ? AND status IN ('pending', 'sent')").run(email, purpose);
      db.prepare(`INSERT INTO auth_email_challenges
        (id, purpose, email, user_id, session_version, source_ip, code_digest, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
        .run(id, purpose, email, user?.id || null, user?.session_version ?? null, sourceIp,
          digest(id, code), time, new Date(Date.now() + 600000).toISOString());
      return { id, code, userId: user?.id || null };
    })();

    const delivery = (async () => {
      try {
        if (challenge.userId) await mail.sendCode(email, challenge.code, purpose);
        db.transaction(() => {
          db.prepare("UPDATE auth_email_challenges SET status = ? WHERE id = ? AND status = 'pending'")
            .run(challenge.userId ? 'sent' : 'failed', challenge.id);
          audit(userId, `email.${purpose}.send`, challenge.userId, challenge.userId ? 'sent' : 'ignored');
        })();
      } catch (_) {
        db.prepare("UPDATE auth_email_challenges SET status = 'failed' WHERE id = ? AND status = 'pending'").run(challenge.id);
        audit(userId, `email.${purpose}.send`, challenge.userId, 'failed');
        throw failure('邮件发送失败，请稍后重试', 503, 'EMAIL_SEND_FAILED');
      }
    })();
    return { delivery };
  }

  function confirm({ purpose, email: rawEmail, code, userId = null, password, newPassword }) {
    const email = normalizeEmail(rawEmail);
    if (purpose === 'reset') auth.validateNewPassword(newPassword);
    // Return failures from the transaction so invalid attempts remain committed.
    const result = db.transaction(() => {
      const challenge = db.prepare(`SELECT * FROM auth_email_challenges
        WHERE email = ? AND purpose = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(email, purpose);
      const invalid = () => ({ error: failure('验证码无效或已过期，请重新获取') });
      if (!challenge || challenge.status !== 'sent' || challenge.expires_at <= at() || challenge.attempts >= 5) return invalid();
      if (purpose === 'bind' && challenge.user_id !== userId) return invalid();
      db.prepare('UPDATE auth_email_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id);
      if (!/^\d{6}$/.test(String(code || '')) || !crypto.timingSafeEqual(Buffer.from(challenge.code_digest, 'hex'), Buffer.from(digest(challenge.id, code), 'hex'))) return invalid();
      const user = currentUser(challenge.user_id);
      if (!user?.is_active || user.session_version !== challenge.session_version) return invalid();
      if (purpose === 'bind') {
        if (!auth.verifyPassword(password, user.password_hash)) return { error: failure('当前密码不正确') };
        if (db.prepare('SELECT id FROM users WHERE verified_email = ? AND id != ?').get(email, userId)) return { error: failure('此邮箱无法绑定') };
        db.prepare('UPDATE users SET verified_email = ?, updated_at = ? WHERE id = ?').run(email, at(), userId);
        // Codes sent to the previous address cannot recover this account anymore.
        db.prepare("UPDATE auth_email_challenges SET status = 'consumed' WHERE user_id = ? AND purpose = 'reset'").run(userId);
      } else {
        if (user.verified_email !== email) return invalid();
        auth.replacePassword(db, user.id, newPassword);
      }
      db.prepare("UPDATE auth_email_challenges SET status = 'consumed' WHERE id = ?").run(challenge.id);
      audit(user.id, purpose === 'bind' ? 'user.email.bind' : 'user.password.reset', user.id, 'success');
      return { success: true };
    })();
    if (result.error) {
      audit(userId, `email.${purpose}.confirm`, userId, 'rejected');
      throw result.error;
    }
  }

  function adminReset(actorId, targetId) {
    return db.transaction(() => {
      const user = currentUser(targetId);
      if (!user || user.role !== 'user' || user.console_access || user.account_kind !== 'creator') throw failure('只能重置创作账号的密码', 403);
      const password = crypto.randomBytes(12).toString('base64url');
      const expiresAt = auth.replacePassword(db, targetId, password, true);
      audit(actorId, 'user.password.admin_reset', targetId, 'success');
      return { temporary_password: password, expires_at: expiresAt };
    })();
  }

  return { requestCode, confirm, adminReset };
}

module.exports = { createPasswordRecoveryService };
