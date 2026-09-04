import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { createShotSaveQueue, mergeSavedShot } from '../src/utils/shotSaveCoordinator.js'

const freeCreateSource = readFileSync(new URL('../src/views/FreeCreate.vue', import.meta.url), 'utf8')

test('shot switching keeps the latest click and never merges a save into currentShot', () => {
  assert.match(freeCreateSource, /const selectionRevision = \+\+shotSelectionRevision/)
  assert.match(freeCreateSource, /if \(selectionRevision !== shotSelectionRevision\) return false/)
  assert.match(freeCreateSource, /mergeSavedShot\(shots\.value, savingShotId,/)
  assert.doesNotMatch(freeCreateSource, /Object\.assign\(currentShot\.value, updated\)/)
  assert.doesNotMatch(freeCreateSource, /Object\.assign\(currentShot\.value, projectShot\(updated\)/)
})

test('a late save response only updates the shot that started the save', () => {
  const shots = [
    { id: 9, title: '镜头 9', video_url: '/nine.mp4' },
    { id: 10, title: '镜头 10', video_url: '/ten.mp4' },
  ]

  const updated = mergeSavedShot(shots, 9, { id: 10, title: '已保存镜头 9', video_url: '' }, { preserveMedia: true })

  assert.equal(updated, shots[0])
  assert.deepEqual(shots.map((shot) => shot.id), [9, 10])
  assert.equal(shots[0].title, '已保存镜头 9')
  assert.equal(shots[0].video_url, '/nine.mp4')
  assert.equal(shots[1].title, '镜头 10')
})

test('saves for the same shot run in request order', async () => {
  const enqueue = createShotSaveQueue()
  const events = []
  let releaseFirst
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })

  const first = enqueue(9, async () => {
    events.push('first:start')
    await firstGate
    events.push('first:end')
  })
  const second = enqueue(9, async () => {
    events.push('second:start')
    events.push('second:end')
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['first:start'])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end'])
})

test('a failed save does not stop the next save for that shot', async () => {
  const enqueue = createShotSaveQueue()
  await assert.rejects(enqueue(9, async () => { throw new Error('conflict') }), /conflict/)
  await assert.doesNotReject(enqueue(9, async () => 'saved'))
})
