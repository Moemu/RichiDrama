import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { productionStatusLabel, productionStatusTone, productionTimelineType } from '../src/utils/productionPresentation.js'

test('production status presentation uses readable labels and matching tones', () => {
  assert.equal(productionStatusLabel('completed'), '已完成')
  assert.equal(productionStatusLabel('not_selected'), '未选择')
  assert.equal(productionStatusLabel('reconciliation_required'), '待对账')
  assert.equal(productionStatusTone('failed'), 'bad')
  assert.equal(productionStatusTone('local_ready'), 'good')
  assert.equal(productionTimelineType('processing'), 'primary')
})

test('production detail uses a status-neutral material heading and structured timeline', () => {
  const source = fs.readFileSync(new URL('../src/views/AdminConsole.vue', import.meta.url), 'utf8')
  assert.match(source, /<h3>请求素材（/)
  assert.doesNotMatch(source, /失败时素材/)
  assert.match(source, /class="production-timeline"/)
  assert.match(source, /class="timeline-stage-card"/)
  assert.match(source, /stageStatusLabel\(stage\.status\)/)
  assert.match(source, /stage\.updated_at \? formatChinaDateTime\(stage\.updated_at\) : '未记录'/)
})
