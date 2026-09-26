# LAS 爆款素材剪辑算子（las_viral_clip_gen）接口契约镜像

> 来源：BytePlus LAS 官方文档《爆款素材剪辑》（https://docs.byteplus.com/en/docs/Byteplus_LAS/Viral_content_editing），
> 由用户提供的正文内容整理镜像，镜像日期 2026-09-24。官方文档更新后以官方为准；实现映射代码前如有疑义须重新核对。

## 一、算子概述

- 输入：一部短剧的一集或多集视频，自动寻找高光片段，一次生成多条差异化投流素材。
- 输出：多条投流短视频 + 结构化结果（语义分镜、S/A/B/C 精彩度评级、钩子/功能标签、时间线、剧本还原）。
- 剪辑策略：顺剪（sequential）、跳剪（jump_cut）；「精彩前置」是独立开关（preset_intro / preset_intro_ratio），不属于 mode 枚举。
- 调用方式与视频本地化一致：`POST {baseUrl}/api/v1/submit` 提交、`POST {baseUrl}/api/v1/poll` 轮询，Bearer apiKey。

## 二、输入要求

| 项 | 约束 |
|---|---|
| 格式 | mp4、mov、avi、mkv |
| 数量 | 单次输入最多 100 个视频 |
| 单集时长 | 最短 1 秒，最长 10 分钟 |
| 总时长 / 总大小 | ≤ 2 小时 / ≤ 10 GB |
| 分辨率 | 所有输入必须一致；短边 ∈ [360,1080]，长边 ∈ [640,1920]（如 360x640 至 1080x1920） |
| 字幕 | 输入视频需携带字幕（内嵌） |
| 集数顺序 | 算子严格按 `video_urls` 物理索引判定剧集序号，传入前必须排好顺序 |
| 路径 | 公网 http/https URL（不支持需登录/Header 鉴权；临时 URL 须在任务期间有效）或 `tos://bucket/...`（与 LAS 同主账号、同地域、有读权限） |
| 前贴视频 | `preroll_urls` 最多 20 个；每条输出随机拼接一个前贴；前贴时长计入输出时长；需含视频流且时长 >0 |
| 后贴视频 | `postroll_url` 单个；分辨率必须与输入完全一致，否则报错 |

## 三、计费

- 按量计费，元/分钟，毫秒精度四舍五入，每小时出账；账单计费单元为「视频智能剪辑」。
- 公式：总费用 = ∑(输入视频分析单价 × 输入视频时长) + 剪辑合成单价 × 输出视频时长。
- 官方单价：输入分析 1.5 元/分钟；剪辑合成输出 0.06 元/分钟；单价与选择的智能剪辑模式有关（模式不同单价不同）。
- 此价格为上游 RMB 列表价，仅用于成本核算与价目草稿；对用户收费以本项目价目书为准。

## 四、Submit 请求参数

`operator_id: "las_viral_clip_gen"`，`operator_version: "v1"`，`data: ViralClipGenReqParams`。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| video_urls | string[] | 是 | 短剧视频列表（tos:// 或 https），物理索引=集数顺序 |
| output_tos_path | string | 是 | 结果输出 TOS 目录（同主账号同地域、可写），格式 `tos://bucket/output/` |
| min_clip_duration | int | 否 | 最短素材时长（秒），默认 180，范围 [5,2400] |
| max_clip_duration | int | 否 | 最长素材时长（秒），默认 300，范围 [5,2400]，须 ≥ min |
| max_clip_count | int | 否 | 最大素材条数，默认 10，范围 [1,300]；实际条数与内容相关，越大条间重复概率越高 |
| playback_speed | float | 否 | 输出倍速，默认 1.0，范围 [0.5,2.0]；变速在剪辑前完成，输出时长仍受 min/max 控制 |
| video_bitrate_kbps | int | 否 | 输出目标码率 Kbps，范围 [100,50000]；默认不指定用 CRF。输出分辨率与输入一致。体积估算：MB ≈ (码率+192)×秒÷8÷1024；360p 500–800、480p 800–1200、720p 1500–2500、1080p 3000–5000 |
| mode | string | 否 | `sequential` 顺剪（默认）/ `jump_cut` 跳剪 |
| preset_intro | bool | 否 | 精彩前置开关：true 全部启用；不可与 preset_intro_ratio 同时设置 |
| preset_intro_ratio | float | 否 | 精彩前置比例 [0.0,1.0]，如 0.5=50% 素材开头加前置；不可与 preset_intro 同时设置 |
| drama_elements | object | 否 | 短剧三要素包装（见下）；不传则不添加 |
| use_subdir | bool | 否 | 在 output_tos_path 下建 `{task_id}_{timestamp}` 子目录，默认 false |
| postroll_url | string | 否 | 后贴视频，拼接到每条输出末尾 |
| preroll_urls | string[] | 否 | 前贴视频列表，≤20，随机拼接每条输出头部，时长计入输出 |
| aspect_ratio | string | 否 | 输出画幅，当前仅支持 `9:16`；横屏输入等比缩放补黑边不裁切；不传则与输入一致 |
| callback | object | 否 | `{url}` 任务状态回调；不配置则轮询 |

