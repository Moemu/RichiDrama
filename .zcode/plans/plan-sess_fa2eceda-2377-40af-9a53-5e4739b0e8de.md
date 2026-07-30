## 401 根因（已用 lens-rhyme 源码 + 火山 SDK 源码双重坐实）

当前项目 AK/SK 签名时，把**用户填的推理域名**（`ark.cn-beijing.volcengineapi.com`）当作签名 host 和请求 host。但推理域名只认 Bearer API Key，不认 AK/SK 签名 → 火山返回 **401 "the API key or AK/SK ... invalid"**。

**控制面 OpenAPI**（`?Action=CreateAssetGroup` 这类）的正确 host 由 region 推断：
- 国内（cn-beijing）：`open.volcengineapi.com`
- 国际（ap-southeast-1 / ap-singapore-1）：`open.byteplusapi.com`

权威依据：
- lens-rhyme（`/root/lens-rhyme/backend/core/models/providers/volcengine/asset_reviewer.py`）用 `volcenginesdkcore.UniversalApi`，**不传 base_url**，靠 `region=cn-beijing` 自动用 `open.volcengineapi.com` → 能成功。
- 当前项目依赖 `@volcengine/openapi@1.36.1`，其 `base/utils.js:19` 默认 host 正是 `open.volcengineapi.com`，`services/livesaas/const.js` 国际版用 `open.byteplusapi.com`。
- 当前项目 `modelArkAssetProxyService.js:129` 的 `parseSignedOpenApiUrl(base)` 直接取用户填的 host → 401 源头。

## 修复方案（单文件：`backend-node/src/services/modelArkAssetProxyService.js`）

核心：让 `volc_sign`（AK/SK）路径**固定用按 region 推断的控制面 host**，与用户填的推理 base_url 解耦。对齐 lens-rhyme / 火山 SDK 的行为。

### 改动 1：新增 `resolveControlPlaneHost(region)` 函数
返回控制面通用 OpenAPI host：
- region 含 `ap-southeast` / `ap-singapore` / `byteplus` → `open.byteplusapi.com`
- 其余（含 cn-beijing / 默认）→ `open.volcengineapi.com`

### 改动 2：改造 `fetchSignedOpenApi`（行 116-164）
- 现状：`const { protocol, host, pathname } = parseSignedOpenApiUrl(base)` —— host 取自用户填的 base（推理域名，错误）。
- 改为：用 `resolveControlPlaneHost(inferSignRegion(原host, signRegion))` 作为**签名 host 和请求 host**；protocol 固定 `https:`；pathname 固定 `/`（控制面接口不带 `/api/v3` 路径）。
- 即：签名 request 的 `region` 仍走 `inferSignRegion`，但 host 强制换成控制面 host。这样签名上下文（service=ark, region, host=open.volcengineapi.com）与火山 SDK 一致，验签通过。
- `base` 参数仍保留（向后兼容签名函数签名），但 host 不再用它的值。

### 改动 3：`callModelArkAsset`（行 182-264）的 volc_sign 分支
- 当前对 base 做了 `normalizeBaseUrl(ensureArkOpenApiBasePath(base))`（行 204）。volc_sign 分支下，这个处理已无意义（host 会被覆盖），但保留不删（避免动 bearer 路径）。`fetchSignedOpenApi` 内部会忽略 base 的 host。

### 不改的部分
- bearer 分支（行 241-246）不动 —— 它用 base 拼 URL，这是中转/推理路径，与控制面无关。
- `inferSignRegion` 不动（保留国内/国际 region 推断能力）。
- 前端不动（上次已精简，前端不再传 base 给 AK/SK 路径也无妨，因为后端会用控制面 host）。
- `buildModelArkContext`（上次已改）不动。

## 为什么这样改是对的
- 与 lens-rhyme 行为完全对齐：都是"region → 控制面 host"，不依赖用户填的推理域名。
- 用户填的 Base URL 从此只影响 Bearer（推理）路径，AK/SK（素材审核）路径固定走控制面，**不会再因填错推理域名而 401**。
- 向后兼容：老配置、bearer 路径、国际 region 都不受影响。

## 验证
1. `cd backend-node && node --test test/*.test.js` 通过（40 个测试，含 modelArkAssetConfigService 套件）。
2. 手动：SD2 资产管理页填正确 IAM AK/SK（AKLT 开头）+ ProjectName，资产组 Id 留空，点保存 → 自动建组应成功（不再 401）。
3. 手动：左侧"资产组/资产"列表刷新、新建等 CRUD 应正常。

## 风险
- 极低。改动集中在 `fetchSignedOpenApi` 的 host 来源，是 401 的直接修复点；签名算法、region 推断、bearer 路径均不变。
- 唯一前提仍是用户填**正确的 IAM 访问密钥**（AKLT 开头，非推理 Key）—— 这是凭据正确性问题，代码无法代劳。但修复 host 后，只要 AK/SK 本身正确，认证就能通过。