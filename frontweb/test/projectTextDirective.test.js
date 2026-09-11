import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive } from 'vue'
import { browserModuleUrl, moduleSourceUrl } from './helpers/browserModule.js'

test('directive discards late bindings after permission toggles, target changes, and unmount', async t => {
  const session = reactive({ id: 1, enabled: true, canEdit: true, error: '' })
  globalThis.directiveSession = session
  const requests = []
  globalThis.directiveBind = (target, listener) => new Promise(resolve => {
    const entry = { target, disposed: 0, changes: [] }
    entry.finish = value => {
      listener(value)
      resolve({ dispose() { entry.disposed++ }, change(value) { entry.changes.push(value) } })
    }
    requests.push(entry)
  })
  const directive = (await import(await browserModuleUrl(new URL('../src/directives/projectText.js', import.meta.url), {
    vue: import.meta.resolve('vue'),
    '@/composables/useProjectCollaboration': moduleSourceUrl(`export const projectSession = globalThis.directiveSession; export const bindProjectText = (...args) => globalThis.directiveBind(...args); export const projectPresence = () => {};`),
    '@/utils/projectSnapshots': moduleSourceUrl('export const projectSnapshot = () => null'),
  }))).default
  class Input extends EventTarget {
    value = ''
    readOnly = false
    matches() { return true }
  }
  const input = new Input()
  const previousDocument = globalThis.document
  globalThis.document = { activeElement: null }
  t.after(() => {
    directive.beforeUnmount(input)
    globalThis.document = previousDocument
    delete globalThis.directiveSession; delete globalThis.directiveBind
  })
  const binding = id => ({ value: { kind: 'storyboards', id, field: 'description' } })
  directive.mounted(input, binding(1))
  assert.equal(requests.length, 1)
  session.enabled = false
  session.enabled = true
  assert.equal(requests.length, 2)
  requests[1].finish('当前正文')
  await Promise.resolve()
  requests[0].finish('过期正文')
  await Promise.resolve()
  assert.equal(input.value, '当前正文')
  assert.equal(requests[0].disposed, 1)
  input.value = '当前修改'; input.dispatchEvent(new Event('input'))
  assert.deepEqual(requests[1].changes, ['当前修改'])
  assert.deepEqual(requests[0].changes, [])

  directive.updated(input, binding(2))
  directive.updated(input, binding(3))
  requests[3].finish('镜头三')
  requests[2].finish('镜头二')
  await Promise.resolve()
  assert.equal(input.value, '镜头三')
  assert.equal(requests[2].disposed, 1)
  directive.updated(input, binding(4))
  directive.beforeUnmount(input)
  requests[4].finish('卸载后的文本')
  await Promise.resolve()
  assert.equal(input.value, '镜头三')
  assert.equal(requests[4].disposed, 1)
})
