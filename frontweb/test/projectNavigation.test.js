import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { browserModuleUrl, moduleSourceUrl } from './helpers/browserModule.js'

const requestUrl = moduleSourceUrl(`export default { get: (...args) => globalThis.projectTestRequest(...args), post: async () => ({}) }`)
const collaborationUrl = await browserModuleUrl(new URL('../src/composables/useProjectCollaboration.js', import.meta.url), {
  vue: import.meta.resolve('vue'), yjs: import.meta.resolve('yjs'),
  '@/utils/request': requestUrl,
  '@/utils/requestId': new URL('../src/utils/requestId.js', import.meta.url).href,
})
const collaboration = await import(collaborationUrl)
const { confirmProjectNavigation, warnBeforeProjectUnload } = await import(await browserModuleUrl(new URL('../src/utils/projectNavigation.js', import.meta.url), {
  'element-plus': moduleSourceUrl(`export const ElMessageBox = { confirm: (...args) => globalThis.projectTestConfirm(...args) }`),
  '@/composables/useProjectCollaboration': collaborationUrl,
}))

test('staying on the page retains an offline draft until a save acknowledgement', async t => {
  const serverDoc = new Y.Doc()
  serverDoc.getText('content').insert(0, '原始内容')
  const textState = () => ({ epoch: 1, state: Buffer.from(Y.encodeStateAsUpdate(serverDoc)).toString('base64'), state_vector: Buffer.from(Y.encodeStateVector(serverDoc)).toString('base64') })
  let socket
  class TestSocket {
    static OPEN = 1
    readyState = 1
    constructor() { socket = this }
    close() {}
    send(input) {
      const message = JSON.parse(input)
      if (message.type === 'text_update') Y.applyUpdate(serverDoc, Buffer.from(message.update, 'base64'))
      queueMicrotask(() => this.onmessage({ data: JSON.stringify({ ...message, type: 'text', ...textState() }) }))
    }
  }
  const previousSocket = globalThis.WebSocket
  const previousLocation = globalThis.location
  globalThis.WebSocket = TestSocket
  globalThis.location = { protocol: 'http:', host: 'fixture.invalid' }
  globalThis.projectTestRequest = async url => url.endsWith('/state') ? { permissions: { collaboration_enabled: true, can_edit: true }, revision: 1 } : textState()
  let prompts = 0
  globalThis.projectTestConfirm = async () => { prompts++; throw new Error('cancel') }
  t.after(() => {
    collaboration.closeProjectSession(); serverDoc.destroy()
    globalThis.WebSocket = previousSocket; globalThis.location = previousLocation
    delete globalThis.projectTestRequest; delete globalThis.projectTestConfirm
  })
  await collaboration.openProjectSession(1)
  const binding = await collaboration.bindProjectText({ kind: 'dramas', id: 1, field: 'description' }, () => {})
  assert.equal(await confirmProjectNavigation(), true)
  assert.equal(prompts, 0)
  binding.change('断线后尚未保存的新内容')
  assert.equal(await confirmProjectNavigation(), false)
  assert.equal(collaboration.hasUnsavedProjectText(), true)
  let prevented = false
  const event = { preventDefault() { prevented = true } }
  warnBeforeProjectUnload(event)
  assert.equal(prevented, true)
  assert.equal(event.returnValue, '')
  socket.onopen()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(serverDoc.getText('content').toString(), '断线后尚未保存的新内容')
  assert.equal(collaboration.hasUnsavedProjectText(), false)
  assert.equal(await confirmProjectNavigation(), true)
  collaboration.projectSession.drafts.push({ key: 'deleted-field', text: '保留的草稿' })
  assert.equal(await confirmProjectNavigation(), false)
  globalThis.projectTestConfirm = async () => {}
  assert.equal(await confirmProjectNavigation(), true)
  binding.dispose()
})
