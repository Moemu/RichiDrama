# LAS 视频本地化接入

本功能提供两个独立任务：字幕擦除、视频翻译配音。用户可以把擦除后的项目素材作为翻译输入。投流智能剪辑不在本次范围。

## 存储与权限

项目最终成片继续使用现有本地／阿里云 OSS 媒体路径。LAS 中转单独使用火山引擎 TOS。不能把阿里云 OSS Bucket 当成 `output_tos_path`。

在后端运行环境设置以下变量，不要把密钥写入仓库或浏览器：

| 变量 | 用途 |
| --- | --- |
| `LAS_REGION` | LAS 与 TOS 的同一地域；当前约定 `cn-beijing` |
| `LAS_API_KEY` | LAS 算子 API Key |
| `LAS_TOS_BUCKET` | 与 LAS Key 同主账号、同地域的私有 TOS Bucket |
| `LAS_TOS_ACCESS_KEY_ID` | 仅允许读写该 Bucket 下 `richidrama/las/` 前缀的受限 AK |
| `LAS_TOS_SECRET_ACCESS_KEY` | 对应受限 SK |

当前中转使用 TOS V4 签名的原生 HTTP 请求，不依赖供应商 SDK。输入文件上传到 `tos://<bucket>/richidrama/las/<job-id>/input/source.mp4`。两个算子分别写入 `translate/` 与 `inpaint/`。完成后，后端将 MP4 和可用的 SRT 下载到项目本地存储，并登记为项目素材。没有进行自动 TOS 清理。

TOS Bucket、凭证或 LAS Key 缺失时，任务提交会在预授权前失败。`GET /api/v1/las-media-jobs/capabilities` 只返回配置是否齐全，不返回密钥。

## 价目与付费门槛

上线前，管理员须根据当前合同价发布价目表。不得直接套用海外 BytePlus 的美元展示价。三个价目项均使用服务类型 `video_postprocess`、供应商 `las`、计量器 `millisecond`、`conditions_json.unit_size = 60000`：

- `las-video-translate`：每分钟翻译配音价格；当前仅单目标语言且关闭口型翻译。
- `las-video-inpaint-lite`：快速版标准字幕擦除每分钟价格。
- `las-video-inpaint-pro`：专业版标准字幕擦除每分钟价格。

前端先展示报价，再要求用户确认。本项目 API 创建任务时再次读取本地视频规格、核对价目和余额、创建预授权，然后才向 LAS 提交。翻译按输入时长结算；擦除按本地归档输出的时长、帧率和分辨率系数结算。供应商任务 ID 与结果持久化。提交结果不确定或进程在提交中断时转待对账，不自动重提。

## 当前边界与验收

首版只接受已本地归档的项目视频，单文件不超过 5GB、分辨率不超过 1080p、帧率不超过 30fps。翻译视频须带音轨且为 10 秒至 4 小时；擦除视频须为 1 秒至 3 小时。超出范围在提交前拒绝。

自动化测试使用隔离 SQLite、模拟 LAS 和模拟 TOS，覆盖认证、幂等、擦除→翻译、媒体归档、结算和重启读取。尚未在真实 LAS/TOS 上做付费验收。真实验收应先核对 Bucket 权限、价目与测试额度，再通过项目 HTTP API 使用一段短测试视频。不能直接运行供应商脚本代替项目调用。

接口依据：[LAS 视频翻译](https://docs.byteplus.com/en/docs/Byteplus_LAS/Video_Translation_operator)、[LAS 视频修复](https://docs.byteplus.com/en/docs/Byteplus_LAS/Video_Inpaint-Pro)、[TOS V4 签名机制](https://www.volcengine.com/docs/6349/74839?lang=en)。
