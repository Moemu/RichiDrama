import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const app = read('../src/App.vue')
const panel = read('../src/components/ProviderPriceSyncPanel.vue')
const admin = read('../src/views/AdminConsole.vue')
const api = read('../src/api/account.js')

test('protected pages use one persistent acknowledgement banner', () => {
  assert.match(app, /route\.meta\.public/)
  assert.match(app, /\/notices\/active/)
  assert.match(app, /\/notices\/\$\{noticeId\}\/acknowledge/)
  assert.match(app, /class="price-notice-banner"/)
  assert.doesNotMatch(app, /position\s*:\s*fixed/)
})

test('price sync remains manual and exposes review, publish, and archive controls', () => {
  assert.match(panel, /系统不会自动发布价格/)
  assert.match(panel, /权限诊断/)
  assert.match(panel, /生成价目草稿/)
  assert.match(panel, /确认发布/)
  assert.match(panel, /确认历史仍会保留/)
  assert.match(panel, /conditionSummary/)
  assert.match(panel, /条件价/)
  assert.match(panel, /providerPriceSyncs\(\{ limit: 1 \}\)/)
  assert.match(panel, /当前生效价目 → 最新火山账户价/)
  assert.doesNotMatch(panel, /v-for="item in syncs"/)
  assert.doesNotMatch(panel, /join\('；'\)/)
  assert.match(panel, /class="provider-price-value"/)
  assert.match(panel, /overflow-wrap:anywhere/)
  assert.match(api, /provider-prices\/volcengine\/sync/)
  assert.match(api, /price-books\/\$\{id\}\/publish/)
  assert.match(api, /admin\/notices\/\$\{id\}\/archive/)
  assert.match(admin, /book\.status === 'draft'/)
  assert.match(admin, /book\.status === 'archived'/)
  assert.match(admin, /has_image_input: '图片输入'/)
})
