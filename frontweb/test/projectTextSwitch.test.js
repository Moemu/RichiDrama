import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, ref, watch } from 'vue'
import * as Y from 'yjs'
import { browserModuleUrl, moduleSourceUrl } from './helpers/browserModule.js'

const collaboration = await import(await browserModuleUrl(new URL('../src/composables/useProjectCollaboration.js', import.meta.url), {
  vue: import.meta.resolve('vue'), yjs: import.meta.resolve('yjs'),
  '@/utils/request': moduleSourceUrl('export default { get: (...args) => globalThis.switchTextRequest(...args) }'),
  '@/utils/requestId': new URL('../src/utils/requestId.js', import.meta.url).href,
}))
const settle = () => new Promise(resolve => setImmediate(resolve))
const target = id => ({ kind: 'storyboards', id, field: 'universal_segment_text' })

test('switching shots never writes loaded text into the previous collaborative document', async t => {
  const scope = effectScope()
  const docs = new Map([1, 2, 3].map(id => {
    const doc = new Y.Doc()
    doc.getText('content').insert(0, `镜头${id}原文`)
    return [id, doc]
  }))
  let releaseSecond
  globalThis.switchTextRequest = async (_url, { params }) => {
    if (params.id === 2) await new Promise(resolve => { releaseSecond = resolve })
    const doc = docs.get(params.id)
    return { epoch: 1, state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), state_vector: Buffer.from(Y.encodeStateVector(doc)).toString('base64') }
  }
  Object.assign(collaboration.projectSession, { id: 1, enabled: true, canEdit: true })
  t.after(() => {
    scope.stop(); collaboration.closeProjectSession()
    docs.forEach(doc => doc.destroy()); delete globalThis.switchTextRequest
  })
  const selected = ref(1), prompt = ref('镜头1原文'), loading = ref(false)
  const editor = scope.run(() => collaboration.useProjectTextModel(() => loading.value ? null : target(selected.value), prompt))
  const changes = []
  scope.run(() => watch(prompt, value => changes.push({ value, remote: editor.applyingRemote }), { flush: 'sync' }))
  await settle()
  assert.equal(editor.ready.value, true)
  selected.value = 2
  assert.equal(editor.ready.value, false)
  prompt.value = '镜头2原文'
  await settle()
  assert.equal(editor.ready.value, false)
  assert.equal(collaboration.hasUnsavedProjectText(), false, 'loading another shot must not create a text update')
  editor.compositionStart()
  selected.value = 3
  prompt.value = '镜头3原文'
  await settle()
  releaseSecond()
  await settle()
  assert.equal(prompt.value, '镜头3原文', 'late shot 2 response must not change shot 3')
  assert.equal(editor.ready.value, true)
  for (const id of [1, 2, 3, 1, 3, 2]) {
    selected.value = id
    prompt.value = `镜头${id}列表快照`
    await settle()
    assert.equal(prompt.value, `镜头${id}原文`, 'cached binding must load the selected document')
  }
  assert.equal(collaboration.hasUnsavedProjectText(), false)
  loading.value = true
  prompt.value = '重新载入的旧列表快照'
  loading.value = false
  await settle()
  assert.equal(prompt.value, '镜头2原文', 'reloading the same shot must not publish its stale snapshot')
  assert.equal(collaboration.hasUnsavedProjectText(), false)
  prompt.value = '镜头2独立修改'
  assert.equal(changes.at(-1).remote, false)
  assert.ok(changes.some(change => change.value === '镜头2原文' && change.remote), 'remote hydration must be distinguishable from a local edit')
  for (const id of [1, 2, 3]) {
    let actual
    const binding = await collaboration.bindProjectText(target(id), value => { actual = value })
    assert.equal(actual, id === 2 ? '镜头2独立修改' : `镜头${id}原文`)
    binding.dispose()
  }
})
