# LocalMiniDrama 部署计划（修订版）— 服务器 101.96.224.33

## 用户约束（已确认）
- ✅ **不影响正在运行的容器**：不删、不重启任何无关容器；构建/启动只针对本项目。
- ✅ **不私自域名解析**：只用 IP `http://101.96.224.33:5679/` 访问。
- ✅ **访问方式**：直接 5679 端口，**不装 Nginx、不碰 80**。
- ✅ **端口冲突策略**：部署前检查 5679，若被占用 → **停下问你**，不自动改端口。

## 待新增文件（提交到 fork 仓库，服务器 git pull 即可部署）
1. **`Dockerfile`**（根目录）：`node:18-bookworm-slim` + 编译工具链（编译 `better-sqlite3`/`sharp` 原生模块）；先构建前端 `frontweb/dist`，再装后端生产依赖；启动 `node src/server.js`；暴露 5679。
2. **`.dockerignore`**：排除 `node_modules`、`data/`、`dist/`、`.git`、`desktop/dist` 等。
3. **`docker-compose.yml`**：单服务 `app`，`container_name: local-minidrama`，`restart: unless-stopped`，`5679:5679`，数据卷 `./volumes/data:/app/backend-node/data`（SQLite + 上传素材持久化）。
4. **`deploy/README.md`**：部署/更新/日志命令文档。
> 不改动任何业务代码。

## 执行步骤

### 阶段 A：本地编写并提交部署文件
1. 创建 `Dockerfile`、`.dockerignore`、`docker-compose.yml`、`deploy/README.md`。
2. 确认 `.gitignore` 覆盖 `volumes/`、`.env`、`backend-node/data/`。
3. 把 `origin` 切到 fork 地址 `https://github.com/Yangheyu123/LocalMiniDrama.git`。
4. `git add` → `git commit` → `git push origin main`。

### 阶段 B：连服务器 + 安全检查（关键）
5. `ssh root@101.96.224.33`（密码 RC666666.）。
6. 检查 Docker / git 是否已装，缺什么补什么。
7. **冲突检查（先于一切部署动作）**：
   - `docker ps`（列出所有运行中容器）→ 给你看。
   - `ss -tlnp | grep ':5679'`。
   - **若 5679 被占用 → 立即停下问你，不擅自改端口、不动现有容器。**

### 阶段 C：拉取代码 + 部署
8. `mkdir -p /data/apps && cd /data/apps && git clone https://github.com/Yangheyu123/LocalMiniDrama.git`。
9. `docker compose up -d --build`（首次含原生模块编译，约 5–10 分钟）。
10. `docker compose ps` + `docker compose logs -f app` + `curl http://127.0.0.1:5679/health`。

### 阶段 D：验收
11. 浏览器 `http://101.96.224.33:5679/` 看前端首页；`/health` 返回 `{"status":"ok",...}`。
12. （可选）重启容器验证数据卷持久化。

## 验收标准
- `http://101.96.224.33:5679/` 显示前端首页。
- `http://101.96.224.33:5679/health` 返回 ok。
- 重启容器后 SQLite 与上传素材不丢。
- 全程未触碰任何既有容器、未做任何域名解析。

## 风险与处理
- **原生模块**：`node:18-bookworm-slim` + 工具链，amd64/arm64 均可编译。
- **GitHub clone 慢**：必要时 `git clone --depth 1`。
- **端口占用**：先查后做，冲突即停。
- **安全**：本次用密码登录，建议后续换密钥（不在本次范围）。