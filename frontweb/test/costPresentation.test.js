import test from 'node:test'
import assert from 'node:assert/strict'
import { chinaDate, chinaTime, costMoney, usageText } from '../src/utils/costPresentation.js'
test('cost presentation preserves Shanghai month boundaries and uncertain amounts', () => {
  assert.equal(chinaDate('2026-08-31T16:00:00Z'), '2026-09-01')
  assert.match(chinaTime('2026-08-31T16:00:00Z'), /2026\/09\/01 00:00:00/)
  assert.equal(costMoney(null), '未确定')
  assert.equal(costMoney(75974179), 'CNY 75.97')
  assert.equal(costMoney(1000000, 'USD'), 'USD 1.00')
  assert.equal(usageText(null), '缺少计量证据')
})
