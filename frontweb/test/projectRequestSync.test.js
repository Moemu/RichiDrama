import test from 'node:test'
import assert from 'node:assert/strict'
import { browserModuleUrl, moduleSourceUrl } from './helpers/browserModule.js'
import { captureProjectEdit, projectSnapshot, rememberProjectEntity, rememberProjectResponse, rememberProjectAcknowledgement } from '../src/utils/projectSnapshots.js'

const sessionUrl = moduleSourceUrl(`export const projectSession = { enabled: true, id: 800, connected: false, canEdit: true, revision: 90, writeContractVersion: 1 }; export const hasPendingProjectText = () => false; export const savePendingProjectText = async () => { await globalThis.confirmProjectText?.() }`)
const snapshotsUrl = new URL('../src/utils/projectSnapshots.js', import.meta.url).href
const writeUrl = await browserModuleUrl(new URL('../src/utils/projectWriteContract.js', import.meta.url), { './projectSnapshots': snapshotsUrl })
const { advanceProjectEdit, mergeGenerationState } = await import(writeUrl)
const { installProjectRequestSync } = await import(await browserModuleUrl(new URL('../src/utils/projectRequestSync.js', import.meta.url), {
  '@/composables/useProjectCollaboration': sessionUrl,
  './projectSnapshots': snapshotsUrl,
  './requestId': new URL('../src/utils/requestId.js', import.meta.url).href,
  './projectWriteContract': writeUrl,
}))
let intercept
installProjectRequestSync({ get: () => { throw new Error('Writes must not re-read project state') }, interceptors: { request: { use(fn) { intercept = fn } } } })
const prepare = (method, url, data, config = {}) => intercept({ method, url, data, headers: {}, ...config })

test('field and canvas preconditions use displayed values without a project revision', async () => {
  rememberProjectEntity('dramas', { id: 800, revision: 2, metadata: { canvas_layout: { nodes: { a: { x: 0 } } } }, episodes: [{ id: 801, storyboards: [{ id: 802, episode_id: 801, character_ids: [1] }] }] })
  const layout = await prepare('put', '/dramas/800/canvas-layout', { canvas_layout: { nodes: { a: { x: 10 } } } })
  assert.equal(layout.headers['X-Project-Revision'], undefined)
  assert.deepEqual(layout.data._project_edit.checks[0].fields.metadata.canvas_layout, { nodes: { a: { x: 0 } } })
  const relation = await prepare('put', '/storyboards/802', { character_ids: [1, 2] })
  assert.deepEqual(relation.data._project_edit.checks[0].fields, { character_ids: [1] })
})

test('creation and certification commands do not inherit stale entity revisions', async () => {
  rememberProjectEntity('assets', { id: 804, drama_id: 800, requires_sd2_identity: false }, 800, 1)
  for (const [url, body] of [['/storyboards', { episode_id: 801 }], ['/assets/804/sd2-certify', undefined], ['/assets/804/sd2-certify/refresh', undefined], ['/dramas/800/resources/import', { source_id: 7 }]]) {
    const config = await prepare('post', url, body)
    assert.ok(config.headers['X-Project-Operation'])
    assert.equal(config.headers['X-Project-Revision'], undefined)
    assert.equal(config.data?._project_edit, undefined)
  }
  const declaration = await prepare('put', '/assets/804', { requires_sd2_identity: true })
  assert.deepEqual(declaration.data._project_edit.checks[0].fields, { requires_sd2_identity: false })
})

test('legacy bulk replacement retains its version guard until it supports field preconditions', async () => {
  rememberProjectEntity('dramas', { id: 800, revision: 3 })
  const config = await prepare('put', '/dramas/800/characters', { characters: [] })
  assert.equal(config.headers['X-Project-Revision'], 3)
  assert.equal(config.data._project_edit, undefined)
})

