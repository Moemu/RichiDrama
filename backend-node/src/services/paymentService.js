const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { AlipayAdapter } = require('./paymentAdapters/alipayAdapter');
const { WechatAdapter } = require('./paymentAdapters/wechatAdapter');

const CREDIT_MICRO_PER_FEN = 10000;
function now() { return new Date().toISOString(); }
function json(value) { return JSON.stringify(value == null ? {} : value); }
function parse(value, fallback = {}) { try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } }

function paymentConfig(cfg) {
  const raw = cfg?.payments || {};
  return {
    ...raw,
    enabled: raw.enabled === true,
    order_expire_minutes: Math.max(1, Math.min(120, Number(raw.order_expire_minutes) || 15)),
    min_amount_fen: Number(raw.min_amount_fen) || 100,
    max_amount_fen: Number(raw.max_amount_fen) || 500000,
    preset_amounts_fen: Array.isArray(raw.preset_amounts_fen) ? raw.preset_amounts_fen.map(Number).filter(Number.isSafeInteger) : [1000, 5000, 10000, 50000],
  };
}

function channelReady(config, channel) {
  if (!config.enabled || !/^https:\/\//i.test(String(config.public_base_url || ''))) return false;
  if (channel === 'alipay') {
    const row = config.alipay || {};
    return row.enabled === true && ['app_id', 'app_private_key', 'alipay_public_key', 'seller_id'].every((key) => String(row[key] || '').trim());
  }
  if (channel === 'wechat') {
    const row = config.wechat || {};
    return row.enabled === true && ['app_id', 'mch_id', 'merchant_serial_no', 'merchant_private_key', 'api_v3_key', 'platform_public_key'].every((key) => String(row[key] || '').trim());
  }
  return false;
}

function parseAmountFen(value, config) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error('充值金额最多支持两位小数');
  const [whole, fraction = ''] = raw.split('.');
  const amount = Number(BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2)));
  if (!Number.isSafeInteger(amount) || amount < config.min_amount_fen || amount > config.max_amount_fen) {
    throw new Error(`充值金额必须为 ${(config.min_amount_fen / 100).toFixed(2)}–${(config.max_amount_fen / 100).toFixed(2)} 元`);
  }
  return amount;
}

function orderNumber() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `R${stamp}${crypto.randomBytes(6).toString('hex')}`;
}

