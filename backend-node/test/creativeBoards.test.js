const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const boards = require('../src/services/creativeBoardService');
const deliveries = require('../src/services/creativeBoardDeliveryService');
const videos = require('../src/services/videoService');
const images = require('../src/services/imageService');

function fixture() {
  const db = new Database(':memory:');
  const originalLog = console.log, originalWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { runMigrationsAndEnsure(db); } finally { console.log = originalLog; console.warn = originalWarn; }
  return db;
}

test('creative board owns media references and rejects stale writes', () => {
  const db = fixture();
  try {
    const board = boards.create(db, 1, '第一张画布');
    assert.deepEqual(board.graph, { nodes: [], edges: [] });
    assert.equal(boards.list(db, 1).length, 1);
    assert.equal(boards.list(db, 2).length, 0);
    assert.throws(() => boards.assertBoard(db, board.id, 2), /无权/);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO image_generations(id,owner_user_id,prompt,status,local_path,created_at,updated_at) VALUES(1,1,'图','completed','library/a.png',?,?)").run(now, now);
    db.prepare("INSERT INTO image_generations(id,owner_user_id,prompt,status,created_at,updated_at) VALUES(2,2,'别人','completed',?,?)").run(now, now);
    const graph = { nodes: [{ id: 'image_generation:1', source_type: 'image_generation', source_id: 1, x: 20, y: 30 }], edges: [] };
    const updated = boards.update(db, board.id, 1, { revision: board.revision, graph });
    assert.equal(updated.revision, 2);
    assert.equal(updated.media['image_generation:1'].url, '/static/library/a.png');
    assert.throws(() => boards.update(db, board.id, 1, { revision: 1, graph }), /其他页面/);
    assert.throws(() => boards.update(db, board.id, 1, { revision: 2, graph: { nodes: [{ id: 'image_generation:2', source_type: 'image_generation', source_id: 2, x: 0, y: 0 }], edges: [] } }), /无权/);
    assert.throws(() => boards.update(db, board.id, 1, { revision: 2, graph: { ...graph, edges: [{ id: 'line', source: 'image_generation:1', target: 'missing', usage: 'reference' }] } }), /连线/);
    db.prepare("INSERT INTO image_generations(id,owner_user_id,board_id,prompt,status,reference_images,created_at,updated_at) VALUES(3,1,?,'新图','pending','[\"library/a.png\"]',?,?)").run(board.id, now, now);
    const withResult = { nodes: [...graph.nodes, { id: 'image_generation:3', source_type: 'image_generation', source_id: 3, x: 220, y: 40 }], edges: [{ id: 'reference-line', source: 'image_generation:1', target: 'image_generation:3', usage: 'reference' }] };
    const linked = boards.update(db, board.id, 1, { revision: 2, graph: withResult });
    assert.equal(linked.graph.edges.length, 1);
    assert.throws(() => boards.update(db, board.id, 1, { revision: 3, graph: { ...withResult, edges: [{ ...withResult.edges[0], usage: 'first_frame' }] } }), /首尾帧/);
    db.prepare("INSERT INTO video_generations(id,owner_user_id,board_id,prompt,status,error_msg,created_at,updated_at) VALUES(4,1,?,'视频','failed','模型提交失败',?,?)").run(board.id, now, now);
    db.prepare('INSERT INTO omni_video_jobs(owner_user_id,video_generation_id,prompt,request_snapshot_json,created_at,updated_at) VALUES(1,4,?,?,?,?)')
      .run('视频', JSON.stringify({ assets: [{ send_to_model: true, local_path: 'library/a.png', usage: 'first_frame' }] }), now, now);
    const videoGraph = { nodes: [...withResult.nodes, { id: 'video_generation:4', source_type: 'video_generation', source_id: 4, x: 450, y: 50 }], edges: [...withResult.edges, { id: 'first-frame-line', source: 'image_generation:1', target: 'video_generation:4', usage: 'first_frame' }] };
    const withVideo = boards.update(db, board.id, 1, { revision: 3, graph: videoGraph });
    assert.equal(withVideo.media['video_generation:4'].error_msg, '模型提交失败');
    assert.throws(() => boards.update(db, board.id, 1, { revision: 4, graph: { ...videoGraph, edges: [...withResult.edges, { ...videoGraph.edges[1], usage: 'last_frame' }] } }), /参考素材不一致/);
    assert.equal(boards.remove(db, board.id, 1).ok, true);
    assert.equal(boards.list(db, 1).length, 0);
  } finally { db.close(); }
});

