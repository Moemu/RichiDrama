import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('自由创作只渲染一个提示词编辑器', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')
  const editorTags = source.match(/<OmniAssetPromptEditor\b/g) || []

  assert.equal(editorTags.length, 1)
  assert.match(source, /<div class="shot-script"><OmniAssetPromptEditor\s+ref="promptEditorRef"\s+v-model="prompt"/)
  assert.match(source, /class="insert-at-caret"/)
  assert.match(source, /promptEditorRef\?\.insertAtCaret\(asset\)/)
  assert.match(source, /@keydown\.up\.prevent="selectRelative\(-1\)"/)
  assert.match(source, /@keydown\.down\.prevent="selectRelative\(1\)"/)
})

test('窄屏隐藏的首页动作仍可从更多菜单访问', async () => {
  const source = await readSource('../src/views/FilmList.vue')

  for (const command of ['omni', 'tools', 'import', 'deleted', 'config', 'account', 'logout']) {
    assert.match(source, new RegExp(`command="${command}"`))
  }
  assert.doesNotMatch(source, /\.header-actions\s*\{[^}]*overflow-x:\s*auto/s)
})
