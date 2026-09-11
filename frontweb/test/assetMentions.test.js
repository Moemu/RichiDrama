import test from 'node:test'
import assert from 'node:assert/strict'
import { assetAliasValues, findAssetMentions, promptAliasForAsset, resolveAssetReferences } from '../src/utils/assetMentions.js'

const customerAsset = {
  id: 552,
  type: 'image',
  name: '镜号05：传统系统设备与布线复杂 (2).png',
  reference_alias: '图片552',
}

test('prompt insertion uses the stable alias instead of a file name with spaces', () => {
  assert.equal(promptAliasForAsset(customerAsset), '图片552')
  assert.ok(assetAliasValues(customerAsset).includes(customerAsset.name))
})

test('stable asset mention resolves as one complete token', () => {
  assert.deepEqual(findAssetMentions('保持 @图片552 的设备布局', [customerAsset]), [
    { alias: '图片552', index: 3, token: '@图片552', end: 9 },
  ])
})

test('legacy file-name mention with spaces remains recoverable', () => {
  const text = `保持 @${customerAsset.name} 的设备布局`
  assert.deepEqual(findAssetMentions(text, [customerAsset]), [
    { alias: customerAsset.name, index: 3, token: `@${customerAsset.name}`, end: 3 + customerAsset.name.length + 1 },
  ])
})

test('project copy resolves its source token without rewriting historical metadata', () => {
  const copy = { id: 20, type: 'image', reference_alias: '图片20', project_source: { source_asset_id: 19 } }
  const saved = { text: '保持 @图片19 的构图', refs: [] }
  const resolved = resolveAssetReferences(saved.text, [copy], saved)
  assert.deepEqual(resolved.refs, [{ asset_id: 20, alias: '图片19', occurrence: 0, start: 3, end: 8 }])
  assert.deepEqual(saved.refs, [])
  assert.equal(copy.reference_alias, '图片20')
})

test('saved reference disambiguates copied aliases and unknown ownership is never guessed', () => {
  const copies = [20, 21].map(id => ({ id, type: 'image', project_source: { source_asset_id: 19 } }))
  const text = '@图片19'
  const ambiguous = resolveAssetReferences(text, copies, { refs: [] })
  assert.deepEqual(ambiguous.refs, [])
  assert.deepEqual(ambiguous.unresolved[0].candidate_asset_ids, [20, 21])
  const explicit = resolveAssetReferences(text, copies, { refs: [{ asset_id: 21, alias: '图片19' }] })
  assert.equal(explicit.refs[0].asset_id, 21)
  assert.deepEqual(resolveAssetReferences('@图片18', copies, { refs: [] }).refs, [])
})
