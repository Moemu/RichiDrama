import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const runner = readFileSync(new URL('../src/composables/useCanvasWorkflowRunner.js', import.meta.url), 'utf8')
const media = readFileSync(new URL('../src/composables/useCanvasStoryboardMedia.js', import.meta.url), 'utf8')
const storyboardMedia = readFileSync(new URL('../src/utils/storyboardMedia.js', import.meta.url), 'utf8')

test('Canvas universal video keeps text-only and optional-last-frame inputs valid', () => {
  assert.match(runner, /const prompt = String\(sb\?\.universal_segment_text \|\| sb\?\.video_prompt \|\| ''\)\.trim\(\)/)
  assert.match(runner, /if \(omniSelection\.mode === 'first_last_frame'\) return omniSelection\.firstId != null/)
  assert.match(storyboardMedia, /if \(firstId != null\) usage\.push\(\{ asset_id: firstId, usage: 'first_frame' \}\)/)
  assert.match(storyboardMedia, /if \(lastId != null && lastId !== firstId\)/)
})

test('Canvas universal requests use exact persisted assets and classic requests keep their payload', () => {
  assert.match(runner, /await omniVideoAPI\.create\(\{[\s\S]*creation_mode: omniCreationMode,[\s\S]*assets: omniRequestAssets/)
  assert.match(runner, /await videosAPI\.create\(\{[\s\S]*image_url: absoluteFirst \|\| undefined,[\s\S]*last_frame_url: absoluteLast,[\s\S]*\}\)/)
  assert.doesNotMatch(runner, /await videosAPI\.create\(\{[\s\S]*reference_image_urls:/)
  assert.match(media, /Promise\.allSettled\(ids\.map\(\(id\) => omniVideoAPI\.getAsset\(id\)\)\)/)
  assert.doesNotMatch(media, /omniVideoAPI\.assets\(/)
})