test('video history pages across legacy and board generations without exposing other owners', () => {
  const db = fixture();
  try {
    const at = new Date().toISOString();
    const insert = db.prepare("INSERT INTO video_generations(owner_user_id,prompt,status,created_at,updated_at) VALUES(?,?,'completed',?,?)");
    for (let i = 0; i < 121; i++) insert.run(1, `视频 ${i}`, at, at);
    insert.run(2, '别人的视频', at, at);
    const first = videos.list(db, { owner_user_id: 1, page: 1, page_size: 100 });
    const second = videos.list(db, { owner_user_id: 1, page: 2, page_size: 100 });
    assert.equal(first.total, 121);
    assert.equal(first.items.length, 100);
    assert.equal(second.items.length, 21);
    assert.ok([...first.items, ...second.items].every((item) => item.prompt !== '别人的视频'));
  } finally { db.close(); }
});

test('manual subtitle timing creates a playable SRT and rejects overlap', () => {
  const subtitles = deliveries.validateSubtitles([{ start_ms: 0, end_ms: 1800, text: '第一句' }, { start_ms: 1800, end_ms: 3700, text: '第二句' }], 4000);
  assert.match(deliveries.srtText(subtitles), /00:00:01,800 --> 00:00:03,700/);
  assert.throws(() => deliveries.validateSubtitles([{ start_ms: 0, end_ms: 1800, text: '第一句' }, { start_ms: 1700, end_ms: 2500, text: '重叠' }], 4000), /时间/);
});

test('board image startup recovery queues only pending board records and leaves terminal history unchanged', async () => {
  const db = fixture();
  try {
    const at = new Date().toISOString();
    const board = boards.create(db, 1, '恢复');
    const insert = db.prepare("INSERT INTO image_generations(owner_user_id,board_id,prompt,status,created_at,updated_at) VALUES(1,?,'图片','pending',?,?)");
    const boardImage = insert.run(board.id, at, at);
    insert.run(null, at, at);
    const queued = images.resumePendingCreativeBoardImages(db, { info() {}, error() {} });
    assert.equal(queued, 1);
    db.prepare("UPDATE image_generations SET status='completed' WHERE id=?").run(Number(boardImage.lastInsertRowid));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(db.prepare('SELECT status FROM image_generations WHERE id=?').get(Number(boardImage.lastInsertRowid)).status, 'completed');
    assert.equal(images.resumePendingCreativeBoardImages(db, { info() {}, error() {} }), 0);
  } finally { db.close(); }
});

