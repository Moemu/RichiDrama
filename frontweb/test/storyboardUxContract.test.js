import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const freeCreate = readFileSync(new URL('../src/views/FreeCreate.vue', import.meta.url), 'utf8')
const promptEditor = readFileSync(new URL('../src/components/OmniAssetPromptEditor.vue', import.meta.url), 'utf8')
const universalEditor = readFileSync(new URL('../src/components/UniversalSegmentOmniAtEditor.vue', import.meta.url), 'utf8')
const filmCreate = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const dragPreview = readFileSync(new URL('../src/utils/dragPreview.js', import.meta.url), 'utf8')
const pointerDrag = readFileSync(new URL('../src/utils/assetPointerDrag.js', import.meta.url), 'utf8')

test('storyboard navigation uses real video for completed shots and a purple play card otherwise', () => {
  assert.match(freeCreate, /<video v-if="shot\.video_url"/)
  assert.match(freeCreate, /v-else class="shot-video-placeholder"/)
  assert.match(freeCreate, /class="shot-play">▶/)
  assert.match(freeCreate, /const preservedVideo = currentShot\.value\.video_url/)
  assert.match(freeCreate, /currentShot\.value\.video_url = localVideoUrl\(completedVideo\)/)
  assert.match(freeCreate, /storyboard_number: storyboard\.storyboard_number/)
  assert.doesNotMatch(freeCreate, /storyboard-placeholder\.svg|shotCover\(/)
})

test('project settings communicate first-shot master, inherited and override states', () => {
  assert.match(freeCreate, /首镜母版/)
  assert.match(freeCreate, /跟随首镜/)
  assert.match(freeCreate, /当前镜头覆盖/)
  assert.match(freeCreate, /updateGenerationSettings/)
})

test('asset mention menus are teleported translucent overlays with bounded internal scrolling', () => {
  for (const source of [promptEditor, universalEditor]) {
    assert.match(source, /teleport to="body"/i)
    assert.match(source, /backdrop-filter:\s*blur/i)
    assert.match(source, /260/)
  }
  assert.match(promptEditor, /pickerMatches\.value\.slice\(0, 30\)/)
  assert.match(promptEditor, /pickerMatchCount > pickerAssets\.length/)
  assert.match(promptEditor, /loading="lazy" decoding="async"/)
})

test('asset drag keeps prompt text visible and supports whitespace-only line targets', () => {
  assert.match(dragPreview, /setDragImage\(transparentPreview, 0, 0\)/)
  assert.match(freeCreate, /@pointerdown="beginAssetPointerDrag\(\$event, asset\)"/)
  assert.match(pointerDrag, /Math\.hypot\([\s\S]*< 6/)
  assert.match(pointerDrag, /ASSET_POINTER_MOVE/)
  assert.match(pointerDrag, /ASSET_POINTER_DROP/)
  assert.match(promptEditor, /window\.addEventListener\(ASSET_POINTER_MOVE/)
  assert.match(promptEditor, /insertAsset\(detail\.asset, \{ offset: point\.offset \}\)/)
  assert.match(filmCreate, /setTransparentDragPreview\(e\)/)
  assert.match(promptEditor, /blankLine/)
  assert.match(promptEditor, /source\[i\] === '\\n'/)
  assert.match(universalEditor, /blankLineDropMeta/)
  assert.match(universalEditor, /omni-drop-indicator/)
  assert.doesNotMatch(promptEditor, /class="mention-anchor"/)
  assert.doesNotMatch(promptEditor, /el-tag v-for="asset in referenced"/)
})

test('billing adjustment explanation is explicitly optional', () => {
  const admin = readFileSync(new URL('../src/views/AdminConsole.vue', import.meta.url), 'utf8')
  assert.match(admin, /情况说明（选填）/)
  assert.doesNotMatch(admin, /请填写调整说明/)
})
