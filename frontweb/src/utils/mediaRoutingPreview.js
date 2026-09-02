const FALLBACK_LIMITS = Object.freeze({ total: 15, image: 9, video: 3, audio: 3 })

export function materialLimits(capability) {
  const limits = capability?.limits || {}
  return {
    total: Number(limits.total_reference?.max || FALLBACK_LIMITS.total),
    image: Number(limits.image_reference?.max || FALLBACK_LIMITS.image),
    video: Number(limits.video_reference?.max || FALLBACK_LIMITS.video),
    audio: Number(limits.audio_reference?.max || FALLBACK_LIMITS.audio),
  }
}

export function materialRoutingPreview(assets = [], capability = null, options = {}) {
  const supports = capability?.supports || {}
  const limits = materialLimits(capability)
  const audioStrategy = options.audioStrategy || 'reference_only'
  const keyframesPerVideo = Math.max(1, Number(options.keyframesPerVideo) || 3)
  const selected = { total: 0, image: 0, video: 0, audio: 0 }
  const sent = { total: 0, image: 0, video: 0, audio: 0 }
  const entries = []
  let preprocessedVideos = 0

  function send(type, count = 1) {
    sent[type] += count
    sent.total += count
  }

  for (const [index, asset] of (assets || []).entries()) {
    const type = ['image', 'video', 'audio'].includes(asset?.type) ? asset.type : 'image'
    selected.total += 1
    selected[type] += 1
    const alias = asset?.alias || asset?.name || `素材${index + 1}`

    if (type === 'image') {
      const canSend = sent.image < Number(supports.image_reference?.max || limits.image || 0)
      if (canSend) send('image')
      entries.push({ alias, type, strategy: canSend ? 'native' : 'not_supported', label: canSend ? '发送给模型：图片参考' : '不会发送：超出图片参考上限' })
      continue
    }

    if (type === 'video') {
      if (supports.video_reference) {
        send('video')
        entries.push({ alias, type, strategy: 'native', label: '发送给模型：原生视频参考' })
        continue
      }
      const extractsFrames = ['motion', 'keyframes', 'reference'].includes(asset?.usage || 'reference') && Number(supports.image_reference?.max || limits.image || 0) > 0
      const imageMax = Number(supports.image_reference?.max || limits.image || 0)
      const framesSent = extractsFrames ? Math.max(0, Math.min(keyframesPerVideo, imageMax - sent.image)) : 0
      if (framesSent) send('image', framesSent)
      if (extractsFrames) preprocessedVideos += 1
      entries.push({
        alias,
        type,
        strategy: 'keyframe_or_post',
        keyframes: extractsFrames ? keyframesPerVideo : 0,
        keyframesSent: framesSent,
        label: extractsFrames
          ? `仅预处理：预计提取 ${keyframesPerVideo} 张关键帧${framesSent < keyframesPerVideo ? `，其中 ${framesSent} 张可发送` : ''}`
          : '不会发送：仅用于后期处理',
      })
      continue
    }

    const canSend = !!supports.audio_reference && audioStrategy !== 'post_mix'
    if (canSend) send('audio')
    entries.push({ alias, type, strategy: canSend ? 'native' : 'post_mix', label: canSend ? '发送给模型：音频参考' : '生成后处理：成片混音' })
  }

  const exceeded = ['total', 'image', 'video', 'audio'].filter((type) => selected[type] > limits[type])
  return { limits, selected, sent, entries, preprocessedVideos, exceeded, withinLimits: exceeded.length === 0 }
}
