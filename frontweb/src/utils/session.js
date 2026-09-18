/**
 * Session teardown shared by every header instance: the server call is best
 * effort, the local token must always be cleared before leaving the page.
 */
export async function signOut(router) {
  try {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'X-LMD-Session': globalThis.localStorage?.getItem('lmd_auth_token') || '' },
    })
  } catch (_) {}
  globalThis.localStorage?.removeItem('lmd_auth_token')
  globalThis.localStorage?.removeItem('lmd_auth_user')
  await router.replace('/login')
}
