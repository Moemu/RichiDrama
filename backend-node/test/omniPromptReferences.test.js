const test = require('node:test');
const assert = require('node:assert/strict');
const { prioritizePromptReferenceAssets, bindPromptReferences } = require('../src/services/omniVideoService');

test('explicit @ references are prioritized and bound to the uploaded image slots', () => {
  const assets = [
    { id: 1, alias: '未引用场景', type: 'image', ordinal: 1 },
    { id: 2, alias: '女主', type: 'image', ordinal: 2 },
    { id: 3, alias: '教室', type: 'image', ordinal: 3 },
  ];
  const prompt = '@女主 坐在 @教室 的窗边。';
  const document = { text: prompt, refs: [{ asset_id: 2, alias: '女主' }, { asset_id: 3, alias: '教室' }] };
  const ordered = prioritizePromptReferenceAssets(assets, document, prompt);

  assert.deepEqual(ordered.map((asset) => asset.id), [2, 3, 1]);
  const bound = bindPromptReferences(prompt, document, ordered.map((asset) => ({ ...asset, send_to_model: true })));
  assert.match(bound, /@图片1 坐在 @图片2/);
  assert.match(bound, /@图片1（女主）/);
  assert.match(bound, /@图片2（教室）/);
  assert.match(bound, /不得忽略、替换或弱化/);
});

test('a referenced prop is explicitly required to appear in the frame', () => {
  const prompt = '手里拿着 @泛黄寻人传单。';
  const document = { text: prompt, refs: [{ asset_id: 22, alias: '泛黄寻人传单' }] };
  const bound = bindPromptReferences(prompt, document, [{ id: 22, alias: '泛黄寻人传单', type: 'image', usage: 'prop', send_to_model: true }]);
  assert.match(bound, /该道具必须在画面中清晰、可辨认地出现/);
  assert.match(bound, /关键文字、图案或外观特征/);
});

test('unreferenced @ tokens are not rewritten when no matching image was uploaded', () => {
  const prompt = '@不存在 的素材不应伪造绑定。';
  const bound = bindPromptReferences(prompt, { text: prompt, refs: [] }, [{ id: 1, alias: '场景', type: 'image', send_to_model: true }]);
  assert.equal(bound, prompt);
});
