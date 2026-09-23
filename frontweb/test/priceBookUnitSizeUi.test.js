import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = () => readFile(new URL('../src/views/AdminConsole.vue', import.meta.url), 'utf8')

test('价目草稿提供计价单位数量输入，并说明填法', async () => {
  const admin = await source()
  assert.match(admin, /v-model="item\.unit_size"[^>]*aria-label="计价单位数量"/)
  assert.match(admin, /每累计多少计量单位收一次单价/)
  assert.match(admin, /毫秒计量按每分钟收费时填 <code>60000<\/code>/)
  assert.match(admin, /<div class="price-item price-item-head">/, '缺少与网格对齐的列标题')
})

test('保存价目时只增删 unit_size，其它计价条件原样保留', async () => {
  const admin = await source()
  const helper = admin.match(/function itemConditions\(item\) \{[^}]*\}[^}]*\}/)
  assert.ok(helper, '缺少 itemConditions()')
  const body = helper[0]
  assert.match(body, /\{ \.\.\.priceConditions\(item\) \}/, '必须从既有 conditions_json 复制，不能重建')
  assert.match(body, /if \(size === 1\) delete conditions\.unit_size; else conditions\.unit_size = size/)
  assert.match(admin, /const \{ unit_size, \.\.\.rest \} = item/, 'unit_size 是界面字段，不能提交给后端')
})

test('编辑既有草稿时单位数量回填自 conditions_json', async () => {
  const admin = await source()
  assert.match(admin, /unit_size: Number\(priceConditions\(item\)\.unit_size \|\| 1\)/)
  assert.match(admin, /计价单位数量必须是正整数/, '保存前必须拦住非法值')
})
