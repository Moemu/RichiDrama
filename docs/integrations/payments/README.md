# ToC 充值接入与验收

本文说明支付宝和微信支付的接入流程。

当前版本只支持 PC 扫码支付。

- 支付宝使用 `alipay.trade.precreate`。
- 微信使用 API v3 Native 支付。
- 1 元兑换 100 积分。
- 默认充值套餐为 39 元、199 元和 599 元。
- 订单有效期为 15 分钟。
- 充值金额为 1–5000 元。
- 金额最多保留两位小数。
- 企业共享账户成员不能充值。
- 当前版本不支持退款。

## 1. 安全边界

支付功能默认关闭。

不要把密钥写入 Git、Markdown 或截图。

只通过服务器环境变量注入密钥。

回调地址必须使用公网 HTTPS。

preview 使用隔离数据库。它不会修改生产余额。

preview 优先读取 `/data/minidrama-config/.preview.env`。

Preview 部署把最小充值金额固定为 0.01 元。该设置只用于真实渠道的小额验收。
生产环境仍使用 1 元最小金额。

套餐金额由分值数组控制。修改环境变量后重新部署即可生效：

```text
CFG_PAYMENTS__PRESET_AMOUNTS_FEN=[3900,19900,59900]
```

页面从后端读取套餐。修改套餐不需要改前端代码。

旧服务器没有该文件时，会回退到 `minidrama.oss.env`。回退期间必须保持支付关闭。

不要在 preview 使用生产支付密钥或生产支付二维码。

真实支付前，必须取得明确授权。

## 2. 公共回调地址

支付宝默认使用公共基址生成通知地址。

支付宝通知地址：

```text
https://example.com/api/v1/payments/callbacks/alipay
```

微信可以使用独立的固定通知地址。当前入口为：

```text
https://api.richbest.cn/minidrama/payments/callbacks/wechat
```

该外部路径由 HTTPS 入口改写为后端微信回调路径。

通知路由不要求登录。

其他支付接口都要求登录。

## 3. 支付宝接入

### 3.1 平台准备

1. 在支付宝开放平台创建应用。
2. 为应用开通当面付能力。
3. 设置 RSA2 签名。
4. 保存应用私钥。
5. 获取支付宝公钥。
6. 获取应用 ID 和商户 ID。
7. 配置异步通知地址。

应用私钥建议使用 PKCS8 格式。

### 3.2 环境变量

```text
CFG_PAYMENTS__ALIPAY__APP_ID
CFG_PAYMENTS__ALIPAY__APP_PRIVATE_KEY
CFG_PAYMENTS__ALIPAY__ALIPAY_PUBLIC_KEY
CFG_PAYMENTS__ALIPAY__SELLER_ID
CFG_PAYMENTS__ALIPAY__ENABLED=true
```

如使用沙箱，再设置沙箱网关：

```text
CFG_PAYMENTS__ALIPAY__ENDPOINT=https://openapi-sandbox.dl.alipaydev.com/gateway.do
```

应用私钥和支付宝公钥可以使用 PEM 文本。

也可以使用 PEM 内容的 Base64 编码。

### 3.3 支付宝验收

1. 创建 1 元订单。
2. 检查二维码可以显示。
3. 使用支付宝沙箱完成支付。
4. 检查订单只到账一次。
5. 重发相同通知。
6. 检查积分没有再次增加。
7. 检查账单类型为 `recharge`。
8. 检查运营台可以读取订单。

