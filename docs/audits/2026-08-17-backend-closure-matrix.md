# 2026-08-17 后端闭环覆盖矩阵

本审计只覆盖通过项目 HTTP API 启动的异步视频链路；没有发起任何供应商请求。

| 任务/阶段 | 生产与持久化 | 恢复器 | 受控重试/处置 | 消费者与可观测性 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 原视频生成 | `videoService.create/processVideoGeneration` 写入 `video_generations` 和供应商任务 ID | `resumeProcessingVideoGenerations` 仅恢复已保存 ID；空 ID 收敛为 `retryable` | 用户视频/Omni 重试路由 | 分镜、自由创作、素材库读取本地持久化路径；运营生产列表/详情 | `taskService.test.js`、`videoPersistence.test.js` |
| 超分 | `videoUpscaleService.process` 写入独立 job、授权和本地输出 | `videoUpscaleService.resumePending` | `retryFromSource` 只用原片，释放失败授权后再预授权 | Omni 后处理入口、运营阶段时间线 | `videoUpscale.test.js` |
| 插帧 | `videoInterpolationService.process` 写入独立 job、授权和本地输出 | `videoInterpolationService.resumePending` | `retryFromSource` 只用超分片/原片 | Omni 后处理入口、运营阶段时间线 | `videoInterpolation.test.js` |
| 归档 | `media_archive_records` 是归档事实来源；视频本地副本独立保留 | `resumePendingVideoArchives`、周期归档重试 | 仅归档重试，不改变视频完成态 | 媒体与存储工作台、生产详情 | `mediaStorageOss.test.js` |
| 计费/对账 | 预授权、usage、账本和对账案件分表持久化 | `recoverCompletedVideoReconciliations` | 既有结算/豁免 API 幂等且留审计 | 待对账工作台、运营总览 | `authBilling.test.js`、`omniBillingUsage.test.js` |
| SD2 认证/等待生成 | 认证请求与快照持久化 | `resumePendingCertifications`、`startSd2WaitingGenerationRecovery` | 认证恢复不重新提交已存在供应商任务 | 资源/Omni 详情 | `assetSd2Async.test.js`、`omniVideoRecovery.test.js` |

## 本轮新增运营合约

- `GET /api/v1/admin/overview`
- `GET /api/v1/admin/production`
- `GET /api/v1/admin/production/:id`
- `GET /api/v1/admin/media-archives`
- `GET /api/v1/admin/billing-reconciliations`（支持 `status`、`user_id`、`model`、`from`、`to`、`page`、`page_size` 过滤和分页）
- `GET/PATCH /api/v1/admin/operations-alert-settings`（本地持久化的告警阈值）
- `GET /api/v1/admin/production-export`（最多 10,000 条、UTF-8 CSV；复用生产筛选条件）
- `GET /api/v1/admin/operations-reports`（每天按 `Asia/Shanghai` 日期保存一条本地汇总快照）

受控处置复用已有服务，不直接调用供应商：

- `POST /api/v1/admin/production/:id/retry-postprocess`
- `POST /api/v1/admin/production/:id/adopt-source`
- `POST /api/v1/admin/production/:id/retry-archive`

所有入口均受 `requireAdmin` 保护；管理员即运营人员，不设置独立运营角色。只读投影使用 SQLite 聚合；处置接口要求确认、原因与幂等键，调用已有阶段重试、原片采用或归档服务并写入审计。历史记录默认只读兼容；没有 Omni 关联的历史视频不会被运营台阶段重试或采用原片。待对账的旧数组服务保留给既有消费者，新运营接口使用分页投影，避免扩大响应而破坏旧调用方。

规模化运营告警仅聚合本地任务、归档与对账记录：长时间未更新、模型连续失败、待对账和归档失败。阈值由管理员通过本项目 API 保存；告警计算、导出和每日快照都不会轮询或调用供应商。每日快照按日期幂等更新，历史日期不会被批量重算。

新行为仅作用于运营读取、导出和发布后每次服务启动/每日生成的报表快照；不会修改历史视频、媒体归档记录、账本流水、待对账案件或供应商任务。历史记录仍沿用原有读取与恢复路径。
