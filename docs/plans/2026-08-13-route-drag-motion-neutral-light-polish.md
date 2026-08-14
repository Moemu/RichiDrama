# LocalMiniDrama 路由稳定、提示词拖放与中性浅色体验改进方案

> 日期：2026-08-13
> 状态：已完成并通过内置浏览器验收
> 范围：前端路由与登录恢复、全能创作/分镜素材拖放、`@` 素材选择、空白行定位、全局微动效与浅色视觉系统

## 一、问题与完成定义

本轮处理六项相互关联的问题，目标不是增加装饰，而是让用户在长时间创作中始终知道“我在哪里、内容会落在哪里、系统是否响应”。

1. **刷新路由稳定**：刷新任意受保护路由时保留完整 `path + query + hash`；会话失效进入登录页也携带原始目标，登录后只恢复站内安全路径，不回项目首页或其它页面。
2. **拖拽不遮挡内容**：拖动素材卡时隐藏浏览器默认大图拖拽预览，仅保留鼠标和编辑器内的插入轨迹，提示词文字必须始终可见。
3. **删除 `@引用` 小矩形**：输入 `@` 时不再在光标旁渲染“@素材”矩形标签；素材浮层和原生文本光标已经足以说明状态。
4. **空格/空白行可定位**：空白行和仅包含空格的行也生成明确落点；横向插入轨道覆盖该行可输入宽度，避免只能猜测一个细小竖线。
5. **系统更丝滑**：补充有意义的 hover、pressed、面板进入、插入确认、滚动和主题切换反馈；仅动画 `transform` 与 `opacity`，统一 160–220ms，并尊重 `prefers-reduced-motion`。
6. **浅色中性化**：大面积表面采用白色、雾灰和中性冷灰；移除页面背景、卡片、视频/图片占位和侧栏的大面积紫水色。品牌紫只出现在主操作、焦点、当前选择和小面积状态。

## 二、根因审计

### 2.1 路由与会话

- 路由守卫在用户已登录却访问 `/login?redirect=...` 时固定返回 `/`，丢失原目标。
- API 401 使用 `window.location.assign('/login')`，未保存当前查询参数与 hash。
- 登录页虽然读取 `redirect`，但缺少统一站内路径校验，恢复规则分散。
- 初始媒体 Cookie 恢复与路由加载并行发生；需要保证失败跳转仍保留原始位置。

### 2.2 拖放编辑器

- `FreeCreate.vue` 和 `FilmCreate.vue` 把完整素材图片作为 HTML5 原生 drag image，鼠标下方的大图会挡住提示词。
- `OmniAssetPromptEditor.vue` 已有镜像测量，但换行符没有可见矩形，连续空行无法进入候选边界。
- `UniversalSegmentOmniAtEditor.vue` 依赖浏览器 `caretPositionFromPoint`；contenteditable 空行返回范围不稳定，且没有拖放轨迹反馈。
- `OmniAssetPromptEditor.vue` 额外渲染 `mention-anchor > i` 的“@素材”矩形，重复表达并遮挡内容。

### 2.3 浅色视觉与动效

- `FilmList.vue`、`DramaDetail.vue`、`FilmCreate.vue` 的旧浅色规则包含紫色/青色径向光晕、紫色卡片渐变和紫水色占位舞台。
- 全局动效分散，部分组件只有 hover，pressed、focus、内容进入反馈不连续。

## 三、实施方案

### 3.1 路由恢复单一契约

- 新增纯函数 `safeRedirectPath`：只接受以单斜杠开头的站内地址，拒绝协议相对地址、外链和登录页递归跳转。
- 守卫和登录页共用该函数；已登录访问登录页时优先恢复合法 `redirect`。
- 401 跳转使用当前 `pathname + search + hash` 构造 redirect，并使用 `location.replace` 防止返回键落回失效页面。
- 增加路由恢复测试覆盖普通页、query/hash、外链、`//host` 与登录递归。

### 3.2 无遮挡拖放

- 新增共享 `setTransparentDragPreview(event)`，在 dragstart 设置 1×1 透明预览。
- 素材信息仍通过自定义 MIME / JSON 传输，不改变业务数据和插入逻辑。
- 编辑器成为唯一落点反馈来源：普通文本显示 3px 光标；空白行显示横向细轨道及小圆点。

### 3.3 空白行算法

- textarea 镜像缓存显式为每个换行后的 offset 创建行首边界，连续换行按真实 line-height 递增。
- 对命中行计算 `lineStart/lineEnd`；当 `trim()` 为空时标记 `blankLine`。
- contenteditable 拖放增加同样的悬停光标和空白行横轨，使用 caret API 失败时按行高和左右位置回退。
- drop 与视觉轨迹共享同一个 offset，杜绝“指示位置”和“实际插入位置”不一致。

### 3.4 中性浅色与细节动效

