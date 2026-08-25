# 账号、媒体与计费部署说明

本项目同时支持本地开发和线上部署。两种环境共享同一套账号、权限和计费数据模型，但安全策略不同。

## 本地开发

本地可直接启动，未设置认证环境变量时会使用开发用密钥，并创建初始管理员 `admin`。只应在离线开发环境使用；首次登录后仍建议改密码。

```powershell
cd backend-node
$env:CFG_IMAGE_PROXY__USE_FOR_VIDEO='false'
node --watch src/server.js
```

Vite 的 `/api` 与 `/static` 代理会转发浏览器 Cookie 和 Authorization 请求头，因此登录、缩略图和媒体预览均可正常工作。

## 线上部署

线上必须使用 HTTPS。以下环境变量可显式控制部署；未设置时，应用会在首次生产启动生成随机 JWT 密钥并持久化在 SQLite 的 `runtime_settings` 表中，因此正常 `git pull`/重启不会让已登录会话失效。

```text
NODE_ENV=production
AUTH_JWT_SECRET=<可选，至少32位；设置后优先使用>
INITIAL_ADMIN_USERNAME=<可选，空数据库首次启动时的管理员名>
INITIAL_ADMIN_PASSWORD=<可选，空数据库首次启动时的管理员强密码>
CFG_SERVER__CORS_ORIGINS=["https://app.example.com"]
CFG_STORAGE__BASE_URL=https://app.example.com/static
```

若未提供首个管理员密码，生产环境会创建随机密码，并在与 SQLite 数据库相同目录生成 `initial-admin-credentials.txt`（仅首次生成、文件权限为 owner-only；首次登录后应删除）。应用会将登录会话写入 `HttpOnly`、`Secure` Cookie，浏览器展示 `/static` 私有媒体时无需把 JWT 暴露在 URL 中。

默认生产策略会保护 `/static`：未登录访问返回 401，已登录用户由 Cookie 或 Bearer Token 认证。若前端与 API 同域（推荐由 Nginx/Caddy 反代到同一个域名）无需额外 CORS 配置；分域部署时，必须将前端完整 Origin 加到 `server.cors_origins`，并设置 `AUTH_COOKIE_SAME_SITE=none`。此模式必须保留 HTTPS。

若需要临时保持公开媒体，可设置 `CFG_SECURITY__PROTECT_STATIC=false`；这会放弃媒体直链隔离，不建议用于含真实用户数据的线上环境。

## 反向代理要点

- 将 `/api/` 与 `/static/` 代理到后端 5679；前端构建文件由同一域名托管。
- 将上传大小和超时配置为不小于后端：建议 `client_max_body_size 500m`、`proxy_read_timeout 600s`。
- TLS 在反向代理终止时，外部访问仍必须是 HTTPS，确保 `Secure` Cookie 可发送。

## 后端出站代理（本地开发）

AI 供应商请求由后端统一发起，文本、图片和视频共用同一传输层与账本流程。Node.js 不会自动继承 Windows 的“系统代理”设置；如果本机直连供应商出现 `EACCES`、`ECONNREFUSED` 或 `fetch failed`，请在**启动后端的进程环境**中设置 HTTP 代理，例如：

```powershell
$env:CFG_SERVER__EGRESS_PROXY='http://127.0.0.1:7897'
$env:CFG_IMAGE_PROXY__USE_FOR_VIDEO='false'
node --watch src/server.js
```

`server.egress_proxy` 只接受 `http://` 代理地址（可包含用户名和密码）；也兼容 `HTTPS_PROXY` 或 `HTTP_PROXY` 环境变量。不要把供应商调用改到前端或终端脚本：只有经后端路由进入，模型权限、预授权、供应商请求 ID、usage 和结算流水才能一致。
- 多实例部署时，SQLite 文件和 `storage.local_path` 必须是所有实例共享且可锁定的持久卷；更推荐单后端实例，或后续迁移到集中式数据库/对象存储。

## 计费启用顺序

1. 管理员登录 `/admin`，创建用户。
2. 建立已发布且不重叠的价目表。
3. 给用户充值；无需为任何账号单独分配模型权限。
4. 所有已登录用户都可调用平台已配置且已定价的模型；图片、视频、全能视频、工具运行会先冻结额度，成功后结算、失败后释放。

## 第三方图片 API 与计费口径

图片配置不局限于火山引擎。现有适配器支持火山、OpenAI Images 兼容接口、DashScope、Gemini、Kling、Nano Banana 和 Agnes；大多数第三方平台只要兼容 `POST /images/generations`，在管理后台新增 `provider: openai`、对应 `base_url`、`endpoint`、API Key 和模型名即可。接口字段或异步查询格式明显不同的平台，需要新增一个小适配器后接入，不能假设所有供应商都能直接兼容。

面向终端用户建议继续使用**内部积分**，不要把火山账户的人民币账单直接透传给用户：供应商账单通常按账号、套餐、区域、折扣、税费和异步失败重试结算，不能稳定等同于单次请求成本。后台价目表以“积分/张、积分/秒、积分/请求”等固定规则收费，后台再按火山/第三方实际 RMB 账单进行毛利和对账。若需要人民币展示，可定义公开兑换比例（例如 `100 积分 = ¥1`），但账本仍保存整数微积分；接入真实收款时再实现支付回调、退款和供应商对账。