test('nested and parent-reference commands receive operation ids without claiming personal resources', async () => {
  rememberProjectEntity('scenes', { id: 810, drama_id: 800 })
  rememberProjectEntity('characters', { id: 811, drama_id: 800 })
  rememberProjectEntity('props', { id: 812, drama_id: 800 })
  for (const [url, body] of [
    ['/images/episode/801/backgrounds/extract', {}], ['/videos/episode/801/batch', {}],
    ['/scenes/generate-image', { scene_id: 810 }], ['/images', { character_id: 811 }],
    ['/images', { prop_id: 812 }], ['/storyboards/batch-infer-params', { storyboard_ids: [802] }],
    ['/characters/batch-generate-images', { character_ids: [811] }],
  ]) assert.ok((await prepare('post', url, body)).headers['X-Project-Operation'], url)
  assert.equal((await prepare('post', '/images', { prompt: '个人生成' })).headers['X-Project-Operation'], undefined)
  assert.equal((await prepare('post', '/images', { scene_id: 999999 })).headers['X-Project-Operation'], undefined)
})

test('generation edits use acknowledged parameters and preserve override semantics', async () => {
  rememberProjectEntity('dramas', { id: 800, revision: 6, episodes: [{ id: 801, storyboards: [{ id: 802, episode_id: 801, duration: 15, video_resolution: '720p', video_aspect_ratio: '16:9', generation_overrides: {} }] }] })
  const config = await prepare('patch', '/storyboards/802/generation-settings', { scope: 'current', settings: { duration: 10 } })
  assert.equal(config.data._project_edit.checks[0].fields.generation_state[0][3], 15)
  rememberProjectResponse('/storyboards/802/generation-settings', { episode_id: 801, storyboards: [{ id: 802, overrides: { duration: 10 }, effective: { duration: 10 } }] })
  const next = await prepare('patch', '/storyboards/802/generation-settings', { scope: 'current', settings: { duration: 12 } })
  assert.equal(next.data._project_edit.checks[0].fields.generation_state[0][3], 10)
  assert.deepEqual(next.data._project_edit.checks[0].fields.generation_state[0][8], { duration: 10 })
})

test('generation baselines use stored values while the UI retains inherited effective settings', async () => {
  const raw = [[802, 'auto', 'auto', 5, '720p', '16:9', null, null, {}]]
  const contract = { episode_id: 801, generation_state: raw, storyboards: [{ id: 802, overrides: {}, effective: { duration: 15, upscale_resolution: '1080p' } }] }
  rememberProjectResponse('/episodes/801/generation-settings', contract)
  assert.deepEqual((await prepare('patch', '/storyboards/802/generation-settings', { settings: { duration: 10 } })).data._project_edit.checks[0].fields.generation_state, raw)
  const baseline = mergeGenerationState([], contract)
  assert.deepEqual(baseline, raw)
  baseline[0][3] = 9
  assert.equal(contract.generation_state[0][3], 5)
  rememberProjectResponse('/storyboards/802/generation-settings/overrides', { ...contract, generation_state: [[802, 'auto', 'auto', 15, '720p', '16:9', '1080p', null, {}]] })
  assert.equal(projectSnapshot('storyboards', 802).duration, 15)
})

test('unchanged aliases are omitted and successful field acknowledgements advance the baseline', async () => {
  rememberProjectEntity('storyboards', { id: 802, episode_id: 801, omni_asset_usage: { 10: 'reference' }, audio_volume: 1 }, 800, 9)
  const update = await prepare('put', '/storyboards/802', { omni_asset_usage_json: { 10: 'reference' } })
  assert.deepEqual(update.data._project_edit.checks[0].fields, {})
  assert.equal(update.data.omni_asset_usage_json, undefined)
  rememberProjectAcknowledgement({ drama_id: 800, revision: 99, entities: [{ kind: 'storyboards', entity: { id: 802, audio_volume: 0.5 } }] })
  assert.deepEqual((await prepare('put', '/storyboards/802', { audio_volume: 0.7 })).data._project_edit.checks[0].fields, { audio_volume: 0.5 })
})

