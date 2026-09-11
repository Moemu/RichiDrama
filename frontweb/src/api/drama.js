import request from '@/utils/request'
import { projectSession, hasPendingProjectText } from '@/composables/useProjectCollaboration'

export const dramaAPI = {
  importResource(id, data) {
    return request.post(`/dramas/${id}/resources/import`, data)
  },
  list(params) {
    return request.get('/dramas', { params: params || {} })
  },
  create(data) {
    return request.post('/dramas', data)
  },
  get(id) {
    return request.get(`/dramas/${id}`)
  },
  getCharacters(id) {
    return request.get(`/dramas/${id}/characters`)
  },
  update(id, data) {
    return request.put(`/dramas/${id}`, data)
  },
  delete(id) {
    return request.delete(`/dramas/${id}`)
  },
  appendEpisodes(id, episodes) {
    return request.put(`/dramas/${id}/episode-edits`, { mode: 'append', episodes }, { errorHandledLocally: true })
  },
  updateEpisode(id, episode, patch) {
    if (projectSession.enabled && projectSession.id === Number(id)) {
      const fields = Object.fromEntries(Object.entries(patch).filter(([field, value]) => value !== undefined && !hasPendingProjectText('episodes', episode.id, field) && value !== episode[field]))
      return request.patch(`/dramas/${id}/collaboration/episodes`, { updates: [{ id: episode.id, fields }] }, { errorHandledLocally: true, projectEpisodeBaseline: episode })
    }
    return request.put(`/dramas/${id}/episode-edits`, {
      mode: 'update', episodes: [{ ...patch, id: episode.id,
        expected_title: episode.title, expected_script_content: episode.script_content }],
    }, { errorHandledLocally: true })
  },
  deleteEpisode(id, episode) {
    return request.put(`/dramas/${id}/episode-edits`, {
      mode: 'delete', episodes: [{ id: episode.id, expected_updated_at: episode.updated_at }],
    }, { errorHandledLocally: true })
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
  saveCanvasLayout(id, canvasLayout, workflowGroups, config) {
    const body = {}
    if (canvasLayout != null) body.canvas_layout = canvasLayout
    if (workflowGroups !== undefined) body.workflow_groups = workflowGroups
    return request.put(`/dramas/${id}/canvas-layout`, body, config)
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
