export const ASSET_POINTER_MOVE = 'localminidrama:asset-pointer-move'
export const ASSET_POINTER_DROP = 'localminidrama:asset-pointer-drop'
export const ASSET_POINTER_CANCEL = 'localminidrama:asset-pointer-cancel'

let suppressClickUntil = 0

function emit(name, asset, event) {
  window.dispatchEvent(new CustomEvent(name, {
    detail: { asset, clientX: event.clientX, clientY: event.clientY },
  }))
}

/** Pointer-driven dragging has no native card/image ghost and behaves the same
 * for a mouse, trackpad or pen. A short threshold preserves ordinary clicks.
 */
export function beginAssetPointerDrag(event, asset) {
  if (typeof window === 'undefined' || event.button !== 0 || !asset) return false
  if (event.target?.closest?.('button, input, select, textarea, a')) return false

  const startX = event.clientX
  const startY = event.clientY
  let active = false

  const cleanup = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    document.documentElement.classList.remove('asset-pointer-dragging')
  }
  const finish = (endEvent, dropped) => {
    cleanup()
    if (!active) return
    suppressClickUntil = Date.now() + 360
    emit(dropped ? ASSET_POINTER_DROP : ASSET_POINTER_CANCEL, asset, endEvent)
  }
  const move = (moveEvent) => {
    if (!active && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return
    active = true
    moveEvent.preventDefault()
    document.documentElement.classList.add('asset-pointer-dragging')
    emit(ASSET_POINTER_MOVE, asset, moveEvent)
  }
  const up = (upEvent) => finish(upEvent, true)
  const cancel = (cancelEvent) => finish(cancelEvent, false)

  window.addEventListener('pointermove', move, { passive: false })
  window.addEventListener('pointerup', up, { once: true })
  window.addEventListener('pointercancel', cancel, { once: true })
  return true
}

export function shouldSuppressAssetClick() {
  return Date.now() < suppressClickUntil
}
