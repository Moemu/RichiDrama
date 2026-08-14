let transparentPreview

/** Hide the browser's native full-card drag ghost so the text under the
 * pointer remains visible. The editor renders the precise insertion affordance.
 */
export function setTransparentDragPreview(event) {
  const transfer = event?.dataTransfer
  if (!transfer?.setDragImage || typeof document === 'undefined') return false
  if (!transparentPreview) {
    transparentPreview = document.createElement('span')
    transparentPreview.setAttribute('aria-hidden', 'true')
    Object.assign(transparentPreview.style, {
      position: 'fixed',
      insetInlineStart: '-10px',
      insetBlockStart: '-10px',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    })
    document.body.appendChild(transparentPreview)
  }
  transfer.setDragImage(transparentPreview, 0, 0)
  return true
}
