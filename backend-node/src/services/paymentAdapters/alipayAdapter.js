const { AlipaySdk } = require('alipay-sdk');

function secret(value) {
  const raw = String(value || '').trim().replace(/\\n/g, '\n');
  if (!raw || raw.includes('-----BEGIN')) return raw;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
    return decoded.includes('-----BEGIN') ? decoded : raw;
  } catch (_) { return raw; }
}

function value(row, snake, camel) { return row?.[snake] ?? row?.[camel]; }

class AlipayAdapter {
  constructor(config, notifyUrl) {
    this.config = config || {};
    this.notifyUrl = notifyUrl;
    this.sdk = new AlipaySdk({
      appId: this.config.app_id,
      privateKey: secret(this.config.app_private_key),
      alipayPublicKey: secret(this.config.alipay_public_key),
      gateway: this.config.endpoint || 'https://openapi.alipay.com/gateway.do',
      keyType: this.config.key_type === 'PKCS1' ? 'PKCS1' : 'PKCS8',
      signType: 'RSA2',
    });
  }

  async createNativeOrder(order) {
    const result = await this.sdk.exec('alipay.trade.precreate', {
      notifyUrl: this.notifyUrl,
      bizContent: {
        out_trade_no: order.out_trade_no,
        total_amount: (order.amount_fen / 100).toFixed(2),
        subject: `瑞池短剧积分充值 ${order.amount_fen / 100}元`,
        timeout_express: '15m',
      },
    });
    if (String(result.code) !== '10000' || !value(result, 'qr_code', 'qrCode')) {
      const error = new Error(result.sub_msg || result.subMsg || result.msg || '支付宝下单失败');
      error.code = result.sub_code || result.subCode || result.code || 'ALIPAY_CREATE_FAILED';
      throw error;
    }
    return { state: 'pending', code_url: value(result, 'qr_code', 'qrCode'), provider_trade_no: value(result, 'trade_no', 'tradeNo') || null };
  }

  async queryOrder(order) {
    const result = await this.sdk.exec('alipay.trade.query', { bizContent: { out_trade_no: order.out_trade_no } });
    const tradeStatus = value(result, 'trade_status', 'tradeStatus');
    if (String(result.code) !== '10000') return { state: 'pending', provider_status: result.sub_code || result.subCode || result.code };
    return {
      state: ['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(tradeStatus) ? 'paid' : tradeStatus === 'TRADE_CLOSED' ? 'closed' : 'pending',
      provider_status: tradeStatus,
      provider_trade_no: value(result, 'trade_no', 'tradeNo') || null,
      amount_fen: Math.round(Number(value(result, 'total_amount', 'totalAmount')) * 100),
      currency: 'CNY',
      app_id: this.config.app_id,
      merchant_id: this.config.seller_id,
    };
  }

  async closeOrder(order) {
    const result = await this.sdk.exec('alipay.trade.close', { bizContent: { out_trade_no: order.out_trade_no } });
    return { closed: String(result.code) === '10000' || ['ACQ.TRADE_NOT_EXIST', 'ACQ.TRADE_STATUS_ERROR'].includes(result.sub_code || result.subCode) };
  }

  verifyNotification({ body }) {
    if (!this.sdk.checkNotifySignV2(body || {})) throw Object.assign(new Error('支付宝通知验签失败'), { status: 401, code: 'INVALID_SIGNATURE' });
    const tradeStatus = body.trade_status;
    return {
      event_id: body.notify_id || null,
      out_trade_no: body.out_trade_no,
      provider_trade_no: body.trade_no || null,
      state: ['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(tradeStatus) ? 'paid' : tradeStatus === 'TRADE_CLOSED' ? 'closed' : 'pending',
      provider_status: tradeStatus,
      amount_fen: Math.round(Number(body.total_amount) * 100),
      currency: 'CNY',
      app_id: body.app_id,
      merchant_id: body.seller_id,
    };
  }
}

module.exports = { AlipayAdapter, secret };
