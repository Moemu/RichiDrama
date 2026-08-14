/**
 * Keep refresh/login recovery on the same in-app location without allowing an
 * external or protocol-relative redirect target.
 */
export function safeRedirectPath(value, fallback = '/') {
  if (typeof value !== 'string') return fallback
  const target = value.trim()
  if (!target.startsWith('/') || target.startsWith('//')) return fallback
  try {
    const parsed = new URL(target, 'http://localminidrama.invalid')
    if (parsed.origin !== 'http://localminidrama.invalid') return fallback
    if (parsed.pathname === '/login') return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch (_) {
    return fallback
  }
}

export function currentRouteWithState(locationLike = globalThis.location) {
  if (!locationLike) return '/'
  return `${locationLike.pathname || '/'}${locationLike.search || ''}${locationLike.hash || ''}`
}

export function loginRouteForCurrentLocation(locationLike = globalThis.location) {
  const redirect = safeRedirectPath(currentRouteWithState(locationLike))
  return `/login?redirect=${encodeURIComponent(redirect)}`
}
