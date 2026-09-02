# Preview 支付 HTTPS 调查

调查日期：2026-09-01。

443 维护者的最新实施要求见
[Avatar Proxy 微信支付回调需求](./AVATAR_PROXY_HTTPS_HANDOFF.md)。该方案复用
`api.richbest.cn`，不增加 DNS 或证书。

本调查只读取公网响应和仓库部署配置。没有修改生产服务器。

## 当前结果

| 地址 | 结果 |
|---|---|
| `http://drama.richbest.cn/ready` | `200`，由端口 80 的 Nginx 提供 |
| `http://pr-22.preview.drama.richbest.cn/ready` | `401`，Preview Basic Auth 正常 |
| `https://drama.richbest.cn/ready` | `404` |
| `https://pr-22.preview.drama.richbest.cn/ready` | `404` |

443 当前返回以下证书：

- Subject：`CN=api.richbest.cn`
- SAN：`api.richbest.cn`
- Issuer：Let's Encrypt
- 有效期：2026-08-12 至 2026-11-10

该证书不覆盖 `drama.richbest.cn` 或 `*.preview.drama.richbest.cn`。

仓库内的 Preview Nginx 配置只监听 80。生产脚本只管理端口 80 的 `lens-rhyme-nginx-1`。443 入口不在当前仓库的发布控制范围内。

## 所有权边界

端口 443 由 `avatar-proxy` 项目管理。该项目使用自动化 Release，并把
`/opt/avatar-proxy/current` 链接到最新发布副本。

LocalMiniDrama 不得执行以下操作：

- 修改 `/opt/avatar-proxy/current` 中的文件。
- 修改 `avatar-proxy` Compose 配置或 Docker 网络。
- 重建或重启 `avatar-proxy` 容器。
- 复用、签发或更新该项目管理的证书。

这些修改会在 Release 后丢失，也超出本项目权限。

## 可接受的 HTTPS 入口

启用支付前，必须满足以下任一条件：

1. 基础设施所有者提供稳定的 HTTPS 回调入口和明确的代理契约。
2. 为 LocalMiniDrama 提供独立管理的 443 入口、证书和发布路径。
3. 为沙箱提供本项目独立管理的 HTTPS 隧道。该隧道不能修改其他项目。

入口必须只转发两个支付回调。LocalMiniDrama 不能把另一个项目的域名或
发布目录作为未授权的长期入口。

## 支付回调规则

Preview 页面继续使用 Basic Auth。

当前高优验收只对以下精确路径关闭 Basic Auth：

```text
/api/v1/payments/callbacks/wechat
```

支付宝路径继续使用 Basic Auth，直到支付宝验收开始。

不要关闭整个 `/api/` 的 Basic Auth。应用仍会验证渠道签名。

## 已完成的只读检查

先执行以下只读命令：

```bash
docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Networks}}'
ss -ltnp | grep -E ':(80|443) '
docker inspect lens-rhyme-nginx-1 --format '{{json .NetworkSettings.Networks}}'
```

检查确认端口 443 属于 `avatar-proxy`。后续只读调查不能被视为修改授权。

## 实施门槛

满足以下条件后，才启用支付宝沙箱：

- `.preview.env` 已存在，权限为 `600`。
- `.preview.env` 不含生产支付密钥。
- 基础设施所有者已提供获准使用的 HTTPS 回调地址。
- HTTPS 请求可以到达目标 PR 容器。
- 两个回调路径不要求 Basic Auth。
- 其他 Preview 路径仍要求 Basic Auth。
- Prod 的 HTTP 和 HTTPS 健康检查均通过。
