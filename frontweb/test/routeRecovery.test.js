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
