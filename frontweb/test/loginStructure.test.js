import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const loginSource = readFileSync(fileURLToPath(new URL('../src/views/Login.vue', import.meta.url)), 'utf8')

test('login presents a cinematic product entrance without changing the auth contract', () => {
  assert.match(loginSource, /login-cinematic-stage\.png/)
  assert.match(loginSource, /本地短剧<br><em>制作平台<\/em>/)
  assert.doesNotMatch(loginSource, /让脑海里的故事/)
  assert.match(loginSource, /灵感成形/)
  assert.match(loginSource, /世界建立/)
  assert.match(loginSource, /镜头开拍/)
  assert.match(loginSource, /request\.post\(`\/auth\/\$\{mode\.value\}`/)
  assert.match(loginSource, /localStorage\.setItem\('lmd_auth_token'/)
  assert.match(loginSource, /localStorage\.setItem\('lmd_auth_user'/)
})

test('login form keeps accessible labels, feedback and motion preferences', () => {
  assert.match(loginSource, /<label for="username">/)
  assert.match(loginSource, /<label for="password">/)
  assert.match(loginSource, /aria-live="polite"/)
  assert.match(loginSource, /aria-busy="loading"/)
  assert.match(loginSource, /role="tablist"/)
  assert.match(loginSource, /prefers-reduced-motion: reduce/)
  assert.match(loginSource, /prefers-contrast: more/)
  assert.match(loginSource, /forced-colors: active/)
})

test('login supports theme, password visibility and responsive layouts', () => {
  assert.match(loginSource, /toggleTheme/)
  assert.match(loginSource, /showPassword/)
  assert.match(loginSource, /@media \(max-width: 980px\)/)
  assert.match(loginSource, /@media \(max-width: 560px\)/)
})
