# PR 预览和安全发布

## GitHub 流程

每个 PR 自动运行 `Validation`。此流程运行后端测试、前端测试、前端构建、空数据库迁移和容器构建。

管理员审查内部 PR 后，手动运行 `PR Preview`。输入 PR 编号。GitHub `preview` environment 需要批准。

预览成功后，提交获得 `preview / smoke` 状态。`main` 分支要求此状态。

合并到 `main` 后，`Validation` 必须先成功。然后 `Production Deploy` 等待 `production` environment 批准。

## 服务器目录

- 上传包：`/data/minidrama-incoming/<sha>.tar.gz`
- 不可变源码：`/data/minidrama-releases/<sha>/source`
- 发布前数据库：`/data/minidrama-releases/<sha>/production-before.db`
- PR 数据：`/data/minidrama-previews/pr-<number>`
- 生产数据：`/data/minidrama-data`

PR 应用只连接内部 Docker 网络。该网络没有外部出口。PR 应用不能挂载生产数据目录。

## 首次服务器准备

安装 Docker、Certbot、OpenSSL 和 `flock`。

当前服务器使用两个入口容器：

- `lens-rhyme-nginx-1` 处理端口 80 和 HTTP-01。
- `avatar-proxy-api-gateway-1` 处理端口 443 和预览 TLS。
- TLS 容器挂载宿主机 `/etc/letsencrypt` 为只读目录。
- 预览代理连接 `avatar-proxy_default`。预览应用仍只连接内部网络。

如服务器名称不同，可以设置：

```text
MINIDRAMA_HTTP_NGINX_CONTAINER
MINIDRAMA_TLS_NGINX_CONTAINER
MINIDRAMA_TLS_PROXY_NETWORK
MINIDRAMA_PROXY_NETWORK
```

在火山引擎 DNS 中添加记录：

```text
*.preview.drama.richbest.cn  A  <生产服务器公网 IP>
```

GitHub `preview` environment 需要变量：

```text
MINIDRAMA_ACME_EMAIL=i@snowy.moe
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
