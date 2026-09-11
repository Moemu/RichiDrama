import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { createClientRequestId } from '../src/utils/requestId.js'

test('request IDs work without randomUUID on an insecure origin', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'crypto', descriptor) : delete globalThis.crypto)
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: bytes => webcrypto.getRandomValues(bytes) } })
  const ids = Array.from({ length: 100 }, () => createClientRequestId())
  assert.equal(new Set(ids).size, 100)
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined })
  assert.match(createClientRequestId(), /^[0-9a-f-]{36}$/)
})
