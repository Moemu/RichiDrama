import test from 'node:test'
import assert from 'node:assert/strict'
import { groupProjectResults, resultTitle } from '../src/utils/projectResults.js'

test('results use shot titles and remain grouped by episode order', () => {
  const episodes = [{ id: 90, episode_number: 2, title: '重逢' }, { id: 100, episode_number: 1, title: '来信' }]
  const results = [
    { id: 1, type: 'video', episode_id: 90, storyboard_number: 2, storyboard_title: '推开温室门' },
    { id: 2, type: 'image', episode_id: 100, storyboard_number: 1, storyboard_title: '展开旧信' },
    { id: 3, type: 'image', episode_id: 90, storyboard_number: 1 },
    { id: 4, type: 'image', episode_id: null },
  ]
  const groups = groupProjectResults(results, episodes)
  assert.deepEqual(groups.map(group => group.title), ['第 1 集 · 来信', '第 2 集 · 重逢', '未分集资源'])
  assert.deepEqual(groups[1].items.map(item => item.id), [3, 1])
  assert.equal(resultTitle(groups[0].items[0]), '展开旧信')
  assert.equal(resultTitle(results[2]), '分镜 1')
  assert.equal(resultTitle({ type: 'final', title: '来信' }), '本集成片')
  assert.equal(groupProjectResults(results, episodes, '90').length, 1)
  assert.equal(groupProjectResults(results, [{ id: 100, episode_number: 1, title: '第1集 · 来信' }], 100)[0].title, '第 1 集 · 来信')
})
