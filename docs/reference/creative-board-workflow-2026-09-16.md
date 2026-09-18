# 纯画布工作流化改造 — 交付说明（2026-09-16）

把 Creative Board 从「节点堆砌」改造成有流向的创作流水线：泳道落位、声明式连线（草稿意图卡）、拖拽上传直入、单集交付终点节点。

## 启用范围

**所有画布，新旧一视同仁**；无开关、无灰度。

- 节点新增可选 `kind` 字段：`draft_image` / `draft_video` / `delivery`。**不写 `kind` 的节点按旧的素材/生成卡语义处理**（`creativeBoardService.js` 的 `nodeKind()` 默认值），旧画布读取、保存、连线校验行为不变。
- 首次保存旧画布时会按新结构重写 `graph_json`，字段语义等价：`validateGraph` 只保留 `id/x/y`（`kind === 'asset'` 时再带 `source_type`/`source_id`），旧节点**不会**被补上 `kind`，只丢弃无意义的冗余字段。
- `draft_node_id`（迁移 `80_creative_board_workflow.sql`，`image_generations` / `video_generations` 各加一列 TEXT、可空）**只在 `source_context === 'creative_board'` 时落库**，其他路径传了也被服务层丢弃，不报错。

## 线上兼容性

- 迁移是纯 `ADD COLUMN` + 可空默认值，可重复执行，不回填、不改写历史行。**旧生成记录 `draft_node_id` 保持 NULL**，语义与改造前完全一致。
- 连线校验**只对草稿节点放宽**：指向**已完成生成卡**的边仍然必须与真实生成快照（`reference_images` / `request_snapshot_json`）一致，历史画布的既有语义没有被削弱，也不会被放宽后的规则改写。
- 交付记录不强制迁移；`creative_board_deliveries` 表结构与读取路径未变。
- 计费、鉴权、幂等路径零改动：`draft_node_id` 仅记录/透传，不进供应商请求，不进预授权计算。

## 明确排除项

| 排除内容 | 原因 |
|---|---|
| 历史交付记录 | 不迁移、不重算、不改状态 |
| 旧生成记录的 `draft_node_id` | 保持 NULL，不回溯关联草稿节点 |
| 旧画布中没有 `kind` 的节点 | 维持原语义，不被自动赋予草稿/交付身份 |
| 指向已完成生成卡的边 | 不放宽，仍按真实快照校验 |

## 消费者检索结果（`rg` @ `backend-node/src`、`frontweb/src`、`backend-node/test`）

- **`graph_json`**：仅 `creativeBoardService.js`（读/写）与迁移 `79_creative_boards.sql`（DDL）触及，无第三方消费方 → `kind` 字段变更完全内聚。
- **`creative_board` source_context**：`routes/images.js`、`routes/omniVideo.js`（含 `quote` 的归属校验）、`services/imageService.js`、`services/omniVideoService.js`、`services/mediaAuthorizationService.js`（交付文件下载授权）、`frontweb/src/views/CreativeBoard.vue`。全部逐处确认：新增字段均为可选，缺省走旧分支。
- **`draft_node_id` 消费者**：`routes/images.js`、`routes/omniVideo.js`（长度/类型校验 + 400）、`imageService.js`、`omniVideoService.js`（INSERT/UPDATE）、前端 `CreativeBoard.vue`。非画布路径（`single_video_tool` 等）显式验证为忽略且 201。
- **媒体与异步状态**：交付组装仍走本地持久化路径 + 后台任务 + `processing` 终态落库，未引入 handler 内轮询；上传复用既有 `/media/upload`（≤50MB），不产生 AI 计费。

## 验证证据

- 后端 `node --test test/*.test.js`：**425 passed / 0 failed**（12 suites）。
- 前端 `node --test test/*.test.js`：**152 passed / 0 failed**；`npm run build` 通过。
- 重启/刷新后读取（AGENTS.md 要求至少一条）：
  - `test/creativeBoardDelivery.integration.test.js` — 单集交付在**数据库重启后**恢复并写出成片/净片/SRT 三件套（真实 ffmpeg）。
  - `test/creativeBoards.test.js` — 启动恢复只为 pending 的画布图片记录排队，终态历史不变。
  - `test/creativeBoardsHttp.integration.test.js` — 重启后画布 HTTP 路由仍是所有者隔离、历史媒体可读。
- 活体 E2E（dev 档 + `127.0.0.1:5679` 真实 API，15 项全绿）：登录 → 建画布 → `/media/upload` 成素材 → 保存无 `kind` 的旧图（向后兼容）→ 素材→`draft_image` 声明式连线保存 → `first_frame` 落到图片草稿被拒 → `draft_video` 接受 `first_frame` → 图片素材不能 `continuation` → 单交付节点保存 / 双交付节点被拒 / 交付节点不能作连线端点 → 指向已完成生成卡的边仍被快照校验拦下 → 回读画布草稿与交付节点持久化、`media` 映射不含草稿/交付节点。
- 前端组件 `CreativeBoard.vue` / `CreativeDraftNode.vue` / `CreativeDeliveryNode.vue` / `CreativeBoardUpload.vue` 经 Vite dev 变换编译 200（无 SFC 编译错误）。

## 已知限制 / 未覆盖

1. **未做人工浏览器视觉验收**：本次改造由无浏览器工具的执行环境完成，泳道吸附、拖拽落位、usage 选择弹窗的**像素级表现**只由 production build 通过 + dev server 编译通过佐证，未经真人拖动确认。建议在 `127.0.0.1:3013`（`admin` / `admin123456`）用 1280×720 / 1440×900 / 1920×1080 三档视口各走一遍：拖文件入画布 → 拉线声明参考 → 提交生成到 quote 弹窗 → 交付节点提交与下载。
2. **未用真实供应商出片**：遵守计费边界，未发起真实 AI 调用，模型实际出片效果待有余额环境验收。
3. **未提交、未部署**：改动仍在工作区（含未跟踪的新文件），无 CI 校验记录。

## 涉及文件

新增：`migrations/80_creative_board_workflow.sql`、`frontweb/src/components/creativeBoard/{CreativeDraftNode,CreativeDeliveryNode,CreativeBoardUpload}.vue`。
改动：`backend-node/src/services/creativeBoardService.js`、`src/db/migrate.js`、`src/routes/images.js`、`src/routes/omniVideo.js`、`src/services/imageService.js`、`src/services/omniVideoService.js`、`frontweb/src/views/CreativeBoard.vue`，以及对应测试。