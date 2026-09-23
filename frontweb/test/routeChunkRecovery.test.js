import test from 'node:test'
import assert from 'node:assert/strict'
import { clearRouteChunkRetry, isRouteChunkError, recoverRouteChunk } from '../src/utils/routeChunkRecovery.js'

test('missing route chunks retry the exact destination only once', t => {
  const values = new Map()
  const destinations = []
  const previousStorage = globalThis.sessionStorage
  const previousWindow = globalThis.window
  globalThis.sessionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  globalThis.window = { location: { assign: path => destinations.push(path) } }
  t.after(() => {
    globalThis.sessionStorage = previousStorage
    globalThis.window = previousWindow
  })

  assert.equal(isRouteChunkError(new Error('Failed to fetch dynamically imported module: /assets/FilmCreate-old.js')), true)
  assert.equal(isRouteChunkError(new Error('Unable to preload CSS for /assets/FilmCreate-old.css')), true)
  assert.equal(isRouteChunkError(new Error('API returned 503')), false)
  assert.equal(recoverRouteChunk('/film/21?stage=storyboard'), true)
  assert.deepEqual(destinations, ['/film/21?stage=storyboard'])
  assert.equal(recoverRouteChunk('/film/21?stage=storyboard'), false)
  clearRouteChunkRetry()
  assert.equal(recoverRouteChunk('/film/21?stage=storyboard'), true)
})
