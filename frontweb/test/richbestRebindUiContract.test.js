import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('admin console exposes an explicit Richbest asset rebind workflow', () => {
  const view = fs.readFileSync(path.join(root, 'src/views/AdminConsole.vue'), 'utf8')
  const api = fs.readFileSync(path.join(root, 'src/api/account.js'), 'utf8')
  assert.match(view, /label="素材重绑"/)
  assert.match(view, /预览候选素材/)
  assert.match(view, /重新绑定所选素材/)
  assert.match(view, /confirm: true/)
  assert.match(view, /idempotency_key: createClientRequestId\('richbest-rebind'\)/)
  assert.match(api, /richbest-asset-rebind-candidates/)
  assert.match(api, /richbest-asset-rebinds/)
})
