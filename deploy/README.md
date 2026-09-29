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
- 生产 Nginx 配置由容器内 `/etc/nginx/conf.d/minidrama.conf` 管理（对应本目录 `nginx-drama-richbest.conf`；`default.conf` 属于 lens 应用，勿动）。该文件由 `install-prod-ingress` 自愈收敛维护，见下方「生产 Ingress 配置：自愈收敛」。

后端（Express）在容器内托管：
- `/api/v1/*`  后端接口
- `/static/*`  生成的图片/视频素材
- `/`          前端 SPA（来自 `frontweb/dist`）
- `/health`    健康检查

**访问地址：`http://drama.richbest.cn/`**

---

## 生产 Ingress 配置：自愈收敛（2026-09-28 实机核对）

关键事实：`lens-rhyme-nginx-1` 的 `Mounts` 为空，`conf.d/*.conf` 全部活在容器可写层——**lens 容器一旦重建（换镜像 / force-recreate），RichiDrama 的 ingress 配置整体丢失**；而 lens 容器的 compose/mount 属跨团队配置，不可要求对方变更。因此收敛不能依赖人工记忆，也不依赖对方配合。

机制：`install-prod-ingress` 以本目录 `nginx-drama-richbest.conf` 为单一事实源，幂等比对容器内 `/etc/nginx/conf.d/minidrama.conf`（行尾归一化后字节一致、且 `nginx -T` 证明已被 include 才 no-op）；漂移或缺失时：备份 → `docker cp` → `nginx -t`（失败自动回滚，绝不把共享 nginx 留在坏配置上）→ 平滑 `nginx -s reload` → media-upload location 生效断言 + `Host: drama.richbest.cn` 的 `/ready` 健康断言（语义错也能秒级自动回滚）。与 `release-deploy` 通过 `/run/lock/minidrama-ingress.lock` 文件锁互斥（两侧都已持锁）。

一次性安装（root）：

```bash
deploy/install-operations release          # 脚本+配置装到 /usr/local/lib/richidrama-deploy 并链接 /usr/local/bin
install -m 0644 deploy/minidrama-ingress-ensure.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now minidrama-ingress-ensure.timer
```

日常观察：`systemctl list-timers minidrama-ingress-ensure`、`journalctl -u minidrama-ingress-ensure.service -n 50`。
手动检查漂移：`install-prod-ingress --check`（退出码 1=漂移）；演练：`install-prod-ingress --dry-run`。
lens 重建后无需人工动作：timer 在 ≤5 分钟内自动恢复我们的配置（lens 自身配置的恢复属他们职责）。

生效断言（首次安装或人工 reload 后）：

```bash
docker exec lens-rhyme-nginx-1 nginx -T | grep -A3 "location = /api/v1/media/upload"
dd if=/dev/zero of=/tmp/big.bin bs=1M count=40
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Host: drama.richbest.cn' \
  -F "file=@/tmp/big.bin;type=video/mp4" http://127.0.0.1/api/v1/media/upload    # 期望 401（应用鉴权层），不是 HTML 413（nginx 体积闸）
```

注意：断言必须用 `-F`（multipart）。`--data-binary` 会以 `x-www-form-urlencoded` 穿透 nginx、被应用 `express.urlencoded` 的 100kb 默认限制挡下返回 JSON 413，看起来像 nginx 没放行、实际是两码事。

手工回滚（兜底）：`docker cp /var/backups/minidrama-ingress/<最近一份> lens-rhyme-nginx-1:/etc/nginx/conf.d/minidrama.conf && docker exec lens-rhyme-nginx-1 nginx -t && docker exec lens-rhyme-nginx-1 nginx -s reload`

已知噪音：`nginx -t` 会报 `conflicting server name "localhost"`——来自 lens 的 `default.conf`，与本应用无关。

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

### 4. 准备环境文件

生产环境使用 Git 忽略文件 `.prod.env`：

