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

// 成片交付体验：任务卡片集中展示源视频→成片、实际扣费与下一步操作，
// 用户不必跳去素材库或账本就能确认这一单产出了什么、花了多少。
test('job cards consolidate source, output, actual billing and next actions', async () => {
  const source = await page()
  assert.match(source, /源视频 \{\{ job\.source_asset_name/)
  assert.match(source, /→ 成片 \{\{ job\.output_asset_name \}\}/)
  assert.match(source, /实际扣费 \$\{creditsText\(billing\.charged_credits\)\}/)
  assert.match(source, /对账中：[\s\S]*冻结中，等待运营核验用量/)
  assert.match(source, /预授权已释放，未扣费/)
  assert.match(source, /@click="retryJob\(job\)">按原参数重新提交/)
  assert.match(source, /运营核验用量后这里会更新为最终结果/)
})
