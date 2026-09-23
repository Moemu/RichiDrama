# LAS 视频本地化接入

本功能提供两个独立任务：字幕擦除、视频翻译配音。用户可以把擦除后的项目素材作为翻译输入。投流智能剪辑不在本次范围。

## 存储与权限

项目最终成片继续使用现有本地／阿里云 OSS 媒体路径。LAS 中转单独使用火山引擎 TOS。不能把阿里云 OSS Bucket 当成 `output_tos_path`。

配置入口是管理端「AI 配置」→「专用服务」→ 新增「视频本地化（字幕擦除 / 翻译配音）」。不再使用后端环境变量。

| 表单项 | 存放位置 | 说明 |
| --- | --- | --- |
| LAS 算子 API Key | `ai_service_configs.api_key` | 提交与查询算子任务使用；回显时脱敏 |
| LAS 与 TOS 地域 | `settings.region` | 一处同时约束算子与 TOS，算子接入地址由它推导 |
| TOS Bucket | `settings.tos_bucket` | 与 LAS Key 同主账号、同地域的私有 Bucket |
| TOS AccessKey ID | `settings.tos_access_key_id` | 仅允许读写该 Bucket 下 `richidrama/las/` 前缀的受限 AK |
| TOS Secret AccessKey | `settings.tos_secret_access_key` | 对应受限 SK |

该配置行的 `service_type` 为 `video_localization`、`provider` 为 `las`，与超分／插帧使用的 `video_postprocess` 行互不选取。地域与 Bucket 只有一份来源，因此算子与 TOS 不可能被配成两个不同的桶。

当前中转使用 TOS V4 签名的原生 HTTP 请求，不依赖供应商 SDK。输入文件上传到 `tos://<bucket>/richidrama/las/<job-id>/input/source.mp4`。两个算子分别写入 `translate/` 与 `inpaint/`。完成后，后端将 MP4 和可用的 SRT 下载到项目本地存储，并登记为项目素材。没有进行自动 TOS 清理。

未新增该配置、取消勾选「启用」，或必填项不完整时，任务提交在预授权前失败。有多条启用的配置时，须明确指定唯一默认配置，防止任务使用旧测试 Bucket。`GET /api/v1/las-media-jobs/capabilities` 只返回配置是否齐全与地域，不返回密钥。

与既有的可灵官方 AK/SK、SD2 资产库配置一样，`settings` 以明文存放在数据库中，并在管理端回显；`api_key` 列单独做脱敏。因此授予 TOS 凭证时必须限制到该 Bucket 与 `richidrama/las/` 前缀。

## 价目与付费门槛

上线前，管理员须在「运营台 → 价目表」发布价目。不得直接套用海外 BytePlus 的美元展示价。三个价目项均使用服务类型 `video_postprocess`、计量器 `millisecond`、`conditions_json.unit_size = 60000`（每分钟），并在草稿表单里把「供应商归属」选为 **火山引擎 LAS 在线算子**（`provider = 'las'`）：

- `las-video-translate`：视频翻译算子，1.5 元/分钟 → **150 积分/60000ms**；当前仅单目标语言且关闭口型翻译，面容翻译（4 元/分钟）未启用、不设价目。
- `las-video-inpaint-lite`：字幕擦除（标准版），0.4 元/分钟 → **40 积分/60000ms**。
- `las-video-inpaint-pro`：字幕擦除精细版，1.0 元/分钟 → **100 积分/60000ms**。

操作路径：新建价目草稿（标注供应商 `las`）→ 保存草稿 → 行内「发布」→ 确认并填写原因。已发布价目不可原地修改；调价用「复制为新版本」，发布新版本时会归档前版并把分组绑定改指过去。带 `provider='las'` 标签的价目只服务 LAS 调用，发布它不会触碰平台火山/中转系统价目；但「项目分组」里以兜底（未标供应商）方式绑定旧价目书的分组，仍需显式增加一条 `las` 绑定才能取到 LAS 价格。

前端先展示报价，再要求用户确认。本项目 API 创建任务时再次读取本地视频规格、核对价目和余额、创建预授权，然后才向 LAS 提交。翻译按输入时长结算；擦除按本地归档输出的时长、帧率和分辨率系数结算。供应商任务 ID 与结果持久化。提交结果不确定或进程在提交中断时转待对账，不自动重提。

## 当前边界与验收

首版只接受已本地归档的项目视频，单文件不超过 5GB、分辨率不超过 1080p、帧率不超过 30fps。翻译视频须带音轨且为 10 秒至 4 小时；擦除视频须为 1 秒至 3 小时。超出范围在提交前拒绝。

## 对账处置闭环

任务转待对账后（提交结果不确定、供应商失败/超时、输出超已报价规格），运营台「对账」队列的每条 LAS 案件都带任务定位：阶段与档位、目标语言、项目、任务当前状态、供应商任务 ID（HTTP 失败时从响应头 `x-request-id` 提取并写入案件原因）、预授权 ID 与冻结积分、TOS 中转路径和已归档文件。结算弹窗按这些字段核验后再补录用量。

管理员结算、豁免或案件超时释放后，后端同步把对应任务从 `reconciliation` 落为终态 `failed`（对账案件没有已归档成片，不自动重提），并把处置结果追加进任务错误信息，用户在「视频本地化」页刷新即可看到。若处置与任务同步之间进程中断，启动与 30 秒恢复轮询会补偿对齐；重复处置幂等，未处置案件的任务不会被改动。结算产生的消耗照常写入 `billing_usage_logs`，消耗控制台与项目用量可见。

自动化测试使用隔离 SQLite、模拟 LAS 和模拟 TOS，覆盖认证、幂等、擦除→翻译、媒体归档、结算和重启读取；`backend-node/test/lasReconciliation.integration.test.js` 覆盖案件定位投影、结算/豁免/超时三条处置路径的用户可见状态同步、重复处置与重启补偿。运行中的任务每 15 秒续期一次，两分钟内未续期的租约可由恢复轮询接管；提交结果不确定的任务转待对账。`backend-node/tools/seed-las-test-media.js` 仅通过项目 API 上传本地测试素材，运行前需设置 `LAS_SEED_USERNAME` 和 `LAS_SEED_PASSWORD`，不会提交 LAS 任务。

尚未在真实 LAS/TOS 上完成付费验收。真实验收应先核对 Bucket 权限、价目与测试额度，再通过项目 HTTP API 使用一段短测试视频。不能直接运行供应商脚本代替项目调用。

接口依据：[LAS 视频翻译](https://docs.byteplus.com/en/docs/Byteplus_LAS/Video_Translation_operator)、[LAS 视频修复](https://docs.byteplus.com/en/docs/Byteplus_LAS/Video_Inpaint-Pro)、[TOS V4 签名机制](https://www.volcengine.com/docs/6349/74839?lang=en)。
