import { taskAPI } from '@/api/task'
import { imagesAPI } from '@/api/images'
import { videosAPI } from '@/api/videos'
import { omniVideoAPI } from '@/api/omniVideo'
import request from '@/utils/request'
import { storyboardImageUrl } from '@/utils/mediaUrl'
import {
  DEFAULT_PIPELINE,
  findStoryboardInDrama,
  getDramaGenerationOptions,
  toAbsoluteMediaUrl,
} from '@/utils/canvasWorkflow'
import {
  dramaUsesFirstLastFrame,
  sbVideoFirstLastUrls,
  storyboardOmniAssetRecords,
  storyboardOmniRequestAssets,
  storyboardOmniSelection,
} from '@/utils/storyboardMedia'

async function pollTaskSimple(taskId, options = {}) {
  if (!taskId) return { status: 'failed', error: '缺少 task_id' }
  const maxAttempts = options.maxAttempts ?? 450
  const interval = options.interval ?? 2000
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, interval))
    try {
      const t = await taskAPI.get(taskId)
      if (t.status === 'completed') return { status: 'completed', result: t.result }
      if (t.status === 'failed') {
        return { status: 'failed', error: t.error?.message || t.error || '任务失败' }
      }
    } catch (e) {
      if (i === maxAttempts - 1) return { status: 'failed', error: e.message || '轮询失败' }
    }
  }
  return { status: 'timeout', error: '任务超时' }
}

export async function runImageStep(drama, sb, genOpts) {
  const prompt = sb.polished_prompt || sb.image_prompt || sb.description || sb.action || ''
  if (!prompt.trim()) throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 缺少图片提示词`)
  const res = await imagesAPI.create({
    storyboard_id: sb.id,
    drama_id: drama.id,
    prompt,
    style: genOpts.style || undefined,
    aspect_ratio: genOpts.aspectRatio,
  })
  if (res?.task_id) {
    const polled = await pollTaskSimple(res.task_id)
    if (polled.status !== 'completed') throw new Error(polled.error || '分镜图生成失败')
  }
}

function resolveVideoStepInput(drama, sb, genOpts) {
  const useFirstLast = dramaUsesFirstLastFrame(drama)
  const imagesBySbId = genOpts?.imagesBySbId || {}
  const universal = sb?.creation_mode === 'universal'
  const omniSelection = storyboardOmniSelection(sb)
  const omniAssetRecords = universal ? storyboardOmniAssetRecords(sb, genOpts?.universalAssets || []) : []
  const missingOmniAssetIds = omniAssetRecords
    .filter((record) => !record.asset)
    .map((record) => record.asset_id)
  const invalidOmniSelection = universal && (
    (omniSelection.mode === 'first_last_frame' && (
      omniSelection.invalidFirst
      || omniSelection.invalidLast
      || omniSelection.firstId == null
      || (omniSelection.lastId != null && omniSelection.lastId === omniSelection.firstId)
    ))
    || (omniSelection.mode === 'multi_reference' && omniSelection.invalidIds?.length > 0)
  )
  const { first, last, omniCreationMode } = sbVideoFirstLastUrls(
    sb,
    imagesBySbId,
    useFirstLast,
    genOpts?.universalAssets || []
  )
  const imgPath = first || storyboardImageUrl(sb)
  return {
    first,
    last,
    imgPath,
    omniCreationMode,
    omniSelection,
    omniAssetRecords,
    omniRequestAssets: universal ? storyboardOmniRequestAssets(sb, genOpts?.universalAssets || []) : [],
    missingOmniAssetIds,
    invalidOmniSelection,
  }
}

export function canRunVideoStep(drama, sb, genOpts) {
  const {
    last,
    imgPath,
    omniSelection,
    missingOmniAssetIds,
    invalidOmniSelection,
  } = resolveVideoStepInput(drama, sb, genOpts)
  if (sb?.creation_mode === 'universal') {
    const prompt = String(sb?.universal_segment_text || sb?.video_prompt || '').trim()
    if (!prompt || invalidOmniSelection || missingOmniAssetIds.length) return false
    if (omniSelection.mode === 'first_last_frame') return omniSelection.firstId != null
    return true
  }
  return !!(imgPath || sb?.video_prompt || last)
}

export async function runVideoStep(drama, sb, genOpts) {
  const {
    last,
    imgPath,
    omniCreationMode,
    omniSelection,
    omniRequestAssets,
    missingOmniAssetIds,
    invalidOmniSelection,
  } = resolveVideoStepInput(drama, sb, genOpts)
  const universal = sb?.creation_mode === 'universal'
  const prompt = universal
    ? String(sb.universal_segment_text || sb.video_prompt || '').trim()
    : (sb.video_prompt || sb.polished_prompt || sb.image_prompt || sb.description || '')
  if (universal && !prompt) {
    throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 缺少视频提示词，无法生成视频`)
  }
  if (universal && invalidOmniSelection) {
    throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 的全能素材选择无效，无法生成视频`)
  }
  if (universal && missingOmniAssetIds.length) {
    throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 缺少已加载的全能素材引用（${missingOmniAssetIds.join('、')}），无法生成视频`)
  }
  if (universal && omniSelection.mode === 'first_last_frame' && omniSelection.firstId == null) {
    throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 缺少首帧素材，无法生成视频`)
  }
  if (!universal && !imgPath && !sb.video_prompt && !last) {
    throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 缺少分镜图，无法生成视频`)
  }
  const absoluteFirst = toAbsoluteMediaUrl(imgPath)
  const absoluteLast = last ? toAbsoluteMediaUrl(last) : undefined
  const selectedVideoModel = sb.video_model && sb.video_model !== 'auto'
    ? sb.video_model
    : (universal && genOpts.videoModel && genOpts.videoModel !== 'auto' ? genOpts.videoModel : undefined)
  const settings = {
    drama_id: drama.id,
    storyboard_id: sb.id,
    prompt,
    style: genOpts.style || undefined,
    model: selectedVideoModel,
    aspect_ratio: sb.video_aspect_ratio || genOpts.aspectRatio,
    resolution: sb.video_resolution || genOpts.videoResolution || undefined,
    duration: sb.duration || undefined,
  }
  const res = universal
    ? await omniVideoAPI.create({
      ...settings,
      creation_mode: omniCreationMode,
      prompt_document: sb.omni_prompt_document || undefined,
      asset_selection_policy: sb.omni_asset_send_policy === 'prompt_references' ? 'prompt_references' : 'all_selected',
      audio_strategy: sb.audio_strategy || undefined,
      keep_original_audio: sb.keep_original_audio ? true : undefined,
      audio_volume: sb.audio_volume ?? undefined,
      audio_fade_seconds: sb.audio_fade_seconds ?? undefined,
      upscale_resolution: sb.video_upscale_resolution || undefined,
      target_fps: sb.video_target_fps || undefined,
      assets: omniRequestAssets,
    })
    : await videosAPI.create({
      ...settings,
      image_url: absoluteFirst || undefined,
      first_frame_url: absoluteFirst || undefined,
      last_frame_url: absoluteLast,
    })
  if (res?.task_id) {
    const polled = await pollTaskSimple(res.task_id)
    if (polled.status !== 'completed') throw new Error(polled.error || '视频生成失败')
  }
}

