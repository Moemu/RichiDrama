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

