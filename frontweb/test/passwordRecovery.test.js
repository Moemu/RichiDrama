import test from 'node:test'
import assert from 'node:assert/strict'
import { newPasswordError, clearPasswordSession } from '../src/utils/passwordRecovery.js'

test('password validation counts characters and rejects mismatching confirmation', () => {
  assert.equal(newPasswordError('新密码你好世界呀', '新密码你好世界呀'), '')
  assert.equal(newPasswordError('a'.repeat(128), 'a'.repeat(128)), '')
  assert.ok(newPasswordError('a'.repeat(129), 'a'.repeat(129)))
  assert.ok(newPasswordError('short', 'short'))
  assert.ok(newPasswordError('password123', 'other123'))
})

test('password session removal preserves unrelated local preferences', () => {
  const values = new Map([['lmd_auth_token', 'old'], ['lmd_auth_user', '{}'], ['theme', 'dark']])
  const original = globalThis.localStorage
  globalThis.localStorage = { removeItem: (key) => values.delete(key) }
  try { clearPasswordSession(); assert.deepEqual([...values], [['theme', 'dark']]) }
  finally { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original }
})
