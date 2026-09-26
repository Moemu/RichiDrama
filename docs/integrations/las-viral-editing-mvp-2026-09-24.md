# 爆款素材剪辑（投流剪辑）第一批次实施方案（MVP）

> 状态：方案定稿，待实施。算子契约见 [las-viral-clip-gen-2026-09-24.md](las-viral-clip-gen-2026-09-24.md)。
> 总体分批：① 投流剪辑 MVP（本文）；② 批量与运营闭环（包装参数、多集批量、版本管理、剧本还原落库）；③ 其他算子（剧本还原接剧本流程、视频编辑增强版）。

## 1. 范围与原则

- 任务模型独立：多集输入 → N 条投流成片 + 结构化结果（分镜评级/钩子标签/时间线），**不复用 `las_media_jobs` 表和视频本地化页面**，避免「单视频→单成片」模型被 N:M 污染。
- 复用三块基础能力：`lasOperatorClient`（加 viral 分支）、`lasTosBridge`（kind 白名单扩 `viral`）、计费对账体系（报价→预授权→结算→待对账）。
- 入口：项目详情页（`DramaDetail.vue`）工作区新增「投流素材」tab，在项目内选已归档剧集视频发起任务；不扩充 AI 工具页路径。
- 遵守既有强制规则：不确定结果转待对账、绝不自动重提；completed 媒体必须可由本地路径恢复，`preview_url`（3 天签名链接）只作过程参考、绝不落为结果；新任务登记精确 TOS 对象清单，历史任务不纳入自动清理。

### 第一批明确不做（留二/三批）

- `drama_elements` 全套包装（剧名/提示语/角标/模板/字号/位置）、`postroll_url`/`preroll_urls`、`callback` 接收端、`playback_speed`/`use_subdir` 暴露、剧本还原结果写入项目（`script` 路径仅存档不消费）、跨项目批量、版本管理。
- 第二批报价注意：前贴时长计入输出时长，届时预授权上限须加 `max(前贴时长) × max_clip_count`。

## 2. 数据模型（新迁移，2 张表）

### `viral_edit_jobs`（migration 87）

| 字段 | 说明 |
|---|---|
| id / owner_user_id / drama_id | 定位；`UNIQUE(owner_user_id, idempotency_key)` |
| input_assets_json | **有序**输入清单快照 `[{seq, asset_id, local_path, duration_ms, bytes, resolution, tos_path}]`（seq=提交给算子的剧集序号） |
| params_json | 固化的算子参数：`{mode, min_clip_duration, max_clip_duration, max_clip_count, preset_intro, aspect_ratio, video_bitrate_kbps}` |
| input_json | 报价输入快照（含 ffprobe 规格、总时长、供应商 request 参数摘要） |
| provider_task_id / result_json | Poll 定位与完整 `data` 原文（含 storyboard、videos、script 路径） |
| authorization_id | 关联预授权 |
| status | 沿用 7 态：`queued/submitting/processing/finalizing/completed/failed/reconciliation`（CHECK） |
| lease_token / lease_until | 120s 租约 + 15s 心跳，与 las_media_jobs 同模式 |
| idempotency_key, error_msg, submitted_at, completed_at, created_at/updated_at | 同现有惯例 |
| tos_objects_json / tos_cleanup_at / tos_cleanup_attempts / tos_policy | 中转治理：登记 `{inputs:[{path,bytes}], outputs:[{path,bytes}], storyboard_json}`；`tos_policy='cleanup'` 仅新任务 |

### `viral_edit_outputs`（同 migration）

| 字段 | 说明 |
|---|---|
| id / job_id / clip_index | `UNIQUE(job_id, clip_index)`；clip_index 对应 `clip_001…` |
| provider_clip_id / provider_duration_sec / tos_path | 供应商返回字段 |
| local_path / file_size / width / height / duration_ms | 本地下载后的成片（finalizing 写入）；时长以本地 ffprobe 实测为准 |
| rating_summary_json | 该条素材聚合评级：`{rating_counts:{S,A,B,C}, avg_highlight_score, top_tags[], top_segments[]}`（由 timeline→storyboard 联查计算） |
| timeline_json | `clips[].timeline` 存储并富化分镜评级（ref/clip_start_sec/clip_end_sec/is_intro_dup + rating/highlight_score/content_desc），列表接口无需回带整份 storyboard |
| status | `pending/downloaded/failed/saved`；asset_id 保存为素材后回填 |
| created_at/updated_at | |

## 3. 计费（已按落地实现更新）

