import test from 'node:test'
import assert from 'node:assert/strict'

import { getDefaultCapabilityModel, getSelectableModels } from '../src/utils/modelSelection.js'

const configs = [
  {
    id: 1,
    service_type: 'text',
    is_active: true,
    is_default: true,
    model: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    default_model: 'deepseek-v4-flash',
  },
  {
    id: 2,
    service_type: 'text',
    is_active: true,
    is_default: false,
    model: ['qwen-plus'],
    default_model: 'qwen-plus',
  },
]

test('uses default active config models when no config is selected', () => {
  assert.deepEqual(getSelectableModels(configs, 'text', null), [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
  ])
})

test('uses selected config models when config is selected', () => {
  assert.deepEqual(getSelectableModels(configs, 'text', 2), ['qwen-plus'])
})

test('selects the configured default video capability for a new tab', () => {
  assert.equal(getDefaultCapabilityModel([
    { model: 'video-secondary', is_default: false },
    { model: 'video-default', is_default: true },
  ]), 'video-default')
  assert.equal(getDefaultCapabilityModel([{ model: 'video-first' }]), 'video-first')
  assert.equal(getDefaultCapabilityModel([]), '')
})
