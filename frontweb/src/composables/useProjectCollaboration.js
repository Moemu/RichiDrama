import { reactive, ref, watch, onScopeDispose } from 'vue'
import * as Y from 'yjs'
import request from '@/utils/request'
import { createClientRequestId } from '@/utils/requestId'

export const projectSession = reactive({ id: null, enabled: false, connected: false, canEdit: false, revision: 0, writeContractVersion: 0, participants: [], pending: 0, error: '', drafts: [] })
let socket
let reconnectTimer
let refreshCallback
let latestRevision = -1
const documents = new Map()
const requests = new Map()
const textKey = input => `${input.kind}:${input.id}:${input.field}`
const decode = value => Uint8Array.from(atob(value), char => char.charCodeAt(0))
const encode = value => btoa(Array.from(value, byte => String.fromCharCode(byte)).join(''))

function acceptText(message) {
  const entry = documents.get(textKey(message))
  if (!entry) return
  if (entry.epoch !== message.epoch) {
    if (entry.dirty) projectSession.drafts.push({ key: textKey(message), text: entry.doc.getText('content').toString() })
    entry.doc.destroy()
    entry.doc = new Y.Doc()
    entry.epoch = message.epoch
    entry.dirty = false
    projectSession.error = '内容已被替换；未确认的修改已保留为草稿。'
  }
  Y.applyUpdate(entry.doc, decode(message.state), 'remote')
  entry.serverVector = message.state_vector
  for (const listener of entry.listeners) listener(entry.doc.getText('content').toString())
}

function send(input) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('协作连接已断开，请稍后重试'))
  const request_id = createClientRequestId()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { requests.delete(request_id); reject(new Error('协作保存未确认，请保留页面等待重连')) }, 15000)
    requests.set(request_id, { resolve, reject, timer })
    socket.send(JSON.stringify({ ...input, request_id }))
  })
}

async function flush(entry) {
  if (!entry.dirty || entry.saving || !projectSession.connected) return
  entry.saving = true
  projectSession.pending++
  const generation = entry.generation
  try {
    await send({ type: 'text_update', ...entry.target, epoch: entry.epoch, update: encode(Y.encodeStateAsUpdate(entry.doc, entry.serverVector ? decode(entry.serverVector) : undefined)) })
    if (generation === entry.generation) entry.dirty = false
  } catch (error) {
    projectSession.error = error.message
    if (error.code === 'ENTITY_DELETED') {
      projectSession.drafts.push({ key: textKey(entry.target), text: entry.doc.getText('content').toString() })
      entry.dirty = false
    }
  }
  finally {
    entry.saving = false
    projectSession.pending--
    if (entry.dirty && generation !== entry.generation) void flush(entry)
  }
}

