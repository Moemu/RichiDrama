import { hasPendingProjectText, projectSession } from '@/composables/useProjectCollaboration'
import { projectKind, projectSnapshot, rememberProjectEntity } from './projectSnapshots'
import { createClientRequestId } from './requestId'
export { projectSnapshot } from './projectSnapshots'

const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function installProjectRequestSync(request) {
  request.interceptors.request.use(config => {
    if (!projectSession.enabled || !projectSession.id || /\/collaboration\/(text|state)$/.test(config.url || '')) return config
    const method = String(config.method || 'get').toLowerCase()
    if (['get', 'head', 'options'].includes(method)) return config
    const body = typeof FormData !== 'undefined' && config.data instanceof FormData ? Object.fromEntries(config.data.entries()) : config.data
    const match = /^\/(dramas|episodes|storyboards|characters|scenes|props|assets|character-library|scene-library|prop-library)\/(\d+)(.*)$/.exec(config.url || '')
    const known = match && projectSnapshot(match[1], Number(match[2]))
    const scoped = Number(known?.__projectId) === projectSession.id || (match?.[1] === 'dramas' && Number(match[2]) === projectSession.id) || Number(body?.drama_id) === projectSession.id || Number(projectSnapshot('episodes', body?.episode_id)?.__projectId) === projectSession.id || Number(projectSnapshot('storyboards', body?.storyboard_id)?.__projectId) === projectSession.id
    if (!scoped) return config
    if (!projectSession.connected) throw new Error('协作连接已断开，请等待重连后再执行此操作')
    if (!projectSession.canEdit) throw new Error('当前为只读成员，无法修改项目')
    config.headers['X-Project-Operation'] ||= createClientRequestId()
    if (match?.[1] === 'dramas' && match[3] === '/outline' && hasPendingProjectText('dramas', Number(match[2]), 'description')) {
      config.data = { ...config.data }
      delete config.data.summary
    }
    if (match && (!match[3] || match[3] === '/outline') && ['put', 'patch'].includes(method) && config.data && typeof config.data === 'object') {
      const next = { ...config.data }
      delete next.expected_updated_at
      for (const [field, value] of Object.entries(next)) {
        if (hasPendingProjectText(projectKind(match[1]), Number(match[2]), field) || (known && equal(value, known[field]))) delete next[field]
      }
      if (next.metadata && typeof next.metadata === 'object' && known?.metadata) {
        next.metadata = Object.fromEntries(Object.entries(next.metadata).filter(([field, value]) => !equal(value, known.metadata[field])))
      }
      if (next.omni_prompt_document && hasPendingProjectText('storyboards', Number(match[2]), 'universal_segment_text')) delete next.omni_prompt_document.text
      if (Object.keys(next).some(field => ['character_ids', 'characters', 'prop_ids', 'scene_id', 'omni_asset_ids', 'omni_first_frame_asset_id', 'omni_last_frame_asset_id', 'workflow_groups'].includes(field))) config.headers['X-Project-Revision'] = projectSession.revision
      config.data = next
    } else {
      config.headers['X-Project-Revision'] = projectSession.revision
    }
    return config
  })
  request.interceptors.response.use(data => {
    if (data?.id && data.permissions && Array.isArray(data.episodes)) {
      if (Number(data.id) === projectSession.id) projectSession.revision = data.revision || 0
      rememberProjectEntity('dramas', data)
    }
    return data
  })
}
