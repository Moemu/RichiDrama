# 全项目功能审查 · 2026-09-07

本轮为只读代码审查与隔离验证。没有修复业务代码，没有提交、推送或部署。

审查分支：`feat/ui-copy-simplify`。开始时提交为 `3230465`，交付时为 `7dce9d4e8dbc726eda3e9f42135ab5af52a1a448`。期间出现的后一个提交只增加工作流提示与对应断言，已补跑受影响测试。该提交不是本轮审查创建的。

优先处理公开注册提权，其次处理跨用户读写、文件路径边界、配置选择和计费闭环。下面按影响分组。P0 表示直接突破平台权限边界；P1 表示安全、数据、计费或主要生产路径缺陷；P2 表示局部功能、性能或状态问题；P3 表示低影响文案问题。

证据分为「HTTP 复现」「隔离复现」「调用链确认」「界面确认」。隔离复现包含临时数据库、服务替身和本地媒体实验，不等同于完整 HTTP 集成验收。未进行真实供应商调用。

## 权限、数据隔离与凭据

### A01 · P0 · 公开注册可获得平台管理员权限

- 位置：`backend-node/src/services/authService.js:142`、`:158`；`backend-node/src/routes/index.js:36`。
- 触发：未登录用户注册时传入 `console_access: true` 或 `account_kind: 'platform_admin'`。`register()` 虽覆盖 `role`，但 `createUser()` 又根据这两个字段生成管理员角色。
- 影响：注册响应立即签发管理员会话，可访问后台用户、配置和资金管理接口。
- 证据：隔离 HTTP 注册返回 201，用户为 `role=admin/account_kind=platform_admin/console_access=true`；使用返回 Cookie 读取 `/api/v1/admin/users` 返回 200。
- 修复：公开注册只接受账号、密码和显示名，服务端强制创作账号权限。管理员创建接口独立校验权限。增加公开注册禁止权限字段的 HTTP 测试。

### A02 · P1 · 普通用户可改全局生成设置和系统提示词

- 位置：`backend-node/src/routes/index.js:538`；`routes/settings.js:37`；`routes/promptOverrides.js:63`。
- 触发：普通登录用户调用全局设置和提示词的 PUT/DELETE 接口。这些接口没有 `requireAdmin`。
- 影响：可改变所有用户的并发设置、语言配置或共用系统提示词。
- 证据：隔离 HTTP 普通账号 `role=user` 修改 `/api/v1/settings/generation` 返回 200。提示词与语言写入路径由调用链确认，未修改实际配置文件。
- 修复：全局写操作要求管理员权限；个人偏好使用用户范围存储。

### A03 · P1 · 静态媒体仅检查登录，缺少资源归属保护

- 位置：`backend-node/src/app.js:156`；`services/mediaStorageService.js:256`。
- 触发：登录用户知道其他项目的 `/static/...` 路径。
- 影响：处理器直接读取文件或 OSS 对象，没有项目所有权检查；响应还使用 `Cache-Control: public`，共享缓存可能复用受保护内容。
- 证据：调用链确认。路径不一定可枚举，但知晓路径即可绕过 API 层的资源隔离。
- 修复：媒体请求关联所有者或明确共享授权，或使用短期授权令牌；私人媒体改为合适的 private 缓存策略。迁移时保留历史媒体的可读路径。

### A04 · P1 · 角色、场景、道具库的直接 ID 接口缺少归属校验

- 位置：`backend-node/src/middleware/ownership.js:3`；`routes/index.js:312`；`services/characterLibraryService.js:103`。场景库、道具库有同类路径。
- 触发：登录用户直接请求其他项目库项的详情、修改或删除接口。
- 影响：中间件没有三类 library 映射，服务按 ID 读写；全局库项也没有明确的创建者或共享写权限。
- 证据：调用链及表结构确认。带父项目参数的请求已有部分保护，直接 ID 路径仍缺保护。
- 修复：区分项目库、个人库和显式共享库，查询与写入都使用对应授权条件。历史全局记录不能直接批量改归属。