test('draft nodes save with usage-only edge checks and delivery is a single terminal node', () => {
  const db = fixture();
  try {
    const board = boards.create(db, 1, '草稿画布');
    const at = new Date().toISOString();
    db.prepare("INSERT INTO image_generations(id,owner_user_id,prompt,status,local_path,created_at,updated_at) VALUES(1,1,'图','completed','library/a.png',?,?)").run(at, at);
    db.prepare("INSERT INTO video_generations(id,owner_user_id,prompt,status,local_path,created_at,updated_at) VALUES(2,1,'视频','completed','library/a.mp4',?,?)").run(at, at);
    const nodes = [
      { id: 'image_generation:1', source_type: 'image_generation', source_id: 1, x: 0, y: 0 },
      { id: 'video_generation:2', source_type: 'video_generation', source_id: 2, x: 0, y: 120 },
      { id: 'draft:image-1', kind: 'draft_image', x: 200, y: 0, draft: { prompt: '画一张图', model: 'm', usage: 'reference' } },
      { id: 'draft:video-1', kind: 'draft_video', x: 400, y: 0, draft: { prompt: '生成视频', duration_sec: 4 } },
      { id: 'draft:video-2', kind: 'draft_video', x: 400, y: 200, draft: { prompt: '续接' } },
      { id: 'delivery:1', kind: 'delivery', x: 600, y: 0 },
    ];
    const graph = {
      nodes,
      edges: [
        { id: 'ref-draft', source: 'image_generation:1', target: 'draft:image-1', usage: 'reference' },
        { id: 'ff-draft', source: 'image_generation:1', target: 'draft:video-1', usage: 'first_frame' },
        { id: 'cont-draft', source: 'video_generation:2', target: 'draft:video-1', usage: 'continuation' },
        { id: 'draft-chain', source: 'draft:video-1', target: 'draft:video-2', usage: 'continuation' },
      ],
    };
    const saved = boards.update(db, board.id, 1, { revision: board.revision, graph });
    assert.equal(saved.graph.edges.length, 4);
    assert.equal(saved.graph.nodes.find((node) => node.id === 'draft:video-1').draft.prompt, '生成视频');
    assert.equal(saved.media['draft:image-1'], undefined);
    assert.equal(saved.media['delivery:1'], undefined);
    // 首帧指向 draft_image（目标不是视频）被拒
    assert.throws(() => boards.update(db, board.id, 1, { revision: 2, graph: { nodes, edges: [{ id: 'ff-img', source: 'image_generation:1', target: 'draft:image-1', usage: 'first_frame' }] } }), /首尾帧/);
    // 续接 draft_video 的 source 必须是视频
    assert.throws(() => boards.update(db, board.id, 1, { revision: 2, graph: { nodes, edges: [{ id: 'cont-img', source: 'image_generation:1', target: 'draft:video-1', usage: 'continuation' }] } }), /续接/);
    // 任何边不得指向交付节点
    assert.throws(() => boards.update(db, board.id, 1, { revision: 2, graph: { nodes, edges: [{ id: 'to-delivery', source: 'image_generation:1', target: 'delivery:1', usage: 'reference' }] } }), /交付/);
    // 交付节点不能作为连线起点
    assert.throws(() => boards.update(db, board.id, 1, { revision: 2, graph: { nodes, edges: [{ id: 'from-delivery', source: 'delivery:1', target: 'draft:image-1', usage: 'reference' }] } }), /交付/);
    // 一个画布最多一个 delivery 节点
    assert.throws(() => boards.update(db, board.id, 1, { revision: 2, graph: { nodes: [...nodes, { id: 'delivery:2', kind: 'delivery', x: 800, y: 0 }], edges: [] } }), /交付/);
    // 草稿提示词超长被拒
    assert.throws(() => boards.update(db, board.id, 1, { revision: 2, graph: { nodes: [{ ...nodes[2], draft: { prompt: 'x'.repeat(10001) } }], edges: [] } }), /草稿/);
    // 指向真实生成卡的边仍走快照校验（不放松）
    db.prepare("INSERT INTO image_generations(id,owner_user_id,board_id,prompt,status,reference_images,created_at,updated_at) VALUES(3,1,?,'新图','pending','[\"library/b.png\"]',?,?)").run(board.id, at, at);
    const withGen = { nodes: [...nodes, { id: 'image_generation:3', source_type: 'image_generation', source_id: 3, x: 200, y: 300 }], edges: [{ id: 'gen-ref', source: 'image_generation:1', target: 'image_generation:3', usage: 'reference' }] };
    assert.throws(() => boards.update(db, board.id, 1, { revision: 2, graph: withGen }), /参考素材不一致/);
    // 旧结构 graph（无 kind 字段）保存不报错
    const legacy = boards.update(db, board.id, 1, { revision: 2, graph: { nodes: [nodes[0]], edges: [] } });
    assert.equal(legacy.graph.nodes[0].source_type, 'image_generation');
    assert.equal(legacy.graph.nodes[0].kind, undefined);
  } finally { db.close(); }
});

