import test from 'node:test'
import assert from 'node:assert/strict'
import { compactQuantity } from '../src/utils/units.js'

test('price quantities use K, M, and B units', () => {
  assert.equal(compactQuantity(1000), '1K')
  assert.equal(compactQuantity(32768), '32K')
  assert.equal(compactQuantity(1000000), '1M')
  assert.equal(compactQuantity(1500000), '1.5M')
  assert.equal(compactQuantity(1000000000), '1B')
})
