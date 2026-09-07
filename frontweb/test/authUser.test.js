import test from 'node:test'
import assert from 'node:assert/strict'
import { readAuthUser, writeAuthUser } from '../src/utils/authUser.js'

function storageWith(value) {
  const values = new Map(value == null ? [] : [['lmd_auth_user', value]])
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, next) { values.set(key, String(next)) },
    removeItem(key) { values.delete(key) },
    has(key) { return values.has(key) },
  }
}

test('damaged cached user is removed without touching the session token', () => {
  const storage = storageWith('{"username":')
  storage.setItem('lmd_auth_token', 'valid-token')

  assert.equal(readAuthUser(storage), null)
  assert.equal(storage.has('lmd_auth_user'), false)
  assert.equal(storage.getItem('lmd_auth_token'), 'valid-token')
})

test('valid cached user remains available and can be written through the shared helper', () => {
  const storage = storageWith(JSON.stringify({ id: 7, username: 'admin', console_access: true }))
  assert.deepEqual(readAuthUser(storage), { id: 7, username: 'admin', console_access: true })

  writeAuthUser({ id: 8, username: 'writer' }, storage)
  assert.deepEqual(readAuthUser(storage), { id: 8, username: 'writer' })
})
