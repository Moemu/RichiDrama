import test from 'node:test'
import assert from 'node:assert/strict'
import { browserModuleUrl, moduleSourceUrl } from './helpers/browserModule.js'
import { captureProjectEdit, projectSnapshot, rememberProjectEntity, rememberProjectResponse, rememberProjectAcknowledgement } from '../src/utils/projectSnapshots.js'

const sessionUrl = moduleSourceUrl(`export const projectSession = { enabled: true, id: 800, connected: false, canEdit: true, revision: 90, writeContractVersion: 1 }; export const hasPendingProjectText = () => false`)
const snapshotsUrl = new URL('../src/utils/projectSnapshots.js', import.meta.url).href
const writeUrl = await browserModuleUrl(new URL('../src/utils/projectWriteContract.js', import.meta.url), { './projectSnapshots': snapshotsUrl })
const { advanceProjectEdit } = await import(writeUrl)
const { installProjectRequestSync } = await import(await browserModuleUrl(new URL('../src/utils/projectRequestSync.js', import.meta.url), {
  '@/composables/useProjectCollaboration': sessionUrl,
  './projectSnapshots': snapshotsUrl,
  './requestId': new URL('../src/utils/requestId.js', import.meta.url).href,
  './projectWriteContract': writeUrl,
}))
let intercept
installProjectRequestSync({ get: () => { throw new Error('Writes must not re-read project state') }, interceptors: { request: { use(fn) { intercept = fn } } } })
const prepare = (method, url, data, config = {}) => intercept({ method, url, data, headers: {}, ...config })

test('field and canvas preconditions use displayed values without a project revision', () => {
  rememberProjectEntity('dramas', { id: 800, revision: 2, metadata: { canvas_layout: { nodes: { a: { x: 0 } } } }, episodes: [{ id: 801, storyboards: [{ id: 802, episode_id: 801, character_ids: [1] }] }] })
  const layout = prepare('put', '/dramas/800/canvas-layout', { canvas_layout: { nodes: { a: { x: 10 } } } })
  assert.equal(layout.headers['X-Project-Revision'], undefined)
  assert.deepEqual(layout.data._project_edit.checks[0].fields.metadata.canvas_layout, { nodes: { a: { x: 0 } } })
  const relation = prepare('put', '/storyboards/802', { character_ids: [1, 2] })
  assert.deepEqual(relation.data._project_edit.checks[0].fields, { character_ids: [1] })
})

test('creation and certification commands do not inherit stale entity revisions', () => {
  rememberProjectEntity('assets', { id: 804, drama_id: 800, requires_sd2_identity: false }, 800, 1)
  for (const [url, body] of [['/storyboards', { episode_id: 801 }], ['/assets/804/sd2-certify', undefined], ['/assets/804/sd2-certify/refresh', undefined], ['/dramas/800/resources/import', { source_id: 7 }]]) {
    const config = prepare('post', url, body)
    assert.ok(config.headers['X-Project-Operation'])
    assert.equal(config.headers['X-Project-Revision'], undefined)
    assert.equal(config.data?._project_edit, undefined)
  }
  const declaration = prepare('put', '/assets/804', { requires_sd2_identity: true })
  assert.deepEqual(declaration.data._project_edit.checks[0].fields, { requires_sd2_identity: false })
})

test('legacy bulk replacement retains its version guard until it supports field preconditions', () => {
  rememberProjectEntity('dramas', { id: 800, revision: 3 })
  const config = prepare('put', '/dramas/800/characters', { characters: [] })
  assert.equal(config.headers['X-Project-Revision'], 3)
  assert.equal(config.data._project_edit, undefined)
})

test('generation edits use acknowledged parameters and preserve override semantics', () => {
  rememberProjectEntity('dramas', { id: 800, revision: 6, episodes: [{ id: 801, storyboards: [{ id: 802, episode_id: 801, duration: 15, video_resolution: '720p', video_aspect_ratio: '16:9', generation_overrides: {} }] }] })
  const config = prepare('patch', '/storyboards/802/generation-settings', { scope: 'current', settings: { duration: 10 } })
  assert.equal(config.data._project_edit.checks[0].fields.generation_state[0][3], 15)
  rememberProjectResponse('/storyboards/802/generation-settings', { episode_id: 801, storyboards: [{ id: 802, overrides: { duration: 10 }, effective: { duration: 10 } }] })
  const next = prepare('patch', '/storyboards/802/generation-settings', { scope: 'current', settings: { duration: 12 } })
  assert.equal(next.data._project_edit.checks[0].fields.generation_state[0][3], 10)
  assert.deepEqual(next.data._project_edit.checks[0].fields.generation_state[0][8], { duration: 10 })
})

