# 全能创作与素材工作流改进方案

> 状态：核心工作流已实施；低优先级项待后续排期
> 优先级：核心工作流优先；UI 视觉优化最低
> 原则：尽量复用现有素材库、SD2 认证、视频生成、首尾帧、任务历史能力；不新增独立音频模型或第二套任务系统。

## 一、目标与优先级

全能创作要成为“以镜头为单位、可长期编辑和复用”的视频工作台。用户应能安全上传素材、明确真人认证成本、按顺序组织镜头、从失败视频中修改提示词后无损复用素材引用，并能删除不再需要的全能项目。

实施顺序：

1. 上传命名与限制说明。
2. 真人声明与按需 SD2 认证。
3. 镜头排序、视频首尾帧提取。
4. 可编辑且不丢失的 `@` 素材引用。
5. 全能项目软删除与恢复。
6. AI 工具箱入口。
7. UI 视觉优化与移动端细节。

## 二、上传与素材库

### 2.1 中文文件名乱码

**现状**：磁盘文件名已经采用 UUID，不会因中文命名损坏；问题出在浏览器文件名经过 multipart/multer 后可能按 Latin-1 被解释，随后被直接写入 `assets.name` 与 `metadata.original_name`。

**方案**：

- 前端每次上传同时提交 `name=file.name` 作为 UTF-8 表单字段。
- 后端优先使用 `body.name` 作为素材显示名；缺少该字段时再对 `file.originalname` 做可逆的 Latin-1 → UTF-8 修复，修复失败则原样保留。
- 存储路径继续只使用 UUID + 扩展名；显示名、搜索名、`@` 别名仅存在数据库，禁止把用户中文名拼入服务器路径。
- 素材库卡片增加“重命名”操作；修改名称同步更新本素材在后续 `@` 选择器中的默认别名，但不修改历史任务快照。
- 对历史乱码名称提供“修复名称”预览：仅当字符串能被可靠地反解为 UTF-8 且反解结果包含合理中文时允许确认保存；不做无差别批量替换，避免损伤旧的正常名称。

### 2.2 上传数量、格式与限制提示

素材库与全能创作上传区必须使用同一份后端返回的限制数据，避免前端文案和后端校验漂移。

| 范围 | 限制 | 说明 |
|---|---:|---|
| 单张图片 | 30MB | JPG/JPEG、PNG、GIF、WebP |
| 单个视频 | 50MB | MP4、WebM、MOV、M4V |
| 单个音频 | 15MB | MP3、WAV、M4A、OGG、WebM |
| 单镜头素材总数 | 12 | 仅指本次镜头编排，不限制素材库累计量 |
| 单镜头图片 | 9 | 最终仍取模型能力的更小值 |
| 单镜头视频 | 3 | 不支持原生视频参考时可降级为关键帧 |
| 单镜头音频 | 3 | 是否原生提交取决于模型能力 |

**接口建议**：新增 `GET /upload-limits`，返回媒体类型、允许 MIME/扩展名、单文件大小、镜头总数和默认媒体数量；`GET /video-model-capabilities` 同时返回模型的原生参考数量上限。前端在选择素材时显示“已选/可用”，提交前由后端再次强制校验。

**交互要求**：多文件上传逐个入队，显示成功数、失败数、剩余数及每个失败原因；素材库累计数量不限制。

## 三、真人声明与 SD2 认证

### 3.1 认证策略

采用“真人勾选后认证”，不再把所有上传图片自动送往 SD2。

- 图片素材新增持久化布尔字段 `requires_sd2_identity`，文案为“含真人／需要身份一致性”。
- 用户勾选后，后台调用现有 ModelArk/即梦素材资产认证服务；认证状态依次为：`none`、`processing`、`active`、`stale`、`failed`。
- 同一图片源未变化时复用已有 `seedance2_asset`；图片 URL、本地路径或内容校验和变化后标记 `stale`。
- 仅当图片以“人物一致性（identity）”用途参与 Seedance/Volc 全能生成时，后端强制要求状态 `active` 且具有 `asset://` URL。
- 普通主视觉、场景、道具、风格和非真人参考图不认证，也不因未认证阻塞提交。
- 系统不做自动人脸识别；真人与身份保持需求由用户主动声明。

