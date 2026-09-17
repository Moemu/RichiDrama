const assetService = require('./assetService');

const EDGE_USAGES = new Set(['reference', 'first_frame', 'last_frame', 'continuation', 'prompt']);
const SOURCE_TYPES = new Set(['asset', 'image_generation', 'video_generation']);
const NODE_KINDS = new Set(['asset', 'draft_image', 'draft_video', 'delivery', 'text']);
const NODE_ID_RE = /^[\w:-]{1,90}$/;
const TEXT_LIMIT = 10000;
const NAME_LIMIT = 100;

function nodeKind(node) { return node.kind || 'asset'; }
function isDraftKind(kind) { return kind === 'draft_image' || kind === 'draft_video'; }

function mediaNodeType(db, node, ownerId) {
  if (nodeKind(node) === 'draft_image') return 'image';
  if (nodeKind(node) === 'draft_video') return 'video';
  const item = ownedMedia(db, node.source_type, node.source_id, ownerId);
  if (!item) return null;
  return node.source_type === 'asset' ? item.type : node.source_type === 'image_generation' ? 'image' : 'video';
}

function ownedBoard(db, id, ownerId) {
  return db.prepare('SELECT * FROM creative_boards WHERE id=? AND owner_user_id=? AND deleted_at IS NULL')
    .get(Number(id), Number(ownerId)) || null;
}

function assertBoard(db, id, ownerId) {
  const board = ownedBoard(db, id, ownerId);
  if (!board) throw new Error('画布不存在或无权访问');
  return board;
}

function ownedMedia(db, sourceType, sourceId, ownerId) {
  const id = Number(sourceId);
  if (!Number.isInteger(id) || id <= 0 || !SOURCE_TYPES.has(sourceType)) return null;
  if (sourceType === 'asset') return assetService.getByIdForOwner(db, id, ownerId);
  const table = sourceType === 'image_generation' ? 'image_generations' : 'video_generations';
  return db.prepare(`SELECT * FROM ${table} WHERE id=? AND owner_user_id=? AND deleted_at IS NULL`).get(id, Number(ownerId)) || null;
}

function generationUsesReference(db, target, sourceMedia, usage) {
  if (!sourceMedia.local_path) return false;
  if (target.source_type === 'image_generation') {
    if (usage !== 'reference') return false;
    const row = db.prepare('SELECT reference_images FROM image_generations WHERE id=?').get(target.source_id);
    try { return JSON.parse(row?.reference_images || '[]').includes(sourceMedia.local_path); } catch (_) { return false; }
  }
  const row = db.prepare('SELECT request_snapshot_json FROM omni_video_jobs WHERE video_generation_id=? ORDER BY id DESC LIMIT 1').get(target.source_id);
  if (!row) return false;
  try {
    const assets = JSON.parse(row.request_snapshot_json || '{}').assets || [];
    return assets.some((asset) => asset.send_to_model && asset.local_path === sourceMedia.local_path
      && (asset.usage === usage || (usage === 'continuation' && asset.usage === 'motion')));
  } catch (_) { return false; }
}

// 生成节点（draft_*）作为连线 source 时，按它的任一历史版本（同 board + draft_node_id）解析引用关系；
// 一个版本都没跑过的生成节点没有可引用的真实产物，不能作 source。
function draftNodeHasReference(db, sourceNode, target, sourceType, usage, ownerId, boardId) {
  const table = sourceType === 'image_generation' ? 'image_generations' : 'video_generations';
  const versions = db.prepare(`SELECT * FROM ${table} WHERE board_id=? AND owner_user_id=? AND draft_node_id=? AND deleted_at IS NULL`)
    .all(Number(boardId), ownerId, sourceNode.id);
  return versions.some((version) => generationUsesReference(db, target, version, usage));
}

