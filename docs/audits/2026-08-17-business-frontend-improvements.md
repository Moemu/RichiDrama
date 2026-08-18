# 2026-08-17 业务漏洞与前端改进清单

本文沉淀 2026-08-11 计费审计的未闭环项 + 本轮业务/前端扫描的新发现。
范围：业务逻辑漏洞（计费/任务链路）、前端缺陷、UI 优化方向。安全类问题（认证/注入/传输）本轮明确排除。

上一轮完整审计结论见 `docs/audits/2026-08-17-backend-closure-matrix.md`（后端异步链路闭环矩阵）。

---

## 一、业务漏洞（按优先级）

### 🔴 P0 — 资金/冻结风险（上轮遗留，未修复）

| 编号 | 位置 | 问题 | 影响 |
| --- | --- | --- | --- |
| B1 | `routes/images.js:39`、`routes/tools.js:13`、`routes/videos.js:52`、`omniVideoService.js:72` | 幂等键兜底值含 `Date.now()+Math.random()`，客户端重试时生成新 key | 重复提交 → 重复冻结额度 |
| B2 | `imageService.js` Step1（约 726 行） | 图片 AI 配置缺失时仅标记 failed 后 return，未调用已有的 `voidImageBilling`（600 行定义，1420/1593 两处已接入） | 该路径冻结永久卡死 |
| B3 | `taskService.js:84-93` | `cancelTask` 用户取消只 `updateTaskError`，不释放 `billing_authorization_id` | 取消即漏冻结 |

**修复建议**：B2/B3 同根因 —— taskService 层没有 billing void 通路，建议在 `updateTaskError` 或调用侧统一接入 `voidAuthorization`，一次修复两处。B1 需将 key 改为业务实体确定性派生（如 `image:genId`、`video:genId`），并补重试幂等测试。

### 🟠 P1 — 高风险

| 编号 | 位置 | 问题 | 影响 |
| --- | --- | --- | --- |
| B4 | `taskService.js` `failOrphanedAsyncTasksOnStartup` | 重启时孤儿任务标失败但不释放计费授权（与 B3 同通路） | 重启后冻结残留 |
| B5 | `imageService.js` 多图结算（上轮 H9） | 疑似硬编码 `{image:1}`，本轮未复核 | 多图任务收入泄露（路由层当时有 count!=1 缓解）→ 待复核 |

### 🟡 P2 — 业务体验一致性

| 编号 | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| B6 | `frontweb/src/utils/request.js` | 402/余额不足无专属处理，只走通用 `ElMessage.error` | 识别余额不足错误码 → 弹引导（跳账户中心/充值），并在提交前做预估费用与余额预检 |
| B7 | `AccountBalanceBadge.vue` + 各生成入口 | 用户侧生成提交/完成后不派发 `lmd:balance-changed`（当前只有 AdminConsole 派发），余额靠 30s 轮询/路由切换/focus 兜底 | 在任务提交成功、轮询到终态两个时机派发事件，冻结/扣费即时可见 |
| B8 | `FreeCreate.vue:770-802` `poll()` | 连续 5 次失败静默 return，任务卡在"状态连接暂不可用，正在重试（5/5）"文案上，无恢复手段 | 失败超限时把任务标记为 `unknown` 状态并显示"手动刷新/重试"操作 |
| B9 | `FreeCreate.vue:769` `create()` | 提交参数直接透传，无 idempotency_key（配合后端 B1，双端都不幂等） | 前端生成 `createClientRequestId()`（AdminConsole 已有此工具函数）随请求携带 |

---

## 二、前端缺陷

