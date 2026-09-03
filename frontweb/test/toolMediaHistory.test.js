import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseToolMediaFeatured } from '../src/utils/toolMediaHistory.js'

const activeStatuses = new Set(['processing', 'pending'])
const keyOf = (item) => item ? `${item.history_kind}:${item.id}` : ''

test('a new browser tab does not adopt another tab active task', () => {
  const active = { id: 3, history_kind: 'omni', status: 'processing' }
  const completed = { id: 2, history_kind: 'omni', status: 'completed' }

  assert.equal(chooseToolMediaFeatured([active, completed], { keyOf, activeStatuses }), completed)
  assert.equal(chooseToolMediaFeatured([active], { keyOf, activeStatuses }), null)
})

test('the current tab keeps the task that it submitted', () => {
  const submitted = { id: 4, history_kind: 'omni', status: 'processing' }
  const selected = chooseToolMediaFeatured([], {
    current: submitted,
    currentSubmissionKey: keyOf(submitted),
    keyOf,
    activeStatuses,
  })

  assert.equal(selected, submitted)
})

test('an explicit history selection stays selected during polling', () => {
  const selected = { id: 5, history_kind: 'omni', status: 'processing' }
  const completed = { id: 4, history_kind: 'omni', status: 'completed' }

  assert.equal(chooseToolMediaFeatured([selected, completed], {
    current: selected,
    keyOf,
    activeStatuses,
  }), selected)
})
