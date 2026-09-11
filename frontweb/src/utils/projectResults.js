export function resultTitle(item) {
  if (item.type === 'final') return '本集成片'
  if (item.storyboard_title?.trim()) return item.storyboard_title.trim()
  if (item.storyboard_number != null) return `分镜 ${item.storyboard_number}`
  return item.type === 'image' ? '生成图片' : '生成视频'
}

export function groupProjectResults(results, episodes, selectedEpisodeId) {
  const groups = new Map()
  for (const item of results) {
    const episodeId = item.episode_id == null ? null : Number(item.episode_id)
    if (selectedEpisodeId && episodeId !== Number(selectedEpisodeId)) continue
    if (!groups.has(episodeId)) {
      const episode = episodes.find(row => Number(row.id) === episodeId)
      const number = episode?.episode_number ?? episode?.number ?? '?'
      const title = String(episode?.title || '').replace(/^第\s*(\d+)\s*集\s*[·:：-]?\s*/, (prefix, value) => Number(value) === Number(number) ? '' : prefix)
      groups.set(episodeId, {
        id: episodeId ?? 'unassigned',
        title: episode ? `第 ${number} 集${title ? ` · ${title}` : ''}` : episodeId ? '历史分集' : '未分集资源',
        order: episode ? Number(episode.episode_number ?? episode.number ?? 0) : Number.MAX_SAFE_INTEGER,
        items: [],
      })
    }
    groups.get(episodeId).items.push(item)
  }
  for (const group of groups.values()) group.items.sort((a, b) => (a.storyboard_number ?? Number.MAX_SAFE_INTEGER) - (b.storyboard_number ?? Number.MAX_SAFE_INTEGER) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
  return [...groups.values()].sort((a, b) => a.order - b.order)
}
