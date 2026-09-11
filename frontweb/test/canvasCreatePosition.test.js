import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { browserModuleUrl, moduleSourceUrl } from './helpers/browserModule.js'
import { buildCanvasLayoutPayload } from '../src/utils/canvasLayout.js'

const { useCanvasCrud } = await import(await browserModuleUrl(new URL('../src/composables/useCanvasCrud.js', import.meta.url), {
  vue: import.meta.resolve('vue'),
  'element-plus': moduleSourceUrl('export const ElMessage = { success() {}, warning() {} }'),
  '@/api/drama': moduleSourceUrl('export const dramaAPI = {}'),
  '@/api/storyboards': moduleSourceUrl('export const storyboardsAPI = { create: async () => ({ id: 9 }) }'),
  '@/api/scenes': moduleSourceUrl('export const sceneAPI = {}'),
  '@/api/props': moduleSourceUrl('export const propAPI = {}'),
}))

test('creating at a canvas position saves against the post-create revision and keeps other nodes', async () => {
  const drama = ref({ id: 1, revision: 1, episodes: [{ id: 2, storyboards: [] }] })
  const nodes = ref([])
  const layoutCache = ref(null)
  let saved
  const crud = useCanvasCrud({
    drama, nodes, layoutCache, filterEpisodeId: ref(2), focusedNodeId: ref(null),
    async refreshCanvas() {
      drama.value.revision = 2
      nodes.value = [{ id: 'sb:8', type: 'canvasStoryboard', position: { x: 500, y: 90 } }, { id: 'sb:9', type: 'canvasStoryboard', position: { x: 0, y: 0 } }]
    },
    async persistCanvasState() {
      saved = { revision: drama.value.revision, layout: buildCanvasLayoutPayload(nodes.value, {}, layoutCache.value) }
    },
  })
  crud.openCreateDialog('storyboard', { x: 230, y: 410 })
  await crud.submitCreate({ title: '新镜头' })
  assert.equal(saved.revision, 2)
  assert.deepEqual(saved.layout.nodes['sb:9'], { x: 230, y: 410 })
  assert.deepEqual(saved.layout.nodes['sb:8'], { x: 500, y: 90 })
})