### A05 · P1 · 批量生成的数组 ID 绕过资源归属检查

- 位置：`backend-node/src/middleware/ownership.js:31`；`routes/audio.js:68`；`routes/characters.js:66`；`services/characterLibraryService.js:355`。
- 触发：向批量 TTS 或角色生图传入他人的 `storyboard_ids`、`character_ids`。中间件只检查单值字段。
- 影响：读取他人对白或角色资料，触发调用，并修改对方音频或图片状态。角色生成使用当前请求的计费上下文。
- 证据：TTS 隔离处理器测试中，非所有者请求仍执行了对指定分镜的 UPDATE；角色路径由排队、生成、写回调用链确认。未执行真实计费。
- 修复：在任何排队、外部调用或写入前验证完整 ID 集合，拒绝混合所有权请求。TTS 数组还应去重并限制数量。

### A06 · P1 · 视频合成记录可被其他用户读取或软删除

- 位置：`backend-node/src/routes/videoMerges.js:6`；`services/videoMergeService.js:6`；`middleware/ownership.js:3`。
- 触发：直接访问合成记录 ID，或不带父项目约束查询列表。
- 影响：暴露成片路径和任务信息，允许删除其他项目的合成记录。
- 证据：调用链确认。服务未接收当前用户，资源映射没有 `video-merges`；带 `drama_id/episode_id` 的请求仍会受到通用父资源检查。
- 修复：通过所属项目联表鉴权，覆盖列表、详情和删除。无需为了修复而重写历史合成记录。

### A07 · P1 · 分镜可关联其他项目道具并读出其资料

- 位置：`backend-node/src/services/storyboardService.js:191`；`services/propService.js:122`；`services/dramaService.js:134`。
- 触发：更新自己的分镜时提交其他项目的 `prop_ids`。
- 影响：关联写入没有逐项归属检查；再次读取项目时，外部道具名称、描述和媒体路径会进入响应。
- 证据：关联写入与项目详情读取调用链确认。
- 修复：校验关联 ID 与分镜属于同一项目和用户；同时检查角色等其他数组关联消费者。

### A08 · P1 · 素材本地路径未限制在存储根目录内

- 位置：`backend-node/src/services/assetService.js:188`；`services/uploadService.js:222`；`services/assetSd2Service.js:13`。
- 触发：用户修改自己的素材 `local_path` 为绝对路径或带 `..` 的路径，再走已配置的 SD2 认证/图床上传路径。
- 影响：服务会读取存储目录外的文件，并尝试上传到图床；文件内容泄露的最终范围取决于图床是否接受该内容。
- 证据：用户可写字段、路径解析、`readFileSync()` 和上传调用链确认。没有读取真实敏感文件或向外上传。
- 修复：统一存储 key 校验，拒绝绝对路径与越界路径；解析后及符号链接解析后都检查实际文件仍在 storage root 内。

### A09 · P1 · TTS 调试日志输出完整 API Key

- 位置：`backend-node/src/services/ttsService.js:279`。
- 触发：进入 OpenAI 兼容 TTS 分支。
- 影响：完整 key、文本、模型与 URL 进入 stdout，绕过脱敏 logger。
- 证据：日志参数及调用路径确认。
- 修复：删除该调试输出，日志仅记录请求 ID、模型和必要状态。是否检查历史日志或轮换线上 key，应另行确定范围和授权。

## 配置、计费与生产结果

### B01 · P1 · 图片实际调用重新选配置时丢失租户范围

- 位置：`backend-node/src/services/imageService.js:723`、`:1392`；`services/imageClient.js:122`、`:1427`。
- 触发：项目组使用独立图片配置。上层已按租户选择配置，但 `callImageApi()` 再次查询时未传租户。
- 影响：实际使用的供应商配置和凭据可能与项目组、报价依据不一致。
- 证据：本地假供应商隔离测试记录到 `getDefaultImageConfig()` 查询选项为 `{}`。图片客户端没有文本客户端的 AsyncLocalStorage 回退保护。
- 修复：将租户范围贯通到实际图片配置选择，确保报价、预授权和调用使用同一配置快照；无租户的历史调用保留原语义。

