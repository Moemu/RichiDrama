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
  const adapter = new WechatAdapter({ app_id: 'wx-app', mch_id: 'mch-1', merchant_serial_no: 'serial', merchant_private_key: merchant.privateKey, platform_public_key: platform.publicKey, api_v3_key: apiKey }, 'https://example.test/wechat');
  const plaintext = JSON.stringify({ appid: 'wx-app', mchid: 'mch-1', out_trade_no: 'R456', transaction_id: 'WX456', trade_state: 'SUCCESS', amount: { total: 1000, currency: 'CNY' } });
  const resourceNonce = '123456789012'; const associated = 'transaction';
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(apiKey), Buffer.from(resourceNonce));
  cipher.setAAD(Buffer.from(associated));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]).toString('base64');
  const body = { id: 'event-wx-1', resource: { nonce: resourceNonce, associated_data: associated, ciphertext } };
  const raw = JSON.stringify(body); const ts = Math.floor(Date.now() / 1000).toString(); const n = 'notify-nonce';
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${ts}\n${n}\n${raw}\n`), platform.privateKey).toString('base64');
  const result = adapter.verifyNotification({ body, rawBody: Buffer.from(raw), headers: { 'wechatpay-timestamp': ts, 'wechatpay-nonce': n, 'wechatpay-signature': signature } });
  assert.equal(result.state, 'paid');
  assert.equal(result.amount_fen, 1000);
  assert.throws(() => adapter.verifyNotification({ body, rawBody: Buffer.from(raw + ' '), headers: { 'wechatpay-timestamp': ts, 'wechatpay-nonce': n, 'wechatpay-signature': signature } }), /验签失败/);
});
