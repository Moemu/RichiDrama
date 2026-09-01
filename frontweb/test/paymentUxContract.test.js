import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('account center exposes guarded two-channel recharge flow', async () => {
  const [view, api] = await Promise.all([readSource('../src/views/AccountCenter.vue'), readSource('../src/api/account.js')])
  assert.match(view, /v:'recharge',label:'充值'/)
  assert.match(view, /paymentOptions\.blocked_reason/)
  assert.match(view, /paymentOptions\.preset_amounts_yuan/)
  assert.match(view, /channel\.id === 'alipay' \? '支付宝' : '微信支付'/)
  assert.match(view, /QRCode\.toDataURL/)
  assert.match(view, /paymentSyncCounter % 5 === 0/)
  assert.match(view, /lmd:balance-changed/)
  assert.match(api, /post\('\/payments\/orders'/)
  assert.match(api, /post\(`\/payments\/orders\/\$\{id\}\/sync`\)/)
})

test('operations console exposes read-only payment reconciliation actions', async () => {
  const [view, api] = await Promise.all([readSource('../src/views/AdminConsole.vue'), readSource('../src/api/account.js')])
  assert.match(view, /el-tab-pane label="充值订单"/)
  assert.match(view, /review_required/)
  assert.match(view, /主动查单/)
  assert.doesNotMatch(view, /payment-orders[^\n]{0,100}(退款|改为已支付)/)
  assert.match(api, /get\('\/admin\/payment-orders'/)
  assert.match(api, /post\(`\/admin\/payment-orders\/\$\{id\}\/sync`\)/)
})
