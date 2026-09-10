import { watch } from 'vue'
import { bindProjectText, projectPresence, projectSession } from '@/composables/useProjectCollaboration'
import { projectSnapshot } from '@/utils/projectSnapshots'

const bindings = new WeakMap()

function mount(el, binding) {
  const state = { target: binding.value, disposed: false, binding: null, composing: false, remote: false }
  bindings.set(el, state)
  const input = el.matches('textarea,input') ? el : el.querySelector('textarea,input')
  if (!input) return
  const originalReadOnly = input.readOnly
  const stopPermission = watch(() => [projectSession.enabled, projectSession.canEdit], ([enabled, canEdit]) => {
    input.readOnly = originalReadOnly || (enabled && !canEdit)
  }, { immediate: true })
  const update = value => {
    if (state.disposed || state.composing || input.value === value) return
    const previous = input.value
    let prefix = 0
    while (prefix < previous.length && prefix < value.length && previous[prefix] === value[prefix]) prefix++
    const start = input.selectionStart; const end = input.selectionEnd
    state.remote = true
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    if (document.activeElement === input && start != null) {
      const shift = value.length - previous.length
      input.setSelectionRange(start <= prefix ? start : Math.max(prefix, start + shift), end <= prefix ? end : Math.max(prefix, end + shift))
    }
    state.remote = false
  }
  state.stop = watch(() => [projectSession.enabled, state.target?.id], async ([enabled]) => {
    state.binding?.dispose()
    if (!enabled || !state.target?.id) return
    if (state.target.kind.endsWith('_libraries') && Number(projectSnapshot(state.target.kind, state.target.id)?.__projectId) !== projectSession.id) return
    try {
      const result = await bindProjectText(state.target, update)
      if (state.disposed) result?.dispose()
      else state.binding = result
    } catch (error) { projectSession.error = error.message }
  }, { immediate: true })
  const onInput = () => { if (!state.remote && !state.composing) state.binding?.change(input.value) }
  const onStart = () => { state.composing = true; state.binding?.compositionStart() }
  const onEnd = () => { state.composing = false; state.binding?.compositionEnd(input.value) }
  const onFocus = () => projectPresence(`${state.target.kind}:${state.target.id}:${state.target.field}`)
  const onBlur = () => projectPresence(null)
  for (const [event, fn] of Object.entries({ input: onInput, compositionstart: onStart, compositionend: onEnd, focus: onFocus, blur: onBlur })) input.addEventListener(event, fn)
  state.cleanup = () => {
    state.disposed = true; state.stop?.(); stopPermission(); state.binding?.dispose()
    for (const [event, fn] of Object.entries({ input: onInput, compositionstart: onStart, compositionend: onEnd, focus: onFocus, blur: onBlur })) input.removeEventListener(event, fn)
  }
}

export default {
  mounted: mount,
  updated(el, binding) {
    const state = bindings.get(el)
    if (JSON.stringify(state?.target) !== JSON.stringify(binding.value)) { state?.cleanup?.(); mount(el, binding) }
  },
  beforeUnmount(el) { bindings.get(el)?.cleanup?.(); bindings.delete(el) },
}
