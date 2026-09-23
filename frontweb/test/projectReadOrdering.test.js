import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

test('stale project detail retries once before reaching the page', async () => {
  const source = fs.readFileSync(new URL('../src/utils/request.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replace('export default request', '')
  let onResponse
  const retries = []
  const remembered = []
  const request = config => { retries.push(config); return Promise.resolve('fresh project') }
  request.interceptors = { request: { use() {} }, response: { use(fn) { onResponse = fn } } }
  const context = {
    axios: { create: () => request }, ElMessage: { error() {} },
    localStorage: { getItem: () => '' },
    projectSnapshot: () => ({ revision: 12 }),
    rememberProjectResponse: (...args) => remembered.push(args),
    rememberProjectAcknowledgement() {}, loginRouteForCurrentLocation() {},
  }
  vm.runInNewContext(source, context)
  const stale = { data: { success: true, data: { id: 3, revision: 11 } }, config: { url: '/dramas/3' } }
  assert.equal(await onResponse(stale), 'fresh project')
  assert.equal(retries.length, 1)
  assert.equal(retries[0]._staleProjectRetry, true)
  assert.equal(remembered.length, 0)
  await assert.rejects(onResponse({ ...stale, config: retries[0] }), /项目读取结果已过期/)
  assert.equal(retries.length, 1)
})
