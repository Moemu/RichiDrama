import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { currentRouteWithState, loginRouteForCurrentLocation, safeRedirectPath } from '../src/utils/routeRecovery.js'

test('refresh recovery preserves path, query and hash exactly', () => {
  const location = { pathname: '/film/2', search: '?episode=7&mode=storyboard', hash: '#shot-3' }
  assert.equal(currentRouteWithState(location), '/film/2?episode=7&mode=storyboard#shot-3')
  assert.equal(
    loginRouteForCurrentLocation(location),
    '/login?redirect=%2Ffilm%2F2%3Fepisode%3D7%26mode%3Dstoryboard%23shot-3',
  )
})

test('login recovery only accepts safe in-app destinations', () => {
  assert.equal(safeRedirectPath('/film/2?episode=7#shot-3'), '/film/2?episode=7#shot-3')
  assert.equal(safeRedirectPath('https://evil.example/path'), '/')
  assert.equal(safeRedirectPath('//evil.example/path'), '/')
  assert.equal(safeRedirectPath('/login?redirect=/admin'), '/')
  assert.equal(safeRedirectPath(undefined, '/ai-tools'), '/ai-tools')
})

test('film workflow persists its internal stage in the route query', () => {
  const source = readFileSync(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  assert.match(source, /normalizeWorkflowStage\(route\.query\.stage\)/)
  assert.match(source, /query:\s*\{\s*\.\.\.route\.query,\s*stage\s*\}/)
  assert.match(source, /watch\(\(\) => route\.query\.stage/)
})

test('secondary pages preserve a safe return destination', () => {
  const accountBadge = readFileSync(new URL('../src/components/AccountBalanceBadge.vue', import.meta.url), 'utf8')
  const accountCenter = readFileSync(new URL('../src/views/AccountCenter.vue', import.meta.url), 'utf8')
  const aiTools = readFileSync(new URL('../src/views/AITools.vue', import.meta.url), 'utf8')
  const aiConfig = readFileSync(new URL('../src/views/AiConfig.vue', import.meta.url), 'utf8')

  assert.match(accountBadge, /query:\s*\{\s*return_to:\s*route\.fullPath\s*\}/)
  assert.match(accountCenter, /safeRedirectPath\(rawReturnTo, '\/'\)/)
  assert.match(accountCenter, /returnTo\.startsWith\('\/account'\)/)
  assert.match(aiTools, /path:\s*'\/media-library',[\s\S]*return_to:\s*route\.fullPath/)
  assert.match(aiConfig, /safeRedirectPath\(rawReturnTo, '\/'\)/)
  assert.match(aiConfig, /returnTo\.startsWith\('\/ai-config'\)/)
})

test('project and tool return links target valid routes', () => {
  const freeCreate = readFileSync(new URL('../src/views/FreeCreate.vue', import.meta.url), 'utf8')
  const mediaTool = readFileSync(new URL('../src/views/ToolMediaGeneration.vue', import.meta.url), 'utf8')

  assert.match(freeCreate, /projectEpisodeId\.value\s*\?\s*\{\s*episode:\s*projectEpisodeId\.value\s*\}/)
  assert.doesNotMatch(freeCreate, /projectEpisodeId\.value\s*\?\s*\{\s*episode_id:/)
  assert.match(mediaTool, /class="brand"\s+to="\/"\s+aria-label="返回项目列表"/)
  assert.doesNotMatch(mediaTool, /class="brand"\s+to="\/film"/)
})