### 3.2 资源消耗说明

认证不是本地操作，通常包含一次图床/公网 URL 转换、一次供应商资产创建、若干次状态轮询，并占用 SD2 资产库配额和网络传输资源。因此：

- 上传即认证会让所有图片承担等待与配额成本，不采用。
- 勾选真人后异步认证能把成本限定在确实需要身份一致性的图片。
- 认证结果与源文件指纹绑定，可跨镜头和跨项目复用，不重复创建资产。
- 认证失败时保留失败原因和“重新认证”按钮；提交时禁止把未认证真人原图回退为 base64/localhost URL。

## 四、镜头排序、首尾帧与素材复用

### 4.1 镜头排序

- 左侧镜头列表支持拖到任意前后位置，显示明确插入线；拖动结束后通过单个原子排序接口持久化。
- 额外提供“上移”“下移”按钮和键盘可访问操作，避免只依赖鼠标拖动。
- 重载项目后按服务器 `sort_order` 恢复；排序不会自动修改提示词、素材或首尾帧设置。

### 4.2 从完成视频提取帧

用户已选择“仅提帧到素材库”，因此不自动绑定相邻镜头。

- 已完成视频提供“提取首帧”“提取尾帧”操作。
- 后端复用 FFmpeg/FFprobe：首帧取时间轴起点；尾帧取视频时长前的安全帧，避免取到编码尾部空帧。
- 提取结果保存为新的图片素材，记录 `source_type=video_frame`、来源任务/视频、`frame_position=first|last` 等元数据，并在素材库和当前镜头素材区即时可见。
- 用户可手动把提取帧设置为任意镜头的首帧、尾帧或普通参考图；系统不自动覆盖已有设置。

**接口建议**：`POST /omni-video-jobs/:id/extract-frame`，请求体 `{ position: 'first' | 'last' }`，返回新建素材对象。

## 五、提示词与 `@` 素材引用

### 5.1 问题

当前引用依赖纯文本 `@素材名` 与字符串匹配。用户把提示词复制到外部编辑器修改后再粘贴，素材 ID 信息丢失，只能手动重新添加全部引用；同名素材还可能被错误匹配。

### 5.2 方案

- 镜头增加 `prompt_document_json`：存储文字片段和稳定的 `asset_id` 引用；现有 `prompt` 保留为模型提交、搜索和历史兼容的文本投影。
- 编辑器将引用渲染为 `@别名` 芯片，内部绑定 `asset_id`；复制到同一编辑器时通过 HTML/自定义剪贴板数据完整保留引用。
- 从外部纯文本粘贴时，解析当前镜头已选素材：唯一匹配的 `@别名` 自动恢复为引用；重复别名或找不到素材时显示“待关联”标记和选择器，禁止静默绑定。
- 用户输入 `@`、拖入素材、从待关联选择器确认时均写入稳定引用。
- 自动保存、生成、重试和“复用创作”保存提示词文档及素材快照；重新编辑文字不会丢失未改动引用。
- 历史镜头没有文档数据时，以旧 `prompt` 加 `assets_json` 尝试一次性恢复；无法判断则保留原文并提示用户确认。

## 六、全能项目删除与恢复

- 新增 `DELETE /omni-video-sequences/:id`：软删除项目并级联软删除镜头。
- 不删除 `omni_video_jobs`、`video_generations`、请求快照和素材文件，已生成结果可继续在任务历史与素材库中使用。
- 项目列表卡片提供删除入口和二次确认；若有生成中任务，确认框必须说明“删除项目不会取消供应商任务或停止计费”。
- 新增已删除项目列表与恢复接口；恢复项目时恢复其镜头和原排序。

## 七、AI 工具箱（首期）

新增 AI 工具箱入口，作为既有能力的导航和复用层，不创建独立模型、资产表或任务队列。

