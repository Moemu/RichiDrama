import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearPromptDraft,
  promptDraftKey,
  readPromptDraft,
  shouldRestorePromptDraft,
  writePromptDraft,
} from '../src/utils/promptDraft.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('draft keys isolate users, workspaces and shots', () => {
  const base = { workspace: 'project', dramaId: 1, episodeId: 2, shotId: 3 }
  assert.notEqual(promptDraftKey({ ...base, userId: 7 }), promptDraftKey({ ...base, userId: 8 }))
  assert.notEqual(promptDraftKey({ ...base, userId: 7 }), promptDraftKey({ ...base, userId: 7, shotId: 4 }))
})

test('empty prompt is a valid recoverable draft', () => {
  const storage = memoryStorage()
  const id = { userId: 1, workspace: 'project', dramaId: 2, episodeId: 3, shotId: 4 }
  writePromptDraft(storage, id, { prompt: '' }, Date.parse('2026-08-13T10:00:00Z'))
  const draft = readPromptDraft(storage, id, { now: Date.parse('2026-08-13T10:01:00Z') })
  assert.equal(draft.payload.prompt, '')
  assert.equal(shouldRestorePromptDraft(draft, '2026-08-13T09:59:59Z'), true)
})

test('older drafts do not override newer server content and expired drafts are removed', () => {
  const storage = memoryStorage()
  const id = { userId: 1, workspace: 'free', shotId: 9 }
  const draft = writePromptDraft(storage, id, { prompt: 'draft' }, Date.parse('2026-08-13T10:00:00Z'))
  assert.equal(shouldRestorePromptDraft(draft, '2026-08-13T10:00:01Z'), false)
  assert.equal(readPromptDraft(storage, id, { now: Date.parse('2026-08-21T10:00:00Z') }), null)
})

test('clearing a draft removes only its exact identity', () => {
  const storage = memoryStorage()
  const a = { userId: 1, workspace: 'free', shotId: 1 }
  const b = { userId: 1, workspace: 'free', shotId: 2 }
  writePromptDraft(storage, a, { prompt: 'a' })
  writePromptDraft(storage, b, { prompt: 'b' })
  clearPromptDraft(storage, a)
  assert.equal(readPromptDraft(storage, a), null)
  assert.equal(readPromptDraft(storage, b).payload.prompt, 'b')
})
