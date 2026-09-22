import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const consoleSource = () => readFile(new URL('../src/views/AdminConsole.vue', import.meta.url), 'utf8')
const apiSource = () => readFile(new URL('../src/api/account.js', import.meta.url), 'utf8')

// A queue with no disposition buttons is the failure this pins: the backend has
// always been able to settle and waive, so an operator looking at a read-only
// list has no way to clear a case, and the frozen funds stay stuck until
// somebody calls the API by hand.
test('the reconciliation queue exposes both disposition actions', async () => {
  const [view, api] = await Promise.all([consoleSource(), apiSource()])
  assert.match(api, /settleReconciliation: \(id, data\) => request\.post\(`\/admin\/billing-reconciliations\/\$\{id\}\/settle`, data\)/)
  assert.match(api, /waiveReconciliation: \(id, data\) => request\.post\(`\/admin\/billing-reconciliations\/\$\{id\}\/waive`, data\)/)
  assert.match(view, /@click="openReconcileSettle\(row\)">按用量结算/)
  assert.match(view, /@click="waiveReconciliation\(row\)">豁免/)
  assert.match(view, /v-if="row\.status === 'pending'"/)
})

// Settlement charges the supplier's real usage, so the form has to know which
// meters were reserved; the projection carries them for exactly that reason.
test('settlement collects the reserved meters and requires a reason', async () => {
  const view = await consoleSource()
  assert.match(view, /const settleMeters = computed\(\(\) => Object\.keys\(settleCase\.value\?\.reservation_usage \|\| \{\}\)\)/)
  assert.match(view, /Object\.entries\(row\.reservation_usage \|\| \{\}\)\.forEach/)
  assert.match(view, /if \(!reason\) return ElMessage\.warning\('必须填写处置原因'\)/)
  assert.match(view, /:disabled="!settleMeters\.length"/)
})