export async function runAudioStep(sb) {
  const text = (sb.dialogue || '').trim()
  if (!text) return { skipped: true, reason: '无对白' }
  await request.post('/audio/extract', {
    storyboard_id: sb.id,
    text,
    tts_kind: 'dialogue',
  })
  return { skipped: false }
}

/**
 * 对单个分镜按 pipeline 顺序执行生成
 * @param {'image'|'video'|'audio'}[] pipeline
 */
export async function runStoryboardPipeline(drama, storyboardId, pipeline, hooks = {}) {
  const found = findStoryboardInDrama(drama, storyboardId)
  if (!found) throw new Error(`找不到分镜 ${storyboardId}`)
  let { storyboard: sb } = found
  const genOpts = {
    ...getDramaGenerationOptions(drama),
    ...(hooks.generationOptions || {}),
  }
  const steps = pipeline?.length ? pipeline : DEFAULT_PIPELINE
  const results = []

  for (const step of steps) {
    hooks.onStepStart?.({ storyboardId, step, sb })
    try {
      if (step === 'image') {
        await runImageStep(drama, sb, genOpts)
        if (hooks.reloadStoryboard) {
          sb = (await hooks.reloadStoryboard(storyboardId)) || sb
        }
      } else if (step === 'video') {
        await runVideoStep(drama, sb, genOpts)
        if (hooks.reloadStoryboard) {
          sb = (await hooks.reloadStoryboard(storyboardId)) || sb
        }
      } else if (step === 'audio') {
        const audioRes = await runAudioStep(sb)
        results.push({ step, ...audioRes })
      }
      hooks.onStepComplete?.({ storyboardId, step, sb })
    } catch (err) {
      hooks.onStepError?.({ storyboardId, step, error: err })
      throw err
    }
  }
  return results
}

/** 按工作流组顺序执行（组内分镜按 storyboard_ids 顺序） */
export async function runWorkflowGroup(drama, group, hooks = {}) {
  const pipeline = group.pipeline || DEFAULT_PIPELINE
  const ids = group.storyboard_ids || []
  const summary = { groupId: group.id, ok: [], failed: [] }

  for (const sbId of ids) {
    hooks.onStoryboardStart?.({ group, storyboardId: sbId })
    try {
      await runStoryboardPipeline(drama, sbId, pipeline, hooks)
      summary.ok.push(sbId)
      hooks.onStoryboardComplete?.({ group, storyboardId: sbId })
    } catch (err) {
      summary.failed.push({ storyboardId: sbId, error: err.message || String(err) })
      hooks.onStoryboardError?.({ group, storyboardId: sbId, error: err })
      if (hooks.stopOnError) break
    }
  }
  return summary
}