| 工具 | 复用能力 | 跳转行为 |
|---|---|---|
| 图片创作 | 现有图片生成 | 进入图片生成流程 |
| 视频创作 | 现有视频生成 | 进入视频工作流 |
| 全能创作 | 全能项目与镜头 | 进入新建或已有全能项目 |
| 媒体素材库 | `assets` | 管理、选择并带回素材 |
| 视频首尾帧 | 帧提取接口 | 从任务/成片上下文打开 |
| 提示词引用修复 | 提示词文档编辑器 | 打开带待关联引用的镜头 |

工具卡只负责深链和传递已有项目、镜头、素材上下文；任务与历史仍在原有页面展示。

## 八、UI 优化（最低优先级）

- 保持“左侧镜头、中间视频、右侧素材与参数”的核心结构。

- 优先改善状态层级：上传限制、认证状态、素材数量、任务进度、失败重试和删除风险必须可见。

- 统一素材卡、认证标签、拖动插入线、首尾帧操作与移动端单列降级。

- https://github.com/anthropics/skills/tree/main/skills/frontend-design

   Design Context

  ## Color

  - Prefer OKLCH for new UI colors.
  - Use restrained product surfaces: tinted neutrals plus one violet-blue accent.
  - Avoid pure black and pure white in custom surfaces.
  - Reserve warm or danger colors for semantic states only.

  ## Typography

  - Keep body copy compact and readable.
  - Use hierarchy through weight, spacing, and modest scale changes.
  - Avoid large text that overwhelms utility pages.

  ## Layout

  - Product pages should feel like focused workspaces, not marketing pages.
  - Use generous negative space only when it clarifies the current task.
  - Avoid nested card grids unless each level has a distinct purpose.
  - Sidebar/filter areas should feel calm and secondary to the working canvas.

  ## Motion

  - Use short, ease-out transitions for reveal and hover states.
  - Animate opacity and transform, not layout-heavy properties.
  - Motion should confirm intent, not distract from scanning resources.
  - Video cards follow the Higgsfield-style preview pattern: show a quiet still frame by default, autoplay a muted looping preview on hover/focus, and pause/reset when the pointer leaves.

  ## Components

  - Prefer clear inline controls over modals when the action is reversible or lightweight.

  - Empty states should offer the next useful action.

  - Status chips should be readable in both light and dark themes.

  - Use `HoverVideoPreview` for video thumbnails, resource cards, history cards, and compact video references. Keep full `controls` only in deliberate playback surfaces such as preview modals or main result players.
    ---------------------------

  - # Content homepage design baseline

    ## Artifacts

    - Homepage concept: `../docs/design/content-home-concept.webp`
    - Homepage verified implementation: `../docs/design/content-home-implementation.webp`
    - Article detail concept: `../docs/design/content-article-concept.png`
    - Article detail verified implementation: `../docs/design/content-article-implementation.png`

    ## Design system

    - Background: graphite black (`#0b0b09`)
    - Surfaces: near-black olive (`#11110e`, `#15140f`)
    - Primary text: warm ivory (`#eee9df`)
    - Accent: restrained bronze (`#c59a3d`)
    - Borders: one-pixel graphite and bronze hairlines
    - Display type: system editorial serif stack
    - Interface/body type: system sans-serif stack
    - Layout: wide editorial grid, strong whitespace, square corners, no decorative badges or glass effects

    ## Fidelity ledger

    | Area           | Concept intent                                               | Implementation                                               | Status                      |
    | -------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | --------------------------- |
    | Header         | Wordmark, five editorial sections, sign-in and restrained CTA | Same hierarchy and spacing                                   | Match                       |
    | Hero           | Two-line serif statement with cinematic continuity dossier   | Same copy, line breaks, ratio, palette and dossier treatment | Match                       |
    | Featured guide | Split image/editorial copy card                              | Same split composition, typography and metadata rail         | Match                       |
    | Workflow grid  | Three image-led production cards                             | Same card count, visual rhythm and metadata structure        | Match                       |
    | Footer/library | Quiet information architecture and publication context       | Expanded with quality-policy library and semantic footer     | Match; production hardening |
    | Typography     | Premium editorial contrast                                   | Uses a zero-request system font stack to protect rendering speed and privacy | Intent preserved            |
    | Accessibility  | Not shown in concept                                         | Semantic landmarks, one H1, alt text, focus states and reduced motion | Added                       |
    | SEO            | Not shown in concept                                         | Static HTML, canonical metadata, JSON-LD, robots, sitemap and generated Open Graph image | Added                       |

    Visual acceptance: 10/10 intended relationships are represented. The implementation additions are technical and accessibility requirements, not visual substitutions.

    ## Article detail fidelity ledger

    | Area                | Concept intent                                               | Implementation                                               | Status                                     |
    | ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------ |
    | Global shell        | Same wordmark, editorial navigation, search, sign-in, and restrained CTA | Shared server component reproduces the hierarchy on every route | Match                                      |
    | Breadcrumb and lead | Quiet breadcrumb followed by large serif H1, deck, and review metadata | Same information hierarchy with one semantic H1 and server metadata | Match                                      |
    | Cover               | Wide cinematic continuity image between lead and reading body | Uses the reviewed article cover already present in the project | Match; source asset differs intentionally  |
    | Reading grid        | Left table of contents, broad article column, right Key Takeaways rail | Same three-column desktop relationship with sticky side rails | Match                                      |
    | Long-form structure | Clear sections, steps, lists, comparison evidence, and citations | Structured sections, steps/lists, stable anchors, and explicit method/source notes | Match; unsupported comparison data omitted |
    | Trust signals       | Author, reviewed date, sources, and visible method context   | All are visible and mirrored by Article/Breadcrumb JSON-LD   | Match                                      |
    | Related content     | End-of-article related guide paths                           | Three data-driven related resources share the publication catalog | Match                                      |
    | Product transition  | Quiet, intent-matched creation CTA after editorial content   | Dedicated content-to-product CTA links to the main product   | Match                                      |
    | Responsive behavior | Desktop concept establishes hierarchy                        | Mobile collapses to Key Takeaways, contents, and body with no horizontal overflow | Added                                      |
    | Interaction         | Search, section links, anchors, and template utility should be usable | GET search, real routes, anchor navigation, and Markdown download verified | Added                                      |

    Intentional deviations:

    - The implementation reuses the existing reviewed guide cover rather than introducing the concept's unapproved character portrait.
    - The concept's model comparison table and named external citations were not copied because no dated benchmark data or verified source set was provided. The production page shows first-party method and scope instead of fabricated evidence.
    - Decorative outline icons in Key Takeaways were reduced to typographic markers to preserve the project's restrained, dependency-free interface.

    Article visual acceptance: all 10 intended structural relationships are present. The deviations enforce content integrity and reuse approved project assets.