function publicOrder(row, includeCode = false) {
  if (!row) return null;
  return {
    id: row.id, out_trade_no: row.out_trade_no, user_id: row.user_id,
    channel: row.channel, amount_fen: row.amount_fen, amount_yuan: (row.amount_fen / 100).toFixed(2),
    credits: row.credits_micro / 10000, status: row.status,
    provider_trade_no: row.provider_trade_no || null,
    code_url: includeCode && row.status === 'pending' ? row.code_url : undefined,
    expires_at: row.expires_at, paid_at: row.paid_at, closed_at: row.closed_at,
    failure_code: row.failure_code || null, failure_message: row.failure_message || null,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function createPaymentService(db, cfg, log, overrides = {}) {
  const config = paymentConfig(cfg);
  const base = String(config.public_base_url || '').replace(/\/$/, '');
  const adapters = {
    alipay: overrides.alipay || (channelReady(config, 'alipay') ? new AlipayAdapter(config.alipay, `${base}/api/v1/payments/callbacks/alipay`) : null),
    wechat: overrides.wechat || (channelReady(config, 'wechat') ? new WechatAdapter(config.wechat, `${base}/api/v1/payments/callbacks/wechat`) : null),
  };

  function options(userId) {
    const organization = require('./customerOrganizationService').membershipForUser(db, userId);
    return {
      enabled: config.enabled,
      personal_recharge_allowed: !organization,
      blocked_reason: organization ? '企业成员使用共享额度，不能充值个人账户。' : null,
      channels: ['alipay', 'wechat'].map((id) => ({ id, enabled: !!adapters[id] })),
      preset_amounts_yuan: config.preset_amounts_fen.map((value) => (value / 100).toFixed(2)),
      min_amount_yuan: (config.min_amount_fen / 100).toFixed(2),
      max_amount_yuan: (config.max_amount_fen / 100).toFixed(2),
      credits_per_yuan: 100,
      order_expire_minutes: config.order_expire_minutes,
    };
  }

  function assertPersonal(userId) {
    if (require('./customerOrganizationService').membershipForUser(db, userId)) throw new Error('企业成员使用共享额度，不能充值个人账户');
  }

  function find(id) { return db.prepare('SELECT * FROM payment_orders WHERE id=?').get(String(id)) || null; }
  function findByTradeNo(value) { return db.prepare('SELECT * FROM payment_orders WHERE out_trade_no=?').get(String(value)) || null; }

  function event(order, channel, result, signatureValid, eventType) {
    try {
      db.prepare(`INSERT OR IGNORE INTO payment_order_events
        (id,payment_order_id,channel,provider_event_id,event_type,signature_valid,detail_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(uuid(), order?.id || null, channel, result?.event_id || null, eventType,
          signatureValid ? 1 : 0, json({ state: result?.state || null, provider_status: result?.provider_status || null, amount_fen: result?.amount_fen || null }), now());
    } catch (error) { log?.warn?.('payment event write failed', { channel, error: error.message }); }
  }

  function expected(channel, result, order) {
    const channelCfg = config[channel] || {};
    return Number(result.amount_fen) === order.amount_fen && result.currency === 'CNY'
      && String(result.app_id || '') === String(channelCfg.app_id || '')
      && String(result.merchant_id || '') === String(channel === 'wechat' ? channelCfg.mch_id : channelCfg.seller_id);
  }

  function markReview(order, result, message) {
    db.prepare(`UPDATE payment_orders SET status='review_required',provider_trade_no=COALESCE(?,provider_trade_no),
      failure_code='PAYMENT_MISMATCH',failure_message=?,updated_at=? WHERE id=? AND status<>'paid'`)
      .run(result.provider_trade_no || null, message, now(), order.id);
    event(order, order.channel, result, true, 'review_required');
    return publicOrder(find(order.id), true);
  }

  function credit(order, result) {
    if (order.status === 'paid') return publicOrder(order, true);
    if (!expected(order.channel, result, order)) return markReview(order, result, '渠道返回的应用、商户、币种或金额与本地订单不一致');
    const at = now(); const ledgerKey = `payment:${order.id}`;
    db.transaction(() => {
      const current = find(order.id);
      if (!current || current.status === 'paid') return;
      const prior = db.prepare('SELECT id FROM billing_transactions WHERE user_id=? AND idempotency_key=?').get(current.user_id, ledgerKey);
      const acct = require('./billingService').account(db, current.user_id);
      if (!prior) {
        const balanceAfter = acct.balance_micro + current.credits_micro;
        const rechargedAfter = acct.total_recharged_micro + current.credits_micro;
        if (!Number.isSafeInteger(balanceAfter) || !Number.isSafeInteger(rechargedAfter)) throw new Error('充值后余额超出安全范围');
        db.prepare('UPDATE billing_accounts SET balance_micro=?,total_recharged_micro=?,updated_at=? WHERE user_id=?')
          .run(balanceAfter, rechargedAfter, at, current.user_id);
        db.prepare(`INSERT INTO billing_transactions
          (id,user_id,tenant_id,type,amount_micro,balance_after_micro,frozen_after_micro,idempotency_key,reference_type,reference_id,reason,snapshot_json,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(uuid(), current.user_id,
            require('./tenantService').tenantForUser(db, current.user_id)?.id || null, 'recharge', current.credits_micro,
            balanceAfter, acct.frozen_micro, ledgerKey, 'payment_order', current.id, `${current.channel === 'alipay' ? '支付宝' : '微信'}充值到账`,
            json({ payment_order_id: current.id, out_trade_no: current.out_trade_no, channel: current.channel, amount_fen: current.amount_fen }), at);
      }
      db.prepare(`UPDATE payment_orders SET status='paid',provider_trade_no=COALESCE(?,provider_trade_no),code_url=NULL,
        paid_at=COALESCE(paid_at,?),failure_code=NULL,failure_message=NULL,updated_at=? WHERE id=?`)
        .run(result.provider_trade_no || null, at, at, current.id);
    })();
    require('./billingService').audit(db, order.user_id, 'payment.recharge.paid', 'payment_order', order.id, { channel: order.channel, amount_fen: order.amount_fen });
    return publicOrder(find(order.id), true);
  }

  async function create(user, input) {
    if (!config.enabled) throw new Error('充值功能暂未开放');
    assertPersonal(user.id);
    const channel = String(input.channel || '');
    const adapter = adapters[channel];
    if (!adapter) throw new Error('该支付渠道暂未开放');
    const clientRequestId = String(input.client_request_id || '').trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(clientRequestId)) throw new Error('client_request_id 格式无效');
    const existing = db.prepare('SELECT * FROM payment_orders WHERE user_id=? AND client_request_id=?').get(user.id, clientRequestId);
    if (existing) return publicOrder(existing, true);
    const amountFen = parseAmountFen(input.amount_yuan, config);
    const at = now(); const expiresAt = new Date(Date.now() + config.order_expire_minutes * 60000).toISOString();
    const order = { id: uuid(), out_trade_no: orderNumber(), user_id: user.id, channel, amount_fen: amountFen, credits_micro: amountFen * CREDIT_MICRO_PER_FEN, status: 'pending', client_request_id: clientRequestId, expires_at: expiresAt, created_at: at, updated_at: at };
    db.prepare(`INSERT INTO payment_orders (id,out_trade_no,user_id,channel,amount_fen,credits_micro,status,client_request_id,expires_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(order.id, order.out_trade_no, order.user_id, order.channel, order.amount_fen, order.credits_micro, order.status, order.client_request_id, order.expires_at, at, at);
    try {
      const result = await adapter.createNativeOrder(order);
      if (!result?.code_url) throw new Error('支付渠道未返回二维码');
      db.prepare('UPDATE payment_orders SET code_url=?,provider_trade_no=?,updated_at=? WHERE id=?')
        .run(result.code_url, result.provider_trade_no || null, now(), order.id);
      event(order, channel, result, true, 'created');
    } catch (error) {
      db.prepare("UPDATE payment_orders SET status='failed',failure_code=?,failure_message=?,updated_at=? WHERE id=?")
        .run(error.code || 'CREATE_FAILED', String(error.message || '渠道下单失败').slice(0, 500), now(), order.id);
      throw error;
    }
    return publicOrder(find(order.id), true);
  }

  function getForUser(id, user) {
    const row = find(id);
    if (!row || (row.user_id !== user.id && user.role !== 'admin')) return null;
    return publicOrder(row, true);
  }

  function list(filters = {}, admin = false) {
    const page = Math.max(1, Number(filters.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(filters.page_size) || 20));
    let where = 'WHERE 1=1'; const params = [];
    if (!admin || filters.user_id) { where += ' AND p.user_id=?'; params.push(Number(filters.user_id)); }
    if (filters.channel) { where += ' AND p.channel=?'; params.push(String(filters.channel)); }
    if (filters.status) { where += ' AND p.status=?'; params.push(String(filters.status)); }
    if (filters.keyword) { where += ' AND (p.out_trade_no LIKE ? OR p.provider_trade_no LIKE ? OR u.username LIKE ?)'; const term = `%${String(filters.keyword).slice(0, 80)}%`; params.push(term, term, term); }
    const total = db.prepare(`SELECT COUNT(*) count FROM payment_orders p JOIN users u ON u.id=p.user_id ${where}`).get(...params).count;
    const rows = db.prepare(`SELECT p.*,u.username,u.display_name FROM payment_orders p JOIN users u ON u.id=p.user_id ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize).map((row) => ({ ...publicOrder(row, false), username: row.username, display_name: row.display_name }));
    return { items: rows, page, page_size: pageSize, total };
  }

  async function sync(id, actor, force = false) {
    const order = find(id);
    if (!order || (!force && order.user_id !== actor.id && actor.role !== 'admin')) return null;
    if (order.status !== 'pending') return publicOrder(order, true);
    if (!force && order.last_query_at && Date.now() - Date.parse(order.last_query_at) < 10000) return publicOrder(order, true);
    const adapter = adapters[order.channel]; if (!adapter) throw new Error('支付渠道未配置');
    db.prepare('UPDATE payment_orders SET last_query_at=?,updated_at=? WHERE id=?').run(now(), now(), order.id);
    const result = await adapter.queryOrder(order);
    event(order, order.channel, result, true, 'query');
    if (result.state === 'paid') return credit(order, result);
    if (result.state === 'closed') db.prepare("UPDATE payment_orders SET status='closed',code_url=NULL,closed_at=?,updated_at=? WHERE id=? AND status='pending'").run(now(), now(), order.id);
    return publicOrder(find(order.id), true);
  }

  async function close(id, actor, force = false) {
    let order = find(id);
    if (!order || (!force && order.user_id !== actor.id && actor.role !== 'admin')) return null;
    if (order.status !== 'pending') return publicOrder(order, true);
    const checked = await sync(order.id, actor, true); if (checked?.status === 'paid') return checked;
    order = find(order.id); if (order.status !== 'pending') return publicOrder(order, true);
    const adapter = adapters[order.channel]; if (!adapter) throw new Error('支付渠道未配置');
    await adapter.closeOrder(order);
    const status = Date.parse(order.expires_at) <= Date.now() ? 'expired' : 'closed';
    db.prepare(`UPDATE payment_orders SET status=?,code_url=NULL,closed_at=?,updated_at=? WHERE id=? AND status='pending'`).run(status, now(), now(), order.id);
    event(order, order.channel, { state: status }, true, status);
    return publicOrder(find(order.id), true);
  }

  function notify(channel, request) {
    const adapter = adapters[channel]; if (!adapter) throw Object.assign(new Error('支付渠道未配置'), { status: 503 });
    const result = adapter.verifyNotification(request);
    const order = findByTradeNo(result.out_trade_no);
    if (!order || order.channel !== channel) throw Object.assign(new Error('支付订单不存在'), { status: 404 });
    event(order, channel, result, true, 'notification');
    if (result.state === 'paid') return credit(order, result);
    if (result.state === 'closed' && order.status === 'pending') db.prepare("UPDATE payment_orders SET status='closed',code_url=NULL,closed_at=?,updated_at=? WHERE id=?").run(now(), now(), order.id);
    return publicOrder(find(order.id), true);
  }

  async function recover(limit = 50) {
    if (!config.enabled) return { processed: 0 };
    const orders = db.prepare("SELECT id,user_id FROM payment_orders WHERE status='pending' ORDER BY COALESCE(last_query_at,created_at) LIMIT ?").all(Math.min(100, Math.max(1, limit)));
    let processed = 0; let failed = 0;
    for (const item of orders) {
      try {
        const result = await sync(item.id, { id: item.user_id, role: 'admin' }, true);
        const current = find(item.id);
        if (result?.status === 'pending' && Date.parse(current.expires_at) <= Date.now()) await close(item.id, { id: item.user_id, role: 'admin' }, true);
        processed += 1;
      } catch (error) { failed += 1; log?.warn?.('payment recovery failed', { payment_order_id: item.id, error: error.message }); }
    }
    return { processed, failed };
  }

  return { config, adapters, options, create, getForUser, list, sync, close, notify, recover, find, credit, parseAmountFen: (value) => parseAmountFen(value, config) };
}

module.exports = { createPaymentService, parseAmountFen, paymentConfig, publicOrder, CREDIT_MICRO_PER_FEN };
