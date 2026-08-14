# 素材资源隔离与全视频插帧闭环改造方案

> 日期：2026-08-13
> 状态：已实施并完成自动化、真实供应商、计费与重启恢复验收
> 范围：素材上传/映射/分镜引用、全局与项目素材库、视频生成与本地持久化、Seedance 2.x 素材认证、AI MediaKit 视频插帧、积分预授权/结算/对账、重启恢复。

## 1. 审计结论

### 1.1 为什么“解除关联后还能恢复”

当前系统同时存在两套资源模型：

1. `assets` 保存真实媒体文件，并被 `storyboards.omni_asset_ids`、首尾帧字段、`omni_video_job_assets` 引用。
2. `characters/scenes/props` 保存项目实体及其图片字段；`assetMappingService` 又把实体图片投影成 `source_type=project_resource` 的 `assets`。
3. `character_libraries/scene_libraries/prop_libraries` 还各自保存一份“项目库/全局库”快照，形成第三份事实来源。

旧实现把项目实体投影视为可重建缓存：读取 `/assets?drama_id=...` 会执行 `syncDramaAssets()`，分镜选择实体图又可能创建匿名 `assets`。因此用户软删除投影后，只要再次读取或选择实体，记录就会重建；历史分镜仍保存旧 `asset_id`，又会造成“卡片恢复、引用失联、认证状态随机变化”的组合问题。

当前工作树已经加入“已软删投影优先作为墓碑”的保护，能阻止同一映射被自动重建，但闭环仍不完整：

- 解除关系与删除真实素材仍共用 `DELETE /assets/:id`，语义不清；
- 没有独立关系表和唯一约束，关系主键藏在 `metadata_json`；
- 前端 `reconcileUnavailableStoryboardAssets()` 会把暂时不可见或已解除关系的素材从历史分镜静默移除；
- 项目资源图片更新仍可能覆盖同一个资产，而不是创建文件版本；
- `character_libraries/scene_libraries/prop_libraries` 没有 `owner_user_id`，其路由也没有完整的所有权守卫。

### 1.2 为什么全局素材和项目素材看起来一样

后端 `assetService.list()` 已支持严格的 `scope=project&drama_id=...` 与 `scope=global`，但消费者没有统一使用：

- `FilmCreate.loadAllUniversalLibraryAssets()` 请求 `/assets` 时没有 scope；
- `MediaLibrary.loadMedia()` 请求 `/assets` 时没有 scope；
- `ToolAssetSelector` 也没有 scope；
- 无 scope 的兼容分支返回“该用户直接拥有的全局素材 + 该用户所有项目下的素材”。

所以不是数据库已经合并，而是 UI 使用了联合查询，并把联合结果标成“素材库”。`FreeCreate` 已经分别请求 project/global 后再合并，是目前唯一显式表达两层作用域的入口。

角色/场景/道具的三张 library 表本身用 `drama_id IS NULL` 表示全局、`drama_id = ?` 表示项目，数据层可区分；但它们复制相同源实体的图片和文字，所以“分别加入两库”会得到内容完全相同的两条快照。这种复制模型天然产生同步、删除、认证与所有权漂移，不能作为长期核心模型。

### 1.3 最优资源模型

采用“媒体事实 + 作用域/关联 + 引用 + 版本”四层模型：

- `assets`：不可变媒体事实。保存本地持久化路径、校验和、媒体元信息、SD2 认证、父版本；完成态不得依赖供应商签名 URL。
- `asset_resource_links`：项目实体与素材的关系，字段包括 `owner_user_id/drama_id/resource_type/resource_id/role/asset_id/status`；唯一键为 `(drama_id, resource_type, resource_id, role)`。
- 分镜/任务引用：继续引用稳定 `assets.id`，解除项目关系不能改写历史引用。
- 版本：替换实体图片时创建新 `assets` 并设置 `parent_asset_id`，只切换 link；历史分镜继续引用旧版本。

作用域规则：

| 入口 | 查询语义 |
|---|---|
| 全局素材库 | `scope=global`，仅当前用户、`drama_id IS NULL` |
| 当前项目素材库 | `scope=project&drama_id=N`，仅该项目 |
| 分镜素材选择 | 两个分组：当前项目 + 我的全局；允许显式复用全局素材，不把它复制成项目素材 |
| 管理全部素材 | `scope=all`，仅用于媒体管理页，并明确显示来源项目 |

删除语义：

- “解除资源关联”：把 link 置为 `detached`，不删除 asset，不改历史分镜。
- “从当前项目移除”：仅当没有项目引用时归档项目资产；否则返回引用位置。
- “从我的全局库删除”：软归档 asset；有分镜/任务引用时禁止硬删。
- “重新关联”：必须是显式 API/按钮，将 link 从 `detached` 改回 `active`；普通同步永不恢复。

