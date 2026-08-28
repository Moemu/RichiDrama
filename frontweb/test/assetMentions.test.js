import test from 'node:test'
import assert from 'node:assert/strict'
import { assetAliasValues, findAssetMentions, promptAliasForAsset } from '../src/utils/assetMentions.js'

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
