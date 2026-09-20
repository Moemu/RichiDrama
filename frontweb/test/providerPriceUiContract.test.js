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
  assert.match(panel, /providerPriceSyncs\(\{ limit: 1, provider: provider\.value \}\)/)
  assert.match(panel, /最新\{\{ sourceLabel \}\}价/)
  assert.match(panel, /:label="`\$\{sourceLabel\}模型`"/)
  assert.doesNotMatch(panel, /火山/)
  assert.doesNotMatch(panel, /v-for="item in syncs"/)
  assert.doesNotMatch(panel, /join\('；'\)/)
  assert.match(panel, /class="provider-price-value"/)
  assert.match(panel, /overflow-wrap:anywhere/)
  assert.match(api, /admin\/provider-price-sources/)
  assert.match(api, /\/admin\/provider-prices\/\$\{encodeURIComponent\(provider\)\}\/sync/)
  assert.match(api, /price-books\/\$\{id\}\/publish/)
  assert.match(api, /admin\/notices\/\$\{id\}\/archive/)
  assert.match(admin, /book\.status === 'draft'/)
  assert.match(admin, /book\.status === 'archived'/)
  assert.match(admin, /has_image_input: '图片输入'/)
})

test('the price source switcher comes from the backend and gates Ark-only copy', () => {
  assert.match(panel, /const sources = ref\(\[\]\); const provider = ref\('volcengine'\)/)
  // 来源清单拿不到时只退回单一来源，不能连带遮住同步批次与通知
  assert.match(panel, /adminAPI\.providerPriceSources\(\)\.catch\(\(\) => \[\]\)/)
  assert.match(panel, /v-if="sources\.length > 1" v-model="provider"[^>]*@change="switchSource"/)
  // 方舟权限诊断只属于需要它的来源，中转来源没有 IAM 诊断
  assert.match(panel, /const supportsProbe = computed\(\(\) => currentSource\.value\?\.requires_source_check !== false\)/)
  assert.match(panel, /v-if="supportsProbe" :loading="probing"/)
  assert.match(panel, /v-if="supportsProbe && probeResult"/)
  assert.match(panel, /supportsProbe\.value \? adminAPI\.providerPriceProbeStatus\(provider\.value\) : Promise\.resolve\(null\)/)
  assert.match(panel, /审核并发布\$\{sourceLabel\.value\}价目同步批次/)
})
