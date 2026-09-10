import test from 'node:test'
import assert from 'node:assert/strict'
import { browserModuleUrl, moduleSourceUrl } from './helpers/browserModule.js'
import { captureProjectEdit, rememberProjectEntity, rememberProjectResponse } from '../src/utils/projectSnapshots.js'

const sessionUrl = moduleSourceUrl(`export const projectSession = { enabled: true, id: 800, connected: true, canEdit: true, revision: 3 }; export const hasPendingProjectText = () => false`)
const { installProjectRequestSync } = await import(await browserModuleUrl(new URL('../src/utils/projectRequestSync.js', import.meta.url), {
  '@/composables/useProjectCollaboration': sessionUrl,
  './projectSnapshots': new URL('../src/utils/projectSnapshots.js', import.meta.url).href,
  './requestId': new URL('../src/utils/requestId.js', import.meta.url).href,
  './projectEditBaseline': new URL('../src/utils/projectEditBaseline.js', import.meta.url).href,
}))
let intercept
let freshProject
installProjectRequestSync({ get: async (url, config) => { assert.equal(config.skipProjectSnapshot, true); return freshProject }, interceptors: { request: { use(fn) { intercept = fn } }, response: { use() {} } } })

test('structural saves use the displayed snapshot, not a newer socket revision', async () => {
  freshProject = { id: 800, revision: 3, episodes: [{ id: 801, storyboards: [{ id: 802, character_ids: [3] }] }] }
  rememberProjectEntity('dramas', { id: 800, revision: 2, episodes: [{ id: 801, storyboards: [{ id: 802, character_ids: [1] }] }] })
  const layout = await intercept({ method: 'put', url: '/dramas/800/canvas-layout', headers: {}, data: { canvas_layout: { nodes: { a: { x: 0 }, b: { x: 100 } } } } })
  assert.equal(layout.headers['X-Project-Revision'], 2)
  const relation = await intercept({ method: 'put', url: '/storyboards/802', headers: {}, data: { character_ids: [1, 2] } })
  assert.equal(relation.headers['X-Project-Revision'], 2)
})

test('generation settings follow confirmed own saves while unrelated text changes advance the project', async () => {
  const shot = { id: 802, episode_id: 801, duration: 15, video_resolution: '720p', video_aspect_ratio: '16:9' }
  rememberProjectEntity('dramas', { id: 800, revision: 6, episodes: [{ id: 801, storyboards: [shot] }] })
  freshProject = { id: 800, revision: 7, episodes: [{ id: 801, storyboards: [{ ...shot, description: '刚保存的文字' }] }] }
  const config = await intercept({ method: 'patch', url: '/storyboards/802/generation-settings', headers: {}, data: { scope: 'current', settings: { duration: 10 } } })
  assert.equal(config.headers['X-Project-Revision'], 7)
  rememberProjectResponse('/storyboards/802/generation-settings', { episode_id: 801, storyboards: [{ id: 802, effective: { duration: 10 } }] })
  freshProject = { id: 800, revision: 9, episodes: [{ id: 801, storyboards: [{ ...shot, duration: 10, description: '下一次文字修改' }] }] }
  const next = await intercept({ method: 'patch', url: '/storyboards/802/generation-settings', headers: {}, data: { scope: 'current', settings: { duration: 12 } } })
  assert.equal(next.headers['X-Project-Revision'], 9)
  freshProject.episodes[0].storyboards[0].duration = 8
  const conflict = await intercept({ method: 'patch', url: '/storyboards/802/generation-settings', headers: {}, data: { scope: 'current', settings: { duration: 12 } } })
  assert.equal(conflict.headers['X-Project-Revision'], 6)
})

test('asset usage aliases are compared rather than rewriting unchanged selections', async () => {
  rememberProjectEntity('storyboards', { id: 802, episode_id: 801, omni_asset_usage: { 10: 'reference' } }, 800, 9)
  const update = await intercept({ method: 'put', url: '/storyboards/802', headers: {}, data: { omni_asset_usage_json: { 10: 'reference' } } })
  assert.deepEqual(update.data, {})
})

test('an open edit form retains its baseline after unrelated HTTP refreshes', async () => {
  freshProject = { id: 800, revision: 3, characters: [{ id: 803, description: '其他人的修改' }] }
  rememberProjectEntity('characters', { id: 803, drama_id: 800, description: '原文' }, 800, 2)
  const config = captureProjectEdit('characters', 803)
  rememberProjectEntity('characters', { id: 803, drama_id: 800, description: '其他人的修改' }, 800, 3)
  const update = await intercept({ ...config, method: 'put', url: '/characters/803', headers: {}, data: { description: '我的草稿' } })
  assert.equal(update.headers['X-Project-Revision'], 2)
  assert.deepEqual(update.data, { description: '我的草稿' })
  assert.equal(captureProjectEdit('characters', 803).projectBaseline.description, '其他人的修改')
})

test('an unrelated own text save does not block a storyboard relation save during socket reconnect', async () => {
  const { projectSession } = await import(sessionUrl)
  projectSession.connected = false
  rememberProjectEntity('dramas', { id: 800, revision: 4, episodes: [{ id: 801, storyboards: [{ id: 802, character_ids: [1], description: '原文' }] }] })
  freshProject = { id: 800, revision: 5, episodes: [{ id: 801, storyboards: [{ id: 802, character_ids: [1], description: '自己刚保存的文字' }] }] }
  const update = await intercept({ method: 'put', url: '/storyboards/802', headers: {}, data: { character_ids: [1, 2] } })
  assert.equal(update.headers['X-Project-Revision'], 5)
  assert.deepEqual(update.data, { character_ids: [1, 2] })
  projectSession.connected = true
})
