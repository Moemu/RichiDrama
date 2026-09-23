import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = () => readFile(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

test('视频本地化作为专用服务出现，并按固定算子工作', async () => {
  const config = await source()
  assert.match(config, /<el-option label="[^"]*" value="video_localization" \/>/)
  assert.match(config, /video_localization: '视频本地化（LAS）'/)
  assert.match(config, /video_localization: \[\s*\{ id: 'las', name: '[^']+' \},\s*\]/)
})

test('视频本地化表单提供地域与 TOS 字段，并要求与 LAS 同地域同 Bucket', async () => {
  const config = await source()
  assert.match(config, /<template v-if="form\.service_type === 'video_localization'">/)
  for (const field of ['las_region', 'tos_bucket', 'tos_access_key_id', 'tos_secret_access_key']) {
    assert.match(config, new RegExp(`v-model="form\\.${field}"`), `缺少 ${field} 输入项`)
  }
  assert.match(config, /同账号、同地域/)
})

test('视频本地化提交的 settings 键与后端读取口径一致，且算子地址由地域推导', async () => {
  const config = await source()
  const backend = await readFile(new URL('../../backend-node/src/services/lasMediaJobService.js', import.meta.url), 'utf8')
  assert.match(
    config,
    /settings = JSON\.stringify\(\{ region, tos_bucket: bucket, tos_access_key_id: accessKeyId, tos_secret_access_key: secretAccessKey \}\)/
  )
  assert.match(config, /form\.value\.base_url = `https:\/\/operator\.las\.\$\{region\}\.volces\.com`/)
  for (const key of ['settings.region', 'settings.tos_bucket', 'settings.tos_access_key_id', 'settings.tos_secret_access_key']) {
    assert.ok(backend.includes(key), `后端未读取 ${key}`)
  }
})

test('平台模式下列表并入平台级配置，新增的专用服务不会消失', async () => {
  const config = await source()
  assert.match(config, /const platformRows = await aiAPI\.list\(null, \{ platform: true \}\)/)
  assert.match(config, /!row\.owner_tenant_id && !row\.provider_connection_id/, '只并入平台级、且未被共享连接接管的行')
  assert.match(config, /list\.value = \[\.\.\.rows, \.\.\.extra\]\.sort\(configOrder\)/, '并入后必须按后端口径重排，不能打乱默认优先')
})

test('视频本地化表单指明价格发布位置与单位数量', async () => {
  const config = await source()
  assert.match(config, /价格在哪里配/)
  assert.match(config, /las-video-inpaint-lite/)
  assert.match(config, /单位数量填 60000/)
})

test('视频本地化不绑定可切换模型，也不暴露连接级计费键', async () => {
  const config = await source()
  assert.match(config, /form\.value\.service_type !== 'model_ark_asset' && form\.value\.service_type !== 'video_localization' && modelList\.length === 0/)
  assert.match(config, /v-if="form\.service_type !== 'video_localization'" prop="modelText"/)
  assert.match(config, /v-if="form\.service_type !== 'video_postprocess' && form\.service_type !== 'video_localization' && !isRichbestProvider"/)
})
