// Copy/paste re-identifies every node and both endpoints of every edge; a missed endpoint
// would leave an edge pointing at a node that does not exist.
export function pasteNodes(snapshot, nextId, offset) {
  const idMap = new Map(snapshot.nodes.map((node) => [node.id, `${String(node.id).split(':')[0]}:${nextId()}`]))
  return {
    nodes: snapshot.nodes.map((node) => ({ ...node, id: idMap.get(node.id), x: node.x + offset, y: node.y + offset })),
    edges: snapshot.edges.map((edge) => ({ id: `edge:${nextId()}`, source: idMap.get(edge.source), target: idMap.get(edge.target), usage: edge.usage })),
  }
}

export function generationVersions(board, nodeId, type) {
  const rows = type === 'image' ? board.generated_images : board.generated_videos
  return (rows || []).filter((row) => row.draft_node_id === nodeId).sort((a, b) => a.id - b.id)
}

export function referenceForNode(node) {
  if (!node) return null
  const draft = ['draft_image', 'draft_video'].includes(node.kind)
  const media = draft ? node.data.output : node.data
  if (!media?.local_path || !['completed', 'ready'].includes(media.status)) return null
  return { source_type: draft ? (node.kind === 'draft_image' ? 'image_generation' : 'video_generation') : node.source_type, source_id: draft ? media.id : node.source_id, type: media.type, name: media.name, local_path: media.local_path }
}

export function usageOptionsFor(sourceType, targetKind) {
  const reference = { value: 'reference', label: '普通参考' }
  if (targetKind !== 'draft_image' && targetKind !== 'draft_video') return []
  // A text node is never a media reference, so it only ever offers the prompt usage.
  if (sourceType === 'text') return [{ value: 'prompt', label: '提示词' }]
  if (targetKind === 'draft_image') return sourceType === 'image' ? [reference] : []
  if (targetKind !== 'draft_video') return []
  if (sourceType === 'image') return [reference, { value: 'first_frame', label: '首帧' }, { value: 'last_frame', label: '尾帧' }]
  return sourceType === 'video' ? [reference, { value: 'continuation', label: '视频续接' }] : []
}

// A text node stays a note until it is connected; connected text joins the prompt
// in edge order ahead of the node's own prompt and never counts as a media reference.
export function textInputsFor(nodeId, edges, nodes) {
  return edges.filter((edge) => edge.target === nodeId && edge.usage === 'prompt')
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node) => node?.kind === 'text' && String(node.data?.text || '').trim())
    .map((node) => String(node.data.text).trim())
}

export function composePrompt(localPrompt, upstream = []) {
  return [...upstream, String(localPrompt || '').trim()].filter(Boolean).join('\n\n')
}

export function nodeLabel(node) {
  if (!node) return '媒体不可用'
  if (node.kind === 'text') return node.data?.title || String(node.data?.text || '').split('\n')[0].trim() || '文本'
  return node.data?.title || node.data?.prompt || node.data?.name || '媒体不可用'
}

// The upload route answers { asset }; the board must not treat a payload without a
// record id as success, or the file uploads invisibly.
export function uploadedAsset(result) {
  const item = result?.asset || result
  if (!item?.id) throw new Error('上传未返回素材记录')
  return item
}

// A multi-file drop lands on one point, so cascade each file instead of stacking cards.
export function dropPosition(base, index) {
  return base && index ? { x: base.x + index * 26, y: base.y + index * 26 } : base
}

// Only editable inputs and an unresolved request survive reload. Edges own references;
// generation rows own versions. An ambiguous submission retains the exact body/key.
export function videoSettingsFor(data) {
  return { video_model: data.model, duration: data.duration, resolution: data.resolution, aspect_ratio: data.aspectRatio,
    upscale_resolution: data.upscale_resolution !== undefined ? data.upscale_resolution : data.resolution === '720p' && data.upscale1080 ? '1080p' : null,
    target_fps: data.target_fps || null }
}

export function draftSnapshot(data) {
  return Object.fromEntries(['draftType', 'prompt', 'model', 'duration', 'resolution', 'aspectRatio', 'upscale1080', 'upscale_resolution', 'target_fps', 'pendingRequest'].filter((key) => data[key] !== undefined).map((key) => [key, data[key]]))
}
