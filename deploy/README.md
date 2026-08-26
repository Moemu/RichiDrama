# RichiDrama 服务器部署文档

按《部署规范》采用 **Git + Docker Compose + 数据持久化** 的最小可维护方案。

## 架构

```
公网(80端口) → lens-rhyme-nginx → server_name drama.richbest.cn
                                        ↓ (lens-rhyme 网络)
                                  minidrama-app:5679 (本应用容器)
                                        ↓
                                  数据卷 ./volumes/data (SQLite + 素材)
```

本应用容器加入 `lens-rhyme_default` 网络（alias `minidrama-app`），
由 `lens-rhyme-nginx` 按域名 `drama.richbest.cn` 反代。
- 容器内监听 5679；宿主机 10588 仅作内网调试备用。
- `deploy/nginx-drama-richbest.conf` 为 nginx 反代配置，每次部署自动同步（见下）。

后端（Express）在容器内托管：
- `/api/v1/*`  后端接口
- `/static/*`  生成的图片/视频素材
- `/`          前端 SPA（来自 `frontweb/dist`）
- `/health`    健康检查

**访问地址：`http://drama.richbest.cn/`**

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

### 2. 配置 GitHub SSH 访问（重要）

> 国内服务器访问 `github.com` 的 HTTPS(443) 常被墙，但 **SSH(22) 稳定**。
> 因此服务器用 SSH 方式拉代码。

在服务器生成密钥并把**公钥**添加为仓库的 Deploy Key（仓库 Settings → Deploy keys）：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy_key -N '' -C 'server-github-pull'
cat ~/.ssh/github_deploy_key.pub   # 复制到 GitHub Deploy Keys
```

配置 SSH 使用该密钥：

```bash
cat > ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/github_deploy_key
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
chmod 600 ~/.ssh/config ~/.ssh/github_deploy_key
```

验证：

```bash
ssh -T git@github.com
# 期望: Hi Moemu/RichiDrama! You've successfully authenticated...
```

### 3. 拉取代码

```bash
mkdir -p /data/apps
cd /data/apps
git clone git@github.com:Moemu/RichiDrama.git LocalMiniDrama
cd LocalMiniDrama
```

> 如已有 HTTPS 克隆，改为 SSH：
> `git remote set-url origin git@github.com:Moemu/RichiDrama.git`

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
curl -H "Host: drama.richbest.cn" http://127.0.0.1/health
```

浏览器访问 `http://drama.richbest.cn/`（需域名已解析到服务器 IP）。

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

当前宿主机端口为 **10588**（复用原 toonflow 端口，已在防火墙放行）。
如需改用其他宿主机端口，编辑 `docker-compose.yml` 中的端口映射左侧：

```yaml
ports:
  - "10588:5679"   # 改左侧，如 "8080:5679"
```

然后 `docker compose up -d`。容器内仍监听 5679，仅外部映射变化。
改端口后需同步在防火墙放行新端口：`firewall-cmd --add-port=<新端口>/tcp --permanent && firewall-cmd --reload`。

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
