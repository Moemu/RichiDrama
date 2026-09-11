import test from 'node:test'
import assert from 'node:assert/strict'
import { activeGenerationStatuses, normalizeJob, resolveShotPreviewJob, shotPreviewVideoUrl } from '../src/utils/shotPreview.js'

const adopted = { id: 1, status: 'completed', is_current: true, videoUrl: '/static/old.mp4' }
const shot = { omni_job_id: 1, video_url: adopted.videoUrl }

test('refresh prioritizes every active generation stage over the adopted video', () => {
  for (const status of activeGenerationStatuses) {
    const running = { id: 2, status, videoUrl: '/static/intermediate.mp4' }
    const job = resolveShotPreviewJob([running, adopted], null, shot.omni_job_id)
    assert.equal(job, running)
    assert.equal(shotPreviewVideoUrl(job, shot), '')
  }
})

test('explicit history preview remains available while another version is generating', () => {
  const running = { id: 2, status: 'processing' }
  const job = resolveShotPreviewJob([running, adopted], 1, shot.omni_job_id)
  assert.equal(job, adopted)
  assert.equal(shotPreviewVideoUrl(job, shot), adopted.videoUrl)
})

test('refresh shows reconciliation ahead of adopted video without restarting automatic polling', () => {
  const pending = { id: 2, status: 'billing_reconciliation' }
  assert.equal(resolveShotPreviewJob([pending, adopted], null, 1), pending)
  assert.equal(shotPreviewVideoUrl(pending, shot), '')
  assert.equal(resolveShotPreviewJob([pending, adopted], 1, 1), adopted)
  assert.equal(activeGenerationStatuses.has(pending.status), false)
})

test('a followed task keeps its own completion or failure instead of falling back to old media', () => {
  for (const status of ['completed', 'failed', 'unknown', 'billing_reconciliation']) {
    const latest = { id: 2, status, videoUrl: status === 'completed' ? '/static/new.mp4' : '' }
    const job = resolveShotPreviewJob([latest, adopted], 2, shot.omni_job_id)
    assert.equal(job, latest)
    assert.equal(shotPreviewVideoUrl(job, shot), latest.videoUrl)
  }
})

test('existing adopted and legacy videos remain available without an active task', () => {
  assert.equal(resolveShotPreviewJob([adopted], null, null), adopted)
  assert.equal(shotPreviewVideoUrl(null, shot), adopted.videoUrl)
  assert.equal(shotPreviewVideoUrl(null, { ...shot, status: 'processing' }), '')
})

test('polling keeps the selected Omni job identity when the video generation ID differs', () => {
  const pending = normalizeJob({ id: 20, video_generation_id: 30, generation: { id: 30, status: 'processing' } })
  assert.equal(pending.id, 20)
  const finished = normalizeJob({ id: 20, video_generation_id: 30, request_snapshot: { original_prompt: '原始提示词' }, generation: { id: 30, status: 'completed', local_path: 'new.mp4', prompt: '供应商提示词' } })
  assert.equal(finished.original_prompt, '原始提示词')
  assert.equal(finished.provider_prompt, '供应商提示词')
  assert.equal(resolveShotPreviewJob([finished, adopted], pending.id, shot.omni_job_id), finished)
  assert.match(shotPreviewVideoUrl(finished, shot), /^\/static\/new\.mp4/)
})
