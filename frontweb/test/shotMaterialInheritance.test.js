import test from 'node:test'
import assert from 'node:assert/strict'
import { planShotMaterialInheritance, referencedShotMaterialIds } from '../src/utils/shotMaterialInheritance.js'

test('resolves previous-shot references even when the current shot has no materials', () => {
  const shot = {
    prompt: '@图片1',
    prompt_document: { text: '@图片1', refs: [{ asset_id: 1, alias: '图片1', occurrence: 0 }] },
    assets: [{ asset_id: 1, usage: 'reference' }, { asset_id: 2, usage: 'last_frame' }],
  }
  assert.deepEqual([...referencedShotMaterialIds(shot, [
    { id: 1, type: 'image', reference_alias: '图片1' },
    { id: 2, type: 'image', reference_alias: '图片2' },
  ])], [1])
})

test('inherits available materials in order without replacing current materials or frame roles', () => {
  const available = [
    { id: 1, type: 'image' }, { id: 2, type: 'image' },
    { id: 3, type: 'video' }, { id: 4, type: 'image' },
  ]
  const source = [
    { asset_id: 1, usage: 'reference' },
    { asset_id: 2, usage: 'primary' },
    { asset_id: 3, usage: 'motion' },
    { asset_id: 4, usage: 'last_frame' },
  ]
  const result = planShotMaterialInheritance(source, available, [1], { total: 4, image: 2, video: 1, audio: 1 })
  assert.deepEqual(result.added.map(({ asset, usage }) => [asset.id, usage]), [[2, 'primary'], [3, 'motion']])
  assert.equal(result.frames, 1)
  assert.equal(result.overLimit, 0)
})

test('reports unavailable and over-limit materials without adding them', () => {
  const source = [
    { asset_id: 2, usage: 'reference' },
    { asset_id: 3, usage: 'reference' },
    { asset_id: 9, usage: 'reference' },
  ]
  const result = planShotMaterialInheritance(source, [
    { id: 1, type: 'image' }, { id: 2, type: 'image' }, { id: 3, type: 'video' },
  ], [1], { total: 2, image: 2, video: 1, audio: 1 })
  assert.deepEqual(result.added.map(({ asset }) => asset.id), [2])
  assert.equal(result.overLimit, 1)
  assert.equal(result.unavailable, 1)
})
