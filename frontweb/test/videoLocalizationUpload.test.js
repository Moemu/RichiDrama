import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const page = () => readFile(new URL('../src/views/VideoLocalization.vue', import.meta.url), 'utf8')
const api = () => readFile(new URL('../src/api/omniVideo.js', import.meta.url), 'utf8')

test('视频本地化页提供本地上传入口，未选项目时不可用', async () => {
  const source = await page()
  assert.match(source, /type="file"[^>]*accept="video\/mp4,video\/\*"[^>]*@change="onUpload"/, '缺少视频文件选择入口')
  assert.match(source, /:disabled="!dramaId \|\| uploading" @click="triggerUpload"/, '上传按钮必须先选项目且上传中禁用')
  assert.match(source, /function triggerUpload\(\) \{ if \(!dramaId\.value\) return; uploadInput\.value\?\.click\(\) \}/)
  assert.match(source, /上传的视频会归档为该项目素材/, '未选项目时必须给出提示文案')
})

test('上传复用素材库同一条 /media/upload 路径并归档为项目素材', async () => {
  const source = await page()
  assert.match(source, /omniVideoAPI\.upload\(file, \{ drama_id: dramaId\.value \}\)/, '必须走项目素材上传接口')
  const omni = await api()
  assert.match(omni, /upload\(file, options = \{\}\) \{[\s\S]*?form\.append\('drama_id'[\s\S]*?request\.post\('\/media\/upload'/, '上传接口必须携带 drama_id 归属项目')
})

test('上传成功后重新拉取素材列表并自动选中', async () => {
  const source = await page()
  const handler = source.match(/async function onUpload\(event\) \{[\s\S]*?\n\}/)
  assert.ok(handler, '缺少 onUpload()')
  assert.match(handler[0], /videos\.value = assets\?\.items \|\| \[\]/, '上传后必须刷新素材列表')
  assert.match(handler[0], /assetId\.value = String\(asset\.id\)/, '上传后必须自动选中新素材')
  assert.match(handler[0], /clearQuote\(\)/, '换素材后必须清掉旧报价')
  assert.match(handler[0], /event\.target\.value = ''/, '必须重置文件输入以便重复上传同名文件')
})

test('上传前按平台限制拦截文件类型与大小', async () => {
  const source = await page()
  assert.match(source, /file\.type\.startsWith\('video\/'\)/, '必须校验视频类型')
  assert.match(source, /uploadLimitMb\.value > 0 && file\.size > uploadLimitMb\.value \* 1024 \* 1024/, '必须按 upload-limits 拦截超限文件')
  assert.match(source, /uploadLimits\(\)\.then\(\(limits\) => \{ uploadLimitMb\.value = Number\(limits\?\.files\?\.video\?\.max_mb \|\| 0\) \}\)\.catch\(\(\) => \{\}\)/, '限制接口失败不得阻塞上传，交给服务端校验')
})
