import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { browserModuleUrl, moduleSourceUrl } from './helpers/browserModule.js'

const collaboration = await import(await browserModuleUrl(new URL('../src/composables/useProjectCollaboration.js', import.meta.url), {
  vue: import.meta.resolve('vue'), yjs: import.meta.resolve('yjs'),
  '@/utils/request': moduleSourceUrl(`export default { get: (...args) => globalThis.sessionGet(...args), post: (...args) => globalThis.sessionPost(...args) }`),
  '@/utils/requestId': new URL('../src/utils/requestId.js', import.meta.url).href,
}))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('explicit save confirms offline text through HTTP and preserves failed drafts for retry', async t => {
  const previous = { socket: globalThis.WebSocket, location: globalThis.location }
  const doc = new Y.Doc()
  const target = { kind: 'episodes', id: 8, field: 'script_content' }
  const snapshot = () => ({ ...target, epoch: 1, state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), state_vector: Buffer.from(Y.encodeStateVector(doc)).toString('base64') })
  globalThis.WebSocket = class { close() {} }
  globalThis.location = { protocol: 'http:', host: 'fixture.invalid' }
  globalThis.sessionGet = async url => url.endsWith('/text') ? snapshot() : { permissions: { collaboration_enabled: true, can_edit: true }, revision: 1 }
  globalThis.sessionPost = async () => ({})
  t.after(() => {
    collaboration.closeProjectSession(); doc.destroy()
    globalThis.WebSocket = previous.socket; globalThis.location = previous.location
    delete globalThis.sessionGet; delete globalThis.sessionPost
  })
  await collaboration.openProjectSession(1)
  let visible = ''
  const binding = await collaboration.bindProjectText(target, text => { visible = text })
  binding.change('断线新剧本')
  visible = ''
  binding.restoreDraft()
  assert.equal(visible, '断线新剧本', 'a refresh cannot replace the unsaved document with old server text')
  globalThis.sessionPost = async () => { throw new Error('HTTP unavailable') }
  await assert.rejects(collaboration.savePendingProjectText(), /HTTP unavailable/)
  assert.equal(collaboration.hasUnsavedProjectText(), true)
  assert.equal(doc.getText('content').toString(), '')
  const response = deferred()
  let sent
  globalThis.sessionPost = async (url, input) => {
    assert.equal(url, '/dramas/1/collaboration/text')
    sent = input
    await response.promise
    Y.applyUpdate(doc, Buffer.from(input.update, 'base64'))
    return snapshot()
  }
  let confirmed = false
  const saving = collaboration.savePendingProjectText().then(() => { confirmed = true })
  await Promise.resolve()
  assert.equal(confirmed, false)
  assert.equal(sent.id, 8)
  response.resolve()
  await saving
  assert.equal(visible, '断线新剧本')
  assert.equal(doc.getText('content').toString(), '断线新剧本')
  assert.equal(collaboration.hasUnsavedProjectText(), false)
  binding.dispose()
})

test('received text updates skip redundant reads while unseen revisions still refresh documents', async t => {
  const previous = { socket: globalThis.WebSocket, location: globalThis.location }
  const sent = []
  let socket
  const doc = new Y.Doc()
  const text = { epoch: 1, state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), state_vector: Buffer.from(Y.encodeStateVector(doc)).toString('base64') }
  class TestSocket {
    static OPEN = 1
    readyState = 1
    constructor() { socket = this }
    send(raw) {
      const request = JSON.parse(raw)
      sent.push(request)
      queueMicrotask(() => this.onmessage({ data: JSON.stringify({ ...request, ...text, type: 'text' }) }))
    }
    close() {}
  }
  globalThis.WebSocket = TestSocket
  globalThis.location = { protocol: 'http:', host: 'fixture.invalid' }
  globalThis.sessionGet = async url => url.endsWith('/text') ? text : { permissions: { collaboration_enabled: true, can_edit: true }, revision: 1 }
  globalThis.sessionPost = async () => ({})
  t.after(() => {
    collaboration.closeProjectSession(); doc.destroy()
    globalThis.WebSocket = previous.socket; globalThis.location = previous.location
    delete globalThis.sessionGet; delete globalThis.sessionPost
  })
  await collaboration.openProjectSession(1)
  socket.onopen()
  const state = revision => socket.onmessage({ data: JSON.stringify({ type: 'state', revision, participants: [] }) })
  state(1)
  await collaboration.bindProjectText({ kind: 'dramas', id: 1, field: 'description' }, () => {})
  await collaboration.bindProjectText({ kind: 'storyboards', id: 2, field: 'dialogue' }, () => {})
  sent.length = 0
  socket.onmessage({ data: JSON.stringify({ type: 'text', kind: 'dramas', id: 1, field: 'description', ...text, before_revision: 1, revision: 2 }) })
  state(2)
  assert.equal(sent.length, 0)
  state(4)
  assert.equal(sent.filter(message => message.type === 'text_read').length, 2)
  await Promise.resolve()
})

