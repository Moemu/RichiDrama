const RETRY_KEY = 'lmd_route_chunk_retry'
const RETRY_WINDOW_MS = 30000

export function isRouteChunkError(error) {
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css/i.test(String(error?.message || ''))
}

export function recoverRouteChunk(targetPath) {
  const now = Date.now()
  try {
    const previous = JSON.parse(sessionStorage.getItem(RETRY_KEY) || 'null')
    if (previous?.path === targetPath && now - previous.at < RETRY_WINDOW_MS) return false
    sessionStorage.setItem(RETRY_KEY, JSON.stringify({ path: targetPath, at: now }))
  } catch {
    return false
  }
  window.location.assign(targetPath)
  return true
}

export function clearRouteChunkRetry() {
  try { sessionStorage.removeItem(RETRY_KEY) } catch { /* Storage may be disabled. */ }
}
