import test from 'node:test'
import assert from 'node:assert/strict'
import { createHistory, editSnapshot, readStoredHistory, writeStoredHistory, clearStoredHistory } from '../src/utils/creativeBoardHistory.js'

function node(id, data = {}, position = { x: 0, y: 0 }) { return { id, kind: data.kind, position, data } }
function graph() {
  return {
    nodes: [
      node('text:1', { kind: 'text', title: '备注', text: '一段文本' }, { x: 10, y: 20 }),
      node('draft:1', { kind: 'draft_video', text: '', prompt: '本地', model: 'm', duration: 15, submitting: true, latest: { id: 9 }, output: { id: 9 }, versionCount: 2, pendingRequest: { idempotency_key: 'k' }, onRun() {} }),
      node('asset:1', { source_type: 'asset', name: '素材', title: '命名' }),
    ],
    edges: [{ id: 'p1', source: 'text:1', target: 'draft:1', usage: 'prompt', label: '提示词', selected: true }],
  }
}

test('an edit snapshot carries only what the user can edit', () => {
  const { nodes, edges } = graph()
  const snapshot = JSON.parse(JSON.stringify(editSnapshot(nodes, edges)))
  assert.deepEqual(snapshot.nodes.map((entry) => entry.id), ['text:1', 'draft:1', 'asset:1'])
  assert.deepEqual(snapshot.nodes[0], { id: 'text:1', x: 10, y: 20, kind: 'text', text: '一段文本', name: '备注' })
  assert.equal(snapshot.nodes[1].draft.prompt, '本地')
  assert.equal(snapshot.nodes[2].source_id, undefined)
  // Runtime state must never enter history, or an undo could replay a paid submission.
  assert.doesNotMatch(JSON.stringify(snapshot), /pendingRequest|submitting|latest|output|versionCount|onRun|selected/)
  assert.deepEqual(snapshot.edges, [{ id: 'p1', source: 'text:1', target: 'draft:1', usage: 'prompt' }])
})

test('undo and redo walk the stack and a new edit drops the redo branch', () => {
  const history = createHistory({ limit: 3 })
  const a = { nodes: [], edges: [], step: 'a' }
  history.record(a)
  assert.deepEqual(history.size, { past: 1, future: 0 })
  const undone = history.undo({ step: 'b' })
  assert.equal(undone.step, 'a')
  assert.deepEqual(history.size, { past: 0, future: 1 })
  assert.equal(history.undo({ step: 'b' }), null)
  assert.equal(history.redo({ step: 'b' }).step, 'b')
  assert.deepEqual(history.size, { past: 1, future: 0 })
  history.record(a)
  history.record(a)
  history.record(a)
  history.record(a)
  assert.equal(history.size.past, 3)
  assert.equal(history.size.future, 0)
})

test('stored history is abandoned when the graph it was recorded against changed', () => {
  const store = new Map()
  const storage = { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) }
  writeStoredHistory(storage, 'k', 'fingerprint-1', { past: [1], future: [2] })
  assert.deepEqual(readStoredHistory(storage, 'k', 'fingerprint-1'), { past: [1], future: [2] })
  // Another tab, another account or a reloaded graph invalidates it.
  assert.equal(readStoredHistory(storage, 'k', 'fingerprint-2'), null)
  clearStoredHistory(storage, 'k')
  assert.equal(readStoredHistory(storage, 'k', 'fingerprint-1'), null)
  // A storage that throws (private mode, full quota) must degrade, not crash the board.
  const hostile = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('full') }, removeItem() { throw new Error('blocked') } }
  assert.equal(readStoredHistory(hostile, 'k', 'fingerprint-1'), null)
  writeStoredHistory(hostile, 'k', 'fingerprint-1', { past: [], future: [] })
  clearStoredHistory(hostile, 'k')
  assert.equal(readStoredHistory(null, 'k', 'fingerprint-1'), null)
})
