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
- 端口 80 入口加载一份静态 vhost `deploy/nginx-preview-vhost.conf`：按 `pr-<number>.preview.drama.richbest.cn` 匹配主机名，经 Basic Auth 后代理到对应容器。文件不随预览增删变化。
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

## 回滚规则

发布脚本保留旧容器和发布前数据库快照。健康检查失败时，脚本自动恢复旧容器。

脚本不自动恢复数据库。数据库迁移必须保持前向兼容。需要恢复数据库时，先停止应用并进行人工审计。
