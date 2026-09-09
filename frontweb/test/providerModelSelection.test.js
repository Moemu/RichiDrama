import test from 'node:test'
import assert from 'node:assert/strict'
import { providerGroups, resolveProviderConfig } from '../src/utils/providerModelSelection.js'

test('groups models by connection while preserving existing business bindings', () => {
  const configs = [
    { id: 1, provider_connection_id: 8, provider_connection_name: 'Shared', service_type: 'image', is_active: true, model: ['a', 'b'] },
    { id: 2, provider_connection_id: 8, provider_connection_name: 'Shared', service_type: 'storyboard_image', is_active: true, model: ['a'] },
    { id: 3, name: 'Legacy', service_type: 'storyboard_image', is_active: true, model: ['a'] },
    { id: 4, provider_connection_id: 9, provider_connection_name: 'Other', service_type: 'storyboard_image', is_active: true, model: ['a'] },
    { id: 5, service_type: 'storyboard_image', is_active: false, model: ['a'] },
  ]
  const groups = providerGroups(configs, 'storyboard_image', true)
  assert.equal(groups.length, 3)
  assert.deepEqual(groups[0].models, ['a', 'b'])
  assert.equal(groups[0].name, 'Shared')
  assert.equal(resolveProviderConfig(groups[0], 'a', 'storyboard_image').id, 2)
  assert.equal(resolveProviderConfig(groups[0], 'a', 'storyboard_image', 1).id, 1)
  assert.equal(resolveProviderConfig(groups[0], 'b', 'storyboard_image', 2).id, 1)
  assert.deepEqual(providerGroups(configs, 'storyboard_image')[0].configs.map(row => row.id), [2])
})
