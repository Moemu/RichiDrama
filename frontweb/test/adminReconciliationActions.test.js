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

// 运营台必须能从 LAS 待对账案件直接定位任务：没有任务定位列时，
// 运营只能拿案件 ID 去猜是哪次提交、哪个项目和哪些中转文件。
test('the reconciliation queue locates the source task for LAS cases', async () => {
  const view = await consoleSource()
  assert.match(view, /label="任务定位"[^>]*><template #default="\{row\}"><template v-if="row\.source_task">/)
  assert.match(view, /reconciliationTaskLabel\(row\.source_task\)/)
  assert.match(view, /row\.reference_type \? `\$\{row\.reference_type\} #\$\{row\.reference_id\}` : '—'/)
  assert.match(view, /v-if="row\.provider_request_id" class="reconciliation-task-subline">请求/)
})

test('the settlement dialog shows the located task, authorization and archived files', async () => {
  const view = await consoleSource()
  assert.match(view, /v-if="settleCase\?\.source_task"/)
  assert.match(view, /label="关联任务"/)
  assert.match(view, /\{\{ settleCase\.source_task\.provider_task_id \|\| settleCase\.provider_request_id \|\| '未受理（提交结果不确定）' \}\}/)
  assert.match(view, /label="预授权"/)
  assert.match(view, /label="已归档文件"/)
  assert.match(view, /无（未产出归档文件）/)
  // 只读信息用纯文本展示：disabled 输入框会裁切长任务定位文字。
  assert.doesNotMatch(view, /label="关联任务"[^>]*><el-input[^>]*disabled/)
})

// 中转治理可见性：运营台「媒体」页必须展示 LAS 耗时、失败阶段与 TOS 占用，
// 否则清理是否生效只能靠猜。
test('the media workbench surfaces LAS duration, failure phase and TOS transit usage', async () => {
  const [view, api] = await Promise.all([consoleSource(), apiSource()])
  assert.match(api, /lasJobs: \(params\) => request\.get\('\/admin\/las-jobs', \{ params \}\)/)
  assert.match(view, /视频本地化（LAS）/)
  assert.match(view, /平均供应商耗时/)
  assert.match(view, /中转待清理/)
  assert.match(view, /历史保留/)
  assert.match(view, /失败阶段/)
  assert.match(view, /lasCleanupLabel\(row\)/)
  assert.doesNotMatch(view, /label="任务"[\s\S]{0,200}v-if="false"/)
})