test('text nodes and custom names round-trip without touching media ownership', () => {
  const db = fixture();
  try {
    const board = boards.create(db, 1, '文本画布');
    const nodes = [
      { id: 'text:1', kind: 'text', x: 0, y: 0, name: '风格备注', text: '赛博朋克夜景' },
      { id: 'text:2', kind: 'text', x: 0, y: 200 },
      { id: 'draft:video-1', kind: 'draft_video', x: 300, y: 0, name: '主镜头', draft: { prompt: '本地提示词' } },
    ];
    const saved = boards.update(db, board.id, 1, { revision: board.revision, graph: { nodes, edges: [
      { id: 'p1', source: 'text:1', target: 'draft:video-1', usage: 'prompt' },
      { id: 'p2', source: 'text:2', target: 'draft:video-1', usage: 'prompt' },
    ] } });
    const text = saved.graph.nodes.find((node) => node.id === 'text:1');
    assert.equal(text.text, '赛博朋克夜景');
    assert.equal(text.name, '风格备注');
    assert.equal(saved.graph.nodes.find((node) => node.id === 'text:2').text, '');
    assert.equal(saved.graph.nodes.find((node) => node.id === 'draft:video-1').name, '主镜头');
    // 文本不是媒体：不入 media 表，不要求 source_type/source_id 所有权
    assert.equal(saved.media['text:1'], undefined);
    assert.equal(saved.graph.edges.length, 2);

    const draftOnly = [{ id: 'draft:image-1', kind: 'draft_image', x: 0, y: 0, draft: {} }];
    const cases = [
      [{ id: 'p3', source: 'text:1', target: 'draft:video-1', usage: 'reference' }, /提示词/],
      [{ id: 'p4', source: 'text:1', target: 'text:2', usage: 'prompt' }, /生成节点/],
      [{ id: 'p5', source: 'text:1', target: 'draft:image-1', usage: 'reference' }, /提示词/],
      [{ id: 'p6', source: 'draft:image-1', target: 'draft:video-1', usage: 'prompt' }, /提示词连线/],
      [{ id: 'p7', source: 'draft:video-1', target: 'text:1', usage: 'reference' }, /作为连线目标/],
    ];
    for (const [edge, pattern] of cases) {
      assert.throws(() => boards.update(db, board.id, 1, { revision: 2, graph: { nodes: [...nodes, ...draftOnly], edges: [edge] } }), pattern, edge.id);
    }
    // 文本节点连生成节点是合法的，与 usage=prompt 之外的媒体边互不影响
    assert.equal(boards.update(db, board.id, 1, { revision: 2, graph: { nodes: [...nodes, ...draftOnly], edges: [{ id: 'p8', source: 'text:1', target: 'draft:image-1', usage: 'prompt' }] } }).graph.edges.length, 1);
    assert.throws(() => boards.update(db, board.id, 1, { revision: 3, graph: { nodes: [{ id: 'text:1', kind: 'text', x: 0, y: 0, text: 'x'.repeat(10001) }], edges: [] } }), /文本节点内容过长/);
    assert.throws(() => boards.update(db, board.id, 1, { revision: 3, graph: { nodes: [{ id: 'text:1', kind: 'text', x: 0, y: 0, name: 'x'.repeat(101) }], edges: [] } }), /名称无效/);
    assert.throws(() => boards.update(db, board.id, 1, { revision: 3, graph: { nodes: [{ id: 'text:1', kind: 'text', x: 0, y: 0, text: { a: 1 } }], edges: [] } }), /文本节点内容无效/);
    // 旧图（无 name/text）保持兼容
    const legacy = boards.update(db, board.id, 1, { revision: 3, graph: { nodes: [{ id: 'draft:image-1', kind: 'draft_image', x: 0, y: 0 }], edges: [] } });
    assert.equal(legacy.graph.nodes[0].name, undefined);
  } finally { db.close(); }
});

