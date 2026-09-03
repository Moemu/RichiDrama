const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { AlipayAdapter } = require('../src/services/paymentAdapters/alipayAdapter');
const { WechatAdapter } = require('../src/services/paymentAdapters/wechatAdapter');

function keyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

test('Alipay notification requires a valid RSA2 signature', () => {
  const app = keyPair(); const alipay = keyPair();
  const adapter = new AlipayAdapter({ app_id: 'app-1', seller_id: 'seller-1', app_private_key: app.privateKey, alipay_public_key: alipay.publicKey, key_type: 'PKCS8' }, 'https://example.test/alipay');
  const body = { app_id: 'app-1', seller_id: 'seller-1', out_trade_no: 'R123', trade_no: 'ALI123', total_amount: '10.00', trade_status: 'TRADE_SUCCESS', sign_type: 'RSA2' };
  const content = Object.keys(body).sort().map((key) => `${key}=${body[key]}`).join('&');
  body.sign = crypto.sign('RSA-SHA256', Buffer.from(content), alipay.privateKey).toString('base64');
  assert.equal(adapter.verifyNotification({ body }).state, 'paid');
  assert.throws(() => adapter.verifyNotification({ body: { ...body, total_amount: '11.00' } }), /验签失败/);
});

test('WeChat notification verifies the raw body and decrypts AES-GCM resource', () => {
  const merchant = keyPair(); const platform = keyPair();
  const apiKey = '12345678901234567890123456789012';
  const publicKeyId = 'PUB_KEY_ID_3000000001';
  const adapter = new WechatAdapter({ app_id: 'wx-app', mch_id: 'mch-1', merchant_serial_no: 'serial', merchant_private_key: merchant.privateKey, wechatpay_public_key_id: publicKeyId, wechatpay_public_key: platform.publicKey, api_v3_key: apiKey }, 'https://example.test/wechat');
  const plaintext = JSON.stringify({ appid: 'wx-app', mchid: 'mch-1', out_trade_no: 'R456', transaction_id: 'WX456', trade_state: 'SUCCESS', amount: { total: 1000, currency: 'CNY' } });
  const resourceNonce = '123456789012'; const associated = 'transaction';
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(apiKey), Buffer.from(resourceNonce));
  cipher.setAAD(Buffer.from(associated));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]).toString('base64');
  const body = { id: 'event-wx-1', resource: { nonce: resourceNonce, associated_data: associated, ciphertext } };
  const raw = JSON.stringify(body); const ts = Math.floor(Date.now() / 1000).toString(); const n = 'notify-nonce';
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${ts}\n${n}\n${raw}\n`), platform.privateKey).toString('base64');
  const headers = { 'wechatpay-timestamp': ts, 'wechatpay-nonce': n, 'wechatpay-signature': signature, 'wechatpay-serial': publicKeyId };
  const result = adapter.verifyNotification({ body, rawBody: Buffer.from(raw), headers });
  assert.equal(result.state, 'paid');
  assert.equal(result.amount_fen, 1000);
  assert.throws(() => adapter.verifyNotification({ body, rawBody: Buffer.from(raw + ' '), headers }), /验签失败/);
  assert.throws(() => adapter.verifyNotification({ body, rawBody: Buffer.from(raw), headers: { ...headers, 'wechatpay-serial': 'PUB_KEY_ID_9999999999' } }), /验签失败/);
});

test('WeChat requests identify the configured verification public key', async () => {
  const merchant = keyPair(); const platform = keyPair();
  const publicKeyId = 'PUB_KEY_ID_3000000001';
  const adapter = new WechatAdapter({ mch_id: 'mch-1', merchant_serial_no: 'merchant-serial', merchant_private_key: merchant.privateKey, wechatpay_public_key_id: publicKeyId, wechatpay_public_key: platform.publicKey }, 'https://example.test/wechat');
  const originalFetch = global.fetch;
  try {
    global.fetch = async (_url, options) => {
      assert.equal(options.headers['Wechatpay-Serial'], publicKeyId);
      return { ok: true, status: 200, headers: new Map(), text: async () => '' };
    };
    await adapter.request('POST', '/v3/pay/transactions/out-trade-no/R1/close', { mchid: 'mch-1' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('WeChat serializes a numeric merchant config value as a string identifier', async () => {
  const merchant = keyPair();
  const adapter = new WechatAdapter({ app_id: 'wx-app', mch_id: 1112440705, merchant_serial_no: 'merchant-serial', merchant_private_key: merchant.privateKey }, 'https://example.test/wechat');
  const originalFetch = global.fetch;
  try {
    global.fetch = async (_url, options) => {
      assert.equal(JSON.parse(options.body).mchid, '1112440705');
      assert.match(options.headers.Authorization, /mchid="1112440705"/);
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ code_url: 'weixin://wxpay/test' }) };
    };
    const result = await adapter.createNativeOrder({
      amount_fen: 1,
      out_trade_no: 'R1',
      expires_at: '2026-09-03T08:00:00.000Z',
    });
    assert.equal(result.code_url, 'weixin://wxpay/test');
  } finally {
    global.fetch = originalFetch;
  }
});

test('WeChat reports an unsigned provider error without accepting its response', async () => {
  const merchant = keyPair(); const platform = keyPair();
  const adapter = new WechatAdapter({ mch_id: 'mch-1', merchant_serial_no: 'merchant-serial', merchant_private_key: merchant.privateKey, wechatpay_public_key_id: 'PUB_KEY_ID_3000000001', wechatpay_public_key: platform.publicKey }, 'https://example.test/wechat');
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: false,
      status: 401,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ code: 'SIGN_ERROR', message: 'sign not match' }),
    });
    await assert.rejects(
      adapter.request('POST', '/v3/pay/transactions/native', { mchid: 'mch-1' }),
      (error) => error.code === 'WECHAT_UNSIGNED_HTTP_ERROR'
        && error.status === 502
        && error.providerStatus === 401
        && error.providerCode === 'SIGN_ERROR'
        && /HTTP 401/.test(error.message)
        && /SIGN_ERROR/.test(error.message)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('WeChat rejects an unsigned successful response', async () => {
  const merchant = keyPair(); const platform = keyPair();
  const adapter = new WechatAdapter({ mch_id: 'mch-1', merchant_serial_no: 'merchant-serial', merchant_private_key: merchant.privateKey, wechatpay_public_key_id: 'PUB_KEY_ID_3000000001', wechatpay_public_key: platform.publicKey }, 'https://example.test/wechat');
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ code_url: 'weixin://wxpay/test' }),
    });
    await assert.rejects(
      adapter.request('POST', '/v3/pay/transactions/native', { mchid: 'mch-1' }),
      (error) => error.code === 'WECHAT_RESPONSE_SIGNATURE_MISSING' && error.status === 502
    );
  } finally {
    global.fetch = originalFetch;
  }
});