test('an open form retains its baseline after unrelated HTTP refreshes', async () => {
  rememberProjectEntity('characters', { id: 803, drama_id: 800, description: '原文' }, 800, 2)
  const baseline = captureProjectEdit('characters', 803)
  rememberProjectEntity('characters', { id: 803, drama_id: 800, description: '其他人的修改' }, 800, 3)
  const update = await prepare('put', '/characters/803', { description: '我的草稿' }, baseline)
  assert.deepEqual(update.data._project_edit.checks[0].fields, { description: '原文' })
  assert.equal(update.data.description, '我的草稿')
  assert.equal(captureProjectEdit('characters', 803).projectBaseline.description, '其他人的修改')
})

test('list wrappers and creation responses update the complete episode order', async () => {
  rememberProjectResponse('/episodes/801/storyboards', { storyboards: [{ id: 802, episode_id: 801, position: 0 }, { id: 805, episode_id: 801, position: 1 }] })
  rememberProjectResponse('/storyboards', { id: 806, episode_id: 801, position: 2 })
  const reorder = await prepare('put', '/storyboards/reorder', { episode_id: 801, ids: [806, 802, 805] })
  assert.deepEqual(reorder.data._project_edit.checks[0].fields.storyboard_order, [802, 805, 806])
  rememberProjectResponse('/storyboards/reorder', { storyboards: [{ id: 806, episode_id: 801, position: 0 }, { id: 802, episode_id: 801, position: 1 }, { id: 805, episode_id: 801, position: 2 }] })
  assert.deepEqual(projectSnapshot('episodes', 801).storyboard_order, [806, 802, 805])
})

test('authentication retries preserve the prepared operation and original preconditions', async () => {
  const first = await prepare('put', '/assets/804', { requires_sd2_identity: true })
  rememberProjectEntity('assets', { id: 804, drama_id: 800, requires_sd2_identity: true })
  assert.equal(await intercept(first), first)
  assert.deepEqual(first.data._project_edit.checks[0].fields, { requires_sd2_identity: false })
})

test('a working form advances only its own saved fields and keeps unseen peer fields pinned', async () => {
  const baseline = { id: 802, __projectId: 800, audio_volume: 1, omni_asset_ids: [] }
  advanceProjectEdit(baseline, { audio_volume: 0.7, omni_asset_ids: [] }, { audio_volume: 0.7, omni_asset_ids: [44], updated_at: 'confirmed' })
  assert.equal(baseline.audio_volume, 0.7)
  assert.deepEqual(baseline.omni_asset_ids, [])
  rememberProjectEntity('storyboards', { id: 802, episode_id: 801, audio_volume: 0.7, omni_asset_ids: [44] }, 800, 105)
  const save = await prepare('put', '/storyboards/802', { audio_volume: 0.8, omni_asset_ids: [] }, { projectBaseline: baseline })
  assert.deepEqual(save.data._project_edit.checks[0].fields, { audio_volume: 0.7 })
  assert.equal(save.data.omni_asset_ids, undefined)
})


test('scoped mutations wait for text acknowledgement and reject failed text saves', async t => {
  let confirm
  let prepared = false
  globalThis.confirmProjectText = () => new Promise(resolve => { confirm = resolve })
  t.after(() => { delete globalThis.confirmProjectText })
  const pending = prepare('put', '/assets/804', { requires_sd2_identity: false }).then(config => { prepared = true; return config })
  await Promise.resolve()
  assert.equal(prepared, false)
  confirm()
  assert.equal((await pending).projectWritePrepared, true)
  globalThis.confirmProjectText = async () => { throw new Error('文本尚未保存') }
  await assert.rejects(prepare('put', '/assets/804', {}, { errorHandledLocally: true }), error => {
    assert.equal(error.config.errorHandledLocally, true)
    return error.message === '文本尚未保存'
  })
  assert.equal((await prepare('post', '/dramas/800/collaboration/text', {})).projectWritePrepared, undefined, 'text acknowledgement must not recurse through the barrier')
})