## 2. 火山引擎视频插帧官方事实

官方文档（核验于 2026-08-13）：

- 专用 API：`POST https://mediakit.cn-beijing.volces.com/api/v1/tools/video-frame-interpolation`
- 鉴权：`Authorization: Bearer {AI MediaKit API Key}`，与方舟/Seedance Key 是独立配置边界。
- 请求：`video_url`、`fps`；可选 `media_output_destination`、`idempotency_key`、回调参数和队列。
- 帧率：15–120fps，建议目标不超过源帧率 4 倍。
- 异步：提交返回 `task_id/request_id`；轮询 `GET /api/v1/tasks/{task_id}` 或接收回调。
- 完成结果：`result.video_url/duration/resolution/fps`；默认 HTTPS 下载地址仅 24 小时有效，必须立即下载并持久化。
- 计费：按输出时长（官方底层精确到毫秒）、输出短边分辨率档位、输出 fps 计费；基准价 0.6 元/分钟。

按项目 `100 积分 = 1 元` 换算：

| 输出规格 | ≤30fps | 31–60fps | 61–120fps |
|---|---:|---:|---:|
| ≤720P | 60 积分/分钟 | 120 | 240 |
| ≤1080P | 120 | 240 | 480 |
| ≤2K | 240 | 480 | 960 |
| ≤4K | 480 | 960 | 1920 |

修正后的默认策略为不插帧（`target_fps=null`）：只有用户在分镜镜头配置中显式选择 60/120fps 才创建 MediaKit 插帧任务并计费。插帧不改变分辨率；后台价目中的 fps 档位只是计费条件，不代表前端默认开启。

官方来源：

- https://www.volcengine.com/docs/6448/2624391?lang=zh
- https://www.volcengine.com/docs/6448/2486473?lang=zh
- https://www.volcengine.com/docs/6448/2278532?lang=zh

## 3. 插帧核心链路设计

### 3.1 状态机

`video_generations` 的用户可见完成态必须表示“最终插帧版本已本地持久化”：

```text
processing_generation
  -> downloading_source
  -> interpolation_queued
  -> interpolating
  -> downloading_interpolated
  -> completed

任一步失败 -> failed（保留内部源文件与可审计错误，不把未插帧源片伪装为完成成片）
```

独立 `video_interpolation_jobs` 保存 `video_generation_id`、目标 fps、输入/输出规格、供应商 task/request id、状态、尝试次数、插帧计费授权、错误和 UTC 时间；原视频生成授权仍保存在 `video_generations`。唯一约束保证每个生成版本只有一个默认插帧任务，不能重复扣费。

### 3.2 持久化与恢复

1. 视频供应商完成后，先把源片下载到本地临时/源版本路径。
2. 使用已持久化的本地源片走 MediaKit 官方上传协议取得 `mediakit://` 文件 ID，再提交插帧；不能把 localhost 或供应商临时 URL 当成可恢复输入。
3. 插帧完成后立刻下载 24 小时临时结果到项目 `videos/`，原子更新 `local_path/video_url/completed_at`。
4. 生成海报、同步 storyboard、写 task result、创建/复用 `assets`、再触发 OSS 镜像。
5. 启动时恢复 `queued/submitted/processing/downloading`；已有 `provider_task_id` 只轮询，绝不重新提交；只有明确“尚未提交且有可重放输入”才提交。
6. 完成记录若没有本地文件，降级为 failed/待修复，绝不回退到供应商签名 URL。

### 3.3 SD2 认证边界

SD2 认证仍属于输入图片内容，保存在 `assets.seedance2_asset`；它只影响 Seedance 生成前置阶段。视频生成供应商和插帧服务使用不同凭据、不同授权、不同请求 ID：

- Seedance：`service_type=video`，方舟配置，输出 token 或既有 meter 结算。
- SD2 资产认证：`jimeng2_character_auth/model_ark_asset`，不与插帧 Key 混用。
- AI MediaKit 插帧：新增 `service_type=video_postprocess`，独立 API Key 和 `billing_key=volcengine-video-frame-interpolation`。

### 3.4 积分闭环

在原始视频供应商调用前，同时完成两笔独立预授权：

1. 视频生成预授权（现有）。
2. 仅当 `target_fps` 非空时创建插帧预授权：按请求时长、最终分辨率和用户选择的目标 fps 取匹配档位，使用 `millisecond` meter 保存毫秒级时长；关闭插帧时不创建任务、不冻结积分。

结果处理：

