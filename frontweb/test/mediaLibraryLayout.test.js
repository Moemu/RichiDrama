import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../src/views/MediaLibrary.vue', import.meta.url)), 'utf8')

test('媒体库长列表保持页面滚动和卡片固有高度', () => {
  const layoutSafety = source.split('/* Keep the contact sheet in normal document flow.')[1] || ''

  assert.match(source, /grid-template-rows:0 auto minmax\(max-content,auto\) auto/)
  assert.match(layoutSafety, /\.media-library-page\s*\{[\s\S]*padding-bottom:\s*10rem;[\s\S]*\}/)
  assert.match(source, /\.media-grid\s*\{[\s\S]*grid-auto-rows:\s*max-content;[\s\S]*min-height:\s*fit-content;[\s\S]*overflow:\s*visible;/)
  assert.match(source, /\.media-card\s*\{[\s\S]*align-self:\s*start;[\s\S]*min-block-size:\s*fit-content;[\s\S]*height:\s*auto;/)
})

test('媒体库窄屏批量操作栏可换行并保留左右安全边距', () => {
  const layoutSafety = source.split('/* Keep the contact sheet in normal document flow.')[1] || ''

  assert.match(layoutSafety, /\.batch-bar\s*\{[\s\S]*flex-wrap:\s*wrap;[\s\S]*max-height:\s*calc\(100dvh - 32px\);[\s\S]*overflow-y:\s*auto;/)
  assert.match(layoutSafety, /@media\s*\(max-width:\s*52rem\)[\s\S]*\.batch-bar\s*\{[\s\S]*left:\s*12px;[\s\S]*right:\s*12px;[\s\S]*transform:\s*none;/)
})

test('媒体卡片浮层动作在窄卡中可收缩或换行', () => {
  assert.match(source, /\.overlay-actions\s*\{[\s\S]*flex-wrap:\s*wrap;[\s\S]*gap:\s*4px;[\s\S]*max-width:\s*100%;/)
  assert.match(source, /\.overlay-actions\s+:deep\(\.el-button\s+\+\s+\.el-button\)[\s\S]*margin-inline:\s*0;/)
})