- **单模型双计量**：`service_type='video_postprocess'`、model `las-viral-clip-gen`、`provider='las'`，两个计量器——`millisecond`=输入分析（150 积分/分钟，`unit_size 60000`）、`second`=剪辑合成输出（6 积分/分钟，`unit_size 60`）。价目项 `UNIQUE(book, service_type, model, meter)` 决定一张价目书内同一 meter 只能一个单价，双计量器避免了双预授权的复杂度。
- 上游 1.5 / 0.06 元/分钟按 **1:1** 落为用户价目（100 积分 = 1 元）；由 migration 87 种子注入**所有已含 `las-video-translate` 的已发布价目书**（平台级与租户级都覆盖），幂等、不新建书、不动旧项。
- **mode 分档暂缓**：官方称输出单价按剪辑模式不同而不同，但未公布各模式真实价；且价目 `rates.when` 白名单校验器只放行 6 个字段（加 `mode` 需改共享校验器）。MVP 两模式扁平同价——不臆测运营商数字；拿到真实分模式价后，为输出项加 `rates` 并把 `mode` 加入 `validatePriceBookWindow` 白名单（增量，见 migration 87 头部注释）。
- **报价/预授权（后端全量计算，运营不填数字）**：
  - 冻结额 = `Σ输入 ffprobe 实测时长 × 分析单价` + `max_clip_count × max_clip_duration 秒 × 合成单价`（最坏情况上限）；
  - `createAuthorization`：idempotency_key=`viral:<ownerId>:<key>`，`reference_type='viral_edit_job'`。
- **结算**：供应商响应无 usage 字段 → 实际输出时长以本地 ffprobe 为准（与 `clips[].duration` 交叉校验，单条偏差 >1s 记日志），`settleAuthorization({millisecond: 输入实测, second: ceil(输出实测总秒)})`；超额补扣、余额不足转待对账；0 条成片时只结算输入分析并完成任务。
- **对账回写**：`syncLasReconciliationOutcome` / `recoverResolvedLasReconciliations` 泛化为 `RECONCILIATION_TASK_TABLES` 循环（`las_media_jobs` + `viral_edit_jobs`），处置后任务统一落 failed 并追加处置文案；`pagedReconciliationCases.source_task` 新增 `viral_edit_job` 投影（集数、输入总时长、供应商账单计费单元「视频智能剪辑」）。
- 提交前失败（TOS 上传）→ `voidAuthorization` 落 failed；Poll FAILED/TIMEOUT 或提交不确定 → 冻结转待对账、绝不自动重提（与本地化同规则）。

## 4. 输入校验与 MVP 上限（后端强制，报价前拒绝）

- 官方硬约束：单集 1s–600s、≤100 集、总时长 ≤2h、总大小 ≤10GB、**所有输入分辨率一致**且短边∈[360,1080]/长边∈[640,1920]、mp4/mov/avi/mkv。
- 本项目 MVP 保守上限（后端常量）：输入 ≤10 集、输入总时长 ≤30 分钟、`max_clip_count ≤10`、`min/max_clip_duration ∈ [5,300]` 且 min ≤ max、单条输出 ≤300s。
- 输入只允许该项目**已本地归档**的视频素材（`assets.local_path` 非空），复用 `assets` 取数（同 VideoLocalization 的 `videos()` 模式），不共用 `validateMedia`（阈值不同）。
- **应用内制作的剧集**：合并成片此前只写 `episodes.video_url`、不在素材表，投流选择器看不到。现已在 `processVideoMerge` 成功后登记为素材（`source_type='merged_final'`、`category='final'`、按 episode 幂等复用/更新、best-effort OSS 镜像、失败不改合并终态），成片因此对投流剪辑与视频本地化都可直接选用；成果页取数仍走 `episodes.video_url`，不产生重复展示。
- 字幕无法自动检测 → 创建页明示「输入需携带内嵌字幕，否则高光识别可能失效」。
- `video_bitrate_kbps` 由后端按短边映射官方分档取中值（360p:650 / 480p:1000 / 720p:2000 / 1080p:4000），不暴露给运营。

## 5. 后端服务与 API

