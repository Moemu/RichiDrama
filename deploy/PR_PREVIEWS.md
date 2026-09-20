# PR 预览和安全发布

## GitHub 流程

每个 PR 自动运行 `Validation`。此流程运行后端测试、前端测试、前端构建、空数据库迁移和容器构建。

内部 PR 的 `Validation` 成功完成后自动触发 `PR Preview`（`workflow_run` 链式触发，即 validation -> preview；验证失败或运行在 `main` 上时不会部署）。该流程运行在受保护的 `preview` environment 中，需要管理员批准后才会部署；也可以通过 `workflow_dispatch` 手动输入 PR 编号重跑。只有仓库成员的同一仓库分支会被部署，其他来源一律拒绝。

预览成功后，提交获得 `preview / smoke` 状态。`main` 分支要求此状态。

合并到 `main` 后，`Validation` 必须先成功。然后 `Production Deploy` 等待 `production` environment 批准。

## 服务器目录

- 服务器本地包：`/data/minidrama-incoming/<sha>.tar.gz`
- 不可变源码：`/data/minidrama-releases/<sha>/source`
- 发布前数据库：`/data/minidrama-releases/<sha>/production-before.db`
- PR 数据：`/data/minidrama-previews/pr-<number>`
- 预览 Basic Auth 凭据：`/data/minidrama-previews/auth`
- 生产数据：`/data/minidrama-data`

## 预览架构

预览与生产使用相同应用代码和 Docker 网络。运行密钥按档位隔离：

- Prod 优先读取 `/data/minidrama-config/.prod.env`。
- Preview 优先读取 `/data/minidrama-config/.preview.env`。
- 旧 `minidrama.oss.env` 只作为兼容回退。

应用行为保持一致。允许的运行差异如下：

- **数据集**：每个 PR 使用生产库在线快照的隔离副本（迁移先双跑验证），预览内的写操作不会触碰生产数据。
- **页面标题**：预览镜像构建时把 ` (preview)` 后缀写入静态 `<title>`，并以 `VITE_TITLE_BADGE` 烘焙进前端产物（`Dockerfile.preview` 的 `PREVIEW_TITLE_BADGE`，生产构建该参数为空），路由切换重写 `document.title` 后后缀仍然保留。
- **运行密钥**：Preview 可以使用沙箱支付密钥和独立 OSS 写入前缀。

结构上只有三件套：

- 每个 PR 一个容器 `minidrama-pr-<number>`，加入**生产所在的 Docker 网络**（`lens-rhyme_default`），别名 `pr-<number>`——与生产应用同构的网络位置。
- 端口 80 入口从 `deploy/nginx-preview-vhost.conf` 为每个 PR 生成精确域名配置，经 Basic Auth 后代理到对应容器。其他 PR 部署旧版共享配置时，不会覆盖当前 PR 的 WebSocket 转发规则。移除预览时同时移除其路由；历史预览继续使用共享规则。
- `MINIDRAMA_PROFILE=preview` 标记运行档位（配置为空集，仅作 /ready 与日志的可观测信号）。

基本鉴权凭据共享于 `/data/minidrama-previews/auth`。这是单人仓库下的有意取舍：预览代码即仓库成员自己的代码，作者门禁（author_association + 同仓库分支校验）是真正的安全边界，预览不应也无法“防御”作者本人。

迁移安全不变：预览数据来自生产库在线快照，迁移先在快照副本上双跑验证后才启动预览应用。

Runner 只发送 PR 编号和 commit SHA。服务器通过 GitHub SSH Deploy Key 获取 PR ref，并在本机创建源码包。

如果 `.preview.env` 不存在，部署脚本会读取旧 `minidrama.oss.env`。此回退只用于无中断迁移。支付必须保持关闭。

## 首次服务器准备

安装 Docker 和 `flock`。

当前服务器使用一个入口容器：

- `lens-rhyme-nginx-1` 处理端口 80（生产站点与预览域名的鉴权代理）。

预览容器由预览部署自动创建/更新，与生产应用同网络位置；入口容器无需加入任何额外网络。