| 编号 | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| F1 | `FilmCreate.vue`（**12,151 行**） | 巨型单文件组件，模板+逻辑+样式混杂；虽已抽 `composables/filmCreate/*`，主体仍然过大 | 按 Tab/区域拆子组件（剧本区/资源中心/分镜区/预览区），目标单文件 <2000 行 |
| F2 | `FilmCreate.vue:7957,8639`、`useCanvasEpisodeGenerate.js:126`、`ToolWorkbench.vue:42` 等 | 2~2.5s 高频轮询不判断 `document.visibilityState`，后台标签页持续打接口 | 抽统一 `usePolling` composable：visibility 感知 + 指数退避 + 最大次数（AdminConsole:183 已有 visibility 判断，可作参照） |
| F3 | `DramaCanvas.vue:744,756`、`FilmCreate.vue:2931,5057,6358,6691,7355,7622,8206` 等 | `catch (_) {}` 静默吞错 10+ 处；轮询兜底类可接受，但需逐个确认未吞关键链路错误（如保存失败） | 复核标注：兜底轮询保留、业务失败至少 console.warn 或降级提示 |
| F4 | `router/index.js:83-95` | admin 判断读 `localStorage.lmd_auth_user.role`，与后端会话可能不同步（改密/降级后仍显示管理入口，点进去 403） | 守卫内轻量校验（如 401/403 时清理本地 user）或 403 拦截统一跳转 |
| F5 | `useCharacters.js:615` 锚点轮询 | 有 60s 超时上限（正确），但超时无提示，用户不知道停了 | 超时时 ElMessage 提示"提炼超时，请稍后手动刷新" |
| F6 | `MediaLibrary.vue:232` | 搜索 400ms 防抖 timer 无组件卸载清理（低危，仅可能多触发一次请求） | 卸载时 clearTimeout |

### 已确认做得好的（无需改动）

- 生成按钮防重复提交：`loading/disabled` 覆盖良好（FreeCreate/FilmCreate/资源批量生成均到位）。
- 轮询去重：`FreeCreate` 用 `pollingJobIds` Set 防并发重复轮询；轮询上限 450×4s≈30min、失败 5 次熔断，机制本身健全（问题只在熔断后的 UI 状态，见 B8）。
- 定时器清理：主要视图（FreeCreate/FilmCreate/FilmList/DramaDetail/ToolWorkbench/AdminConsole）`onUnmounted` 清理齐全。
- 错误信息透传：`request.js` 优先展示后端 message、413 HTML 响应单独处理，体验良好。

---

## 三、前端 UI 优化方向建议

1. **空态与加载骨架统一**：`theme.css` 已有 CSS 变量体系，建议补一套统一 `EmptyState`/`Skeleton` 组件，替换各视图手写的占位（FilmCreate 资源中心、FilmList 列表、MediaLibrary 网格）。
2. **任务状态可视化**：视频生成涉及 sd2_waiting → processing → 后处理（超分/插帧）→ 归档多阶段，前端目前只有单一状态文案；建议引入阶段步骤条（后端 `stages()` 已返回各阶段状态，见 adminOperationsService，可复用给用户侧详情）。
3. **费用预估展示**：提交生成前展示预估冻结额度（后端 reservation 逻辑已有 `textReservation` 等估算），配合 B6 的余额预检，减少提交后才发现余额不足的挫败感。
4. **移动端断点**：`AccountBalanceBadge` 已做 720px 适配，其余视图（FilmList 表格、FilmCreate 三栏）建议系统性过一遍窄屏表现。
5. **巨型组件治理**：F1 之外，`FilmList.vue`（2098 行）、`DramaDetail.vue`（1613 行）也建议列入拆分计划；可先从纯展示子组件抽起，不动业务逻辑。

---

## 四、仓库卫生

1. `backend-node/` 根目录 33 个未跟踪 `.log` 文件（约 5MB+）→ 删除并在 `.gitignore` 增加 `backend-node/*.log`。
2. `.zcode/` 下 `FreeCreate_orig.vue`、`__pycache__/`、`sshrun.py` 未跟踪 → 清理或加入忽略。
3. `codex/ui-refactor` 分支 31 文件 1745 行改动未提交 → 尽快分批提交，与后续计费修复（B1-B4）分开，避免混淆回滚粒度。
4. 记忆索引引用的 `docs/audit-and-improvements.md` 不存在，实际为 `docs/audits/` 下文件 → 已在本文件统一沉淀，后续以 `docs/audits/` 为准。

---

## 修复顺序建议

1. **第一批（后端资金）**：B2 + B3 + B4 统一接入 void → B1 幂等键改造 + 测试。
2. **第二批（前后端配合）**：B9 前端幂等 key + B1 联调、B6 余额不足引导、B7 余额事件派发。
3. **第三批（体验/重构）**：F1 拆分、F2 usePolling 统一、UI 三项优化。
