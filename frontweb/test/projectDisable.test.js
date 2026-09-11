import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('closing collaboration confirms text first and never discards late edits', async () => {
  const events = []
  let dirty = false
  let failSave = false
  let editDuringDisable = false
  const source = readFileSync(new URL('../src/components/ProjectMembers.vue', import.meta.url), 'utf8')
    .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  const context = vm.createContext({
    ref: value => ({ value }),
    defineProps: () => ({ dramaId: 1 }),
    defineEmits: () => event => events.push(event),
    ElMessageBox: { confirm: async () => {} },
    ElMessage: { error: message => events.push(message), success: message => events.push(message) },
    savePendingProjectText: async () => { events.push('save'); if (failSave) throw new Error('save failed'); dirty = false },
    hasUnsavedProjectText: () => dirty,
    closeProjectSession: () => events.push('close'),
    request: { post: async url => { events.push(url); dirty = editDuringDisable } },
  })
  vm.runInContext(source, context)
  failSave = true
  await context.disable()
  assert.deepEqual(events, ['save', 'save failed'])
  events.length = 0; failSave = false
  await context.disable()
  assert.deepEqual(events, ['save', '/dramas/1/collaboration/disable', 'close', '协作已关闭', 'updated'])
  events.length = 0; editDuringDisable = true
  await context.disable()
  assert.equal(events.includes('close'), false)
  assert.equal(events.includes('updated'), false)
  assert.match(events.at(-1), /请先复制备份/)
})