### B02 · P1 · 剧本创作和反推结果完成后仍进入待对账

- 位置：`backend-node/src/services/toolRunService.js:78`、`:93`、`:95`；`routes/index.js:408`。
- 触发：工具使用 token 计费；供应商正常返回 usage，但剧本创作和反推路径未向完成结算传递 usage。
- 影响：结果是 completed，计费却进入待核对，冻结和人工对账不能自动闭环。
- 证据：隔离测试模拟供应商返回 46 tokens，完成后 `pending=1/settled=0/usagePassedToSettle=null`。剧本分析路径已有 callback，不属于同一缺陷。
- 修复：贯通供应商 usage 与 request ID。视频反推的多个视觉/文本调用应按实际配置分别记录或正确汇总，不应以一个调用的 usage 代替全部。

### B03 · P2 · AI 配置校验失败后仍继续保存

- 位置：`frontweb/src/components/AIConfigContent.vue:2038`；`backend-node/src/routes/aiConfig.js:60`；`services/aiConfigService.js:244`。
- 触发：填写其他必填项后清空普通配置的 API Key。`validate()` 的异常被吞掉，提交继续执行。
- 影响：新增可保存空 key/空模型；编辑清空 key 会覆盖原凭据，后续生成失败。
- 证据：隔离路由测试空 key/模型返回 201，编辑空 key 后数据库凭据为空。内置浏览器全空提交则被后台以缺必填字段拒绝，因此并非所有空配置都能保存。
- 修复：前端校验失败立即停止；后端校验普通配置的有效凭据和模型，保留官方 AK/SK 配置的合法例外与编辑掩码语义。

### B04 · P1 · 后处理对账解决后，成片仍停在等待结算

- 位置：`backend-node/src/services/videoUpscaleService.js:151`；`services/videoInterpolationService.js:179`；`services/billingService.js:584`；`services/videoService.js:1153`。
- 触发：超分/插帧已有本地输出，但因实际费用进入待对账；管理员随后结算或豁免。
- 影响：对账单 resolved，视频仍为 `billing_reconciliation`，阶段仍为 `reconciliation_required`，无法发布已有成片。
- 证据：临时 SQLite、本地 FFmpeg 文件与假 MediaKit 响应复现；解决后本地输出存在，但两个业务状态未变。
- 修复：对账解决后幂等恢复阶段与视频最终化，并提供重启扫描；不能重复调用供应商或扣费。

### B05 · P1 · 后处理已完成但视频未最终化时重启，会永久等待

- 位置：`backend-node/src/services/videoService.js:542`、`:804`、`:896`；`services/videoUpscaleService.js:172`；`services/videoInterpolationService.js:200`；`app.js:82`。
- 触发：阶段已写 completed，进程在外层最终化前重启。
- 影响：视频停在 `upscale_pending/interpolation_pending`；启动恢复只处理未完成阶段、普通 processing 或已完成归档，遗漏这一组合。
- 证据：隔离状态夹具执行恢复入口后，`upscale_pending + upscale_status=completed` 保持不变，恢复排队数为 0。
- 修复：启动时补扫已完成阶段但视频未最终化的记录，以已验证的本地输出幂等完成后续流程。

### B06 · P2 · 取消与轮询完成竞态可能覆盖取消结果

- 位置：`backend-node/src/services/videoClient.js:4142`；`services/videoService.js:745`、`:615`；`services/omniVideoService.js:1056`。
- 触发：轮询在取消前发出，供应商取消成功后，先前在途响应再返回成功。
- 影响：最终化未重查本地终态，已取消记录可能重新成为 completed。
- 证据：隔离在途响应测试中，本地已 failed，轮询仍返回成功视频，状态检查只发生一次。真实供应商产生该响应顺序的频率未验证。
- 修复：最终化前重查取消状态，并用带状态条件的原子更新防止终态回退。