test('unchanged aliases are omitted and successful field acknowledgements advance the baseline', () => {
  rememberProjectEntity('storyboards', { id: 802, episode_id: 801, omni_asset_usage: { 10: 'reference' }, audio_volume: 1 }, 800, 9)
  const update = prepare('put', '/storyboards/802', { omni_asset_usage_json: { 10: 'reference' } })
  assert.deepEqual(update.data._project_edit.checks[0].fields, {})
  assert.equal(update.data.omni_asset_usage_json, undefined)
  rememberProjectAcknowledgement({ drama_id: 800, revision: 99, entities: [{ kind: 'storyboards', entity: { id: 802, audio_volume: 0.5 } }] })
  assert.deepEqual(prepare('put', '/storyboards/802', { audio_volume: 0.7 }).data._project_edit.checks[0].fields, { audio_volume: 0.5 })
})

test('an open form retains its baseline after unrelated HTTP refreshes', () => {
  rememberProjectEntity('characters', { id: 803, drama_id: 800, description: '原文' }, 800, 2)
  const baseline = captureProjectEdit('characters', 803)
  rememberProjectEntity('characters', { id: 803, drama_id: 800, description: '其他人的修改' }, 800, 3)
  const update = prepare('put', '/characters/803', { description: '我的草稿' }, baseline)
  assert.deepEqual(update.data._project_edit.checks[0].fields, { description: '原文' })
  assert.equal(update.data.description, '我的草稿')
  assert.equal(captureProjectEdit('characters', 803).projectBaseline.description, '其他人的修改')
})

test('list wrappers and creation responses update the complete episode order', () => {
  rememberProjectResponse('/episodes/801/storyboards', { storyboards: [{ id: 802, episode_id: 801, position: 0 }, { id: 805, episode_id: 801, position: 1 }] })
  rememberProjectResponse('/storyboards', { id: 806, episode_id: 801, position: 2 })
  const reorder = prepare('put', '/storyboards/reorder', { episode_id: 801, ids: [806, 802, 805] })
  assert.deepEqual(reorder.data._project_edit.checks[0].fields.storyboard_order, [802, 805, 806])
  rememberProjectResponse('/storyboards/reorder', { storyboards: [{ id: 806, episode_id: 801, position: 0 }, { id: 802, episode_id: 801, position: 1 }, { id: 805, episode_id: 801, position: 2 }] })
  assert.deepEqual(projectSnapshot('episodes', 801).storyboard_order, [806, 802, 805])
})

test('authentication retries preserve the prepared operation and original preconditions', () => {
  const first = prepare('put', '/assets/804', { requires_sd2_identity: true })
  rememberProjectEntity('assets', { id: 804, drama_id: 800, requires_sd2_identity: true })
  assert.equal(intercept(first), first)
  assert.deepEqual(first.data._project_edit.checks[0].fields, { requires_sd2_identity: false })
})

test('a working form advances only its own saved fields and keeps unseen peer fields pinned', () => {
  const baseline = { id: 802, __projectId: 800, audio_volume: 1, omni_asset_ids: [] }
  advanceProjectEdit(baseline, { audio_volume: 0.7, omni_asset_ids: [] }, { audio_volume: 0.7, omni_asset_ids: [44], updated_at: 'confirmed' })
  assert.equal(baseline.audio_volume, 0.7)
  assert.deepEqual(baseline.omni_asset_ids, [])
  rememberProjectEntity('storyboards', { id: 802, episode_id: 801, audio_volume: 0.7, omni_asset_ids: [44] }, 800, 105)
  const save = prepare('put', '/storyboards/802', { audio_volume: 0.8, omni_asset_ids: [] }, { projectBaseline: baseline })
  assert.deepEqual(save.data._project_edit.checks[0].fields, { audio_volume: 0.7 })
  assert.equal(save.data.omni_asset_ids, undefined)
})