```bash
install -d -m 700 /data/minidrama-config
cp deploy/.prod.env.example /data/minidrama-config/.prod.env
chmod 600 /data/minidrama-config/.prod.env
```

Preview 使用独立文件：

```bash
cp deploy/.preview.env.example /data/minidrama-config/.preview.env
chmod 600 /data/minidrama-config/.preview.env
```

填写真实值时不要输出密钥。旧路径 `minidrama.oss.env` 仍可使用。

### 5. 构建并启动

```bash
docker compose up -d --build
```

首次构建会编译 `better-sqlite3` / `sharp` 原生模块，约 5–10 分钟。

### 6. 验证

```bash
docker compose ps
docker compose logs -f app
curl -H "Host: drama.richbest.cn" http://127.0.0.1/health
```

浏览器访问 `http://drama.richbest.cn/`（需域名已解析到服务器 IP）。

---

## 二、安全发布

```bash
# GitHub Actions 上传源码包后执行：
release-deploy <40-character-commit-sha>
```

发布脚本不修改服务器 Git 仓库。脚本先测试生产数据库副本，再切换生产容器。详细规则见 `deploy/PR_PREVIEWS.md`。

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

数据目录与备份目录分开：数据在 `/data/minidrama-data`，备份在 `/data/minidrama-backups`。完整策略见 [PERSISTENCE.md](PERSISTENCE.md)。

systemd timer 每天 03:30（Asia/Shanghai）执行一次全量归档，线上保留最近 2 份：

```bash
sudo systemctl list-timers minidrama-full-backup.timer   # 查看下次执行时间
```

归档包含 SQLite 和本地热副本媒体。库文件是在线一致性快照，不含 `-wal`、`-shm`；发布过程的临时目录不会被收录。宿主机装有 zstd 时生成 `.tar.zst`，否则回退到 `.tar.gz`。

手动备份与恢复：

```bash
# 立即执行一次全量备份
bash deploy/backup-data.sh --full

# 从归档恢复，会替换整个数据目录，需要显式确认
bash deploy/restore-data.sh /data/minidrama-backups/minidrama-data-<时间戳>.tar.zst --confirm
```

恢复命令会先完整读取并校验归档：验压缩流、读全量文件清单、抽出库文件跑 `PRAGMA integrity_check`，全部通过才停止应用并替换数据目录。校验不通过时现有数据保持原样。确实要用未通过的归档，加 `--skip-database-check`。宿主机没有 sqlite3、没有可用的 better-sqlite3、也没有运行中的容器时，只校验库文件头并打印警告。

探测不到 Docker 守护进程时，全量备份会直接失败，因为无法确认数据库是否仍在写入。确实需要在这种状态下出包，加 `--allow-unverified-database`，此时旧的归档全部保留、不做回收。

发布产物存放在 `/data/minidrama-releases/<sha>`，由发布与预览流程自动回收，且只回收脚本自己创建的目录（内含 `.gc-stamp` 标记）。保留窗口内的发布只删除 `preflight-data/`，窗口外的发布连同 `production-before.db` 一起删除；`active-revision` 与 `rollback.env` 点名的发布始终保留。策略生效前的历史目录不会被自动删除，需要先统计、再显式确认：

```bash
bash deploy/prune-release-backlog            # 只统计，不删除
bash deploy/prune-release-backlog --confirm  # 确认后清理
```

保留数量可调节：`FULL_BACKUP_RETAIN_COUNT` 控制全量归档份数，`MINIDRAMA_KEEP_RELEASES` 控制发布产物份数（默认 5）。已完成的媒体同时镜像到 OSS，OSS 才是媒体的持久层，本地只保留热副本。

---

## 六、注意事项

- **数据持久化**：切勿删除 `./volumes/data`，否则 SQLite 库与所有生成素材丢失。
- **原生模块**：更换基础镜像 Node 版本后需重新 `docker compose build`。
- **AI 配置**：应用内的「AI 配置」保存在 SQLite 中，首次进入页面后按需填入各厂商 API Key。
