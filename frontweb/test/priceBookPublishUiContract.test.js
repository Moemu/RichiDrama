import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const consoleSource = () => readFile(new URL('../src/views/AdminConsole.vue', import.meta.url), 'utf8')
const apiSource = () => readFile(new URL('../src/api/account.js', import.meta.url), 'utf8')

test('价目表草稿有发布入口，已发布版本可复制为新版本', async () => {
  const admin = await consoleSource()
  assert.match(admin, /v-if="book\.status === 'draft'" link type="success" @click\.stop="publishPrice\(book\)">发布</, '草稿行缺少发布按钮')
  assert.match(admin, /v-if="book\.status === 'published'" link @click\.stop="clonePrice\(book\)">复制为新版本</, '已发布行缺少复制为新版本')
  assert.match(admin, /v-if="book\.system_managed && book\.status === 'archived'" link type="warning" @click\.stop="rollbackPrice\(book\)">回滚到此版本</, '回滚入口必须保留')
  assert.match(admin, /价目表" name="prices"[\s\S]{0,400}?新建价目草稿/, '价目表工具栏必须保留新建草稿入口')
})

test('发布走项目发布接口，带确认、原因与幂等键，并可通知用户', async () => {
  const admin = await consoleSource()
  const publish = admin.match(/async function publishPrice\(book\) \{[\s\S]*?\n\}/)
  assert.ok(publish, '缺少 publishPrice()')
  assert.match(publish[0], /adminAPI\.publishPriceBook\(book\.id, \{ confirm: true, reason:/)
  assert.match(publish[0], /idempotency_key: createClientRequestId\(`price-publish-\$\{book\.id\}`\)/)
  assert.match(publish[0], /notify_users: notifyUsers\.value/)
  assert.match(publish[0], /await loadGovernance\(\)/, '发布后必须刷新价目列表')
})

test('发布前列出待发布条目，并对同模型已发布版本给出改价提醒', async () => {
  const admin = await consoleSource()
  assert.match(admin, /function priceItemSummary\(item\)/, '缺少待发布条目摘要')
  assert.match(admin, /function conflictingBook\(book\)/, '缺少同模型已发布版本检查')
  assert.match(admin, /price-publish-preview/, '发布确认里必须列出计价项')
  assert.match(admin, /建议改用「复制为新版本」|改用「复制为新版本」/, '冲突提醒必须指向复制为新版本')
})

test('新建价目草稿可以标注供应商归属，留空即平台通用价目', async () => {
  const admin = await consoleSource()
  assert.match(admin, /供应商归属（选填）/)
  assert.match(admin, /v-model="price\.provider"/)
  assert.match(admin, /provider: price\.provider \|\| ''/, '保存草稿必须提交供应商归属')
  assert.match(admin, /provider: book\.provider \|\| ''/, '编辑草稿必须回填供应商归属')
})

test('复制新版本调用项目 API，且只对已发布版本开放', async () => {
  const api = await apiSource()
  assert.match(api, /clonePriceBook: \(id\) => request\.post\(`\/admin\/price-books\/\$\{id\}\/clone`\)/)
  const admin = await consoleSource()
  assert.match(admin, /await adminAPI\.clonePriceBook\(book\.id\)/)
  assert.match(admin, /if \(target\) openPrice\(target\)/, '复制后应直接打开草稿继续改价')
})
