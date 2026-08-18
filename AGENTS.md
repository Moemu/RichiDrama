# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview

LocalMiniDrama (本地短剧助手) — an AI-powered local short drama creation tool. Single product, three sub-projects sharing one repo (no monorepo tooling).

### Services

| Service | Directory | Port | Start Command |
|---------|-----------|------|---------------|
| Backend (Express + SQLite) | `backend-node/` | 5679 | `npm run dev` |
| Frontend (Vite + Vue 3) | `frontweb/` | 3013 | `npm run dev` |

Frontend proxies `/api` and `/static` to backend via Vite config.

### Running Tests

```bash
# Backend tests (Node.js built-in test runner)
cd backend-node && node --test test/*.test.js

# Frontend tests (ESM, Node.js built-in test runner)
cd frontweb && node --test test/*.test.js
```

No ESLint or other lint tool is configured in this codebase.

### Building

```bash
cd frontweb && npm run build
```

### Key Development Notes

- Pure JavaScript (no TypeScript) throughout.
- Backend uses `node --watch` for hot reloading in dev mode (`npm run dev`).
- Database is SQLite (embedded via `better-sqlite3`), auto-created in `backend-node/data/`.
- Migrations run automatically on backend startup (`ensureColumns()`); explicit `npm run migrate` only needed for first-time setup or after adding new migration SQL files.
- Config file at `backend-node/configs/config.yaml` already exists in the repo — no need to copy from example.
- AI content generation requires external API keys (configured via the app's "AI 配置" page), but the app fully functions without them for development/testing purposes.
- The backend also serves the built frontend from `frontweb/dist/` at port 5679 when the dist folder exists; during development, use the Vite dev server at port 3013 instead.

### 修改闭环与验证（强制规则）

- 所有改动在交付前必须完成闭环验证；不得只根据代码审查或构建成功宣称完成。
- 修改前端后，必须运行前端自动化测试和 production build；还必须使用 Codex 内置浏览器或 Computer Use 实际审查改动页面的布局与交互，重点验证滚动、窄屏、固定/粘性区域、遮挡和主要用户路径。
- 修改后端逻辑后，必须运行覆盖该改动的后端测试；涉及异步、媒体、状态恢复、计费或 API 合约时，必须补充相应的集成/重启恢复验证。
- 非必要不得发起 API 调用；验证应优先使用现有测试、静态检查和本地 UI。只有接口行为本身是本次改动的验证目标时，才可以调用项目 API；禁止为方便而调用供应商 API。
- 涉及提交和部署的任务，只有在 **Git 提交已推送到目标远端分支，且该提交对应的部署检查/工作流显示成功** 后才可结束任务；若 Git 平台显示部署检查失败、缺失或仍在运行，即使服务器容器健康、页面可访问，也必须将任务保持为失败或进行中，不得宣称上线成功。部署检查成功后，再确认部署环境运行目标提交、服务健康检查通过；必要时验证受影响页面或接口。

### Codex 内置浏览器测试入口（本地协作规则）

- 前端视觉与交互验收默认使用 Codex 内置浏览器，优先访问本地开发地址：`http://127.0.0.1:3013/`。
- 本地默认验收账号：`admin` / `admin123456`。仅用于本机开发验证，禁止写入前端代码、配置文件、日志、截图说明或提交到远端。
- 线上测试入口：`http://drama.richbest.cn/`。仅在需要验证线上发布结果或线上特有数据时访问；不得因常规前端样式验收触发线上 API、生成或计费调用。

### 桌面端 UI 验收基线（强制规则）

桌面端界面改动必须同时适配并实际验收以下三个视口：`1280×720`、`1440×900`、`1920×1080`。不得只在单一分辨率完成布局判断。

- 每个受影响页面都必须验证页面纵向滚动可达：不可由 `height`、`max-height`、`overflow: hidden` 或固定/粘性区截断内容；表格横向滚动只能归属到表格容器，不能阻断页面纵向滚动。
- 验收时检查无页面横向溢出、最后一个操作项可到达、固定区域不遮挡正文或按钮、关键文字未被裁切。
- 这三档尺寸是产品 UI 的长期系统提示与交付门槛；新增或重构桌面页面时必须沿用，直到用户明确变更该基线。

### AI 调用与计费边界（强制规则）

所有面向用户的 AI 生成、验收和真实调用，**必须通过本项目的 HTTP API 路由进入**（`/api/v1/...`），使用项目登录态和业务请求 ID；不得在脚本、REPL、测试工具或前端中直接调用供应商 API，也不得直接调用 `aiClient`、`imageClient`、`videoService` 等内部服务来替代业务接口。

- 供应商调用只能由后端适配层在完成“鉴权 → 模型权限 → 价目校验 → 预授权 → 调用 → 结算/待对账/释放”后发起。
- 禁止使用供应商官方 SDK 或在项目外发起真实供应商调用；统一使用项目后端的原生 HTTP 适配器，确保能记录供应商请求 ID、真实 usage、计费快照和账本流水。
- 需要验证真实模型时，先选择对应的项目 API；若当前没有可承载该能力的 API，应先补齐带鉴权和计费的路由及自动化测试，再进行真实调用。
- 单元测试可以直接测试服务层的纯业务逻辑；但涉及真实供应商调用、计费闭环或验收时，必须以 HTTP API 集成测试作为依据。

### 跨组件变更强制影响面检查（强制规则）

涉及通用组件、共享数据模型、API 合约、认证、媒体或异步状态的修改，不能只修一个页面或一条路由。实施前必须用 `rg` 在 `frontweb/src`、`backend-node/src` 和 `backend-node/test` 检索同名字段、状态和值的全部消费者，并在交付说明中列出覆盖结果。

- API 合约：同步检查前端 API 封装、路由、服务层、鉴权/所有权、计费、列表/详情/历史记录、刷新与重启恢复路径。
- 媒体：`completed` 的图片/视频必须可由本地持久化路径恢复；不得将供应商签名 URL 作为完成结果、素材库来源或成片兜底。检查生成、Omni、分镜、素材导入与视频合成。
- 身份与会话：变更用户名、角色、权限或登录资料时，必须检查 JWT、HttpOnly Cookie、`localStorage` 当前用户、导航展示与重新登录。
- 异步状态：不得在 HTTP handler 内长时间轮询供应商；先持久化 `processing`，再用后台任务/轮询更新终态，并提供前端可见的刷新或自动轮询。
- 时间：业务时间以 UTC ISO 存储和传输；所有用户可见时间必须显式按 `Asia/Shanghai` 格式化，不能依赖浏览器或服务器本地时区。
- 验证：除单元测试外，至少覆盖一次刷新/重启后的读取行为；前端改动需运行测试和 production build。

### 线上兼容与零破坏发布（强制规则）

任何代码、数据库、配置、计费、认证、媒体或异步任务改动，必须默认保证**线上已有用户、已有数据、已有任务和已有调用方不受破坏**。不能把“本地验证通过”当作线上兼容性的替代证据。

- 数据库迁移必须前向兼容、可重复执行；新增列/表必须提供安全默认值。禁止用迁移批量删除、重写或改变历史业务数据的语义，除非用户明确授权并先提交可审计的范围、备份与回滚方案。
- 新行为涉及删除、清理、重算、迁移、自动修复或付费动作时，必须使用显式 opt-in、版本标记或新建记录标记；默认只作用于发布后新建的数据。历史记录必须保持原路径、原状态、原账本和可读取性。
- API 必须保持已有请求字段、响应字段和状态值的向后兼容；新增字段应可选，旧客户端不传时维持旧语义。不得静默改变旧模型、旧项目、旧分镜或旧任务的默认参数。
- 媒体清理只能在最终文件已通过本地规格校验、数据库完成态已写入且播放路径可读后执行；只能删除已精确解析并校验位于 storage root 内的明确中间文件，绝不递归扫描目录或按时间猜测删除。清理失败不得使完成任务变失败。
- 已完成、处理中、待对账、可重试和历史导入任务的恢复必须幂等：不重复提交供应商、不重复扣费、不把已存在的本地文件替换为供应商签名 URL。
- 上线前必须执行消费者检索、后端测试、前端测试/构建（如有前端改动），并至少验证一条历史记录在迁移/重启后仍可读；交付说明必须写明“哪些记录启用新行为、哪些历史记录被明确排除”。
- 任何线上破坏性操作（批量删除、批量重算、强制迁移、密钥轮换、修改生产配置或直接调用生产供应商）都需要用户明确授权；没有授权时，只实现保护性代码与只读验证，不执行该操作。

### Local Debugging Startup (重要)

**本地调试后端必须带环境变量启动，否则视频生成会卡死：**

```bash
cd backend-node
CFG_IMAGE_PROXY__USE_FOR_VIDEO=false node --watch src/server.js
```

**原因**：`config.yaml` 默认 `image_proxy.use_for_video: true`，视频生成时会把本地参考图上传到中转图床（`imageproxy.zhongzhuan.chat`）转公网 URL。线上图床可达没问题，但**本地调试时图床响应慢/不稳，每张图最多等 180s×2 重试，3 张参考图会把异步任务 `processVideoGeneration` 阻塞数分钟**，表现为任务队列一直 processing 不推进。

`CFG_IMAGE_PROXY__USE_FOR_VIDEO=false` 关闭图床后，本地图片直接转 base64 提交给火山，几秒内完成提交。

#### config 环境变量覆盖机制

`loadConfig()` 支持 `CFG_<段>__<键>` 格式覆盖 `config.yaml` 的任意字段（双下划线分层，全大写对应 snake_case 路径），类型自动推断（`true`/`false`→布尔、纯数字→数字、其它→字符串）。启动时会打印已覆盖字段。

| 环境变量 | 作用 | 本地调试值 | 线上值 |
|---|---|---|---|
| `CFG_IMAGE_PROXY__USE_FOR_VIDEO` | 关闭图床，本地图走 base64 | `false` | 不设（读 config.yaml，默认 true） |
| `SD2_DISABLE_ASSET_INJECT` | 跳过 Seedance 2.0 asset 注入（排查 asset 失效时用） | `1`（仅排查时） | 不设（默认开启 asset 注入） |

示例：
```bash
# 同时关图床 + 关 asset 注入（深度排查 SD2 视频链路）
CFG_IMAGE_PROXY__USE_FOR_VIDEO=false SD2_DISABLE_ASSET_INJECT=1 node --watch src/server.js
```

**线上零影响**：线上不设这些环境变量，覆盖层和开关都不触发，行为完全由 `config.yaml` 决定。`config.yaml` 本身不要为本地调试改动（会被提交污染线上）。

#### 本地测试 HTTP 请求注意

用 `curl` 发含中文的 JSON 请求时，Windows Git Bash 的 curl 会损坏 UTF-8（中文变 `U+FFFD`），导致后端收到的中文路径匹配不到本地文件。**本地测试含中文的请求请用 Node 发送**（`http.request` + `Buffer.byteLength(body)`），或直接用浏览器前端操作。