- 浅色页面背景：中性雾灰；卡片：实体白；嵌套区：浅灰；hover/active：中性灰，不用紫色铺底。
- 去除首页、详情、创作页的大面积紫色径向光晕与紫水渐变；媒体占位使用中性灰或专业暗场。
- 品牌紫仅用于主要按钮、2px focus ring、当前项细边框/侧标和小面积进度。
- 卡片/按钮 hover 160ms，pressed 80ms，浮层出现 180ms；滚动使用 `scroll-behavior: smooth`，减弱动态时全部关闭。
- 不使用无限闪烁装饰；拖放光标只在拖动期间低幅呼吸。

## 四、影响面检查

- 路由：`router/index.js`、`utils/request.js`、`views/Login.vue`、`main.js`。
- textarea 提示词：`OmniAssetPromptEditor.vue`、`FreeCreate.vue`。
- contenteditable 提示词：`UniversalSegmentOmniAtEditor.vue`、`FilmCreate.vue`。
- 主题与动效：`styles/theme.css`，并以末级兼容层覆盖 FilmList、DramaDetail、FilmCreate、FreeCreate 旧局部浅色规则。
- 后端 API、生成、计费、媒体持久化均不改动。

## 五、验证矩阵

### 自动化

- 路由恢复纯函数测试：目标地址完整性与开放重定向防护。
- 拖放契约测试：透明 drag image、删除 mention 小矩形、换行/空白行边界、两套编辑器视觉光标。
- 动效/浅色契约：中性令牌、无浅色页面氛围渐变、reduced motion。
- 运行 `node --test test/*.test.js`、`npm run build`、`git diff --check`。

### 内置浏览器 + computer-use

1. 直接打开 `/film/2?episode=2`，刷新，URL 仍完全一致。
2. 打开 `/film/2/canvas` 与 `/free-create?sequence_id=...` 分别刷新，确认不跳页。
3. 在分镜工作台输入 `@`：出现素材浮层但无“@素材”小矩形。
4. 拖动真实素材到普通文本、空白行、仅空格行：拖拽图片不遮挡，落点轨迹与插入结果一致。
5. 浅色检查首页、详情、分镜工作台、全能创作：大面积表面为中性白/灰，无紫水色铺底。
6. 深色回归、控制台 error 为 0；最终把用户正在审查的工作台留在内置浏览器。

## 六、交付边界

- 本轮不同步 GitHub。
- 不触发真实 AI 供应商调用，不修改用户业务数据；浏览器测试只做导航、刷新、主题和可恢复的编辑器输入/拖放验证。
- 保留工作区中既有未提交修改。

## 七、实施与验收结果

### 7.1 实施结果

- 路由恢复统一使用站内安全目标；401 登录恢复保留完整 `path + query + hash`。
- 分镜工作流阶段写入 `stage` 查询参数，刷新不再回到“剧本管理”；画布切换剧集时显式保留 hash。
- 主工作台素材拖动升级为 Pointer Events：6px 移动阈值区分点击与拖动，不创建图片拖影；鼠标、触控板、笔与自动化输入共用同一轨迹。
- textarea 与 contenteditable 均支持普通文本、空白行和仅空格行的落点反馈；Pointer Events 的移动轨迹与最终插入共用同一 offset。
- `@` 素材选择器浮动在提示词上方，内部滚动并轻量渲染最多 30 个匹配项；移除“@素材”矩形与已引用标签条。
- 浅色页面、卡片、参数区和侧栏改为中性白/雾灰；移除 body 紫青径向水洗。按钮、焦点与播放占位仍保留小面积品牌紫。
- 补充 80/160/210ms 交互节奏、pressed、surface reveal、输入焦点、滚动条与 reduced-motion 兼容。

### 7.2 自动化结果

- `node --test test/*.test.js`：27/27 通过。
- `npm run build`：通过，1663 modules transformed。
- `git diff --check`：通过；仅报告工作区既有 LF/CRLF 提示，无空白错误。

### 7.3 内置浏览器 + computer-use 结果

- `/film/2?episode=2&stage=storyboard`：用 `Ctrl+R` 刷新后 URL、分镜管理阶段和原提示词均保持一致。
- `/film/2/canvas?episode=2#shot-3` 与 `/free-create?sequence_id=1#prompt`：刷新前后 URL 完全一致。
- 实际把“老师”素材拖到仅含空格的第二行：结果为 `第一行\n   @老师\n第三行`，证明空格行落点和实际插入一致；拖动过程无图片拖影。
- 输入 `@`：浮层位于提示词框上方，420×260，可内部滚动；旧矩形/标签计数为 0。
- 浅色模式：`body.backgroundImage = none`，分镜参数区背景为 `rgb(247, 248, 250)`。
- 验收产生的临时提示词已恢复；刷新后原内容仍为 `@ @1111这种@老师 111111111111@老师 1111111111`。原有“教室、老师、22”三个镜头素材也已恢复并经刷新确认持久化。
- 浏览器控制台 error 为 0；仅有 4 条 Element Plus `el-radio label` 弃用 warning，与本轮功能无关。
