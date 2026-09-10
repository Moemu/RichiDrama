import test from 'node:test'
import assert from 'node:assert/strict'
import { browserModuleUrl, moduleSourceUrl } from './helpers/browserModule.js'
import { captureProjectEdit, rememberProjectEntity } from '../src/utils/projectSnapshots.js'

const sessionUrl = moduleSourceUrl(`export const projectSession = { enabled: true, id: 800, connected: true, canEdit: true, revision: 3 }; export const hasPendingProjectText = () => false`)
const { installProjectRequestSync } = await import(await browserModuleUrl(new URL('../src/utils/projectRequestSync.js', import.meta.url), {
  '@/composables/useProjectCollaboration': sessionUrl,
  './projectSnapshots': new URL('../src/utils/projectSnapshots.js', import.meta.url).href,
  './requestId': new URL('../src/utils/requestId.js', import.meta.url).href,
}))
let intercept
installProjectRequestSync({ interceptors: { request: { use(fn) { intercept = fn } }, response: { use() {} } } })

test('structural saves use the displayed snapshot, not a newer socket revision', () => {
  rememberProjectEntity('dramas', { id: 800, revision: 2, episodes: [{ id: 801, storyboards: [{ id: 802, character_ids: [1] }] }] })
  const layout = intercept({ method: 'put', url: '/dramas/800/canvas-layout', headers: {}, data: { canvas_layout: { nodes: { a: { x: 0 }, b: { x: 100 } } } } })
  assert.equal(layout.headers['X-Project-Revision'], 2)
  const relation = intercept({ method: 'put', url: '/storyboards/802', headers: {}, data: { character_ids: [1, 2] } })
  assert.equal(relation.headers['X-Project-Revision'], 2)
})

test('an open edit form retains its baseline after unrelated HTTP refreshes', () => {
  rememberProjectEntity('characters', { id: 803, drama_id: 800, description: '原文' }, 800, 2)
  const config = captureProjectEdit('characters', 803)
  rememberProjectEntity('characters', { id: 803, drama_id: 800, description: '其他人的修改' }, 800, 3)
  const update = intercept({ ...config, method: 'put', url: '/characters/803', headers: {}, data: { description: '我的草稿' } })
  assert.equal(update.headers['X-Project-Revision'], 2)
  assert.deepEqual(update.data, { description: '我的草稿' })
  assert.equal(captureProjectEdit('characters', 803).projectBaseline.description, '其他人的修改')
})
