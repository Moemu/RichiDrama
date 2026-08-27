# PR 预览和安全发布

## GitHub 流程

每个 PR 自动运行 `Validation`。此流程运行后端测试、前端测试、前端构建、空数据库迁移和容器构建。

内部 PR 打开或更新时自动触发 `PR Preview`（`pull_request_target`）。该流程运行在受保护的 `preview` environment 中，需要管理员批准后才会部署；也可以通过 `workflow_dispatch` 手动输入 PR 编号重跑。只有仓库成员的同一仓库分支会被部署，其他来源一律拒绝。

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

预览是纯 HTTP，不签发任何证书：

- 所有预览共享一个 Docker 内部网络 `minidrama-previews`（`--internal`，无公网出口、无默认路由）。
- 每个 PR 只有一个容器 `minidrama-pr-<number>`，以别名 `pr-<number>` 加入该网络。
- 专用的 `minidrama-preview-edge` 容器是**唯一**同时连接入口网络与预览网络的组件：它按 `pr-<number>.preview.drama.richbest.cn` 匹配主机名并执行 Basic Auth，其余一切 Host 在查询上游之前直接返回 404——预览代码即使发起请求也无法借它进入生产网络。
- 端口 80 入口容器只加载一份静态透传配置 `deploy/nginx-previews-passthrough.conf`（不含凭据），把预览域名转发给 edge；另一份 `deploy/nginx-preview-edge.conf` 安装在 edge 上。两份文件都不随预览增删变化。
- 预览数据来自生产库在线快照；迁移会在快照副本上先完整验证两次，然后才启动预览应用。生产数据目录永不挂载进预览。
- 预览容器不接收任何生产环境变量（OSS 凭据等绝不进入预览代码），以 `MINIDRAMA_PROFILE=preview` 启动：配置档强制本地存储并关闭中转图床代理；候选镜像按发布裁剪策略在每次预览成功后回收。
- 所有预览共享一组 Basic Auth 凭据（`/data/minidrama-previews/auth`），域名固定可预测——这是免证书方案的既定取舍，由强制鉴权兜底。

Runner 只发送 PR 编号和 commit SHA。服务器通过 GitHub SSH Deploy Key 获取 PR ref，并在本机创建源码包。

## 首次服务器准备

安装 Docker 和 `flock`。

当前服务器使用两个长驻容器：

- `lens-rhyme-nginx-1` 处理端口 80（生产站点与预览域名的透传）。
- `minidrama-preview-edge` 由预览部署自动创建/更新，持有 Basic Auth 并路由到具体预览容器。

首次预览部署会自动创建 `minidrama-previews` 网络，并把入口容器接入该网络（`--gw-priority -1` 保证其默认路由不变）。

如服务器名称不同，可以设置：

```text
MINIDRAMA_HTTP_NGINX_CONTAINER
MINIDRAMA_PROXY_NETWORK
MINIDRAMA_PREVIEW_NETWORK
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