### B07 · P2 · 超分/插帧失败未同步分镜失败状态

- 位置：`backend-node/src/services/videoUpscaleService.js:177`；`services/videoInterpolationService.js:208`；`services/videoService.js:553`、`:575`；`frontweb/src/views/DramaCanvas.vue:809`。
- 触发：阶段服务先把视频直接写成 failed，外层因此跳过负责同步分镜的 `setVideoGenFailed()`。
- 影响：视频已失败，分镜仍 processing，画布可能持续轮询并显示处理中。
- 证据：失败写入、外层分支和画布消费调用链确认；未做完整失败流程的动态复现。
- 修复：失败状态通过统一幂等入口传播到视频、分镜及界面可见状态。

### B08 · P1 · 空提取结果会清除现有角色关联、场景或道具

- 位置：`backend-node/src/services/backgroundExtractionService.js:45`、`:138`；`services/propExtractionService.js:61`；`services/characterGenerationService.js:90`、`:179`。
- 触发：AI 返回合法空数组，或部分解析失败被归一为空列表。
- 影响：服务先删除/软删除旧数据再写入空结果，并以 `count=0` 成功结束，用户原有资料不可继续正常使用。
- 证据：解析、替换和终态调用链确认。没有调用真实模型或删除业务资料。
- 修复：自动替换前验证有效结果；空结果保留旧数据并提示。若确需清空，应使用明确的用户操作。

### B09 · P1 · 画布全能分镜生成没有传递 Omni 素材

- 位置：`frontweb/src/utils/storyboardMedia.js:124`；`composables/useCanvasWorkflowRunner.js:57`；`composables/useCanvasEpisodeGenerate.js:235`。
- 触发：在画布中对全能模式分镜执行视频生成，尤其是批量生成。
- 影响：universal 模式不返回普通首尾帧，而提交路径也未传 Omni asset IDs、参考图片或创建模式；素材引用不进入请求，输出可能退化为文本生成或失败。
- 证据：画布数据整理与 `/videos` 提交调用链确认；FilmCreate 独立路径已有引用收集逻辑。
- 修复：复用统一的全能请求构造与引用验证，覆盖单条、批量、刷新恢复和计费报价。

## 导入、媒体与性能

### C01 · P1 · 导入缺少解压后内存预算

- 位置：`backend-node/src/services/dramaImportService.js:21`；`services/novelImportService.js:12`；`routes/index.js:211`。
- 触发：高压缩比 ZIP 或大型 TXT。500MB 仅限制原始上传体积。
- 影响：同步全量解压、Buffer/字符串/数组多份保留会阻塞事件循环并显著抬高内存。
- 证据：隔离 ZIP 实验中约 130KiB 压缩文件展开为 128MiB，RSS 增长约 409MB；64MiB 小说解析 RSS 增长约 134MB。数值只代表该测试进程，不是生产容量预测。
- 修复：设置条目数量、单条与总解压体积预算；限制 TXT 字节数，避免全量分行复制。大任务移入有资源限制的异步处理。

### C02 · P1 · 项目 ZIP 往返丢失 Omni 设置与素材引用

- 位置：`backend-node/src/services/dramaExportService.js:253`；`services/dramaImportService.js:287`；`frontweb/src/views/FreeCreate.vue:701`、`:1085`。
- 触发：导出含 Omni 素材、提示词文档、首尾帧 ID 或视频/音频后处理设置的项目，再导入。
- 影响：导出对象与导入白名单未包含这些字段，重新导入只能得到默认值，无法完整恢复创作状态。
- 证据：隔离导出 fixture 检查 `project.json`，相关字段缺失；已检查前端恢复消费者。
- 修复：为新导出 schema 增加版本与字段，并为素材及关联 ID 建立映射；兼容旧 ZIP。暂不支持的内容应在导出前明确提示。

### C03 · P2 · 导入事务失败后残留已写媒体

