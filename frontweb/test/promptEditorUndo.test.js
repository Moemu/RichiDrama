import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Chromium clears the contenteditable undo stack whenever script mutates the
// editable subtree. The editor re-renders from several watchers, and the
// references round-trip (editor emits -> parent replaces promptDocument ->
// deep watcher fires) runs on every keystroke; without a no-op guard each
// keystroke ends in replaceChildren() and Ctrl+Z has nothing to undo.
test('renderEditor skips DOM rebuilds while content and resolved references are unchanged', async () => {
  const file = new URL('../src/components/OmniAssetPromptEditor.vue', import.meta.url)
  const source = await readFile(file, 'utf8')
  const renderEditor = source.match(/function renderEditor\(value, force = false\) \{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(renderEditor, /serializeEditor\(\) === source/, 'renderEditor must compare the live DOM against the target source before rebuilding')
  assert.match(renderEditor, /renderedSource === source/, 'renderEditor must remember what it last rendered and skip identical rebuilds')
  assert.match(renderEditor, /renderedRefsKey === refsKey/, 'reference resolution changes (chips appearing/disappearing) must still trigger a rebuild')
  assert.match(renderEditor, /if \(!force &&[\s\S]*?\) return/, 'the no-op guard must be bypassable for forced re-renders after asset insertion')
})
