import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { collectDisplayNames, modelLabel } from '../src/utils/modelDisplayNames.js'

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('中转站走「供应商连接」入口，不混进专用服务页的厂商下拉', async () => {
  const [configSource, connections] = await Promise.all([
    readSource('../src/components/AIConfigContent.vue'),
    readSource('../src/components/ProviderConnections.vue'),
  ])
  assert.equal(configSource.includes("id: 'richbest'"), false, '裸配置页不再是新厂商的入口')
  assert.match(connections, /\{ value: 'richbest', label: '瑞池中转 API（api\.richbest\.cn）', url: 'https:\/\/api\.richbest\.cn\/v1' \}/)
  // 新建表单默认仍是火山，不能因为 presets 顺序变化而错配地址
  assert.match(connections, /presets\.find\(item => item\.value === 'volcengine'\)/)
  assert.doesNotMatch(connections, /base_url: presets\[0\]\.url/)
})

test('专用服务页改名并说明与供应商连接的分工', async () => {
  const source = await readSource('../src/components/AIConfigContent.vue')
  assert.match(source, /canManageCatalog \? '专用服务' : '供应商连接'/)
  assert.doesNotMatch(source, /待迁移配置与专用服务/)
  assert.match(source, /供应商凭据与模型请在「供应商连接」中添加/)
})

test('中转站连接隐藏连接级计费键', async () => {
  const source = await readSource('../src/components/AIConfigContent.vue')
  assert.match(source, /const isRichbestProvider = computed\(\(\) => String\(form\.value\.provider \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'richbest'\)/)
  assert.match(source, /v-if="form\.service_type !== 'video_postprocess' && form\.service_type !== 'video_localization' && !isRichbestProvider"/)
})

test('中转厂商的协议与地址映射仍保留，供项目组独立凭据手输使用', async () => {
  const source = await readSource('../src/components/AIConfigContent.vue')
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
