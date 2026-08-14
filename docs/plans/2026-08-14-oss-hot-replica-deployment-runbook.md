# OSS 与本地热副本持久化部署基线

> 目的：本地部署与线上部署都采用“先落本地、镜像到 OSS、校验后按保留期清理本地热副本”的持久化模式。
> 安全原则：OSS 同步失败时绝不删除本地文件；完成态媒体始终通过应用鉴权路径读取，不能把供应商临时 URL 当成持久化结果。

## 1. 工作方式

1. 图片、音频、视频生成完成后先写入 `storage.local_path`。
2. OSS 模式下，后端异步镜像对象并写入 `media_archive_records`：对象 Key、ETag、同步状态、校验时间、重试信息、可清理时间。
3. 上传失败时状态为 `pending`，本地文件仍然可访问；定时任务重试镜像。
4. 到达保留期后，定时任务先 HEAD 校验 OSS 对象仍可读，校验成功才删除本地热副本并标记 `local_pruned`。
5. `/static` 优先读取本地；热副本被清理后，从 OSS 受鉴权代理读取。用户访问路径不变。

## 2. 必要配置

### 通用底层配置

```text
CFG_STORAGE__TYPE=oss
CFG_STORAGE__OSS__ENDPOINT=<OSS endpoint>
CFG_STORAGE__OSS__BUCKET=<private bucket>
CFG_STORAGE__OSS__PREFIX=local-mini-drama
CFG_STORAGE__OSS__ACCESS_KEY_ID=<secret>
CFG_STORAGE__OSS__ACCESS_KEY_SECRET=<secret>
CFG_STORAGE__OSS__PUBLIC_BASE_URL=<optional CDN domain>
CFG_STORAGE__OSS__AUTO_ARCHIVE_ENABLED=true
CFG_STORAGE__OSS__LOCAL_RETENTION_DAYS__VIDEO=14
CFG_STORAGE__OSS__LOCAL_RETENTION_DAYS__IMAGE=30
CFG_STORAGE__OSS__LOCAL_RETENTION_DAYS__AUDIO=30
```

部署容器也可使用兼容别名 `MINIDRAMA_STORAGE_TYPE`、`MINIDRAMA_OSS_*`；后端会映射至同一组 `CFG_STORAGE__...` 配置。密钥只能放入忽略的部署环境文件或密钥管理系统，不能提交到 `config.yaml`、仓库或前端。

## 3. 当前核验状态（2026-08-14）

| 环境 | OSS 类型 | 自动归档 | 证据 |
|---|---|---|---|
| 本地服务 | 已启用 | 已启用 | 进程启动日志显示 `CFG_STORAGE__TYPE=oss` 与 `CFG_STORAGE__OSS__AUTO_ARCHIVE_ENABLED=true` |
| 线上 `local-minidrama` 容器 | 已启用 | 已启用 | `MINIDRAMA_STORAGE_TYPE=oss`、`MINIDRAMA_OSS_AUTO_ARCHIVE_ENABLED=true`；归档数会被后台任务持续推进，核验时按媒体类型与视频任务关联查询 |

线上容器挂载 `/data/minidrama-data` 到 `/app/backend-node/data`，其本地卷仍作为热副本和 SQLite 持久化载体。抽样记录已具备 `verified_at` 与 `local_delete_after`，视频默认保留期为 14 天。归档指标是实时值，验收时必须同时查询 `media_archive_records` 的 `source_type` 和 `video_generations` 的关联状态；不能把两张表的总数直接比较。

## 4. 发布与验收

1. 先以 `node src/scripts/migrateMediaToOss.js --dry-run` 统计已有本地文件；不得在 dry-run 阶段删除任何文件。
2. 确认 bucket、endpoint、前缀和最小权限凭证后，启用 OSS 与自动归档。
3. 上传或生成一条测试媒体，检查本地文件、`media_archive_records.oss_synced`、对象可读校验和应用 `/static` 访问。
4. 将测试记录的 `local_delete_after` 调整到可控的测试时间后，验证仅在 OSS HEAD 成功时清理本地，并确认 `/static` 可从 OSS 继续受鉴权读取。
5. 检查 `pending` 数量、归档错误和本地磁盘容量；失败记录必须保留本地副本，直到重试成功。

## 5. 禁止事项

- 不得根据目录扫描或文件年龄直接删除本地媒体。
- 不得将供应商签名 URL 存作完成态视频、素材库或成片的兜底地址。
- 不得把 OSS 凭证写入版本控制文件、前端代码、日志或验收文档。
- 不得因开启 OSS 而重算历史账单、修改历史素材引用或删除线上既有媒体。