function connect() {
  if (!projectSession.enabled || !projectSession.id) return
  const id = projectSession.id
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/v1/dramas/${id}/collaboration/socket`)
  socket.onopen = () => {
    projectSession.connected = true
    projectSession.error = ''
    for (const entry of documents.values()) void send({ type: 'text_read', ...entry.target, epoch: entry.epoch, state_vector: encode(Y.encodeStateVector(entry.doc)) }).then(() => flush(entry)).catch(error => { projectSession.error = error.message })
  }
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.type === 'state') {
      projectSession.participants = message.participants
      projectSession.revision = message.revision
      if (message.permissions) projectSession.canEdit = message.permissions.can_edit
      if (latestRevision !== message.revision) {
        latestRevision = message.revision
        for (const entry of documents.values()) void send({ type: 'text_read', ...entry.target, epoch: entry.epoch, state_vector: encode(Y.encodeStateVector(entry.doc)) }).catch(error => { projectSession.error = error.message })
        refreshCallback?.()
      }
    }
    if (message.type === 'text') acceptText(message)
    const pending = requests.get(message.request_id)
    if (pending) {
      clearTimeout(pending.timer); requests.delete(message.request_id)
      if (message.type === 'error') pending.reject(Object.assign(new Error(message.message), { code: message.code }))
      else pending.resolve(message)
    }
  }
  socket.onclose = event => {
    projectSession.connected = false
    for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(new Error('连接已断开，文本修改保留在当前页面')) }
    requests.clear()
    if (event.code === 4403) { projectSession.error = '项目权限已变更，请重新进入项目'; return }
    if (projectSession.id === id) reconnectTimer = setTimeout(connect, 1500)
  }
}

export async function openProjectSession(dramaId, onRefresh) {
  closeProjectSession()
  projectSession.id = Number(dramaId)
  refreshCallback = onRefresh
  const state = await request.get(`/dramas/${dramaId}/collaboration/state`)
  if (projectSession.id !== Number(dramaId)) return
  projectSession.enabled = state.permissions.collaboration_enabled
  projectSession.canEdit = state.permissions.can_edit
  projectSession.revision = state.revision
  projectSession.writeContractVersion = state.write_contract_version || 0
  if (projectSession.enabled) {
    await request.post('/auth/session-cookie', {})
    connect()
  }
}

export function closeProjectSession() {
  projectSession.id = null
  projectSession.enabled = false
  projectSession.connected = false
  projectSession.writeContractVersion = 0
  projectSession.participants = []
  projectSession.drafts = []
  projectSession.error = ''
  latestRevision = -1
  clearTimeout(reconnectTimer)
  if (socket) { socket.onclose = null; socket.close(); socket = null }
  for (const entry of documents.values()) entry.doc.destroy()
  documents.clear()
  for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(new Error('已离开项目')) }
  requests.clear()
}

export function hasUnsavedProjectText() {
  return projectSession.drafts.length > 0 || [...documents.values()].some(entry => entry.dirty || entry.saving)
}

export async function bindProjectText(target, listener) {
  if (!projectSession.enabled || !target.id) return null
  const key = textKey(target)
  let entry = documents.get(key)
  if (!entry) {
    const state = await request.get(`/dramas/${projectSession.id}/collaboration/text`, { params: target })
    entry = documents.get(key)
    if (!entry) {
      entry = { target, epoch: state.epoch, serverVector: state.state_vector, doc: new Y.Doc(), listeners: new Set(), dirty: false, generation: 0 }
      Y.applyUpdate(entry.doc, decode(state.state))
      documents.set(key, entry)
    }
  }
  let local = new Y.Doc()
  let localEpoch = entry.epoch
  Y.applyUpdate(local, Y.encodeStateAsUpdate(entry.doc))
  let composing = false
  const receive = value => {
    if (composing) return
    if (localEpoch !== entry.epoch) { local.destroy(); local = new Y.Doc(); localEpoch = entry.epoch }
    Y.applyUpdate(local, Y.encodeStateAsUpdate(entry.doc))
    listener(value)
  }
  entry.listeners.add(receive)
  receive(entry.doc.getText('content').toString())
  return {
    compositionStart() { composing = true },
    compositionEnd(value) { this.change(value); composing = false; receive(entry.doc.getText('content').toString()) },
    change(value) {
      if (localEpoch !== entry.epoch) {
        projectSession.drafts.push({ key, text: value })
        projectSession.error = '内容已被替换；你的输入已保留为草稿。'
        return
      }
      const text = local.getText('content')
      const previous = text.toString()
      let start = 0
      while (start < previous.length && start < value.length && previous[start] === value[start]) start++
      let end = 0
      while (end < previous.length - start && end < value.length - start && previous[previous.length - 1 - end] === value[value.length - 1 - end]) end++
      local.transact(() => {
        text.delete(start, previous.length - start - end)
        text.insert(start, value.slice(start, value.length - end))
      })
      Y.applyUpdate(entry.doc, Y.encodeStateAsUpdate(local))
      entry.dirty = true; entry.generation++
      void flush(entry)
    },
    dispose() { entry.listeners.delete(receive); local.destroy() },
  }
}

export function retryPendingProjectText() {
  projectSession.error = ''
  for (const entry of documents.values()) void flush(entry)
}

export function projectPresence(editing) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'presence', editing }))
}

export function hasPendingProjectText(kind, id, field) {
  return documents.has(textKey({ kind, id, field }))
}

export function useProjectTextModel(targetGetter, model) {
  const ready = ref(false)
  let binding; let remote = false; let version = 0; let composing = false
  const stopTarget = watch(() => [projectSession.enabled, targetGetter()], async ([enabled, target]) => {
    const current = ++version
    binding?.dispose(); binding = null
    composing = false
    ready.value = !enabled
    if (!enabled || !target?.id) return
    try {
      // Detach synchronously, then let the caller finish loading the selected shot.
      await Promise.resolve()
      if (current !== version) return
      const next = await bindProjectText(target, value => {
        if (current !== version) return
        remote = true; model.value = value; remote = false
      })
      if (current !== version) next?.dispose()
      else { binding = next; ready.value = !!next }
    } catch (error) { if (current === version) projectSession.error = error.message }
  }, { immediate: true, deep: true, flush: 'sync' })
  const stopModel = watch(model, value => { if (!remote && !composing) binding?.change(value || '') }, { flush: 'sync' })
  onScopeDispose(() => { version++; binding?.dispose(); stopTarget(); stopModel() })
  return {
    ready,
    compositionStart() { composing = true; binding?.compositionStart() },
    compositionEnd() { composing = false; binding?.compositionEnd(model.value || '') },
  }
}