test('departed project callbacks cannot replace an active session, including reentry to the same project', async t => {
  const previous = { socket: globalThis.WebSocket, location: globalThis.location }
  const sockets = []
  class TestSocket {
    static OPEN = 1
    readyState = 1
    constructor(url) { this.url = url; sockets.push(this) }
    send() {}
    close() {}
  }
  globalThis.WebSocket = TestSocket
  globalThis.location = { protocol: 'http:', host: 'fixture.invalid' }
  const state = { permissions: { collaboration_enabled: true, can_edit: true }, revision: 1 }
  globalThis.sessionGet = async () => state
  globalThis.sessionPost = async () => ({})
  const doc = new Y.Doc()
  doc.getText('content').insert(0, '旧项目文本')
  const text = { epoch: 1, state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), state_vector: Buffer.from(Y.encodeStateVector(doc)).toString('base64') }
  t.after(() => {
    collaboration.closeProjectSession(); doc.destroy()
    globalThis.WebSocket = previous.socket; globalThis.location = previous.location
    delete globalThis.sessionGet; delete globalThis.sessionPost
  })
  await collaboration.openProjectSession(1)
  const oldSocket = sockets.at(-1)
  const oldOpen = oldSocket.onopen, oldMessage = oldSocket.onmessage, oldClose = oldSocket.onclose
  oldOpen()
  const pendingText = deferred()
  globalThis.sessionGet = async url => url.endsWith('/text') ? pendingText.promise : state
  let received = 0
  const bindingPromise = collaboration.bindProjectText({ kind: 'dramas', id: 1, field: 'description' }, () => received++)
  await collaboration.openProjectSession(2)
  sockets.at(-1).onopen()
  oldOpen()
  oldMessage({ data: JSON.stringify({ type: 'state', revision: 999, participants: [{ name: '旧项目' }], permissions: { can_edit: false } }) })
  oldClose({ code: 4403 })
  pendingText.resolve(text)
  assert.equal(await bindingPromise, null)
  assert.equal(received, 0)
  assert.equal(collaboration.hasPendingProjectText('dramas', 1, 'description'), false)
  assert.equal(collaboration.projectSession.revision, 1)
  assert.equal(collaboration.projectSession.canEdit, true)
  assert.equal(collaboration.projectSession.connected, true)
  assert.deepEqual(collaboration.projectSession.participants, [])

  // A save rejected during close must not affect the new pending count or error.
  globalThis.sessionGet = async url => url.endsWith('/text') ? text : state
  const binding = await collaboration.bindProjectText({ kind: 'dramas', id: 2, field: 'description' }, () => {})
  binding.change('保存中的草稿')
  assert.equal(collaboration.projectSession.pending, 1)
  await collaboration.openProjectSession(3)
  await Promise.resolve()
  assert.equal(collaboration.projectSession.pending, 0)
  assert.equal(collaboration.projectSession.error, '')
  binding.change('离开后的输入')
  assert.equal(collaboration.hasUnsavedProjectText(), false)
  binding.dispose()

  const staleState = deferred()
  globalThis.sessionGet = () => staleState.promise
  const firstEntry = collaboration.openProjectSession(1)
  globalThis.sessionGet = async () => state
  await collaboration.openProjectSession(2)
  await collaboration.openProjectSession(1)
  const socketCount = sockets.length
  staleState.resolve({ permissions: { collaboration_enabled: true, can_edit: false }, revision: 999 })
  await firstEntry
  assert.equal(sockets.length, socketCount)
  assert.equal(collaboration.projectSession.canEdit, true)
  assert.equal(collaboration.projectSession.revision, 1)

  const cookie = deferred()
  globalThis.sessionPost = () => cookie.promise
  const oldCookie = collaboration.openProjectSession(2)
  await Promise.resolve()
  await Promise.resolve()
  globalThis.sessionPost = async () => ({})
  await collaboration.openProjectSession(3)
  const currentSocketCount = sockets.length
  cookie.resolve({})
  await oldCookie
  assert.equal(sockets.length, currentSocketCount)
  assert.equal(collaboration.projectSession.id, 3)
})
