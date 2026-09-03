# Avatar Proxy 微信支付回调需求

更新日期：2026-09-02。

本文只说明 `avatar-proxy` 的 443 入口修改。

LocalMiniDrama 不需要访问 `avatar-proxy` 的源码、密钥或发布目录。

## 1. 目标

复用现有域名和证书：

```text
POST https://api.richbest.cn/minidrama/payments/callbacks/wechat
```

不要增加新域名。不要修改现有 `/api/`、控制台或健康检查路由。

该路径不使用登录认证或 Basic Auth。LocalMiniDrama 会验证微信支付签名。

## 2. 网络连接

LocalMiniDrama 已把生产应用发布到宿主机端口 `10588`。

为避免共享 Docker 网络，请只给 `api-gateway` 增加宿主机网关别名：

```yaml
services:
  api-gateway:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

不要把 `avatar-proxy` 加入 LocalMiniDrama 或 Lens Rhyme 的 Docker 网络。

## 3. 正式环境 Nginx 配置

在 `api.richbest.cn` 的 443 `server` 中增加精确路径。把它放在通用
`location /` 之前。

```nginx
location = /minidrama/payments/callbacks/wechat {
    limit_except POST { deny all; }

    proxy_pass http://host.docker.internal:10588/api/v1/payments/callbacks/wechat;
    proxy_http_version 1.1;
    proxy_set_header Host drama.richbest.cn;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;

    client_max_body_size 1m;
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;
}
```

Nginx 不能修改请求正文。不要配置 `sub_filter`、请求体转换或登录跳转。

## 4. PR 22 验收临时目标

真实付款前，回调需要先进入 PR 22 的隔离数据库。

验收期间，把上述 `proxy_pass` 和 `Host` 临时改为。网关保留原始外部路径：

```nginx
proxy_pass http://host.docker.internal:5410;
proxy_set_header Host pr-22.preview.drama.richbest.cn;
```

端口 `5410` 是现有 LocalMiniDrama HTTP 入口。外部微信回调路径会在该入口
改写为应用路径，并绕过 Basic Auth。其他 Preview 路径仍使用 Basic Auth。

验收完成并合并 PR 22 后，必须切回第 3 节的生产目标。不要把 PR 编号作为
长期配置。

## 5. 发布和检查

请在 `avatar-proxy` 仓库中提交配置。请使用该项目的 Release 流程。

不要直接修改 `/opt/avatar-proxy/current`。该目录是自动发布符号链接。

发布前运行：

```bash
docker compose config
docker compose run --rm --no-deps api-gateway nginx -t
```

发布后执行以下检查：

```bash
docker exec avatar-proxy-api-gateway-1 nginx -t
docker exec avatar-proxy-api-gateway-1 \
  wget -qO- http://host.docker.internal:10588/ready
```

在 PR 验收模式下，只检查公开的回调路径。`/ready` 仍受 Basic Auth 保护：

```bash
docker exec avatar-proxy-api-gateway-1 \
  wget --server-response -O- \
  --header='Host: pr-22.preview.drama.richbest.cn' \
  --header='Content-Type: application/json' \
  --post-data='{}' \
  http://host.docker.internal:5410/api/v1/payments/callbacks/wechat
```

预期响应是应用返回的 `INVALID_SIGNATURE` JSON。它证明请求没有进入
Preview Basic Auth。

最后向公网回调发送空 JSON：

```bash
curl -i -X POST \
  -H 'Content-Type: application/json' \
  --data '{}' \
  https://api.richbest.cn/minidrama/payments/callbacks/wechat
```

预期结果是应用返回的 JSON `401`：

```json
{"code":"INVALID_SIGNATURE","message":"微信支付通知验签失败"}
```

此 `401` 表示请求已经到达支付回调。HTML 登录页、Basic Auth 响应或
`avatar-proxy` 自身的认证错误都表示路由不正确。

## 6. 边界

`avatar-proxy` 只负责 TLS 终止和精确路径转发。

它不保存以下信息：

- 商户号。
- AppID。
- API v3 密钥。
- 商户私钥。
- 微信支付公钥。

这些配置由 LocalMiniDrama 在 `/data/minidrama-config/` 中管理。
