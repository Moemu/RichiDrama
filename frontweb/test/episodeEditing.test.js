import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parseScriptIntoEpisodes } from '../src/utils/scriptEpisodes.js'

const film = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
const saveScript = film.slice(film.indexOf('async function saveScriptToBackend('), film.indexOf('\n/**', film.indexOf('async function saveScriptToBackend(')))

test('saving episode 8 with multiple chapter headings updates only the selected identity', async () => {
  const episodes = Array.from({ length: 8 }, (_, i) => ({ id: 237 + i, episode_number: i + 1, title: `第${i + 1}集`, script_content: `original ${i + 1}`, updated_at: 'version' }))
  const calls = []
  const context = vm.createContext({
    parseScriptIntoEpisodes,
    store: { dramaId: 76, drama: { episodes }, currentEpisode: episodes[7] },
    scriptTitle: { value: '第8集' }, storyInput: { value: '' }, savedCurrentEpisodeNumber: { value: 8 },
    dramaAPI: { updateEpisode: async (...args) => calls.push(args) }, loadDrama: async () => {},
  })
  vm.runInContext(saveScript, context)
  const text = '第八集\n本集正文\n\n第九集\n下一集正文'
  await context.saveScriptToBackend(text)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 76)
  assert.equal(calls[0][1], episodes[7])
  assert.equal(calls[0][2].script_content, text)
  assert.equal(episodes[0].script_content, 'original 1')
  assert.equal(episodes.length, 8)
  context.dramaAPI.updateEpisode = async () => { throw new Error('分集已被修改') }
  await assert.rejects(context.saveScriptToBackend(text), /分集已被修改/)
})

test('new projects can still split a script into new episodes', async () => {
  const appended = []
  const context = vm.createContext({
    parseScriptIntoEpisodes,
    store: { dramaId: null, setDrama() {} },
    scriptTitle: { value: '' }, storyInput: { value: '' }, savedCurrentEpisodeNumber: { value: 1 },
    storyType: { value: '' }, generationStyle: { value: '' }, storyStyle: { value: '' },
    projectAspectRatio: { value: '16:9' }, projectStylePromptMetadata: () => ({}),
    dramaAPI: { create: async () => ({ id: 77 }), appendEpisodes: async (id, rows) => appended.push(...rows) },
    loadDrama: async () => {}, route: { params: { id: 'new' } }, router: { replace() {} }, ElMessage: { success() {} },
  })
  vm.runInContext(saveScript, context)
  await context.saveScriptToBackend('第一集\n正文一\n第二集\n正文二')
  assert.equal(appended.length, 2)
  assert.equal(appended[0].script_content, '正文一')
  assert.equal(appended[1].script_content, '正文二')
})

test('batch import waits for persistence and keeps the preview on failure', async () => {
  const component = readFileSync(new URL('../src/components/EpisodeBatchImportDialog.vue', import.meta.url), 'utf8')
  const fn = component.slice(component.indexOf('async function confirmImport()'), component.indexOf('</script>'))
  let rejectSave
  let succeeded = false
  let reset = false
  const messages = []
  const context = vm.createContext({
    props: { importEpisodes: () => new Promise((resolve, reject) => { rejectSave = reject }) },
    previewEpisodes: { value: [{ episode_number: 8, title: '第八集', script_content: '正文' }] },
    importing: { value: false }, resetState: () => { reset = true },
    ElMessage: { success: () => { succeeded = true }, error: message => messages.push(message), warning() {} },
  })
  vm.runInContext(fn, context)
  const pending = context.confirmImport()
  assert.equal(context.importing.value, true)
  assert.equal(succeeded, false)
  rejectSave(new Error('保存失败'))
  await pending
  assert.equal(succeeded, false)
  assert.equal(reset, false)
  assert.equal(context.importing.value, false)
  assert.deepEqual(messages, ['保存失败'])
})

test('adding an episode selects its returned ID instead of leaving the old editor selected', async () => {
  const start = film.indexOf('async function onAddEpisode()')
  const fn = film.slice(start, film.indexOf('\nfunction onUploadResourceClick', start))
  const context = vm.createContext({
    store: { dramaId: 76 }, selectedEpisodeId: { value: 237 }, savedCurrentEpisodeNumber: { value: 1 },
    dramaAPI: { appendEpisodes: async () => ({ episodes: [{ id: 400, episode_number: 9 }] }) },
    loadDrama: async () => { assert.equal(context.selectedEpisodeId.value, 400) },
    ElMessage: { success() {}, error(message) { throw new Error(message) } },
  })
  vm.runInContext(fn, context)
  await context.onAddEpisode()
  assert.equal(context.savedCurrentEpisodeNumber.value, 9)
})
