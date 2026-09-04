import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/utils/request.js', import.meta.url), 'utf8')

test('a stale 401 cannot remove a newer shared browser session', () => {
  const staleGuard = source.indexOf('failedToken !== currentToken')
  const sessionRemoval = source.indexOf('clearCurrentSession()', staleGuard)
  assert.ok(staleGuard >= 0)
  assert.ok(sessionRemoval > staleGuard)
  assert.match(source, /请求使用了旧登录状态，请重试/)
})

test('a current-token 401 verifies the HttpOnly cookie before logout', () => {
  assert.match(source, /await probeCookieSession\(\)/)
  assert.match(source, /_lmdUseCookieOnly: true/)
  assert.match(source, /_lmdAuthRecovery: true/)
  assert.match(source, /if \(cookieSession === null\) return Promise\.reject\(error\)/)
})
