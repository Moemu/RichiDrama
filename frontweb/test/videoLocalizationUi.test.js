import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const page = () => readFile(new URL('../src/views/VideoLocalization.vue', import.meta.url), 'utf8')

test('completed LAS jobs open the archived asset in a local video player', async () => {
  const source = await page()
  assert.match(source, /@click="openPreview\(job\)"/)
  assert.match(source, /omniVideoAPI\.getAsset\(job\.output_asset_id\)/)
  assert.match(source, /asset\?\.local_path \|\| asset\.type !== 'video'/)
  assert.match(source, /<video v-else-if="previewVideoUrl" :src="previewVideoUrl" controls/)
  assert.doesNotMatch(source, /查看成片[^\n]*media-library/)
})

test('quote refreshes when project, asset, model, language or stage changes and ignores stale responses', async () => {
  const source = await page()
  // 回归：上传素材后切换目标语言，翻译模型不变（las-video-translate），
  // 旧实现只监听 [dramaId, assetId, model]，clearQuote 之后没人重载报价，
  // 提交按钮因 !quote 永久禁用。语言与阶段必须进入 watcher 依赖。
  assert.match(source, /watch\(\[dramaId, assetId, model, outputLanguage, stage\]/)
  assert.match(source, /quoteTimer = setTimeout\(loadQuote, 250\)/)
  assert.match(source, /if \(version === quoteVersion\) quote\.value = result/)
  assert.match(source, /:disabled="!ready \|\| !quote \|\| quoting \|\| submitting"/)
  assert.match(source, /ElMessageBox\.confirm\(/)
})
