import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = () => readFile(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

test('platform setup uses supplier connections while new direct configs stay special-purpose', async () => {
  const config = await source()
  assert.match(config, /const platformCatalogMode = computed\(\(\) => !tenantId\.value && canManageCatalog\)/)
  assert.match(config, /platformCatalogMode \? '添加专用服务' : '添加配置'/)
  assert.match(config, /platformCatalogMode \? '导入旧配置' : '导入配置'/)
  assert.match(config, /form\.value\.service_type = 'video_postprocess'\s+onServiceTypeChange\(\)/)
  for (const type of ['text', 'image', 'storyboard_image', 'video', 'tts']) {
    assert.match(config, new RegExp(`<el-option v-if="!platformCatalogMode \\|\\| editingId"[^>]+value="${type}"`))
  }
  for (const type of ['video_postprocess', 'jimeng2_character_auth']) {
    assert.match(config, new RegExp(`<el-option label="[^"]+" value="${type}"`))
  }
  assert.match(config, /const legacyList = computed\(\(\) => !tenantId\.value && canManageCatalog \? list\.value\.filter\(row => !row\.provider_connection_id\) : list\.value\)/)
})

test('platform one-key shortcuts do not create duplicate bare provider configs', async () => {
  const config = await source()
  for (const name of ['Volc', 'Agnes', 'Tongyi']) {
    assert.match(config, new RegExp(`<el-button v-if="!platformCatalogMode"[^>]+@click="openOneKey${name}"`))
  }
  assert.match(config, /前往供应商连接/)
})

test('new Volcengine video configs use the price-book provider while legacy catalog aliases remain visible', async () => {
  const config = await source()
  assert.match(config, /\{ id: 'volcengine', name: '火山引擎（方舟）' \}/)
  assert.match(config, /service_type: 'video', name: '火山引擎 即梦 视频'[^\n]+provider: 'volcengine'/)
  assert.match(config, /\['volces', 'volc'\]\.includes\(value\) \? 'volcengine' : value/)
  assert.match(config, /providerFamily\(connection\.provider\) === providerFamily\(provider\)/)
})
