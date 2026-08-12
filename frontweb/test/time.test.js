import test from 'node:test'
import assert from 'node:assert/strict'
import { formatChinaDateTime, formatChinaDate, formatChinaTime } from '../src/utils/time.js'

test('UTC business timestamps are always rendered in Asia/Shanghai', () => {
  const value = '2026-08-12T00:00:00.000Z'
  assert.match(formatChinaDateTime(value), /2026\/08\/12 08:00:00/)
  assert.match(formatChinaDate(value), /2026\/08\/12/)
  assert.match(formatChinaTime(value), /08:00:00/)
})