function validateGraph(db, input, ownerId, boardId) {
  const nodes = input?.nodes;
  const edges = input?.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges) || nodes.length > 500 || edges.length > 1000) throw new Error('画布内容无效或超出限制');
  const ids = new Set();
  let deliveryCount = 0;
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !NODE_ID_RE.test(node.id) || ids.has(node.id)) throw new Error('画布卡片 ID 无效');
    const kind = nodeKind(node);
    if (!NODE_KINDS.has(kind)) throw new Error('画布卡片类型无效');
    if (node.name != null && (typeof node.name !== 'string' || node.name.length > NAME_LIMIT)) throw new Error('画布卡片名称无效');
    if (kind === 'delivery') {
      deliveryCount += 1;
      if (deliveryCount > 1) throw new Error('画布只能有一个交付节点');
      if (node.delivery_id != null && (typeof node.delivery_id !== 'string' || node.delivery_id.length > 200)) throw new Error('交付节点关联无效');
    } else if (kind === 'text') {
      if (node.text != null && typeof node.text !== 'string') throw new Error('文本节点内容无效');
      if ((node.text || '').length > TEXT_LIMIT) throw new Error('文本节点内容过长');
    } else if (isDraftKind(kind)) {
      if (node.draft != null && (typeof node.draft !== 'object' || Array.isArray(node.draft))) throw new Error('草稿节点数据无效');
      if (node.draft?.prompt != null && String(node.draft.prompt).length > 10000) throw new Error('草稿提示词过长');
    } else if (node.id !== `${node.source_type}:${Number(node.source_id)}` || !ownedMedia(db, node.source_type, node.source_id, ownerId)) {
      throw new Error('画布包含无权访问的媒体');
    }
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || Math.abs(node.x) > 100000 || Math.abs(node.y) > 100000) throw new Error('画布卡片位置无效');
    ids.add(node.id);
  }
  const edgeIds = new Set();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    if (!edge || typeof edge.id !== 'string' || !NODE_ID_RE.test(edge.id) || edgeIds.has(edge.id)
      || !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target || !EDGE_USAGES.has(edge.usage)) throw new Error('画布连线无效');
    const source = byId.get(edge.source), target = byId.get(edge.target);
    const targetKind = nodeKind(target);
    const sourceKind = nodeKind(source);
    // Text edges carry the prompt only, so they never reach the media reference checks below.
    if (sourceKind === 'text') {
      if (edge.usage !== 'prompt') throw new Error('文本节点只能作为提示词输入');
      if (!isDraftKind(targetKind)) throw new Error('文本节点只能连接到生成节点');
      edgeIds.add(edge.id);
      continue;
    }
    if (targetKind === 'text') throw new Error('文本节点不能作为连线目标');
    if (edge.usage === 'prompt') throw new Error('提示词连线只能来自文本节点');
    if (targetKind === 'asset' && target.source_type === 'asset') throw new Error('连线只能指向画布生成结果');
    if (targetKind === 'delivery') throw new Error('交付节点不能作为连线目标');
    if (sourceKind === 'delivery') throw new Error('交付节点不能作为连线起点');
    const sourceType = mediaNodeType(db, source, ownerId);
    if (!sourceType) throw new Error('画布包含无权访问的媒体');
    const targetIsDraft = isDraftKind(targetKind);
    const targetType = mediaNodeType(db, target, ownerId);
    if ((edge.usage === 'first_frame' || edge.usage === 'last_frame') && (sourceType !== 'image' || targetType !== 'video')) throw new Error('首尾帧须用于视频生成并使用图片素材');
    if (edge.usage === 'continuation' && (sourceType !== 'video' || targetType !== 'video')) throw new Error('续接须用于视频生成并使用视频素材');
    if (!targetIsDraft) {
      const result = ownedMedia(db, target.source_type, target.source_id, ownerId);
      if (Number(result.board_id) !== Number(boardId)) throw new Error('连线目标不属于该画布生成任务');
      const matched = isDraftKind(sourceKind)
        ? draftNodeHasReference(db, source, target, sourceKind === 'draft_image' ? 'image_generation' : 'video_generation', edge.usage, ownerId, boardId)
        : generationUsesReference(db, target, ownedMedia(db, source.source_type, source.source_id, ownerId), edge.usage);
      if (!matched) throw new Error('连线与生成任务的参考素材不一致');
    }
    edgeIds.add(edge.id);
  }
  return {
    nodes: nodes.map((node) => {
      const kind = nodeKind(node);
      const out = { id: node.id, x: node.x, y: node.y };
      if (kind !== 'asset') out.kind = kind;
      if (kind === 'asset') { out.source_type = node.source_type; out.source_id = Number(node.source_id); }
      if (node.name !== undefined) out.name = node.name;
      if (kind === 'text') out.text = node.text || '';
      if (node.draft !== undefined) out.draft = node.draft;
      if (node.delivery_id !== undefined) out.delivery_id = node.delivery_id;
      return out;
    }),
    edges: edges.map(({ id, source, target, usage }) => ({ id, source, target, usage })),
  };
}