- 位置：`backend-node/src/services/dramaImportService.js:71`、`:126`。
- 触发：媒体文件写入后，后续数据库插入失败。
- 影响：数据库回滚，文件未回滚；重复失败导入持续占用磁盘。
- 证据：临时目录中模拟角色插入失败后，仍保留 `characters/char_imp_*.bin`。
- 修复：记录本次创建的精确文件清单，失败后逐项安全清理；禁止按目录或时间猜测删除历史文件。

### C04 · P1 · OSS 冷视频每次 Range 请求仍下载完整文件

- 位置：`backend-node/src/services/mediaStorageService.js:70`、`:90`、`:256`。
- 触发：本地热副本已移除，浏览器从 OSS 媒体请求首段或拖动播放。
- 影响：服务先聚合完整对象 Buffer，再截取 Range；多个并发大视频造成高延迟、全量流量和内存压力。
- 证据：OSS 读取与静态响应调用链确认；未进行线上 OSS 压测。
- 修复：将 Range 传给 OSS，按流返回响应并处理客户端中断，避免每次 seek 都整文件读取。

### C05 · P2 · 媒体上传同步执行无超时的探测与缩略图进程

- 位置：`backend-node/src/services/mediaAssetService.js:62`、`:119`、`:129`；`routes/upload.js:102`。
- 触发：上传探测较慢或构造异常的媒体文件。
- 影响：`spawnSync` 阻塞 Node 事件循环；错误被吞掉时，记录仍可能以 ready 写入。
- 证据：HTTP 上传调用链确认，未运行恶意文件压力测试。
- 修复：使用有超时的异步子进程或受限后台队列，明确 processing/ready/failed 状态。

### C06 · P2 · 视频反推的临时代表帧没有回收

- 位置：`backend-node/src/services/toolRunService.js:96`。
- 触发：运行视频反推，尤其是重复创建任务或提帧后失败。
- 影响：每个任务向 `tool-reverse` 写入首、中、尾 JPG，没有成功或失败清理；运行记录删除也不回收这些文件。
- 证据：文件创建与错误处理调用链确认。
- 修复：在分析完成后清理本次明确创建的中间文件，失败路径也执行同一清理；不得扫描目录删除其他任务或历史资产。

## 界面、状态和文案

### D01 · P2 · 素材选择器超过 100 条后无法加载与搜索

- 位置：`frontweb/src/components/ToolAssetSelector.vue:78`、`:116`；`backend-node/src/response.js:18`。
- 触发：单个素材范围超过 100 条。
- 影响：前端读 `first.total`，实际接口是 `first.pagination.total`，页数退化为 1；搜索只过滤已加载数组。修正字段后仍有 300 条上限，现有“请用搜索查找更多”文案仍不成立。
- 证据：隔离 HTTP 确认响应只含 `items/pagination`；请求封装不扁平化 pagination。前端分页与本地搜索调用链确认。
- 修复：读取正确分页字段，并实现服务端搜索或明确的分页选择。不要只把文案改成“300 条”而留下 100 条接口错误。

### D02 · P2 · 素材库“选中全部筛选结果”静默漏选

- 位置：`frontweb/src/views/MediaLibrary.vue:503`、`:201`；`backend-node/src/services/assetService.js:40`。
- 触发：筛选结果超过 100 条，或操作跨页选择集。
- 影响：前端请求 500 条，后台上限 100；101–500 条时没有截断提示。部分批量操作还只从当前页构造 `selectedMedia`，遗漏其他页 ID。
- 证据：分页上限和选择集消费者调用链确认。
- 修复：完整分页收集 ID 或使用明确的服务端全选协议，批量操作使用完整选择集。

### D03 · P2 · 图片工具宣称批量组图，实际只有单图接口

- 位置：`frontweb/src/views/ToolMediaGeneration.vue:152`、`:282`；`backend-node/src/routes/images.js:31`。
- 触发：选择“组生组图 / 共享风格批量出图”。
- 影响：前端只提交一次图片生成，后台限制 `count=1`，没有批量数量和任务机制。
- 证据：内置浏览器确认模式文案与“生成单张图片”标题同时存在；请求和后台限制由调用链确认。未进行付费生成。
- 修复：删除未实现的模式，或通过带报价、进度和重试的批量 API 实现。