- 生成失败且未提交插帧：两笔授权均释放。
- 生成成功：生成授权按供应商 usage 结算或进入待对账。
- 插帧提交失败：插帧授权释放；整条成片失败，不把源片标为 completed。
- 插帧完成：使用官方返回的 `duration/resolution/fps` 结算；保存 MediaKit `request_id`。
- 返回规格导致实际费用超过预授权：不静默截断为少扣；进入待对账并阻断同模型累计风险，管理员可补录。
- 重启：已结算/已释放授权幂等复用；悬挂授权恢复为待对账或按明确未调用证据释放。

## 4. 数据库与 API 改造

### 4.1 数据库

- 新增 `asset_resource_links`，迁移历史 `project_resource` metadata，保留软删墓碑。
- `assets` 增加必要的归档/引用检查索引；不复制 SD2 状态到关系表。
- 新增 `video_interpolation_jobs`。
- `video_generations` 增加 `source_local_path/interpolation_job_id/interpolation_status/target_fps/interpolation_billing_authorization_id`。
- 计费 meter 增加 `millisecond`，官方价目写入发布中的系统价目表；条件使用 `resolution/fps_tier`。
- `ai_service_configs` 允许 `video_postprocess`，默认唯一性检查覆盖该类型。

### 4.2 HTTP API

- `GET /assets`：保留无 scope 的后向兼容联合查询，但所有现有 UI 消费者必须显式传 scope；项目页传 project，全局/工具页传 global，需要联合展示时分别查询后分组。
- `POST /assets/project-resource-link`：只读取/创建 active link；detached 返回 409。
- `DELETE /assets/:id`：若目标是 `project_resource`，仅把关系置为 detached；普通素材仍执行软删除。
- `GET /asset-resource-links?drama_id=N&status=detached`：展示可审计的已解除关系。
- `POST /asset-resource-links/:id/restore`：显式恢复。
- `GET /assets/:id/references`：返回分镜、任务、实体 link 引用数和位置。
- 插帧没有面向前端绕过核心链路的“直接供应商调用”接口；所有默认视频由现有 `/api/v1/videos`、`/api/v1/omni-video-jobs` 进入并携带登录态、业务 ID 和两笔预授权。

## 5. 前端改造

- `FilmCreate` 分别加载 `scope=project` 与 `scope=global`，合并展示时显式标注“当前项目素材/我的全局素材”，不再使用无 scope 联合查询。
- 独立 `MediaLibrary` 定义为“我的全局素材库”并默认严格 global；当前项目素材在项目素材阶段管理，避免缺少项目上下文时再次混库。
- 删除项目投影改调 detach API；普通 asset 删除前展示引用摘要。
- 删除 `reconcileUnavailableStoryboardAssets()` 的静默写回行为：不可见引用显示“已解除/待修复”，由用户显式替换或移除。
- 视频卡显示 `生成中 → 插帧中 → 持久化中 → 完成`，刷新后从后端状态恢复；完成视频始终使用 `/static/{local_path}`。
- AI 配置页增加“火山 AI MediaKit 视频插帧”类型，字段只需 Base URL、API Key、目标 fps/队列等 settings，不暴露 Key 给普通用户接口。

## 6. 强制影响面覆盖

已用 `rg` 检查：

- 前端：`FilmCreate.vue`、`FreeCreate.vue`、`MediaLibrary.vue`、`ToolAssetSelector.vue`、`libraryMembership.js`、`omniVideo.js`、`videos.js`、生成任务 store 与视频展示组件。
- 后端路由：`assets.js/upload.js/videos.js/omniVideo.js/storyboards.js`，三类 library 路由及所有权中间件。
- 后端服务：`assetService/assetMappingService/*LibraryService/uploadService/omniVideoService/videoService/videoClient/mediaStorageService/assetSd2Service/jimengMaterialHubService/billingService/billingUsageService/aiConfigService`。
- 数据/恢复：`assets/video_generations/storyboards/omni_video_jobs/omni_video_job_assets/ai_service_configs/billing_*` 迁移和 `app.js` 启动恢复。
- 测试：`assetService/assetMappingCertification/libraryDedup/ownershipGuard/videoPersistence/videoUsage/authBilling/assetSd2Async/volcOmniVideo`。

## 7. 验证矩阵

### 自动化