function detail(db, board, ownerId) {
  const graph = JSON.parse(board.graph_json);
  const media = Object.fromEntries(graph.nodes.filter((node) => nodeKind(node) === 'asset').map((node) => {
    const item = ownedMedia(db, node.source_type, node.source_id, ownerId);
    if (!item) return [node.id, { missing: true }];
    const type = node.source_type === 'asset' ? item.type : node.source_type === 'image_generation' ? 'image' : 'video';
    return [node.id, { id: item.id, type, name: item.name || item.prompt || `${type === 'image' ? '图片' : '视频'} #${item.id}`, prompt: item.prompt || null, model: item.model || null, status: item.status || item.processing_status || 'ready', url: item.local_path ? `/static/${String(item.local_path).replace(/^\/+/, '')}` : null, local_path: item.local_path || null, duration_ms: item.output_duration_ms || (item.duration ? Number(item.duration) * 1000 : null), error_msg: item.error_msg || null }];
  }));
  const generatedImages = db.prepare('SELECT id, status, local_path, image_url, error_msg, created_at, draft_node_id FROM image_generations WHERE board_id=? AND owner_user_id=? AND deleted_at IS NULL ORDER BY id').all(board.id, ownerId);
  const generatedVideos = db.prepare('SELECT id, status, local_path, output_duration_ms, duration, error_msg, created_at, draft_node_id FROM video_generations WHERE board_id=? AND owner_user_id=? AND deleted_at IS NULL ORDER BY id').all(board.id, ownerId);
  return { id: board.id, name: board.name, revision: board.revision, graph, media, generated_images: generatedImages, generated_videos: generatedVideos, created_at: board.created_at, updated_at: board.updated_at };
}

function list(db, ownerId) {
  return db.prepare('SELECT id, name, revision, created_at, updated_at FROM creative_boards WHERE owner_user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC').all(Number(ownerId));
}

function create(db, ownerId, name) {
  const title = String(name || '未命名画布').trim().slice(0, 100) || '未命名画布';
  const at = new Date().toISOString();
  const out = db.prepare('INSERT INTO creative_boards(owner_user_id,name,created_at,updated_at) VALUES(?,?,?,?)').run(ownerId, title, at, at);
  return detail(db, assertBoard(db, out.lastInsertRowid, ownerId), ownerId);
}

function update(db, id, ownerId, input) {
  const board = assertBoard(db, id, ownerId);
  const revision = Number(input?.revision);
  if (!Number.isInteger(revision) || revision !== board.revision) { const error = new Error('画布已在其他页面修改，请刷新后重试'); error.code = 'VERSION_CONFLICT'; throw error; }
  const graph = input.graph === undefined ? JSON.parse(board.graph_json) : validateGraph(db, input.graph, ownerId, board.id);
  const name = input.name === undefined ? board.name : String(input.name || '').trim().slice(0, 100);
  if (!name) throw new Error('画布名称不能为空');
  const out = db.prepare('UPDATE creative_boards SET name=?,graph_json=?,revision=revision+1,updated_at=? WHERE id=? AND owner_user_id=? AND revision=? AND deleted_at IS NULL')
    .run(name, JSON.stringify(graph), new Date().toISOString(), board.id, ownerId, revision);
  if (!out.changes) { const error = new Error('画布保存冲突'); error.code = 'VERSION_CONFLICT'; throw error; }
  return detail(db, assertBoard(db, id, ownerId), ownerId);
}

function remove(db, id, ownerId) {
  assertBoard(db, id, ownerId);
  db.prepare('UPDATE creative_boards SET deleted_at=?,updated_at=? WHERE id=? AND owner_user_id=? AND deleted_at IS NULL')
    .run(new Date().toISOString(), new Date().toISOString(), Number(id), Number(ownerId));
  return { ok: true };
}

module.exports = { assertBoard, ownedMedia, validateGraph, list, create, detail, update, remove };
