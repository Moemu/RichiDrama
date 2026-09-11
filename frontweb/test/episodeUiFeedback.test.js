import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('episode failures keep normalized errors and leave one notification to the caller', async () => {
  let rejectResponse
  const messages = []
  const request = {
    interceptors: { request: { use() {} }, response: { use(ok, fail) { rejectResponse = fail } } },
    put: async (url, body, config) => rejectResponse({
      config, response: { status: 409, data: { error: { message: '分集已被修改，请刷新后重试' } } },
    }),
  }
  const context = vm.createContext({
    projectSession: { enabled: false },
    axios: { create: () => request }, localStorage: { getItem: () => null },
    window: { location: { pathname: '/film/1' } },
    ElMessage: { error: message => messages.push(message) },
  })
  vm.runInContext(read('../src/utils/request.js').replace(/^import .*\n/gm, '').replace('export default request', ''), context)
  vm.runInContext(read('../src/api/drama.js').replace(/^import .*\n/gm, '').replace('export const dramaAPI', 'var dramaAPI'), context)
  const ep = { id: 8, title: '第8集', script_content: '原稿', updated_at: '2026-09-11T00:00:00Z' }
  for (const action of [
    () => context.dramaAPI.appendEpisodes(1, []),
    () => context.dramaAPI.updateEpisode(1, ep, { script_content: '新稿' }),
    () => context.dramaAPI.deleteEpisode(1, ep),
  ]) {
    messages.length = 0
    await action().catch(error => context.ElMessage.error(error.message))
    assert.deepEqual(messages, ['分集已被修改，请刷新后重试'])
  }
  messages.length = 0
  await assert.rejects(rejectResponse({ config: {}, response: { status: 503 } }), error => error.message === '服务正在维护，请稍后重试')
  assert.deepEqual(messages, ['服务正在维护，请稍后重试'], 'unrelated requests retain their global notification')
  messages.length = 0
  await assert.rejects(rejectResponse({ config: { errorHandledLocally: true }, response: { status: 502 } }), error => error.message === '服务暂时不可用，请稍后重试')
  assert.deepEqual(messages, [])
})

test('episode focus waits for the filtered graph and does not reset zoom on data refresh', async () => {
  const props = { episodeId: null }
  const getNodes = { value: [{ id: 'script:1', type: 'canvasScript' }, { id: 'script:8', type: 'canvasScript' }] }
  const fits = []
  let onChange
  const context = vm.createContext({
    defineProps: () => props,
    useVueFlow: () => ({ getNodes, getViewport() {}, fitView: async options => fits.push(options) }),
    useNodesInitialized: () => ({ value: true }), useCanvasContext: () => ({}),
    onMounted() {}, onUnmounted() {}, nextTick: async () => {}, watch: (sources, callback) => { onChange = callback },
  })
  const script = read('../src/components/dramaCanvas/CanvasFlowAligner.vue').split('<script setup>')[1].split('</script>')[0]
  vm.runInContext(script.replace(/^import .*\n/gm, ''), context)
  await onChange([null, true])
  assert.equal(fits.length, 0, 'opening all episodes preserves the saved viewport')
  props.episodeId = 8
  await onChange([8, true])
  assert.equal(fits.length, 0, 'old all-episode graph must not be fitted')
  getNodes.value = [{ id: 'script:8', type: 'canvasScript' }]
  await onChange([8, false])
  assert.equal(fits.length, 0, 'wait for measured nodes')
  await onChange([8, true])
  assert.deepEqual(Array.from(fits[0].nodes), ['script:8', 'episode:8'])
  await onChange([8, true])
  assert.equal(fits.length, 1, 'polling or saving does not move the viewport')
  props.episodeId = null
  await onChange([null, true])
  assert.equal(fits.length, 2)
  assert.equal(fits[1].nodes, undefined, 'clearing the filter fits the full graph')
})
