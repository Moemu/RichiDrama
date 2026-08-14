const PREFIX = 'lmd_prompt_draft:v1'
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function safePart(value) {
  return encodeURIComponent(String(value == null || value === '' ? 'none' : value))
}

export function currentDraftUserId(storage = globalThis.localStorage) {
  try {
    const user = JSON.parse(storage?.getItem('lmd_auth_user') || '{}')
    return user?.id ?? user?.username ?? 'anonymous'
  } catch (_) {
    return 'anonymous'
  }
}

export function promptDraftKey({ userId, workspace, dramaId, episodeId, shotId }) {
  return [PREFIX, userId, workspace, dramaId, episodeId, shotId].map(safePart).join(':')
}

export function writePromptDraft(storage, identity, payload, now = Date.now()) {
  if (!storage) return null
  const key = promptDraftKey(identity)
  const draft = { version: 1, savedAt: new Date(now).toISOString(), payload }
  storage.setItem(key, JSON.stringify(draft))
  return draft
}

export function readPromptDraft(storage, identity, options = {}) {
  if (!storage) return null
  const key = promptDraftKey(identity)
  try {
    const draft = JSON.parse(storage.getItem(key) || 'null')
    const savedAt = Date.parse(draft?.savedAt || '')
    const maxAgeMs = Number(options.maxAgeMs ?? DEFAULT_MAX_AGE_MS)
    const now = Number(options.now ?? Date.now())
    if (!draft || draft.version !== 1 || !Number.isFinite(savedAt) || now - savedAt > maxAgeMs) {
      storage.removeItem(key)
      return null
    }
    return draft
  } catch (_) {
    storage.removeItem(key)
    return null
  }
}

export function shouldRestorePromptDraft(draft, serverUpdatedAt) {
  if (!draft) return false
  const localTime = Date.parse(draft.savedAt || '')
  const serverTime = Date.parse(serverUpdatedAt || '')
  if (!Number.isFinite(localTime)) return false
  return !Number.isFinite(serverTime) || localTime > serverTime
}

export function clearPromptDraft(storage, identity) {
  storage?.removeItem(promptDraftKey(identity))
}
