import { hasPendingProjectText, projectSession } from '@/composables/useProjectCollaboration'
import { projectKind, projectSnapshot } from './projectSnapshots'
import { createClientRequestId } from './requestId'
import { projectFieldValue, equalProjectValue, buildProjectWriteContract } from './projectWriteContract'
export { projectSnapshot } from './projectSnapshots'

const equal = equalProjectValue

export function installProjectRequestSync(request) {
  request.interceptors.request.use(config => {
    if (config.projectWritePrepared) return config
    if (!projectSession.enabled || !projectSession.id || /\/collaboration\/(text|state)$/.test(config.url || '')) return config
    const method = String(config.method || 'get').toLowerCase()
    if (['get', 'head', 'options'].includes(method)) return config
    const body = typeof FormData !== 'undefined' && config.data instanceof FormData ? Object.fromEntries(config.data.entries()) : config.data
    const match = /^\/(dramas|episodes|storyboards|characters|scenes|props|assets|character-library|scene-library|prop-library)\/(\d+)(.*)$/.exec(config.url || '')
    const known = config.projectBaseline || (match && projectSnapshot(match[1], Number(match[2])))
    const scoped = Number(known?.__projectId) === projectSession.id || (match?.[1] === 'dramas' && Number(match[2]) === projectSession.id) || Number(body?.drama_id) === projectSession.id || Number(projectSnapshot('episodes', body?.episode_id)?.__projectId) === projectSession.id || Number(projectSnapshot('storyboards', body?.storyboard_id)?.__projectId) === projectSession.id
    if (!scoped) return config
    if (!projectSession.canEdit) throw new Error('当前为只读成员，无法修改项目')
    config.headers['X-Project-Operation'] ||= createClientRequestId()
    const useBaselineRevision = () => {
      const revision = known?.__projectRevision ?? projectSnapshot('dramas', projectSession.id)?.revision
      if (!Number.isSafeInteger(revision)) throw new Error('请先刷新项目内容后再执行此操作')
      config.headers['X-Project-Revision'] ??= revision
    }
    if (match?.[1] === 'dramas' && match[3] === '/outline' && hasPendingProjectText('dramas', Number(match[2]), 'description')) {
      config.data = { ...config.data }
      delete config.data.summary
    }
    if (match && (!match[3] || match[3] === '/outline') && ['put', 'patch'].includes(method) && config.data && typeof config.data === 'object') {
      const next = { ...config.data }
      delete next.expected_updated_at
      for (const [field, value] of Object.entries(next)) {
        if (hasPendingProjectText(projectKind(match[1]), Number(match[2]), field) || (known && equal(value, projectFieldValue(known, field)))) delete next[field]
      }
      if (next.metadata && typeof next.metadata === 'object' && known?.metadata) {
        next.metadata = Object.fromEntries(Object.entries(next.metadata).filter(([field, value]) => !equal(value, known.metadata[field])))
      }
      if (next.omni_prompt_document && hasPendingProjectText('storyboards', Number(match[2]), 'universal_segment_text')) {
        const { text, ...document } = next.omni_prompt_document
        const { text: baselineText, ...baselineDocument } = known?.omni_prompt_document || {}
        if (equal(document, baselineDocument)) delete next.omni_prompt_document
        else next.omni_prompt_document = document
      }
      config.data = next
    }
    if (projectSession.writeContractVersion >= 1) {
      const contract = buildProjectWriteContract(config, known, match)
      if (contract) config.data = { ...config.data, _project_edit: contract }
      else if (['put', 'patch', 'delete'].includes(method)) useBaselineRevision()
    } else {
      useBaselineRevision()
    }
    config.projectWritePrepared = true
    return config
  })
}