### D04 · P2 · 旧完成计时器会删除新重试任务

- 位置：`frontweb/src/stores/generationTaskStore.js:104`；`composables/filmCreate/useCharacters.js:347`。
- 触发：同资源在前次完成后 3 秒内或失败清理窗口内重新生成。
- 影响：旧定时器按同 key 删除新 running 实例，界面生成状态消失，后台任务仍在执行。
- 证据：隔离复现先完成 old-task，再写入同 key 的 new-task，触发旧计时器后新任务被删除；调用方没有冷却限制。
- 修复：清理前核对任务实例、版本或 taskId，不能仅以资源 key 删除。

### D05 · P2 · 首页一个列表接口失败会清空其他成功数据

- 位置：`frontweb/src/views/FilmList.vue:826`。
- 触发：短剧列表成功，全能项目列表失败，或反向情况。
- 影响：未隔离的 `Promise.all()` 进入统一 catch，清空所有项目与媒体，用户看到错误的空工作台。
- 证据：错误分支调用链确认。
- 修复：分别保留成功结果，对失败区域提示重试，刷新失败时保留上次数据。

### D06 · P2 · 角色、场景、道具文本清空后又恢复

- 位置：`frontweb/src/composables/filmCreate/useCharacters.js:229`、`useScenes.js:260`、`useProps.js:240`；对应后端更新服务。
- 触发：编辑已有文本为空并保存。
- 影响：前端转为 undefined 或后端拒绝空值更新，界面提示成功但旧值仍在，刷新后恢复。
- 证据：表单序列化和数据库更新条件确认。
- 修复：约定空字符串或 null 表示显式清除，保持“不传字段即不修改”的旧 API 语义。

### D07 · P2 · 场景/道具单图与四视图模式未贯通

- 位置：`frontweb/src/composables/filmCreate/useProps.js:311`；`src/api/props.js:19`；`backend-node/src/routes/scenes.js:90`；`frontweb/src/views/FilmCreate.vue:872`。
- 触发：调用方指定 `use_quad_grid` 或依据单图提示词说明生成。
- 影响：道具 API 封装丢弃第四个模式参数，场景路由也不消费模式；现有说明声称可不勾选四宫格，但实际生成路径不能按该选择切换。
- 证据：参数传递、路由分支和提示文本确认；部分模式 ref 甚至没有模板入口。
- 修复：统一模式字段和真实入口，再让后台调用对应单图/四视图实现，保留旧请求默认语义。

### D08 · P2 · 损坏的用户缓存会中断路由导航

- 位置：`frontweb/src/router/index.js:97`。
- 触发：`lmd_auth_user` 为非法 JSON。
- 影响：路由守卫的无保护 JSON.parse 抛错，登录页等导航也可能失败，用户需手动清缓存。
- 证据：路由守卫代码确认；这是异常缓存输入的恢复缺口，不是当前正常账号必现故障。
- 修复：安全解析失败后清除无效显示缓存，按未加载用户状态继续路由，不应破坏仍有效的 Cookie 会话。

### D09 · P3 · 媒体预览直接显示原始创建时间

- 位置：`frontweb/src/views/MediaLibrary.vue:145`。
- 触发：预览包含 UTC ISO 创建时间的媒体。
- 影响：显示原始 T/Z 字符串，未遵守用户可见时间使用 Asia/Shanghai 的项目规则。
- 证据：模板确认。
- 修复：使用现有 `formatChinaDateTime()`。

### D10 · P3 · 所有上传超限都被描述为图片超过 16MB

- 位置：`backend-node/src/app.js:223`、`:228`。
- 触发：视频、音频或 ZIP 上传触发 `LIMIT_FILE_SIZE`。
- 影响：统一错误文案固定为“图片大小不能超过 16MB”，与具体上传类型和限制不符。
- 证据：统一错误处理与各上传限额调用链确认。
- 修复：由上传路由附带媒体类型和实际限额，兜底只说明文件超限。

