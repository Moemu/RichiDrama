const crypto = require('crypto');
const { secret } = require('./alipayAdapter');

function nonce() { return crypto.randomBytes(16).toString('hex'); }
function timestamp() { return Math.floor(Date.now() / 1000).toString(); }

class WechatAdapter {
  constructor(config, notifyUrl) {
    this.config = config || {};
    this.notifyUrl = notifyUrl;
    this.baseUrl = this.config.base_url || 'https://api.mch.weixin.qq.com';
  }

  privateKey() { return secret(this.config.merchant_private_key); }
  publicKey() { return secret(this.config.platform_public_key); }

  authorization(method, requestPath, body) {
    const ts = timestamp(); const n = nonce();
    const message = `${method}\n${requestPath}\n${ts}\n${n}\n${body}\n`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(message), this.privateKey()).toString('base64');
    return `WECHATPAY2-SHA256-RSA2048 mchid="${this.config.mch_id}",nonce_str="${n}",timestamp="${ts}",serial_no="${this.config.merchant_serial_no}",signature="${signature}"`;
  }

  verifySignature(headers, rawBody) {
    const ts = String(headers['wechatpay-timestamp'] || '');
    const n = String(headers['wechatpay-nonce'] || '');
    const signature = String(headers['wechatpay-signature'] || '');
    if (!ts || !n || !signature || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
    return crypto.verify('RSA-SHA256', Buffer.from(`${ts}\n${n}\n${rawBody}\n`), this.publicKey(), Buffer.from(signature, 'base64'));
  }

  async request(method, requestPath, input) {
    const body = input == null ? '' : JSON.stringify(input);
    const response = await fetch(this.baseUrl + requestPath, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: this.authorization(method, requestPath, body) },
      body: body || undefined,
    });
    const raw = await response.text();
    const headers = Object.fromEntries(response.headers.entries());
    const responseSignature = headers['wechatpay-signature'];
    if (this.publicKey() && responseSignature && !this.verifySignature(headers, raw)) {
      throw Object.assign(new Error('微信支付响应验签失败'), { code: 'WECHAT_RESPONSE_SIGNATURE_INVALID' });
    }
    if (this.publicKey() && raw && !responseSignature) {
      throw Object.assign(new Error('微信支付响应缺少签名'), { code: 'WECHAT_RESPONSE_SIGNATURE_MISSING' });
    }
    let data = {}; try { data = raw ? JSON.parse(raw) : {}; } catch (_) {}
    if (!response.ok) throw Object.assign(new Error(data.message || '微信支付接口失败'), { code: data.code || `WECHAT_HTTP_${response.status}` });
    return data;
  }

  async createNativeOrder(order) {
    const data = await this.request('POST', '/v3/pay/transactions/native', {
      appid: this.config.app_id,
      mchid: this.config.mch_id,
      description: `瑞池短剧积分充值 ${order.amount_fen / 100}元`,
      out_trade_no: order.out_trade_no,
      time_expire: order.expires_at.replace('.000Z', '+00:00'),
      notify_url: this.notifyUrl,
      amount: { total: order.amount_fen, currency: 'CNY' },
    });
    return { state: 'pending', code_url: data.code_url };
  }

  async queryOrder(order) {
    const data = await this.request('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.out_trade_no)}?mchid=${encodeURIComponent(this.config.mch_id)}`);
    return {
      state: data.trade_state === 'SUCCESS' ? 'paid' : ['CLOSED', 'REVOKED', 'PAYERROR'].includes(data.trade_state) ? 'closed' : 'pending',
      provider_status: data.trade_state,
      provider_trade_no: data.transaction_id || null,
      amount_fen: Number(data.amount?.total), currency: data.amount?.currency,
      app_id: data.appid, merchant_id: data.mchid,
    };
  }

  async closeOrder(order) {
    await this.request('POST', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.out_trade_no)}/close`, { mchid: this.config.mch_id });
    return { closed: true };
  }

  decryptResource(resource) {
    const key = Buffer.from(String(this.config.api_v3_key || ''), 'utf8');
    if (key.length !== 32) throw new Error('微信 API v3 密钥必须为 32 字节');
    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
    decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));
    decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
    return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'));
  }

  verifyNotification({ headers, rawBody, body }) {
    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(body || {});
    if (!this.verifySignature(headers || {}, raw)) throw Object.assign(new Error('微信支付通知验签失败'), { status: 401, code: 'INVALID_SIGNATURE' });
    const data = this.decryptResource(body.resource || {});
    return {
      event_id: body.id || null,
      out_trade_no: data.out_trade_no,
      provider_trade_no: data.transaction_id || null,
      state: data.trade_state === 'SUCCESS' ? 'paid' : 'pending',
      provider_status: data.trade_state,
      amount_fen: Number(data.amount?.total), currency: data.amount?.currency,
      app_id: data.appid, merchant_id: data.mchid,
    };
  }
}

module.exports = { WechatAdapter };
