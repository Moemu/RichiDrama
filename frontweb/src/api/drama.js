import request from '@/utils/request'
import { projectSession, hasPendingProjectText } from '@/composables/useProjectCollaboration'
import { projectSnapshot } from '@/utils/projectRequestSync'

export const dramaAPI = {
  list(params) {
    return request.get('/dramas', { params: params || {} })
  },
  create(data) {
    return request.post('/dramas', data)
  },
  get(id) {
    return request.get(`/dramas/${id}`)
  },
  update(id, data) {
    return request.put(`/dramas/${id}`, data)
  },
  delete(id) {
    return request.delete(`/dramas/${id}`)
  },
  saveEpisodes(id, episodes) {
    const baseline = projectSnapshot('dramas', Number(id))
    if (projectSession.enabled && projectSession.id === Number(id) && baseline) {
      if (!projectSession.connected) return Promise.reject(new Error('连接已断开，请等待重连后保存'))
      const updates = []; const creates = []; const retained = new Set()
      for (const episode of episodes) {
        const existing = (baseline.episodes || []).find(item => episode.id ? item.id === episode.id : item.episode_number === episode.episode_number)
        if (!existing) { creates.push(episode); continue }
        retained.add(existing.id)
        const fields = {}
        for (const field of ['title', 'script_content', 'description', 'duration']) {
          if (episode[field] !== undefined && !hasPendingProjectText('episodes', existing.id, field) && JSON.stringify(episode[field] ?? null) !== JSON.stringify(existing[field] ?? null)) fields[field] = episode[field]
        }
        if (Object.keys(fields).length) updates.push({ id: existing.id, fields })
      }
      return request.patch(`/dramas/${id}/collaboration/episodes`, { updates, creates, remove_ids: (baseline.episodes || []).filter(item => !retained.has(item.id)).map(item => item.id) })
    }
    return request.put(`/dramas/${id}/episodes`, { episodes })
  },
  saveCharacters(id, data) {
    return request.put(`/dramas/${id}/characters`, data)
  },
  /** 保存梗概/故事摘要到项目（outline），body: { summary, title?, genre?, tags? } */
  saveOutline(id, data) {
    return request.put(`/dramas/${id}/outline`, data)
  },
  saveProgress(id, data) {
    return request.put(`/dramas/${id}/progress`, data)
  },
  saveCanvasLayout(id, canvasLayout, workflowGroups) {
    const body = {}
    if (canvasLayout != null) body.canvas_layout = canvasLayout
    if (workflowGroups !== undefined) body.workflow_groups = workflowGroups
    return request.put(`/dramas/${id}/canvas-layout`, body)
  },
  getStoryboards(episodeId) {
    return request.get(`/episodes/${episodeId}/storyboards`)
  },
  generateStoryboard(episodeId, options) {
    // 兼容旧调用方式: generateStoryboard(episodeId, model, style)
    let body = {};
    if (arguments.length > 2 || typeof options === 'string') {
       body.model = arguments[1];
       body.style = arguments[2];
    } else {
       body = options || {};
    }
    return request.post(`/episodes/${episodeId}/storyboards`, body)
  },
  finalizeEpisode(episodeId, data) {
    return request.post(`/episodes/${episodeId}/finalize`, data || {})
  },
  extractBackgrounds(episodeId, body) {
    return request.post(`/images/episode/${episodeId}/backgrounds/extract`, body || {})
  },
  exportDrama(id) {
    return request.get(`/dramas/${id}/export`, { responseType: 'blob' })
  },
  importDrama(file) {
    const form = new FormData()
    form.append('file', file)
    return request.post('/dramas/import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  listExamples() {
    return request.get('/dramas/examples')
  },
  importExample(filename) {
    return request.post('/dramas/import-example', { filename })
  }
}