test('generation node keeps identity across versions and completed-card edges accept any version match', () => {
  const db = fixture();
  try {
    const board = boards.create(db, 1, '版本节点');
    const at = new Date().toISOString();
    const insertImage = db.prepare("INSERT INTO image_generations(id,owner_user_id,board_id,prompt,status,local_path,draft_node_id,reference_images,created_at,updated_at) VALUES(?,1,?,?,'completed',?,?,?,?,?)");
    const insertVideo = db.prepare("INSERT INTO video_generations(id,owner_user_id,board_id,prompt,status,local_path,draft_node_id,created_at,updated_at) VALUES(?,1,?,?,'completed',?,?,?,?)");
    // 生成节点 draft:image-1 / draft:video-1 各两个历史版本
    insertImage.run(1, board.id, '图一', 'library/a.png', 'draft:image-1', '[]', at, at);
    insertImage.run(2, board.id, '图二', 'library/b.png', 'draft:image-1', '[]', at, at);
    insertVideo.run(4, board.id, '视频一', 'library/v1.mp4', 'draft:video-1', at, at);
    // 下游已完成生成，引用的是第一个版本的产物
    insertImage.run(3, board.id, '下游', 'library/c.png', null, '["library/a.png"]', at, at);
    insertVideo.run(5, board.id, '下游视频', 'library/d.mp4', null, at, at);
    db.prepare('INSERT INTO omni_video_jobs(owner_user_id,video_generation_id,prompt,request_snapshot_json,created_at,updated_at) VALUES(1,5,?,?,?,?)')
      .run('下游视频', JSON.stringify({ assets: [{ send_to_model: true, local_path: 'library/v1.mp4', usage: 'motion' }] }), at, at);
    const nodes = [
      { id: 'draft:image-1', kind: 'draft_image', x: 0, y: 0, draft: { prompt: '角色图' } },
      { id: 'draft:video-1', kind: 'draft_video', x: 0, y: 160, draft: { prompt: '镜头' } },
      { id: 'draft:none', kind: 'draft_image', x: 0, y: 320, draft: { prompt: '没跑过' } },
      { id: 'image_generation:3', source_type: 'image_generation', source_id: 3, x: 240, y: 0 },
      { id: 'video_generation:5', source_type: 'video_generation', source_id: 5, x: 240, y: 160 },
    ];
    const graph = {
      nodes,
      edges: [
        { id: 'ver-ref', source: 'draft:image-1', target: 'image_generation:3', usage: 'reference' },
        { id: 'ver-cont', source: 'draft:video-1', target: 'video_generation:5', usage: 'continuation' },
      ],
    };
    const saved = boards.update(db, board.id, 1, { revision: board.revision, graph });
    assert.equal(saved.graph.edges.length, 2);
    // detail() 返回 draft_node_id，前端据此把版本挂回节点
    assert.equal(saved.generated_images.filter((row) => row.draft_node_id === 'draft:image-1').length, 2);
    // 无版本节点作 source（目标是完成卡）被拒
    assert.throws(() => boards.update(db, board.id, 1, { revision: 2, graph: { nodes, edges: [{ id: 'none-ref', source: 'draft:none', target: 'image_generation:3', usage: 'reference' }] } }), /参考素材不一致/);
    // 引用与所有版本都不一致被拒
    db.prepare("UPDATE image_generations SET reference_images='[\"library/z.png\"]' WHERE id=3").run();
    assert.throws(() => boards.update(db, board.id, 1, { revision: 2, graph: { nodes, edges: [graph.edges[0]] } }), /参考素材不一致/);
    // usage 与快照不一致同样被拒（视频版本只有 motion/continuation 语义）
    assert.throws(() => boards.update(db, board.id, 1, { revision: 2, graph: { nodes, edges: [{ id: 'ver-bad-usage', source: 'draft:video-1', target: 'video_generation:5', usage: 'reference' }] } }), /参考素材不一致/);
    db.prepare("UPDATE image_generations SET reference_images='[\"library/a.png\"]' WHERE id=3").run();
  } finally { db.close(); }
});

test('image service persists draft_node_id only for creative board submissions', async () => {
  const db = fixture();
  try {
    const board = boards.create(db, 1, '草稿透传');
    const log = { info() {}, warn() {}, error() {} };
    const boardRec = images.create(db, log, { source_context: 'creative_board', board_id: board.id, idempotency_key: 'board-k1', prompt: '图', model: 'm', owner_user_id: 1, draft_node_id: 'draft:image-1' });
    const plainRec = images.create(db, log, { prompt: '图2', model: 'm', drama_id: 1, owner_user_id: 1, draft_node_id: 'draft:ignored' });
    db.prepare("UPDATE image_generations SET status='failed' WHERE id IN (?, ?)").run(boardRec.id, plainRec.id);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(db.prepare('SELECT draft_node_id FROM image_generations WHERE id=?').get(boardRec.id).draft_node_id, 'draft:image-1');
    assert.equal(db.prepare('SELECT draft_node_id FROM image_generations WHERE id=?').get(plainRec.id).draft_node_id, null);
  } finally { db.close(); }
});