如服务器名称不同，可以设置：

```text
MINIDRAMA_HTTP_NGINX_CONTAINER
MINIDRAMA_PROXY_NETWORK
```

在火山引擎 DNS 中添加记录（外部访问预览的前提）：

```text
*.preview.drama.richbest.cn  A  <生产服务器公网 IP>
```

第一次成功生产发布会安装以下命令：

```bash
preview-deploy <pr-number> <commit-sha>
preview-remove <pr-number>
preview-show <pr-number>
preview-cleanup
release-deploy <commit-sha>
release-rollback
```

新工作流合并到 `main` 后，在管理员工作站启用最终分支保护：

```bash
bash deploy/configure-github-protection Moemu/RichiDrama 0
```

该命令会先确认 `validation.yml` 和 `preview.yml` 已存在于 `main`。确认失败时，它不会修改分支保护。

参数 `0` 是单人仓库模式。它仍要求 PR、测试、容器构建和预览检查。

新增其他管理员后，将批准数改为 `1`：

```bash
bash deploy/configure-github-protection Moemu/RichiDrama 1
```

`preview-show` 输出敏感地址和密码。只通过私密渠道发送这些信息。

## 构建超时的手动重建

上游 apt / npm 镜像在某些时段会明显变慢。镜像构建在**生产服务器**上执行，如果它还没结束就撞上
`PR Preview` 流程的 SSH 命令上限（`command_timeout`，默认 40m），整次部署会被杀掉并在提交上记为
`preview / smoke` 失败。失败时日志里会看到构建仍停在中转镜像的安装阶段，最后一行是
`##[error]Process completed with exit code 1.`。

两条恢复路径：

**A. 重跑 GitHub 流程（构建仍然受 SSH 上限约束）**

```bash
# 重跑失败的工作流
gh run rerun <run-id> --failed

# 或按 PR 编号重新派发，并在镜像慢时显式放宽上限
gh workflow run "PR Preview" -f pr_number=<pr-number> -f command_timeout=90m
```

**B. 在服务器上直接重建（推荐，完全不受 SSH 上限约束）**

```bash
ssh root@<production-host>
preview-rebuild <pr-number> --detach      # 立即返回，构建在后台继续
tail -f /var/log/minidrama-rebuild/pr-<pr-number>.log
preview-show <pr-number>                  # 完成后读取访问地址与口令
```

- `preview-rebuild` 与 CI 走**完全相同的部署路径**：同一个 `preview-deploy`、同一把部署锁、同样先在
  生产库快照副本上双跑迁移。它只是把"发起位置"从 runner 移到服务器，不改变任何安全检查。
- `--detach` 用 `setsid nohup` 后台执行，关掉 SSH 会话也不会中断构建；不带该参数则前台执行并直接反馈退出码。
- 可用 `--sha <commit>` 要求重建的必须是某个确切提交，避免 PR 头在排查期间被推进。
- 脚本要求被部署的提交是 `origin` 某个分支的 HEAD，与被拒的分叉 PR 保持一致（CI 侧另外通过
  `author_association` 校验）。分叉仓库的提交会被拒绝。
- 部署锁是排他的：若 CI 部署正在运行，手动重建会立即失败并提示已有部署在进行，不会并发构建。

`preview-rebuild` 在生产发布会安装到 `/usr/local/bin/preview-rebuild`（见 `deploy/install-operations`）。
首次使用前若该命令不存在，可直接执行 `bash /data/apps/LocalMiniDrama/deploy/preview-rebuild <pr-number> --detach`。

### 减少再次超时

`Dockerfile.preview` 的构建阶段把 apt 索引放在缓存挂载里（不再每次部署重新下载整套索引），并启用
`Acquire::Retries=3`。这直接消除了"镜像慢 + 每次重建都重下索引"叠加出的超时。

## 回滚规则

发布脚本保留旧容器和发布前数据库快照。健康检查失败时，脚本自动恢复旧容器。

脚本不自动恢复数据库。数据库迁移必须保持前向兼容。需要恢复数据库时，先停止应用并进行人工审计。
