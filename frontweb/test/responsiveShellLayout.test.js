import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const appHeader = read('../src/components/ui/AppHeader.vue')
const filmList = read('../src/views/FilmList.vue')
const mediaLibrary = read('../src/views/MediaLibrary.vue')

test('窄屏共享头部把品牌、操作和主导航分成可达的两行', () => {
  assert.match(appHeader, /@media\(max-width:720px\)[\s\S]*grid-template-rows:34px 26px;[\s\S]*grid-template-areas:"brand actions" "nav nav";/)
  assert.match(appHeader, /\.app-header__nav\{[\s\S]*overflow-x:auto;/)
  assert.match(appHeader, /\.app-header__actions\{[\s\S]*min-width:0;/)
  assert.match(appHeader, /\.app-header__actions :deep\(\.el-dropdown\)\{flex:0 0 auto\}/)
})

test('窄屏主页为全部记录快捷入口给大标题留出顶部空间', () => {
  assert.match(filmList, /Keep the records shortcut clear of the mobile hero title\.[\s\S]*@media \(max-width: 52rem\)[\s\S]*\.media-stage-content \{ padding-top: 7\.5rem; \}/)
})

test('媒体库左栏只裁剪横向装饰并保留纵向内容可达', () => {
  assert.match(mediaLibrary, /\.library-header \{[\s\S]*max-height:100dvh;[\s\S]*overflow-x:hidden; overflow-y:auto;/)
  assert.match(mediaLibrary, /@media \(max-width: 52rem\)[\s\S]*\.library-header \{[\s\S]*max-height: none;[\s\S]*overflow-x: hidden;[\s\S]*overflow-y: visible;/)
})
