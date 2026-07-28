# LocalMiniDrama 服务器部署文档

按《部署规范》采用 **Git + Docker Compose + 数据持久化** 的最小可维护方案。

## 架构

```
单容器（node:18 + 前端 dist + 后端）
   ├── 监听端口 5679
   └── 数据卷挂载到宿主机 ./volumes/data （SQLite + 素材）
```

后端（Express）在容器内启动后，会同时托管：
- `/api/v1/*`  后端接口
- `/static/*`  生成的图片/视频素材
- `/`          前端 SPA（来自 `frontweb/dist`）
- `/health`    健康检查

访问地址：`http://<服务器IP>:5679/`

---

## 一、首次部署

### 1. 服务器环境要求

- Docker（含 buildx）
- Docker Compose v2（`docker compose` 子命令）
- Git

检查：

```bash
docker --version
docker compose version
git --version
```

### 2. 拉取代码

```bash
mkdir -p /data/apps
cd /data/apps
git clone https://github.com/Yangheyu123/LocalMiniDrama.git
cd LocalMiniDrama
```

### 3. 准备数据目录

```bash
mkdir -p volumes/data
```

### 4. 构建并启动

```bash
docker compose up -d --build
```

首次构建会编译 `better-sqlite3` / `sharp` 原生模块，约 5–10 分钟。

### 5. 验证

```bash
docker compose ps
docker compose logs -f app
curl http://127.0.0.1:5679/health
```

浏览器访问 `http://<服务器IP>:5679/`。

---

## 二、更新到最新版本

```bash
cd /data/apps/LocalMiniDrama
git pull
docker compose build app
docker compose up -d
```

数据保留在 `./volumes/data`，不受镜像重建影响。

---

## 三、常用运维命令

```bash
# 查看状态
docker compose ps

# 查看实时日志
docker compose logs -f app

# 重启
docker compose restart app

# 停止 / 启动
docker compose stop
docker compose start

# 完全卸载（保留数据）
docker compose down

# 完全卸载并删除数据（⚠️ 不可逆）
docker compose down
sudo rm -rf volumes/data
```

---

## 四、端口修改

如需改用其他宿主机端口（例如 8080），在项目根目录创建 `.env`：

```env
HOST_PORT=8080
```

然后 `docker compose up -d`。容器内仍监听 5679，仅外部映射变化。

---

## 五、数据备份

```bash
# 备份 SQLite + 素材
tar -czf minidrama-backup-$(date +%F).tar.gz volumes/data
```

---

## 六、注意事项

- **数据持久化**：切勿删除 `./volumes/data`，否则 SQLite 库与所有生成素材丢失。
- **原生模块**：更换基础镜像 Node 版本后需重新 `docker compose build`。
- **AI 配置**：应用内的「AI 配置」保存在 SQLite 中，首次进入页面后按需填入各厂商 API Key。
