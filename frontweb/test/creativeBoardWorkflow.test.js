import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { generationVersions, referenceForNode, usageOptionsFor, draftSnapshot, uploadedAsset, dropPosition, textInputsFor, composePrompt, nodeLabel, pasteNodes } from '../src/utils/creativeBoardWorkflow.js'

test('persistent generation nodes resolve latest completed local output, not a pending version', () => {
  const board = { generated_images: [{ id: 3, draft_node_id: 'draft:a', status: 'pending' }, { id: 1, draft_node_id: 'draft:a', status: 'completed', local_path: 'a.png' }, { id: 2, draft_node_id: 'draft:b' }] }
  const versions = generationVersions(board, 'draft:a', 'image')
  assert.deepEqual(versions.map((row) => row.id), [1, 3])
  const node = { id: 'draft:a', kind: 'draft_image', data: { output: { ...versions[0], type: 'image' }, latest: versions[1] } }
  assert.equal(referenceForNode(node).source_id, 1)
  assert.equal(referenceForNode(node).source_type, 'image_generation')
  assert.equal(node.id, 'draft:a')
  assert.equal(referenceForNode({ ...node, data: { output: null } }), null)
  assert.equal(referenceForNode({ ...node, data: { output: { status: 'completed', url: 'https://supplier.invalid/signed' } } }), null)
})

test('image inputs reject video and frame usages; video inputs allow frames and continuation', () => {
  assert.deepEqual(usageOptionsFor('image', 'draft_image').map((item) => item.value), ['reference'])
  assert.deepEqual(usageOptionsFor('video', 'draft_image'), [])
  assert.deepEqual(usageOptionsFor('image', 'draft_video').map((item) => item.value), ['reference', 'first_frame', 'last_frame'])
  assert.deepEqual(usageOptionsFor('video', 'draft_video').map((item) => item.value), ['reference', 'continuation'])
  assert.deepEqual(usageOptionsFor('audio', 'draft_video'), [])
})

test('draft snapshot persists exact unresolved request but never duplicates edges or versions', () => {
  const pendingRequest = { idempotency_key: 'same-key', reference_sources: [{ source_type: 'image_generation', source_id: 1 }], prompt: 'frozen input' }
  const snapshot = JSON.parse(JSON.stringify(draftSnapshot({ prompt: 'prompt', pendingRequest, refs: ['legacy'], output: { id: 1 }, latest: { id: 2 }, submitting: true, onRun() {} })))
  assert.deepEqual(snapshot, { prompt: 'prompt', pendingRequest })
})

test('upload results unwrap the asset payload and refuse a record without an id', () => {
  assert.equal(uploadedAsset({ asset: { id: 233, type: 'image' } }).id, 233)
  assert.equal(uploadedAsset({ id: 7 }).id, 7)
  assert.throws(() => uploadedAsset({ asset: { type: 'image' } }), /上传未返回素材记录/)
  assert.throws(() => uploadedAsset(undefined), /上传未返回素材记录/)
})

test('a multi-file drop cascades while a retry keeps every file on its own point', () => {
  const base = { x: 100, y: 100 }
  assert.deepEqual(dropPosition(base, 0), base)
  assert.deepEqual(dropPosition(base, 2), { x: 152, y: 152 })
  // No drop point means the caller places the card, so the offset must not invent one.
  assert.equal(dropPosition(null, 3), null)
  const upload = readFileSync(new URL('../src/components/creativeBoard/CreativeBoardUpload.vue', import.meta.url), 'utf8')
  assert.match(upload, /positions\?\.\[index\] \?\? dropPosition\(position, index\)/)
  assert.match(upload, /items\.map\(\(item\) => item\.position\)/)
})

