import { ref } from 'vue'
import { imagesAPI } from '@/api/images'
import { videosAPI } from '@/api/videos'
import { omniVideoAPI } from '@/api/omniVideo'
import { storyboardOmniAssetIds } from '@/utils/storyboardMedia'

/**
 * 加载当前剧集分镜的 images / videos 列表（与 FilmCreate.loadStoryboardMedia 对齐）
 */
export function useCanvasStoryboardMedia() {
  const imagesBySbId = ref({})
  const videosBySbId = ref({})
  const universalAssets = ref([])
  const mediaLoading = ref(false)

  async function loadUniversalAssets(storyboards) {
    const ids = [...new Set((storyboards || []).flatMap((sb) => storyboardOmniAssetIds(sb)))]
    if (!ids.length) return []
    const results = await Promise.allSettled(ids.map((id) => omniVideoAPI.getAsset(id)))
    return results
      .filter((result) => result.status === 'fulfilled' && result.value && Number.isInteger(Number(result.value.id)))
      .map((result) => result.value)
  }

  async function loadForStoryboards(storyboards) {
    const boards = storyboards || []
    if (!boards.length) {
      imagesBySbId.value = {}
      videosBySbId.value = {}
      universalAssets.value = []
      return
    }
    mediaLoading.value = true
    try {
      const nextImages = { ...imagesBySbId.value }
      const nextVideos = { ...videosBySbId.value }
      await Promise.all(
        boards.map(async (sb) => {
          try {
            const [imgRes, vidRes] = await Promise.all([
              imagesAPI.list({ storyboard_id: sb.id, page: 1, page_size: 100 }),
              videosAPI.list({ storyboard_id: sb.id, page: 1, page_size: 50 }),
            ])
            nextImages[sb.id] = imgRes?.items || []
            nextVideos[sb.id] = vidRes?.items || []
          } catch (_) {
            nextImages[sb.id] = []
            nextVideos[sb.id] = []
          }
        })
      )
      imagesBySbId.value = nextImages
      videosBySbId.value = nextVideos
    } finally {
      mediaLoading.value = false
    }
  }

  async function loadForDrama(drama, episodeId = null) {
    const episodes = episodeId
      ? (drama?.episodes || []).filter((ep) => ep.id === episodeId)
      : (drama?.episodes || [])
    const boards = episodes.flatMap((ep) => ep.storyboards || [])
    await Promise.all([
      loadForStoryboards(boards),
      boards.some((sb) => sb.creation_mode === 'universal' && (
        (Array.isArray(sb.omni_asset_ids) && sb.omni_asset_ids.length) ||
        sb.omni_first_frame_asset_id != null || sb.omni_last_frame_asset_id != null
      ))
        ? loadUniversalAssets(boards).then((assets) => { universalAssets.value = assets }).catch(() => { universalAssets.value = [] })
        : Promise.resolve().then(() => { universalAssets.value = [] }),
    ])
  }

  return {
    imagesBySbId,
    videosBySbId,
    universalAssets,
    mediaLoading,
    loadForStoryboards,
    loadForDrama,
  }
}
