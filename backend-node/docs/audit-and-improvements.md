# LocalMiniDrama 后端 — 全量安全审计与改进计划

> 生成日期：2026-08-11（第三轮复审计）
> 范围：计费系统 + 安全配置 + 资产权限 + **SD2 无感认证方案**

---

## 目录

1. [计费系统漏洞（11 项）](#1-计费系统漏洞)
2. [安全配置问题（3 项）](#2-安全配置问题)
3. [资产权限与数据一致性（2 项·已修复）](#3-资产权限与数据一致性)
4. [SD2 认证无感化方案](#4-sd2-认证无感化方案)
5. [修复优先级总表](#5-修复优先级总表)

---

## 1. 计费系统漏洞

> 核心计费基础设施（三阶段计费、BigInt 运算、幂等键去重、atomic 事务、reconciliation 兜底）已正确实现。残留问题集中在**失败/取消路径的冻结释放、幂等键确定性、生产安全默认值**。

### 1.1 🔴 C4 — 致命：图片配置缺失不释放冻结

**位置**：`src/services/imageService.js:720-728`

**问题**：AI 配置不存在（未找到 image 模型）时，记录标记为 `failed`，但**不调用 `voidImageBilling`**。已冻结的积分永久卡死。

**修复**：该分支补 `voidImageBilling(db, log, row, '未配置图片模型')` 调用。

**影响**：用户余额无限期冻结，无结算/释放。

---

### 1.2 🔴 C10 — 致命：任务取消不释放冻结

**位置**：`src/services/taskService.js:84-94`（`cancelTask`）

**问题**：取消任务时把 task 标记为取消/failed，但**不 void 关联的 billing authorization**。视频/图片任务被取消后，冻结积分永久卡死。

**修复**：`cancelTask` 内根据 task 关联的 video/image/tool run 找到 `billing_authorization_id` 并 void。需双向关联（task → run → authorization）。

**参考**：`videoService.setVideoGenFailed()`（`videoService.js:22-38`）已正确 void，是应遵循的模式。

---

### 1.3 🔴 C11 — 致命：幂等键用 Math.random()，重试重复冻结

**位置**：
- `src/routes/images.js:32`
- `src/routes/videos.js:48`
- `src/services/omniVideoService.js:55`
- `src/routes/tools.js:13`

**问题**：幂等键生成含 `Math.random()`。当客户端未显式传幂等键、因网络超时重试时，每次生成**新键** → 创建**多个 authorization** → 重复冻结，部分 authorization 永不结算。

**对比**：`ttsService.js` 用 `crypto.randomUUID()`，但同样不接受调用方键。

**修复**：接受调用方 `idempotency_key`（已支持），且**未传时用请求体确定性 hash**（如基于 body 内容 SHA256）。最小改动：要求调用方必传幂等键，或对同 body 去重。

---

### 1.4 🟠 H9 — 高风险：多图计费按 `{image:1}` 结算，收入泄露

**位置**：`src/services/imageService.js:591-598`（`settleImageBilling`）

**问题**：授权时记 `{image: count}`（多图数量），结算时硬编码 `{image: 1}`，且 `Math.min(actual, frozen)` 用 ratio 均摊。多图请求按 1 张结算 → **收入永远低于成本**。

**缓解**：`routes/images.js:29-31` 已拒绝 `count != 1`，路由层封住了风险。

**修复**：把授权时记录的 `count`（存于 `auth.snapshot` 或 run 记录）传回结算，结算量 = 实际张数。

---

### 1.5 🟠 H10 — 高风险：启动时孤儿异步任务不 void 计费

**位置**：`src/services/taskService.js:99-119`（`failOrphanedAsyncTasksOnStartup`）

**问题**：服务重启后遗留的 `processing` 任务被标记 `failed`，但**不 void billing**。跨重启崩溃的任务冻结积分永久卡死。

**修复**：该函数对每个失败 task 关联的 authorization 调 void。

---

### 1.6 🟠 H5 — 高风险：开发 JWT 密钥硬编码

**位置**：`src/services/authService.js:7`

**问题**：`DEVELOPMENT_JWT_SECRET = 'local-mini-drama-development-secret-change-me'` 固定值。非生产环境用硬编码密钥签 JWT。若误部署到生产，可伪造任意用户。

**修复**：生产必须从 env/DB 读取（已实现 `jwtSecret()`），且硬编码值改为随机生成并持久化。

---

### 1.7 🟠 H4 — 高风险：默认管理密码 admin123456

**位置**：`src/services/authService.js:69`

**问题**：非生产默认密码 `admin123456` 明文硬编码。

**影响**：若误部署，管理员可被暴力破解。

**修复**：首次启动强制改为随机密码并提示用户设置。

---

### 1.8 🟡 M13 — 中危：图片非 pending 状态提前返回不释放冻结

**位置**：`src/services/imageService.js:618-621`

**问题**：并发/重复处理时，状态非 `pending` 直接 `return`，**不 void** 已冻结的 authorization。

**修复**：该分支补 `voidImageBilling`。

---

### 1.9 🟡 M-new — 中危：executeStory/executeReverse 不带 usage 回调

**位置**：`src/services/toolRunService.js:93-97`

**问题**：`executeStory`/`executeReverse` 调用 `set(db, id, {status: 'completed', output})` **未传 `billing_usage` / `provider_request_id`**。而工具路径已 `disableAutoBilling`，`settleBilling` 收到 `actualUsage=undefined`，对 token 计费模型落入 `markPendingReconciliation`。

**影响**：这两个工具每次成功都产生待人工结算的 reconciliation case；文本模型 token 用量未被捕获，需管理员手动 settle。

**修复**：仿照 `executeAnalysis`（`toolRunService.js:92`），传入 provider 返回的 usage 回调和 `provider_request_id`。`storyGeneration.generateStory` 需暴露 usage 或改走带 `usage_callback` 的流式接口；`executeReverse` 的 `generateTextWithVision` 同样需捕获 usage。

---

### 1.10 🟡 M13b — 中危：默认 insecure_tls:true 全局关闭 TLS 校验

**位置**：`configs/config.yaml:13` → `src/server.js:4-12` → `NODE_TLS_REJECT_UNAUTHORIZED=0`

**问题**：默认全局关闭 TLS 校验，中间人攻击风险。

**修复**：默认改为 `false`，仅开发环境显式开启。

---

### 1.11 🟢 L2 — 低危：requireAdmin 信任 JWT 角色

**位置**：`src/middleware/auth.js:27-30`

**问题**：`requireAdmin` 只检查 `req.auth.role`（来自 JWT），不查库确认该用户当前仍是 admin。角色一旦变更，旧 token 仍有效。

**修复**：从 DB 读取用户角色复核。

### 1.12 🟡 M7 — 中危：初始管理员密码明文写文件

**位置**：`src/services/authService.js:41-46`

**问题**：`initial-admin-credentials.txt` 明文存初始密码。

**影响**：本地文件泄露。

**修复**：文件加权限限制，或生产禁用、提示通过安全渠道获取。

---

## 2. 安全配置问题

### 2.1 🟡 缺少请求速率限制

**位置**：全局

**问题**：API 无速率限制，登录/注册/计费接口可被暴力请求。

**影响**：暴力破解密码、耗尽积分。

**修复**：引入 `express-rate-limit` 或类似中间件，对 `/auth/login`、`/auth/register`、`/billing/` 等接口限流。

### 2.2 🟡 日志可能泄露敏感信息

**位置**：多处 `log.error()`、`log.info()` 调用

**问题**：错误日志中可能包含完整请求体、token、密码等敏感信息。

**修复**：日志记录时对敏感字段做脱敏（`password`、`token`、`secret` 等字段替换为 `***`）。

### 2.3 🟢 scheme 校验（CORS/CSRF）

**位置**：`configs/config.yaml:9-11`

**问题**：CORS 仅配置 `http://localhost:3012`，生产部署时需收紧域名白名单。

**修复**：生产环境通过环境变量注入正确的 `cors_origins`。

---

## 3. 资产权限与数据一致性

> 以下问题已在最近 PRs 中修复（#41-#44），记录在此供回顾。

### 3.1 ✅ 已修复：资产归属权优先级颠倒

**位置**：`src/middleware/ownership.js:17`（PR #43）

**问题**：`COALESCE(a.owner_user_id, d.owner_user_id)` 优先使用资产的直接拥有者，而不是项目拥有者。旧数据遗留的 `owner_user_id` 导致项目成员无法编辑/删除项目内的可见素材。

**修复**：改为 `COALESCE(d.owner_user_id, a.owner_user_id)`，项目关系优先。

**影响范围**：`ownership.js`、`routes/tools.js`、`omniVideoService.js`、`assetService.test.js`、`ownershipGuard.test.js`

### 3.2 ✅ 已修复：SD2 空响应导致解引用崩溃

**位置**：`src/services/assetSd2Service.js:39-46`（PR #42）

**问题**：`createImageAsset` 返回 `{ok: true, data: null}` 时，`createdAssetFromResult` 未校验 `data` 非空，后续 `data.id` 抛 `TypeError`。

**修复**：添加 `createdAssetFromResult()` 函数，校验 `data` 及 `data.id` 非空后返回。

**同批修复**：`characterLibraryService.js` 中 `registerCharacterViaJimengHub` 和 `registerCharacterViaModelArk` 也加了 `?.` 安全访问。

---

## 4. SD2 认证无感化方案

> 用户要求：SD2 认证**无需手动逐个点击**，系统应在后台自动完成认证，实现"无感"体验。

### 4.1 现状痛点

当前认证流程（`src/services/assetSd2Service.js`）需要用户手动触发：

```
用户上传/选择素材
  ↓
用户手动点击"认证"按钮        ← 需要用户操作
  ↓
createImageAsset（创建远程资产，~1-2s）
  ↓
pollAssetUntilSettled（轮询直到就绪，~5-30s）  ← 同步阻塞
  ↓
返回结果给客户端（全程 await）
```

**痛点**：
- 每个认证请求**同步等待 5-30 秒**才能返回，HTTP 连接长时间保持
- 用户必须**逐个手动点击**认证按钮，素材多时繁琐
- 素材更换主图后变为 `stale`，需重新手动认证
- 认证是使用 SD2 素材的前置条件，手动触发造成"卡点"

### 4.2 无感方案设计（三阶段）

核心思路：**让认证在后台自动发生，用户无感知**。分三个触发时点：

```
阶段一：素材写入时自动认证（fire-and-forget）
阶段二：SD2 生成路径按需认证（生成前兜底检查）
阶段三：stale 后自动重认证（指纹驱动）
```

---

#### 阶段一：素材写入时自动认证

**触发点**（在素材主图写入/更新后，自动发起后台认证，不阻塞响应）：

| 触发点 | 文件 | 钩子 |
|--------|------|------|
| 角色主图更新 | `routes/characters.js:157-196`（`putImage`） | 成功更新后 `setImmediate` 触发 |
| 场景主图更新 | `routes/scenes.js`（update） | 同上 |
| 道具主图更新 | `routes/props.js`（update） | 同上 |
| 素材池导入/更新 | `routes/assets.js`（create/update/importImage） | 同上 |
| 角色库应用 | `routes/characters.js:197-212`（`imageFromLibrary`） | 应用成功后触发 |

**实现**：在 `assetSd2Service.js` 新增一个 `ensureCertifiedAsync(db, log, cfg, kind, id)` 入口：

```javascript
// 无感自动认证：fire-and-forget，不阻塞响应
function ensureCertifiedAsync(db, log, cfg, kind, id) {
  const table = tableFor(kind);
  if (!table) return;
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(Number(id));
  if (!row) return;
  const cert = parse(row.seedance2_asset);
  // 已经是 active 且指纹未变 → 无需重复认证
  if (cert && String(cert.status).toLowerCase() === 'active' &&
      cert.source_fingerprint === sourceFingerprint(row)) return;
  setImmediate(async () => {
    try {
      const out = await certifyResource(db, log, cfg, kind, id);
      if (!out.ok) log.warn('[SD2] 背景自动认证失败（可容忍，生成时再兜底）', { kind, id, error: out.error });
    } catch (err) {
      log.error('[SD2] 背景自动认证异常', { kind, id, error: err.message });
    }
  });
}
```

**关键点**：
- 用 `source_fingerprint` 判断是否需要认证，避免重复请求
- `setImmediate` 异步执行，响应秒级返回
- 失败不抛出，仅在日志记录（生成时兜底）

---

#### 阶段二：SD2 生成路径按需认证（兜底）

在真正依赖 SD2 素材的生成流程中，**使用前检查**认证状态，未认证/已 stale 则即时认证。

**SD2 依赖路径**（素材以 `identity` 身份进入视频生成 body 时）：
- `src/services/omniVideoService.js` — `enforceSd2IdentityAssets()`、`applySd2CertifiedAssetReferences()`（第 40-41 行）
- `src/services/videoService.js` — 视频生成 reference 处理

**实现**：生成前对 identity 素材做 `await ensureCertifiedSync()`（同步、快速判断）：

```javascript
// 生成路径兜底：同步确保已认证（active），未认证/已 stale 就在此刻认证
async function ensureCertifiedSync(db, log, cfg, kind, id) {
  const cert = ...; // 读取 seedance2_asset
  if (cert && cert.status === 'active' && cert.source_fingerprint === sourceFingerprint(row)) {
    return { ok: true, status: 'active' };  // 已认证，直接放行
  }
  // 未认证或已失效 → 即时认证（此路径是生成前置，可同步等待）
  return certifyResource(db, log, cfg, kind, id);
}
```

**权衡**：此路径是生成的前置条件，同步等待可接受（用户在生成时本就等待）。但若阶段一已自动认证成功，此路径零延迟。

---

#### 阶段三：stale 后自动重认证

当素材主图变化触发 `markResourceStale`（已实现，`assetSd2Service.js:110-123`），状态变为 `stale`。此时：

1. **立即**放入后台重认证队列（异步，不阻塞主图更新响应）
2. 若 `source_fingerprint` 意外匹配（用户改回原图），现有逻辑已自动恢复 `active`（`cert.source_fingerprint === newFp`）

**实现**：在 `markResourceStale` 的最后，若状态被置为 `stale`，调用 `ensureCertifiedAsync` 触发重认证。

---

### 4.3 异步轮询改造（certifyResource 优化）

`certifyResource`（`assetSd2Service.js:70-91`）当前同步等待 `pollAssetUntilSettled`，应改为**先返回、后轮询**：

```javascript
async function certifyResource(db, log, cfg, kind, id) {
  // ... 校验、选择 provider、获取图片 URL 等（不变）...
  const createdResult = createdAssetFromResult(create, route.provider);
  if (!createdResult.ok) return createdResult;
  const created = createdResult.asset;

  // 保存初始状态（processing），立即返回
  let out = payload(row, created, source.url, route.provider);
  out.status = 'processing';
  db.prepare(`UPDATE ${table} SET seedance2_asset = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(out), out.updated_at, row.id);

  // 异步轮询，不阻塞响应
  setImmediate(async () => {
    try {
      const settled = route.provider === 'model_ark'
        ? await modelArk.pollAssetUntilSettled(route.ctx, created.id, { log })
        : await materialHub.pollAssetUntilSettled(route.ctx, created.id, { log });
      const data = settled.asset || created;
      out = {
        ...out,
        asset_url: data?.asset_url || out.asset_url || modelArk.assetUrlForVideo(data),
        status: data?.status || out.status,
        poll_timed_out: !!settled.timedOut,
        updated_at: new Date().toISOString(),
      };
      db.prepare(`UPDATE ${table} SET seedance2_asset = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(out), out.updated_at, row.id);
      // 同步 asset mapping
      if (kind !== 'asset') {
        try { require('./assetMappingService').syncEntities(db, log, kind, [id]); } catch (_) {}
      }
    } catch (err) {
      log.error('SD2 async poll failed', { kind, id, error: err.message });
      out = { ...out, status: 'failed', error: err.message, updated_at: new Date().toISOString() };
      db.prepare(`UPDATE ${table} SET seedance2_asset = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(out), out.updated_at, row.id);
    }
  });

  return { ok: true, seedance2_asset: out };
}
```

**前端交互**（已有刷新按钮，无需大改）：
```
┌─────────────────────────────────────────┐
│ 素材图片    状态                   操作  │
│ ┌────┐  processing (认证中·自动) [刷新] │
│ │    │  ⏳ 上传后已自动发起认证...       │
│ └────┘                                  │
│ ┌────┐  active (已就绪·自动)   [刷新]   │
│ │    │  ✅ 无需手动操作                 │
│ └────┘                                  │
└─────────────────────────────────────────┘
```

---

### 4.4 完整无感流程示例

**场景：用户上传角色主图**

```
1. 用户 PUT /characters/:id/image  { image_url: "..." }
2. 后端校验 + 更新角色主图            ← markResourceStale 检测到变更
3. 返回 200 OK（秒级响应）            ← 不阻塞
4. setImmediate → ensureCertifiedAsync
   ├─ fingerprint 变化 → 触发 certifyResource
   │   ├─ createImageAsset（~1-2s）
   │   ├─ 保存 processing 状态
   │   └─ setImmediate → pollAssetUntilSettled（后台 5-30s）
   │       └─ 更新为 active / failed
   └─ fingerprint 未变 → 跳过
5. 稍后用户生成视频，素材以 identity 引用
   ├─ ensureCertifiedSync 检查 → 已 active → 直接放行（零延迟）
   └─ 若仍在 processing → 等待或提示"素材认证中"
```

---

### 4.5 方案对比

| 维度 | 现状（手动认证） | 无感方案（自动后台认证） |
|------|-----------------|------------------------|
| 用户操作 | 逐个人工点击认证 | **零操作**，上传即自动认证 |
| 响应速度 | 同步阻塞 5-30s | 秒级响应，后台完成 |
| 认证时机 | 用户想起来才认证 | 上传即认证 + 生成前兜底 |
| 主图变更 | 手动重新认证 | 自动检测 stale 并重认证 |
| 改动量 | 基准 | 中（后端钩子 + 异步化） |
| 失败兜底 | 无 | 生成路径 ensureCertifiedSync |

---

### 4.6 建议实施步骤

1. **第一阶段（异步化）**：改造 `certifyResource` 为"先返回、后轮询"（4.3），前端无需改动（已有刷新按钮）
2. **第二阶段（自动触发）**：在素材写入/更新钩子中调用 `ensureCertifiedAsync`（阶段一）
3. **第三阶段（生成兜底）**：在 SD2 依赖生成路径加入 `ensureCertifiedSync`（阶段二）
4. **第四阶段（自动重认证）**：`markResourceStale` 后自动触发重认证（阶段三）
5. **可选优化**：提供批量认证接口 `POST /assets/batch/sd2-certify`（`Promise.allSettled` 并发）

---

## 5. 修复优先级总表

### 计费与资金安全（P0-P2）

| 优先级 | 问题 | 影响 | 涉及文件 | 预估工时 |
|--------|------|------|---------|---------|
| P0 | C4: 图片配置缺失不释放冻结 | 资金冻结 | `imageService.js:720` | 0.5h |
| P0 | C10: 任务取消不释放冻结 | 资金冻结 | `taskService.js:84` | 1h |
| P0 | C11: 幂等键 Math.random() | 重复冻结/计费 | `images.js`、`videos.js`、`tools.js`、`omniVideoService.js` | 2h |
| P1 | H9: 多图计费收入泄露 | 收入损失 | `imageService.js:591` | 1h |
| P1 | H10: 孤儿任务不 void | 资金冻结 | `taskService.js:99` | 1h |
| P1 | H5: 开发 JWT 密钥硬编码 | 安全风险 | `authService.js:7` | 0.5h |
| P1 | H4: 默认管理密码 | 安全风险 | `authService.js:69` | 0.5h |
| P2 | M13: 非 pending 状态不 void | 资金冻结 | `imageService.js:618` | 0.5h |
| P2 | M-new: executeStory/Reverse 无 usage 回调 | 需人工对账 | `toolRunService.js:93` | 1h |
| P2 | M7: 初始密码明文文件 | 信息泄露 | `authService.js:41` | 0.5h |
| P2 | 缺少速率限制 | 暴力攻击 | 新增中间件 | 1h |
| P2 | 日志敏感信息泄露 | 信息泄露 | 全局 | 2h |

### 安全配置（P2-P3）

| 优先级 | 问题 | 影响 | 涉及文件 | 预估工时 |
|--------|------|------|---------|---------|
| P2 | M13b: 默认 insecure_tls | 中间人攻击 | `config.yaml`、`server.js` | 0.5h |
| P3 | L2: requireAdmin 信任 JWT | 权限延迟 | `auth.js:27` | 0.5h |
| P3 | CORS 白名单收紧 | 跨站风险 | `config.yaml` | 0.5h |

### SD2 无感认证（新功能）

| 阶段 | 内容 | 涉及文件 | 预估工时 |
|------|------|---------|---------|
| 一 | certifyResource 异步化 | `assetSd2Service.js` | 2h |
| 二 | 素材写入自动认证钩子 | `characters.js`、`scenes.js`、`props.js`、`assets.js` | 3h |
| 三 | 生成路径按需认证兜底 | `omniVideoService.js`、`videoService.js` | 2h |
| 四 | stale 自动重认证 | `assetSd2Service.js` | 1h |

---

## 附录：DB 现场状态（2026-08-11）

- 3 个账户，0 冻结，0 待对账，全部授权已 settle/void
- 用户 1 余额 28980652 micro（约 289.8 积分），已消费 3019348 micro
- 近期 20 笔授权全部正常终结
- 生产数据持久化在 `data/` 目录（PR #39 修复，不与部署目录绑定）