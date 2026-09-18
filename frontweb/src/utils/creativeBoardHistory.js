// Browser-local edit history for the creative board. It stores only what a user can
// edit by hand: node placement, titles, text and draft parameters plus the edges.
// Runtime state (versions, outputs, a resolved or unresolved request) is deliberately
// excluded, so an undo can never replay a paid submission or resurrect a stale task.
const LIMIT = 50
const DRAFT_FIELDS = ['draftType', 'prompt', 'model', 'duration', 'resolution', 'aspectRatio', 'upscale1080', 'upscale_resolution', 'target_fps']

export function editSnapshot(nodes, edges) {
  return {
    nodes: nodes.map((node) => {
      const out = { id: node.id, x: node.position.x, y: node.position.y }
      if (node.kind === 'draft_image' || node.kind === 'draft_video') {
        out.kind = node.kind
        out.draft = Object.fromEntries(DRAFT_FIELDS.filter((key) => node.data[key] !== undefined).map((key) => [key, node.data[key]]))
      } else if (node.kind === 'delivery') out.kind = 'delivery'
      else if (node.kind === 'text') { out.kind = 'text'; out.text = node.data.text || '' }
      else { out.source_type = node.source_type; out.source_id = node.source_id }
      if (node.data.title) out.name = node.data.title
      return out
    }),
    edges: edges.map(({ id, source, target, usage }) => ({ id, source, target, usage })),
  }
}

export function createHistory({ limit = LIMIT } = {}) {
  const past = [], future = []
  return {
    get size() { return { past: past.length, future: future.length } },
    record(state) { past.push(state); if (past.length > limit) past.shift(); future.length = 0 },
    undo(current) { if (!past.length) return null; future.push(current); return past.pop() },
    redo(current) { if (!future.length) return null; past.push(current); return future.pop() },
    restore(saved) { if (!saved) return; past.length = 0; future.length = 0; past.push(...saved.past.slice(-limit)); future.push(...saved.future.slice(-limit)) },
    dump() { return { past: past.slice(), future: future.slice() } },
  }
}

// A reload must not replay edits that no longer match the graph on screen, so the stored
// history carries a fingerprint of the graph it was recorded against.
export function readStoredHistory(storage, key, fingerprint) {
  try {
    const raw = JSON.parse(storage?.getItem(key) || 'null')
    if (!raw || raw.fingerprint !== fingerprint || !Array.isArray(raw.past) || !Array.isArray(raw.future)) return null
    return { past: raw.past, future: raw.future }
  } catch (_) { return null }
}

export function writeStoredHistory(storage, key, fingerprint, { past, future }) {
  try { storage?.setItem(key, JSON.stringify({ fingerprint, past, future })) } catch (_) {}
}

export function clearStoredHistory(storage, key) {
  try { storage?.removeItem(key) } catch (_) {}
}