test('pasting re-identifies nodes and rewires both edge endpoints, never the clipboard itself', () => {
  const clipboard = {
    nodes: [{ id: 'text:origin', x: 10, y: 20, kind: 'text', text: '备注', name: '标题' }, { id: 'draft:origin', x: 300, y: 20, kind: 'draft_video', draft: { prompt: '猫' } }],
    edges: [{ id: 'edge:origin', source: 'text:origin', target: 'draft:origin', usage: 'prompt' }],
  }
  let seq = 0
  const { nodes, edges } = pasteNodes(clipboard, () => `n${++seq}`, 36)
  assert.deepEqual(nodes.map((node) => node.id), ['text:n1', 'draft:n2'])
  assert.deepEqual(nodes.map((node) => [node.x, node.y]), [[46, 56], [336, 56]])
  // Content travels; only the identity and the placement move.
  assert.equal(nodes[0].text, '备注'); assert.equal(nodes[0].name, '标题'); assert.deepEqual(nodes[1].draft, { prompt: '猫' })
  assert.deepEqual(edges, [{ id: 'edge:n3', source: 'text:n1', target: 'draft:n2', usage: 'prompt' }])
  // An endpoint left pointing at the old id would dangle, so none may survive.
  const live = new Set(nodes.map((node) => node.id))
  for (const edge of edges) { assert.ok(live.has(edge.source) && live.has(edge.target)) }
  assert.deepEqual(clipboard.nodes.map((node) => node.id), ['text:origin', 'draft:origin'])
})

test('text nodes compose in edge order ahead of the node prompt and stay out of media references', () => {
  const nodes = [
    { id: 'text:1', kind: 'text', data: { text: '  风格：赛博朋克  ' } },
    { id: 'text:2', kind: 'text', data: { text: '    ' } },
    { id: 'media:1', kind: 'asset', source_type: 'asset', data: { text: '忽略我' } },
    { id: 'draft:1', kind: 'draft_video', data: { text: '本节点的文本不属于提示词' } },
  ]
  const edges = [
    { id: 'p1', source: 'text:1', target: 'draft:1', usage: 'prompt' },
    { id: 'p2', source: 'text:2', target: 'draft:1', usage: 'prompt' },
    { id: 'p3', source: 'media:1', target: 'draft:1', usage: 'first_frame' },
    { id: 'p4', source: 'text:1', target: 'draft:2', usage: 'prompt' },
  ]
  assert.deepEqual(textInputsFor('draft:1', edges, nodes), ['风格：赛博朋克'])
  assert.equal(composePrompt('', textInputsFor('draft:1', edges, nodes)), '风格：赛博朋克')
  assert.equal(composePrompt('本地提示词', ['上游一', '上游二']), '上游一\n\n上游二\n\n本地提示词')
  assert.equal(composePrompt('   ', []), '')
  // Only the prompt usage reaches a text source, and a text label falls back to its own line.
  assert.deepEqual(usageOptionsFor('text', 'draft_video'), [{ value: 'prompt', label: '提示词' }])
  assert.deepEqual(usageOptionsFor('text', 'delivery'), [])
  assert.equal(nodeLabel({ kind: 'text', data: { text: '第一行\n第二行' } }), '第一行')
  assert.equal(nodeLabel({ kind: 'text', data: { title: '命名', text: '第一行' } }), '命名')
  assert.notEqual(nodeLabel({ kind: 'asset', data: { name: '素材' } }), '')
})

test('canvas edits and runs inside persistent nodes, polling never re-adds removed cards', () => {
  const view = readFileSync(new URL('../src/views/CreativeBoard.vue', import.meta.url), 'utf8')
  const node = readFileSync(new URL('../src/components/creativeBoard/CreativeDraftNode.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(view, /CreativeComposePanel|ZONE_X|ZONES|zone-layer|draftNode\.id\s*=/)
  assert.equal(existsSync(new URL('../src/components/creativeBoard/CreativeComposePanel.vue', import.meta.url)), false)
  assert.match(view, /<el-drawer v-model="showLibrary"/)
  assert.match(node, /v-model="data\.prompt"/)
  assert.match(node, /data\.onRun\(id\)/)
  assert.match(node, /nodrag nopan nowheel/)
  assert.match(view, /node\.data\.delivery_id = String\(recordId\)/)
  const polling = view.slice(view.indexOf('async function refresh()'), view.indexOf('watch(showLibrary'))
  assert.doesNotMatch(polling, /loadBoard\(|flowNodes\.value\s*=|flowNodes\.value\.push/)
  assert.match(polling, /updateNodeState\(value\)/)
  assert.match(view, /scheduleSave\(\); await saveBoard\(\)/)
  assert.match(view, /imagesAPI\.create\(data\.pendingRequest\)/)
})