- 素材 scope：用户隔离、项目 A/B 隔离、全局不包含项目、all 仅返回本人可管理项。
- 解除：同步/刷新/重启/分镜再次打开均不自动恢复；显式 restore 才恢复。
- 引用：解除不删除历史分镜；被引用资产删除返回冲突；版本替换不改旧引用。
- SD2：空实体认证不覆盖 asset active；图片换版本置 stale；重启继续 processing。
- 插帧 client：请求字段、Bearer、幂等键、轮询完成/失败、临时 URL 下载。
- 状态机：仅显式开启插帧的视频经过插帧阶段；关闭时持久化为 `skipped`，重复 worker/重启不重复提交。
- 计费：分辨率/fps 全档位、毫秒用量、预授权不足、失败释放、完成结算、超授权待对账、幂等。
- 持久化：完成记录只有本地路径；刷新与模拟重启后仍能读取最终视频和海报。

### 命令

```bash
cd backend-node && node --test test/*.test.js
cd frontweb && node --test test/*.test.js
cd frontweb && npm run build
```

真实供应商验收只能通过项目 HTTP API，使用登录态和业务请求 ID；不得在脚本、REPL 或测试中直接调用供应商。验收前须配置 AI MediaKit Key、发布价目、足额积分，并以 `CFG_IMAGE_PROXY__USE_FOR_VIDEO=false` 启动本地后端。验收记录必须包含两段供应商 request id、两笔授权/结算、最终本地路径、刷新后播放和重启后恢复。

## 8. 上线与回滚

1. 先部署只读兼容迁移和新价目；校验历史 links、重复投影和失联引用报表。
2. 再启用严格 scope 与显式 detach；观察 409/引用失联指标。
3. 配置并测试 AI MediaKit 后开放按需插帧选项；默认保持关闭。用户显式开启但缺少 Key/价目时拒绝创建新视频，不能静默跳过。
4. 回滚时可关闭新任务入口，但已提交插帧任务的轮询和持久化 worker 必须继续运行，直到终态；不得把源片批量标成 completed。

## 9. 完成定义

- 全局和项目素材列表在数据、API、UI 上均可证明隔离。
- 解除关联经过刷新、同步、重启和再次选择都不会自行恢复；显式恢复可审计。
- 历史分镜引用不被静默清理，引用文件可持久读取。
- 新视频在所有“已选择”的后处理阶段完成并本地持久化后才是 completed；未选择插帧时必须记录为 `skipped` 且不得产生插帧费用。
- Seedance、SD2 认证、MediaKit 三套鉴权边界清晰。
- 两段调用分别预授权、结算/释放/待对账，供应商 request id、价目快照和账本完整。
- 后端/前端测试、production build、刷新/重启读取验证全部通过。

## 10. 实施与验证记录

本次已落地：

- 迁移 `52_asset_links_video_interpolation.sql`：显式资源关系、插帧任务、视频源/终态字段、毫秒计量与官方条件价目；旧库 meter CHECK 由启动迁移安全扩展。
- 素材：项目资源解除写入 durable tombstone，普通同步不再回生；FilmCreate 可查看“已解除”并显式恢复；分镜不可见引用只告警、不再静默写回删除。
- scope：FilmCreate 分别请求项目/全局，MediaLibrary 默认全局，FreeCreate 保持显式 project/global；后端继续用项目所有权守卫。
- 插帧：`/videos` 与 `/omni-video-jobs` 在提交生成前完成第二笔预授权；源片本地归档后上传 MediaKit、持久化 task/request ID、轮询、下载最终片并只暴露 `/static/`；启动恢复 pending/processing 及有源片的 awaiting_source。
- 计费：生成与插帧分别结算；失败按调用边界释放；实际规格超过预授权时进入 `billing_reconciliation`，不静默少扣或把源片标为 completed。
- 配置：AI 配置页新增 `video_postprocess`/火山 AI MediaKit、独立 Key、固定 billing key 和 15–120fps 目标帧率。

验证结果（2026-08-13）：

- 后端 `139/139` 通过；覆盖 scope、detach/restore、插帧条件价目、毫秒预授权、供应商任务/请求 ID 持久化、本地结果、精确结算、重放幂等和 awaiting_source。
- 前端 `27/27` 通过。
- `npm run build` 通过；仅保留既有大 chunk 提示。
- 使用独立验证数据库、`CFG_IMAGE_PROXY__USE_FOR_VIDEO=false` 启动成功，`GET /health` 返回 ok；验证后正常关闭。

该段在 2026-08-13 首次实现时尚未执行真实供应商调用；2026-08-14 已补齐真实闭环验收。调用从登录后的 `/api/v1/videos` 发起，没有直连供应商：`video_generations.id=61` 的 Seedance 原片与 MediaKit 1080p 超分均成功、本地持久化并独立结算；插帧按修正后的默认策略关闭，任务/授权/usage 均为 0。服务重启后最终文件可 Range 播放，供应商任务与账本没有重复。完整 request ID、规格和积分证据见 `2026-08-13-video-resolution-upscale-frame-interpolation-remediation.md` 第 12.2 节。