支付宝资料：[当面付产品说明](https://open.alipay.com/paymentServicer/paymentProvider.htm)

## 4. 微信支付接入

### 4.1 商户平台准备

1. 准备已开通 Native 支付的微信商户号。
2. 获取 AppID。
3. 获取商户证书序列号。
4. 保存商户 API 私钥。
5. 设置 32 字节 API v3 密钥。
6. 获取微信支付平台公钥或证书公钥。
7. 配置支付通知地址。

当前实现使用平台公钥验证响应和通知。

平台公钥必须与商户平台当前配置一致。

### 4.2 环境变量

```text
CFG_PAYMENTS__WECHAT__APP_ID
CFG_PAYMENTS__WECHAT__MCH_ID
CFG_PAYMENTS__WECHAT__NOTIFY_URL=https://api.richbest.cn/minidrama/payments/callbacks/wechat
CFG_PAYMENTS__WECHAT__MERCHANT_SERIAL_NO
CFG_PAYMENTS__WECHAT__MERCHANT_PRIVATE_KEY
CFG_PAYMENTS__WECHAT__API_V3_KEY
CFG_PAYMENTS__WECHAT__WECHATPAY_PUBLIC_KEY_ID
CFG_PAYMENTS__WECHAT__WECHATPAY_PUBLIC_KEY
CFG_PAYMENTS__WECHAT__ENABLED=true
```

商户私钥和微信支付公钥可以使用 PEM 文本。

也可以使用 PEM 内容的 Base64 编码。

商户证书序列号来自 `apiclient_cert.pem`。商户私钥来自配套的 `apiclient_key.pem`。

微信支付公钥 ID 使用 `PUB_KEY_ID_...` 格式。微信响应和通知中的 `Wechatpay-Serial` 必须与该 ID 一致。

`wechatpay_public_key` 是微信支付公钥，不是商户证书中的公钥。旧字段 `platform_public_key` 只保留读取兼容。

### 4.3 微信验收

1. 创建 1 元 Native 订单。
2. 检查 `code_url` 可以生成二维码。
3. 完成扫码支付。
4. 检查通知签名验证成功。
5. 检查通知资源可以解密。
6. 检查订单只到账一次。
7. 重发相同通知。
8. 检查积分没有再次增加。
9. 检查主动查单可以恢复丢失通知。

微信资料：[Native 下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)、[支付成功通知](https://pay.wechatpay.cn/doc/v3/merchant/4012791882)

## 5. 全局配置

两个渠道准备完成后，再设置全局配置：

```text
CFG_PAYMENTS__PUBLIC_BASE_URL=https://example.com
CFG_PAYMENTS__ENABLED=true
```

`CFG_PAYMENTS__PUBLIC_BASE_URL` 必须是 HTTPS 地址。

系统默认在该地址后添加支付通知路径。

渠道的 `NOTIFY_URL` 可以覆盖默认通知地址。该值也必须使用 HTTPS。

建议按以下顺序启用：

1. 保持全局开关关闭。
2. 配置支付宝和微信密钥。
3. 检查应用启动日志。
4. 检查日志没有密钥明文。
5. 检查 HTTPS 回调可访问。
6. 启用一个渠道。
7. 完成该渠道验收。
8. 再启用另一个渠道。
9. 最后启用全局开关。

## 6. preview 验收流程

preview 由内部 PR 自动部署。

沙箱密钥写入 Git 忽略的 `.preview.env`。不要写入 `preview.yaml`。

`preview.yaml` 只保存无密钥的应用行为覆盖。`.preview.env` 保存运行密钥。

详细部署规则见 [PR 预览和安全发布](../../../deploy/PR_PREVIEWS.md)。

HTTPS 双入口调查见 [Preview 支付 HTTPS 调查](PREVIEW_HTTPS.md)。

preview 第一轮只做模拟和保护性测试。

### 6.1 自动检查

Validation 必须完成以下工作：

- 后端全量测试。
- 前端全量测试。
- 前端 production build。
- 空数据库迁移双跑。
- Docker 镜像构建。
- preview 支付迁移、页面标题和支付 API smoke。

Validation 成功后，批准 `preview` environment 部署。

### 6.2 页面检查

1. 登录 preview。
2. 打开账户中心的“充值”页签。
3. 检查固定金额和自定义金额。
4. 检查支付宝和微信渠道状态。
5. 检查个人账户充值区域。
6. 检查企业成员只显示说明文本。
7. 打开运营台的“充值订单”页签。
8. 检查筛选、横向滚动和主动查单入口。

检查以下视口：

- `1280×720`
- `1440×900`
- `1920×1080`

### 6.3 API 检查

在支付关闭状态检查以下结果：

- `GET /api/v1/payments/options` 返回 200。
- `GET /api/v1/payments/orders` 返回 200。
- `GET /api/v1/admin/payment-orders` 返回 200。
- 创建支付订单返回“充值功能暂未开放”。
- 未登录公共回调不会返回 401。

不要向 preview 写入生产支付密钥。

不要在本轮扫描或支付二维码。

服务器内部 smoke 使用隔离数据库中的管理员身份。

登录令牌只存在于 smoke 进程内。

支付关闭时，smoke 还会检查安全拒绝和公共回调路由。

支付开启时，smoke 会跳过所有写入接口。

## 7. 真实渠道验收

真实渠道验收必须单独授权。

支付宝先使用沙箱。

微信先使用测试商户能力。

正式验收只使用最小金额。

每个渠道必须完成以下闭环：

1. 创建订单。
2. 显示二维码。
3. 完成支付。
4. 接收通知。
5. 增加一次积分。
6. 重复通知不重复到账。
7. 读取账单和运营订单。

## 8. 上线检查

上线前检查以下内容：

- PR Validation 成功。
- `preview / smoke` 成功。
- preview 页面和 API 验收成功。
- 数据库迁移可以重复执行。
- 历史余额和历史流水仍可读取。
- 支付密钥没有进入 Git 或日志。
- 回调域名使用 HTTPS。
- 支付渠道配置与当前商户一致。

新行为只作用于新支付订单。

历史充值记录不迁移。

企业共享余额不参与个人充值。