### drama_elements（包装参数，第二批启用）

| 字段 | 说明 |
|---|---|
| title | 剧名，建议 ≤50 字符，`\n` 换行 |
| hint | 提示语，建议 ≤30 字符 |
| include_badge | 是否加角标 |
| badge_url | 自定义角标（tos/http/https），必须是含透明通道的 PNG/WebP，否则报参数不合法 |
| badge_position | top_left / top_right（默认）/ bottom_left / bottom_right |
| badge_size_ratio | 角标宽/输出短边，默认 0.16，范围 [0.05,0.40] |
| template_name | 模板1（标题顶居中+提示语左竖排+角标"热门短剧"右上）/ 模板2（右竖排+"热播中"）/ 模板3（左竖排+"爆款推荐"） |
| title_font_size | 默认 50，范围 [20,150] |
| title_opacity | 默认 1.0，范围 [0.3,1.0] |
| title_position | top_left/top_center（默认）/top_right/bottom_left/bottom_center/bottom_right |
| hint_position | left（默认竖排）/right/top_left/top_center/top_right/bottom_left/bottom_center/bottom_right |

### Submit 返回

`metadata: { task_id, task_status(PENDING), submit_time?, business_code, error_msg }`；task_id 示例 `20250108_150000_abc123`。

## 五、Poll 返回（COMPLETED 时）

`metadata: { task_id, task_status, submit_time, end_time, business_code(ISO8601 时间), error_msg }` + `data: ViralClipGenResponse`：

- `total_clips` int：符合需求的片段总数。
- `videos` SourceVideoInfo[]：原视频信息：`episode`（按输入顺序编号）、`video_url`、`file_size`、`duration`（秒）、`resolution`。
- `storyboard` SegmentInfo[]：原视频语义分镜：
  - `id`（如 `ep8_seg24`）、`episode`、`start_sec`、`end_sec`、
  - `rating`：S/A/B/C 重要性评级（S 最高）、
  - `highlight_score` int（如 95）、
  - `function_tags` string[]（如「钩子-情绪共鸣」「冲突-原生家庭矛盾」「爽点-直球出击」）、
  - `content_desc` 剧情描述、`asr` 识别文本、`duration`。
- `clips` ClipInfo[]：剪辑素材：
  - `id`（`clip_001`）、`url`（tos://，未指定 output_tos_path 时为空）、`preview_url`（HTTPS 临时链接，**3 天有效**）、
  - `duration`（秒）、`segment_count`、
  - `timeline` SegmentRef[]（按素材播放顺序）：`ref`（分镜 ID；拼接段为 `preroll`/`postroll`）、`clip_start_sec`、`clip_end_sec`、`is_intro_dup`（是否精彩前置复制段）、`source_url`（ref 为 preroll/postroll 时）。
- `script` ScriptInfo：`script_path`（剧本文件夹）、`character_table_path`（全局角色表）、`storyboard_json_path`（分镜完整 JSON 的 TOS 路径）。

**无供应商 usage/计量字段** → 本项目结算以本地 ffprobe 实测输出时长为准，并与响应 `clips[].duration` 交叉校验。

> 契约内部不一致（解析需防御性兼容）：Schema 表把 `storyboard_json_path` 归在 `script` 下，返回示例却出现在 `data` 顶层（`data.storyboard_json_path`）。两处都要接受。

## 六、错误码（业务码，出现在 metadata.business_code / error_msg）

| 类别 | 码 | 含义 |
|---|---|---|
| 参数 | Parameter.Invalid / Parameter.Missing | 参数不合法 / 缺参 |
| 输入访问 | Url.Invalid / Video.DownloadFailed / Tos.AccessFailed | URL 不可访问 / 下载失败 / TOS 访问失败 |
| 视频规格 | Video.Invalid / Video.FormatUnsupported / Video.DurationTooShort / Video.DurationExceeded / Video.FileTooLarge | 无效文件 / 格式不支持 / 过短 / 超时限 / 过大 |
| 处理 | Video.Timeout / Video.ClipFailed / Video.UploadFailed / Video.ModelFailed(VLM) / Video.FrameExtractionFailed | 处理超时 / 剪辑提取 / 上传 / VLM 调用 / 抽帧失败 |
| 算子专项 | ViralClipGen.AsrFailed / SceneFailed / ScriptFailed / BoundaryFailed / SubtitleFailed / ReviewFailed / JumpcutFailed / RenderFailed | ASR / 场景检测 / 剧本生成 / 剧集边界 / 内嵌字幕 OCR / 片段审核 / 跳剪方案 / 渲染上传失败 |
| 限流 | Connection.TooMany | 并发过高限流 |
| 鉴权 | Authorization.Missing / ApiKey.InValid（401）、InternalError（500） | |
