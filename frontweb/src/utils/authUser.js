/**
 * Read the cached display identity without treating it as the session
 * credential. A damaged cache must not invalidate an otherwise valid token or
 * HttpOnly cookie.
 */
export function readAuthUser(storage = globalThis.localStorage) {
  const raw = storage?.getItem?.('lmd_auth_user')
  if (!raw) return null
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid cached user')
    return value
  } catch (_) {
    storage?.removeItem?.('lmd_auth_user')
    return null
  }
}

export function writeAuthUser(user, storage = globalThis.localStorage) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    storage?.removeItem?.('lmd_auth_user')
    return
  }
  storage?.setItem?.('lmd_auth_user', JSON.stringify(user))
}