### D11 · P2 · 视频反推的首、中、尾实际都是首帧

- 位置：`backend-node/src/services/toolRunService.js:96`。
- 触发：任意视频反推。中帧和尾帧使用 `select=eq(n,trunc(n*0.5))` 与 `select=eq(n,trunc(n*0.99))`。
- 影响：两个条件对非负整数帧号仅在 n=0 成立，三个视觉调用都分析首帧，后续运动、转场和尾部内容没有进入分析。
- 证据：本地 30 帧、10fps、红绿蓝分段视频实验中，三个输出 SHA-256 完全一致；正确选择第 15/29 帧的对照输出不同。未调用 AI。
- 修复：根据探测到的时长进行有界时间定位，或使用实际总帧数选择中尾位置；短视频与可变帧率也要有明确行为。

## 已排除与尚未验证

- 流式文本显式 tenant_id 未直接传给查询，但当前业务入口的 AsyncLocalStorage 提供租户回退。未计入当前漏洞。
- 素材别名前缀匹配可能与中文连写约定有关，没有足够证据认定为错误引用缺陷，未计入。
- 供应商接受提交后、任务 ID 落库前的崩溃窗口，仍需核对供应商幂等能力。未将其计为已确认重复计费。
- 改密后既有 JWT 有效期、退出是否应立即撤销全部会话，涉及产品会话策略，未作为已确认缺陷。
- AI 配置“测试”存在生成类调用路径，但本轮未验证真实供应商是否接受测试载荷以及产生何种费用。未执行真实测试，也未把费用推测计入已确认问题。

## 覆盖与验证记录

七个并行审查方向覆盖：认证/计费/后台；普通视频与 Omni 异步恢复；上传/存储/素材/图片；项目/集/角色/场景/道具/分镜/画布；AI 工具与配置；共享前端/路由/缓存/时间；导入导出/小说/TTS。

已检索跨组件消费者：资源 ID 与 ID 数组、owner_user_id、tenant_id、local_path、分页结构、usage、processing/completed/failed、后处理状态、Omni 引用、生成模式和创建时间。每条发现列出主要生产入口与消费者，重复线索已合并。

- 前端自动化基线：133 项通过。
- 后端自动化基线：322 项通过。首次隔离运行中，强制空环境文件使 2 个配置发现测试与测试夹具冲突；移除该测试专属覆盖后，配置测试文件 10 项通过。未将夹具冲突视为产品失败。
- 审查期间的新提交仅改变工作流提示及结构断言，补跑 `creativeUiStructure.test.js`，54 项通过。
- 视频补证另运行进度、超分、卡住授权测试，12 项通过。
- 使用 dev 档、临时 SQLite/存储、本地假供应商与外网请求阻断。隔离 HTTP 验证注册提权、普通用户修改全局并发及素材分页响应。
- 内置浏览器抽查首页、后台设置、AI 配置表单和图片工具模式。未进行所有页面、三个桌面视口和全部异常分支的 UI 验收。
- 本轮未改前端业务代码，未重新构建；没有访问线上、真实生成、支付、供应商 API 或生产媒体。

这是广泛代码审查，不代表穷尽全部输入组合。现有测试通过仍遗漏上述权限、状态和接口契约问题。

## 建议修复顺序与兼容边界

1. 先修 A01，并为公开注册及后台授权补充 HTTP 负向测试。
2. 修跨用户读写、数组归属、媒体路径与 key 日志问题；使用普通双用户夹具验收。
3. 修图片配置/计费传递和后处理恢复，验证刷新与重启后不重复生成、不重复扣费。
4. 修导入完整性与资源预算，再修素材分页、批量语义及界面状态。

本轮仅产出报告，没有启用任何新业务行为，也没有修改历史记录。后续修复必须明确哪些新记录启用新行为，哪些历史记录继续沿用旧规则；迁移和恢复不能批量删除、改写旧账本或替换已持久化媒体。以上建议不构成生产操作授权。
