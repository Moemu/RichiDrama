import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { collectDisplayNames, modelLabel } from '../src/utils/modelDisplayNames.js'

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('瑞池中转作为可选厂商出现在文本/图片/分镜图/视频四类配置里', async () => {
  const source = await readSource('../src/components/AIConfigContent.vue')
  const entries = source.match(/\{ id: 'richbest', name: '瑞池中转 API（api\.richbest\.cn）' \}/g) || []
  assert.equal(entries.length, 4, '文本、图片、分镜图、视频各一条')
  assert.match(source, /richbest: 'richbest',/, '协议映射必须显式写 richbest，避免被按模型名猜成火山')
  assert.match(source, /if \(p === 'richbest'\) return 'https:\/\/api\.richbest\.cn\/v1'/)
  assert.match(source, /value="richbest"/, '接口规范下拉里要能选到中转协议')
})

test('中转视频端点预览用 /api/v3 任务路径，不使用已停用的 /v1/videos', async () => {
  const source = await readSource('../src/components/AIConfigContent.vue')
  assert.match(source, /p === 'richbest' \|\| proto === 'richbest'\) && service_type === 'video'/)
  assert.match(source, /submit: `\$\{root\}\/api\/v3\/contents\/generations\/tasks`/)
  assert.match(source, /query: `\$\{root\}\/api\/v3\/contents\/generations\/tasks\/\{taskId\}`/)
})

test('连接测试只提交 config_id，业务 Key 不出浏览器', async () => {
  const source = await readSource('../src/components/AIConfigContent.vue')
  const call = source.slice(source.indexOf('const summary = await aiAPI.testConnection({'), source.indexOf('const summary = await aiAPI.testConnection({') + 400)
  assert.match(call, /config_id: row\.id/)
  assert.doesNotMatch(call, /api_key/)
  assert.match(source, /本测试只读取模型目录，不产生费用/)
})

test('模型下拉显示目录展示名，提交值仍是模型 id', async () => {
  const settings = await readSource('../src/components/GenerationSettings.vue')
  assert.match(settings, /import \{ collectDisplayNames, modelLabel \} from '@\/utils\/modelDisplayNames'/)
  assert.match(settings, /return modelLabel\(modelNames\.value, model\)/)
  const dialog = await readSource('../src/components/ModelDiscoveryDialog.vue')
  assert.match(dialog, /found\?\.display_name \|\| id/, '导入时把供应商展示名一并提交')
  const api = await readSource('../src/api/modelDiscovery.js')
  assert.match(api, /display_names/)
})

test('展示名工具只影响显示，绝不改写提交值', () => {
  const names = collectDisplayNames([
    { model: ['doubao-seedance-2.0'], display_names: { 'doubao-seedance-2.0': 'Doubao Seedance 2.0', 'x': '' } },
    { model: ['glm-5.2'], display_names: { 'glm-5.2': 'glm-5.2' } },
  ])
  assert.deepEqual(names, { 'doubao-seedance-2.0': 'Doubao Seedance 2.0' }, '与 id 相同或为空的展示名不入库')
  assert.equal(modelLabel(names, 'doubao-seedance-2.0'), 'Doubao Seedance 2.0')
  assert.equal(modelLabel(names, 'wan3.0-video'), 'wan3.0-video', '目录没名字时回落 id')
  assert.equal(modelLabel(names, ''), '未选择')
  assert.equal(modelLabel(null, 'glm-5.2'), 'glm-5.2')
})