- 首先主题色禁用紫色渐变紫色，修改ui配置时一定要参考上述skills和文字后再决策

-

## 九、数据、接口与迁移清单

1. `assets`：增加 `requires_sd2_identity`；复用已有 `seedance2_asset` JSON。
2. `omni_video_sequence_shots`：增加 `prompt_document_json`。
3. `omni_video_sequences`：现有 `deleted_at` 用于项目软删除；补充恢复查询。
4. 新接口：`GET /upload-limits`、帧提取、项目删除/恢复/已删除列表。
5. 现有接口扩展：素材上传支持 UTF-8 `name`；素材更新支持真人声明与重命名；镜头更新支持提示词文档。

## 十、验收标准

- 中文文件名在上传、素材卡、搜索、重命名和 `@` 选择器中正确显示；历史乱码只能在确认后修复。
- 前端限制提示与后端拒绝规则一致；超出文件大小、类型、镜头总数或模型参考数时都有明确错误。
- 未标记真人的图片不会认证；标记后只认证一次；身份一致性提交只使用有效 `asset://`。
- 镜头可任意拖动且重载后顺序不变；完成视频可提取首尾帧并进入素材库。
- 用户外部修改提示词后粘贴，唯一 `@` 引用自动恢复；重名引用必须确认；重试和复用创作不丢引用。
- 删除全能项目不删除任务、成片和素材；可恢复项目和镜头排序。
- AI 工具箱入口均复用原有页面、素材和任务历史。
- 回归通过后端测试、前端测试、前端生产构建，以及 Docker 部署中的 `npm ci`。