- `lasOperatorClient`：`OPERATORS.viral='las_viral_clip_gen'`；`submitPayload` 加 viral 分支——**白名单式组装**（只发 §4 校验过的字段）；`outputPath` 继续按 `richidrama/las/<jobId>/viral/`；poll 复用。
- `lasTosBridge.objectKey` kind 白名单扩 `viral`。
- 新服务 `viralEditJobService`：`quote / create / get / list / processJob / resume / saveOutputAsAsset`。**不重构 `lasMediaJobService`**，编排逻辑允许少量重复，抽象等第二批有实测数据后再做。
- `processJob`（finalizing 多输出，与本地化「唯一 MP4」假设不同，独立实现）：
  1. 租约接管 → 按 `input_assets_json` 顺序上传 TOS；
  2. submit → 落 `provider_task_id`（落库失败即提交结果不确定 → 对账）；
  3. 30s 轮询至 COMPLETED/FAILED/TIMEOUT；
  4. 下载全部 `clips[].url` + `storyboard.json`（`data.script.storyboard_json_path` 与 `data.storyboard_json_path` 双路径兼容解析）到本地任务目录；`script_path`/`character_table_path` 仅记录进 `result_json` 不下载（第三批消费）；`preview_url` 不存储；
  5. 逐条 ffprobe 校验 → 写 `viral_edit_outputs` + 评级汇总 → 事务内结算 → 完成任务后按登记清单清理中转对象（清理失败不使任务变失败，走重试列）。
- 路由（`/api/v1`，鉴权 + 项目成员校验，注册于 `routes/index.js:484` 附近，实现见 `routes/viralEditJobs.js`）：
  - `POST /viral-edit-jobs/quote`（后端实测素材时长计算冻结上限）、`POST /viral-edit-jobs`（幂等 key）、`GET /viral-edit-jobs?drama_id=`、`GET /viral-edit-jobs/:id`（含逐条 outputs：`/static/...` 播放地址、评级汇总、富化时间线）
  - 成片与 storyboard.json 的读取走既有 `/static` 鉴权链路：`mediaAuthorizationService` 新增 `viral_edit_outputs.local_path`（downloaded/saved 才授权）与 `viral_edit_jobs.storyboard_local_path`（completed 才授权）两条 DEFINITIONS，与 LAS 字幕同模式，不设独立文件路由
  - `POST /viral-edit-jobs/:id/outputs/:clipIndex/save-asset`（勾选后 `assetService.create`，`source_type:'las'`，幂等回填 asset_id；OSS 镜像在任务完成时已按 `viral_edit_job` 登记）
- 恢复：`app.js` 挂 `viralEditJobService.resume`（setImmediate 驱动 + 30s setInterval；`submitting` 且租约过期只转对账）；对账案件处置回写复用 §3 的泛化同步；管理端 `lasSummary` 返回新增 `viral` 计数块（total/completed/failed/reconciling/active/pending_cleanup）。
- 错误映射：Poll FAILED 的 `business_code`（`ViralClipGen.*`、`Video.*`、`Connection.TooMany` 等）经 `translateProviderError` 译为中文入 `error_msg`；提交侧一切 HTTP 失败（含限流 400）一律转待对账，不做自动重试——保守优先。

## 6. 前端

- `DramaDetail.vue` 工作区 tab（36 行常量）加「投流素材」（v:'viral'，置于「成果」之后），新组件 `frontweb/src/components/ViralEditingWorkspace.vue`，纯展示/交互逻辑抽到 `frontweb/src/utils/viralEditing.js`（可单测）：
  - 创建流：多选本项目已归档视频 → **显式有序列表，可上下调序**（seq 语义）→ 目标条数/单条时长区间/mode/精彩前置/画幅（跟随输入|9:16）→ 展示后端报价（冻结额与依据）→ 提交；
  - 任务列表与详情：15s 轮询；逐条成片预览（本地鉴权 URL）/下载、评级分布（S/A/B/C + 钩子标签）、时间线条带展示（含 is_intro_dup 标记）；勾选「保存为素材」写回项目媒体库；计费状态/待对账提示沿用 VideoLocalization 卡片样式。
- 时间统一 `Asia/Shanghai`；三视口（1280×720 / 1440×900 / 1920×1080）滚动与遮挡验收。
- 管理端 `AIConfigContent.vue`：`video_localization` 的 LAS/TOS 配置被投流剪辑共用，页面文案注明（同地域同桶约束不变）；`OperationsScale.vue` 增加投流任务/待对账计数。
- API 封装新增 `frontweb/src/api/viralEditJobs.js`。

## 7. 线上兼容

- 全部为新建表、新路由、新价目项、加性分支；`las_media_jobs`、既有素材、既有对账案件、视频本地化页面零改动。
- 迁移前向兼容可重复执行；TOS 自动清理仅覆盖新表登记对象；历史任务不涉及。
- 真实冒烟须通过项目 HTTP API（带鉴权与计费），不在脚本/REPL 直调供应商。

## 8. 实施顺序与验收

