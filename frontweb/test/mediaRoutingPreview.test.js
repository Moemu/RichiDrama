import test from 'node:test'
import assert from 'node:assert/strict'
import { materialLimits, materialRoutingPreview } from '../src/utils/mediaRoutingPreview.js'

const seedanceImageFallback = {
  supports: { image_reference: { max: 30 }, video_reference: false, audio_reference: true },
  limits: { total_reference: { max: 50 }, image_reference: { max: 30 }, video_reference: { max: 10 }, audio_reference: { max: 10 } },
}

test('unsupported source video is shown as keyframes and is excluded from video billing input', () => {
  const preview = materialRoutingPreview([
    { alias: '视频807', type: 'video', usage: 'motion' },
    { alias: '图片668', type: 'image', usage: 'reference' },
    { alias: '图片670', type: 'image', usage: 'reference' },
    { alias: '图片672', type: 'image', usage: 'reference' },
  ], seedanceImageFallback)

  assert.deepEqual(preview.selected, { total: 4, image: 3, video: 1, audio: 0 })
  assert.deepEqual(preview.sent, { total: 6, image: 6, video: 0, audio: 0 })
  assert.equal(preview.preprocessedVideos, 1)
  assert.equal(preview.entries[0].strategy, 'keyframe_or_post')
  assert.match(preview.entries[0].label, /预计提取 3 张关键帧/)
})

test('native video capability keeps the source video in the provider request', () => {
  const preview = materialRoutingPreview(
    [{ alias: '动作参考', type: 'video', usage: 'motion' }],
    { supports: { image_reference: { max: 9 }, video_reference: true }, limits: {} },
  )
  assert.deepEqual(preview.sent, { total: 1, image: 0, video: 1, audio: 0 })
  assert.equal(preview.preprocessedVideos, 0)
  assert.equal(preview.entries[0].strategy, 'native')
})

test('material preview exposes backend-compatible per-type selection limits', () => {
  assert.deepEqual(materialLimits(null), { total: 15, image: 9, video: 3, audio: 3 })
  const preview = materialRoutingPreview([
    { type: 'video' }, { type: 'video' }, { type: 'video' }, { type: 'video' },
  ], null)
  assert.equal(preview.withinLimits, false)
  assert.deepEqual(preview.exceeded, ['video'])
})
