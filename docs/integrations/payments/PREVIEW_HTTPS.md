# Preview 支付 HTTPS 调查

调查日期：2026-09-01。

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

## 推荐结构

保留当前端口 80 容器。不要在未调查 443 容器前移动生产入口。

让端口 443 容器只完成以下工作：

1. 终止 TLS。
2. 保留原始 `Host`。
3. 把 `drama.richbest.cn` 和 `*.preview.drama.richbest.cn` 转发到端口 80 入口。
4. 让现有端口 80 Nginx继续完成 Prod 和 PR 路由。

该结构不复制动态 Preview 路由规则。

需要以下证书名称：

```text
drama.richbest.cn
*.preview.drama.richbest.cn
```

通配符证书建议使用 ACME DNS-01。HTTP-01 会跨越两个入口容器，故障面较大。

## 支付回调规则

Preview 页面继续使用 Basic Auth。

以下精确路径必须关闭 Basic Auth：

```text
/api/v1/payments/callbacks/alipay
/api/v1/payments/callbacks/wechat
```

不要关闭整个 `/api/` 的 Basic Auth。应用仍会验证渠道签名。

## 取得服务器只读权限后的检查

先执行以下只读命令：

```bash
docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Networks}}'
ss -ltnp | grep -E ':(80|443) '
docker inspect lens-rhyme-nginx-1 --format '{{json .NetworkSettings.Networks}}'
```

确定 443 容器名称后，再执行：

```bash
docker inspect <https-container> --format '{{json .Mounts}}'
docker inspect <https-container> --format '{{json .NetworkSettings.Networks}}'
docker exec <https-container> nginx -T
```

`nginx -T` 可能显示路径，但不应显示私钥内容。不要读取或输出环境文件。

## 实施门槛

满足以下条件后，才启用支付宝沙箱：

- `.preview.env` 已存在，权限为 `600`。
- `.preview.env` 不含生产支付密钥。
- 443 证书覆盖 Preview 域名。
- HTTPS 请求可以到达目标 PR 容器。
- 两个回调路径不要求 Basic Auth。
- 其他 Preview 路径仍要求 Basic Auth。
- Prod 的 HTTP 和 HTTPS 健康检查均通过。