1. 迁移 + 价目项草稿（含 mode 分档 rates）；
2. `lasOperatorClient`/`lasTosBridge` viral 分支单测（payload 白名单、多输入路径、objectKey kind）；
3. `viralEditJobService` 纯逻辑单测：报价/冻结公式、解析（含 storyboard_json 双路径）、结算交叉校验、状态机；
4. 路由 + 对账回写分支；仿 `lasReconciliation.integration.test.js` 补投流集成测试（含提交不确定、重启恢复、逐条下载与清理清单用例）；
5. 前端 tab + 页面：测试 + production build + 内置浏览器三视口验收；
6. 真实冒烟：项目 API 提交一次小素材任务（约 2 集 × 3 分钟 + 2 条输出，上游成本 ≈ ¥9.4，产生真实费用，执行前单独确认）；
7. 历史记录验证：既有本地化任务在对账分支改动后仍可正常处置。

## 9. 待拍板项

- 价目书两条新项的**对用户定价**（上游 ¥1.5/¥0.06 每分仅成本参考，两个 mode 的输出单价待定）；
- MVP 上限数值认可：≤10 集 / 总输入 ≤30 分钟 / ≤10 条 / 单条 ≤300s；
- 结算口径认可：无供应商 usage → 本地 ffprobe 实测输出时长结算、与响应 duration 交叉校验。

> 2026-09-24 拍板结果：定价 1:1（150/6 积分每分钟，mode 暂同价）、上限照案、结算口径照案。真实冒烟通过（603MB Vlog，实扣 883.84 积分，与逐项重算一致）。

## 10. 边界处置记录（2026-09-24）

- **大文件上传（A 方案）**：`/media/upload` 改 multer diskStorage 流式写 `storage/.tmp-uploads/`，rename 转正（EXDEV 回退复制）；签名读头 12 字节、sha256 流式；`LIMITS.video` 50MB→2048MB 且 multer/校验/`/upload-limits` 共用同一来源；`upload()` finally 清临时文件 + 启动清扫 >6h 残留；nginx 仅对 `/api/v1/media/upload` 精确放宽 2100m（配置文件已改，reload 属部署动作）。实测 87.5MB 上传 9.9s 通过。
- **失败任务中转回收**：`cleanupTransit` 终态口径从「仅 completed」扩为 `completed|failed`——failed 无结果需保护（预授权已释放或经对账终结），直接按登记清单回收；**reconciliation 仍不删**（提交不确定时供应商可能仍在读取输入）。viral 输入改逐集登记，中途上传失败不留未登记对象。两表 30s 清扫循环同扩 `failed`。
- **任务 API 治理字段**：`GET /viral-edit-jobs/:id` 详情新增 `tos: { policy, cleanup_at, cleanup_attempts }`。
- 未处理（观察项）：无字幕素材的评级质量需带真实剧集的运营反馈再评估。

## 11. 审查修复记录（2026-09-26，本地分支追加）

- **输入校验补长边 ≥640**：官方要求长边 ∈ [640,1920]，此前只校验短边，480×480 等文件会通过本地预检后被供应商拒绝、资金冻结转对账。
- **成片 ffprobe 与上传 sha256 改异步**：`registerMergedFinalAsset` 的 ffprobe 与 `fileChecksum` 原为同步调用，2GB 文件会阻塞事件循环数秒（回填循环逐集放大）；分别改 `execFile`（promisified）与 `stream/promises` 流式哈希。
- **上传临时文件兜底清理**：新增 `middleware/uploadTempBackstop`——multer 落盘后、handler 前被守卫拒绝的请求（403/409）不经过 `upload()` 的 finally，2GB 临时文件会残留到下次重启清扫；现于响应 `finish/close` 时幂等删除（成功路径已被 rename 走，无副作用）。
- **storyboard 限定任务前缀**：分镜下载路径从「任意 `tos://`」收紧为「本任务 `richidrama/las/<jobId>/` 前缀」，供应商响应指向其他任务对象时跳过分镜（记 warn）而不跨任务读取；成片仍按 outputPrefix 硬校验、违规转对账。
- **对账/失败任务的已下载成片可保存**：下载先于结算，对账结算收费后任务落 failed 但成片本地可用；`saveOutputAsAsset` 放开为按 output 状态（`downloaded`）判定，前端成片列表同步放开状态门槛；对账回写注释同步修正（viral 任务进入对账时可能已有本地成片）。
- **projectOperations 幂等哈希**：diskStorage 下 `req.file.buffer` 恒为 undefined（所有上传被判同一请求回放），改用 `size:originalname` 入哈希。
- **选择器体验**：「只看成片」过滤（`source_type='merged_final'`，默认关）+ 按集数排序；素材超过单页 100 条上限时内联提示截断；成片素材在媒体库归档确认中说明「仅从素材库隐藏，剧集成果页不受影响」；修复 viral tab 卸载后 15s 轮询泄漏（disposed 守卫）。
