# Codex 极致视觉与丝滑动效 UI 重构总控提示词

> 目标网站：`https://xc.agent.richbest.cn/`
>
> 任务类型：**Major UI Redesign / Premium Visual Rebuild**
>
> 核心目标：**保留业务逻辑，彻底重构表现层，追求极致丝滑、极强视觉冲击力、现代高级感与高完成度。**

---

# 1. 总目标

请对当前项目执行一次真正的、系统性的、颠覆式 UI 重构。

目标参考：

```text
https://xc.agent.richbest.cn/
```

本任务不是：

```text
换主题
改几个颜色
微调字号
调整 padding
局部 CSS 优化
Element Plus / Ant Design 换肤
Minimal Diff
```

而是：

```text
Major UI Redesign
+
Premium Visual Rebuild
+
Motion Experience Upgrade
```

最终页面必须同时具备：

- 强烈视觉冲击力；
- 高级感；
- 现代感；
- 极致丝滑的交互体验；
- 清晰的信息层级；
- 大胆但克制的视觉设计；
- 连贯统一的动效系统；
- 明显区别于旧版的全新视觉语言；
- 高质量 Desktop 体验；
- 稳定 Responsive；
- 良好的真实性能。

---

# 2. 最重要的设计原则

整个重构遵循以下优先级：

```text
视觉冲击力
>
整体高级感
>
交互丝滑度
>
视觉一致性
>
信息层级
>
真实可用性
>
工程可维护性
>
Diff 大小
```

不要为了：

```text
少改代码
复用旧组件
减少文件修改
保持旧 DOM
```

而牺牲最终效果。

如果旧 UI 结构限制设计：

> **直接重构表现层。**

---

# 3. 核心任务定义

当前任务应该被理解为：

> **保留 Business Core，重新打造整个 Presentation Layer。**

基本原则：

```text
Business Logic = Protect

Presentation Layer = Rebuild When Necessary
```

允许大胆重构：

```text
UI
Layout
DOM
Component Tree
Design Tokens
Motion
Interaction
Visual Hierarchy
```

不要大胆修改：

```text
API
业务逻辑
权限
后端
核心状态行为
数据协议
```

---

# 4. 必须保护的内容

默认保护：

- API Contract；
- 后端接口；
- 请求参数语义；
- 返回数据结构；
- 核心业务流程；
- 用户状态；
- 登录逻辑；
- 权限逻辑；
- 状态管理中的业务行为；
- Router 的业务语义；
- WebSocket 协议；
- 上传逻辑；
- 下载逻辑；
- 表单核心业务校验；
- 数据模型；
- 后端代码。

如果某个旧组件同时包含：

```text
业务逻辑
+
旧 UI
```

优先采用：

```text
保留 / 抽取业务逻辑
↓
重新设计表现层
↓
重新接入业务能力
```

---

# 5. 允许进行的大规模前端重构

明确允许：

- 重写 App Shell；
- 重写 Header；
- 重写 Sidebar；
- 重写 Navigation；
- 重写 Main Workspace；
- 重构页面 DOM；
- 重构 Component Tree；
- 新建展示型组件；
- 删除过时 UI 组件；
- 拆分大型组件；
- 重构 CSS / SCSS / Less；
- 重构 Theme；
- 重构 Design Tokens；
- 重构 Typography；
- 重构 Grid；
- 重构 Card；
- 重构 Toolbar；
- 重构 Empty State；
- 重构 Dashboard；
- 重构 Hero；
- 重构页面留白；
- 重构视觉层级；
- 重构交互动效；
- 重构响应式逻辑。

如果合理：

```text
修改 10 个文件
修改 20 个文件
修改 30 个文件
```

都可以接受。

不要人为限制 Diff。

---

# 6. 目标网站是视觉参考核心

使用 Browser / Browser Testing / Playwright 实际打开：

```text
https://xc.agent.richbest.cn/
```

不要凭文字猜。

不要只分析源码。

必须观察最终浏览器渲染效果。

重点理解：

- 页面气质；
- 页面节奏；
- 空间关系；
- 视觉焦点；
- 组件密度；
- 留白策略；
- 色彩层级；
- 字体层级；
- 光影；
- 动效；
- Hover；
- Active；
- Selected；
- 页面转场；
- 滚动体验。

---

# 7. 分析阶段必须快速

分析只服务于实施。

不要：

```text
分析 30 分钟
写大量 Markdown
只改几十行代码
```

规则：

> 分析与文档编写不得成为本轮工作的主体。

完成必要理解以后：

**立即开始实际 UI 重构。**

---

# 8. 首先判断旧 UI 是否值得保留

开始编码前快速回答：

```text
当前页面骨架是否适合目标设计？
```

如果：

```text
YES
```

可以复用部分结构。

如果：

```text
NO
```

直接重构：

- Layout；
- DOM；
- Component Tree；
- Visual Structure。

不要因为：

```text
旧组件已经存在
```

就强行保留。

---

# 9. 视觉目标：必须产生强烈第一印象

用户打开页面后的前 1 秒，应明显感受到：

> **这不是旧项目换皮，而是一套重新设计过的产品。**

重点打造：

- 强主视觉；
- 高级背景层次；
- 大胆 Typography；
- 清晰 Content Hierarchy；
- 精致的空间比例；
- 强弱明确的 Surface；
- 克制但有力量的 Accent；
- 高质量 Hover；
- 连贯 Transition；
- 精致 Loading；
- 高级 Empty State；
- 微妙的光影；
- 精细 Border；
- 合理 Blur；
- 有节奏的 Motion。

---

# 10. 不要把“视觉冲击力”理解成堆特效

禁止为了视觉冲击力滥用：

- 大量渐变；
- 到处发光；
- 过量毛玻璃；
- 所有组件悬浮；
- 所有元素都有动画；
- 巨量阴影；
- 高频闪动；
- 彩虹色；
- 复杂粒子特效；
- 无意义 3D；
- 过长动画。

真正的视觉冲击力来自：

```text
构图
+
比例
+
Typography
+
Color Contrast
+
Whitespace
+
Motion Rhythm
+
Hierarchy
```

---

# 11. 高级感原则

优先使用：

- 强布局；
- 大留白；
- 清晰层级；
- 高质量字体比例；
- 精细 Border；
- 克制色彩；
- 低噪点背景；
- 精确对齐；
- 稳定间距；
- 大小对比；
- 精致 Hover；
- 统一 Transition。

避免：

```text
廉价渐变
廉价发光
过度圆角
所有卡片一个样
大量 Badge
大量装饰
过多色彩
```

---

# 12. Typography 是核心视觉元素

Typography 不允许只是：

```text
font-size 改大一点
```

需要系统设计：

- Display；
- H1；
- H2；
- H3；
- Body；
- Secondary；
- Caption；
- Label；
- Button；
- Numeric；
- Metadata。

重点控制：

- 字号；
- Weight；
- Line Height；
- Letter Spacing；
- Text Color；
- Width；
- Wrap；
- Vertical Rhythm。

标题必须有明显视觉存在感。

正文必须保持舒适阅读。

---

# 13. Layout 必须大胆重构

优先解决宏观结构：

```text
App Shell
Header
Sidebar
Main Workspace
Content Width
Grid
Section
Hero
Main / Aside
```

不要先花大量时间：

```text
调整某个按钮 2px
```

宏观布局不成立：

微调没有意义。

---

# 14. 页面必须建立明确视觉焦点

每一个主页面都应该明确：

```text
Primary Focus
Secondary Focus
Supporting Content
Background Information
```

不要所有模块：

```text
同样大小
同样 Card
同样颜色
同样权重
```

必须建立：

- 大小差异；
- 颜色差异；
- 密度差异；
- 留白差异；
- 层级差异。

---

# 15. Surface 层次

根据目标站实际表现，建立清晰 Surface：

```text
Page Background

Surface 1

Surface 2

Elevated Surface

Interactive Surface

Selected Surface
```

优先使用：

```text
Background Contrast
+
Border
+
Subtle Shadow
```

建立空间层次。

避免依赖超重 Shadow。

---

# 16. 色彩系统

分析目标站真实色彩关系。

至少形成：

```text
--background
--surface
--surface-elevated

--text-primary
--text-secondary
--text-muted

--border
--border-hover
--border-active

--accent
--accent-hover

--success
--warning
--danger
```

不要每个页面自己定义颜色。

---

# 17. Spacing 必须形成节奏

Spacing 不是随机数字。

建立统一体系，例如：

```text
4
8
12
16
20
24
32
40
48
64
80
96
```

页面应该具有：

- 紧凑区域；
- 正常区域；
- 大留白区域。

不要所有 Gap 都是：

```text
16px
```

---

# 18. 极致丝滑是核心目标

本项目的交互必须追求：

> **所有反馈及时、自然、连续，没有突兀跳变。**

重点关注：

- Hover；
- Active；
- Focus；
- Expand；
- Collapse；
- Drawer；
- Modal；
- Tabs；
- Dropdown；
- Navigation；
- Page Transition；
- Loading；
- Skeleton；
- List Update；
- Scroll；
- Card Interaction。

---

# 19. 动效设计原则

所有动画必须服务于：

```text
状态变化
空间关系
用户反馈
视觉连续性
```

不能为了动画而动画。

一个合格动画应该回答：

```text
元素从哪里来？
为什么移动？
移动到哪里？
用户是否理解状态变化？
```

---

# 20. 动效时长体系

建议建立统一 Motion Duration：

```text
Fast:
100ms - 160ms

Normal:
180ms - 260ms

Slow:
280ms - 420ms
```

用途：

```text
Hover
100 - 160ms

Button feedback
100 - 180ms

Dropdown
160 - 220ms

Tabs
180 - 240ms

Drawer
220 - 320ms

Modal
220 - 320ms

Page-level transition
260 - 420ms
```

避免：

```text
700ms
1000ms
```

这种拖沓动画。

---

# 21. Easing 必须自然

不要所有动画：

```css
linear
```

也不要所有：

```css
ease
```

建议优先使用自然减速曲线。

例如：

```css
cubic-bezier(0.22, 1, 0.36, 1)
```

对于进入动画：

```text
快速启动
柔和停止
```

对于退出动画：

```text
干净
快速
不拖尾
```

---

# 22. 重点使用 Transform 与 Opacity

为了保持丝滑：

优先动画：

```text
transform
opacity
filter（谨慎）
```

尽量避免频繁动画：

```text
width
height
top
left
margin
padding
```

如果需要尺寸动画：

优先考虑：

- transform；
- grid；
- clip-path；
- max-height 的有限场景；
- View Transitions；
- FLIP 思路。

---

# 23. Hover 必须高级

Hover 不要只是：

```text
background 变色
```

可以组合：

```text
轻微 translateY
轻微 scale
Border 变化
Surface 变化
Icon 位移
Opacity 变化
Subtle glow
```

但幅度必须克制。

例如：

```text
translateY(-1px ~ -3px)

scale(1.005 ~ 1.02)
```

避免：

```text
scale(1.1)
```

---

# 24. Button 必须有物理反馈

Button 至少考虑：

```text
Default
Hover
Active
Focus
Disabled
Loading
```

Active 状态可以使用：

```text
scale(0.97 ~ 0.99)
```

制造轻微按压反馈。

不要过度。

---

# 25. Card 动效

Card Hover 应体现：

```text
层级提升
+
交互可点击
```

可以使用：

- Border 增强；
- Surface 提升；
- Shadow 微调；
- Translate；
- 内部 Icon 移动。

不要所有 Card：

```text
大幅漂浮
```

---

# 26. Navigation 动效

导航切换应该连续。

例如：

- Active Indicator 平滑移动；
- Background Pill 滑动；
- Text Color 过渡；
- Icon 状态变化；
- Sidebar Expand / Collapse 连贯。

避免：

```text
瞬间跳变
```

---

# 27. 页面进入动画

主要页面进入时：

允许轻量：

```text
opacity
+
translateY(4px ~ 12px)
```

时间：

```text
180ms - 320ms
```

不要：

```text
每次进页面所有元素飞进来
```

---

# 28. Stagger 动画

对于：

- Dashboard；
- Card Grid；
- Menu；
- Initial Content；

可以适度使用 Stagger。

例如：

```text
20ms - 50ms
```

每项延迟。

总动画时间不要过长。

---

# 29. Modal / Drawer

Modal 打开：

```text
Backdrop Fade
+
Panel Scale / Translate
```

Drawer：

```text
Translate
+
Backdrop Fade
```

关闭速度通常应该：

```text
略快于打开
```

保证操作利落。

---

# 30. Loading 体验

禁止主要交互中频繁出现：

```text
纯白屏
瞬间空内容
跳变
```

优先：

- Skeleton；
- Placeholder；
- Progressive Rendering；
- Local Loading；
- Optimistic Feedback；
- 保留旧内容直到新内容就绪。

用户应该感受到：

> 系统一直在响应。

---

# 31. Skeleton

Skeleton 必须：

- 对应真实布局；
- 不乱跳；
- 尺寸接近最终内容；
- 动画克制。

不要使用：

```text
全页面大量闪光 Skeleton
```

---

# 32. Layout Shift 必须尽量减少

重点避免：

- 图片加载导致跳动；
- 字体加载导致跳动；
- 数据回来整个页面位移；
- Button Loading 导致宽度变化；
- Tab 内容切换高度巨变。

必要时：

```text
预留尺寸
min-height
aspect-ratio
固定 Button Width
Skeleton
```

---

# 33. 滚动体验

滚动区域必须自然。

检查：

- 页面主滚动；
- Sidebar 滚动；
- Modal 滚动；
- Table 滚动；
- Nested Scroll。

避免：

```text
多个滚动条
滚动锁死
滚动穿透
突然回顶
```

---

# 34. 性能是“丝滑”的前提

视觉效果不能以明显卡顿为代价。

Browser 验证时重点关注：

- FPS；
- Long Task；
- Layout Thrashing；
- 重复 Render；
- 大量 DOM；
- 重 Blur；
- 大面积 Filter；
- 无意义 Box Shadow；
- 高频 Resize；
- 高频 Scroll Handler。

---

# 35. 避免重型视觉效果

谨慎使用：

```text
backdrop-filter
filter: blur()
超大 box-shadow
大面积 fixed blur
复杂 SVG filter
持续运行 Canvas
持续运行粒子
```

如果实际浏览器出现掉帧：

> **优先性能，而不是保留特效。**

---

# 36. 60 FPS 体验目标

主要动画目标：

```text
60 FPS
```

在常见桌面环境中：

- Hover 不掉帧；
- Drawer 不明显卡顿；
- Modal 不抖；
- Sidebar 展开流畅；
- 页面滚动稳定；
- Tabs 切换自然。

---

# 37. Reduced Motion

尊重：

```css
@media (prefers-reduced-motion: reduce)
```

对于用户明确要求减少动画时：

- 移除大范围位移；
- 缩短动画；
- 保留必要状态反馈。

---

# 38. Cursor 与交互反馈

所有可点击元素：

必须具备明确交互反馈。

检查：

- cursor；
- hover；
- active；
- focus-visible；
- disabled。

不要出现：

```text
看起来能点但没有反馈
```

---

# 39. Focus 状态

Keyboard Focus 不得丢失。

实现：

```text
focus-visible
```

确保：

- 可访问性；
- 高级感；
- 不出现廉价默认 outline；
- 但也不能完全移除 Focus Indicator。

---

# 40. Icon 动效

Icon 可以轻微参与：

- Arrow Translate；
- Chevron Rotate；
- Plus Rotate；
- Loading Spin；
- Copy Success；
- Expand Indicator。

不要：

```text
所有 Icon 都持续动画
```

---

# 41. Micro Interaction

可以增加适量 Micro Interaction：

- Copy Success；
- Save Success；
- Button Press；
- Toggle；
- Expand；
- Upload；
- Delete；
- Favorite；
- Status Change。

原则：

```text
短
快
明确
自然
```

---

# 42. 视觉冲击力重点区域

优先投入精力：

```text
App Shell
Hero / Main Workspace
Header
Sidebar
主要数据区域
核心 CTA
Primary Card
Empty State
Loading State
```

不要平均用力。

---

# 43. 首屏必须精雕细琢

首屏决定产品第一印象。

重点优化：

- Background；
- Header；
- Main Heading；
- Primary Content；
- Hero / Workspace；
- Key Action；
- Main Card；
- Initial Motion。

首屏必须具备：

> 一眼高级。

---

# 44. 不允许“组件库默认感”

如果最终页面仍然一眼看出：

```text
Element Plus 默认后台
Ant Design 默认后台
TDesign 默认后台
```

则重构不合格。

UI Library 可以提供能力。

但：

> **最终视觉语言必须属于当前产品，而不是组件库。**

---

# 45. Browser / Playwright 强制执行

每完成主要改动后：

启动项目。

例如：

```bash
npm run dev
```

打开 localhost。

同时打开：

```text
https://xc.agent.richbest.cn/
```

进行真实视觉对比。

---

# 46. 对比顺序

优先比较：

## P0

```text
整体气质
布局
页面骨架
视觉重心
信息层级
首屏冲击力
Typography
Background
```

## P1

```text
Card
Button
Toolbar
Input
Navigation
Spacing
Border
Surface
```

## P2

```text
Hover
Animation
Icon
Shadow
1-2px 细节
```

不要 P0 没完成就一直抠 P2。

---

# 47. 强制截图验收

至少检查：

```text
1440 × 900

1920 × 1080
```

如果项目支持移动端：

额外检查：

```text
1024 × 768

390 × 844
```

---

# 48. 每次截图必须问自己

```text
如果把旧版和新版截图放在一起，
用户是否能在 1 秒内判断这是一次大改？
```

如果：

```text
不能
```

继续重构。

---

# 49. 第二个问题

```text
如果隐藏 Logo，
页面是否仍然具有独立、统一、可辨识的设计语言？
```

如果：

```text
不能
```

继续完善 Design System。

---

# 50. 第三个问题

```text
动画是否让体验更顺滑，
还是只是为了炫技？
```

如果是后者：

删除。

---

# 51. 第四个问题

```text
页面是否因为视觉特效影响性能？
```

如果：

```text
YES
```

降低特效成本。

---

# 52. 第五个问题

```text
当前结果是否仍然只是旧 UI 换皮？
```

如果：

```text
YES
```

重新检查：

```text
DOM
Layout
Component Tree
Visual Hierarchy
```

---

# 53. 防止“只改几十行”

不要在：

```text
只修改几十行 CSS
```

之后就自动判断任务完成。

代码行数本身不是目标。

但如果：

- DOM 基本没变；
- Layout 基本没变；
- Component Tree 基本没变；
- 页面截图基本没变；

则：

> **重大 UI 重构显然没有完成。**

---

# 54. 防止过度写文档

不要创建大量：

```text
analysis.md
plan.md
report.md
summary.md
```

除非确实必要。

优先级：

```text
代码实施
>
Browser 验证
>
实际修正
>
必要文档
```

---

# 55. 推荐执行顺序

严格执行：

```text
Step 1
打开目标网站

↓

Step 2
分析其视觉语言和交互

↓

Step 3
打开当前项目

↓

Step 4
识别 Business Core

↓

Step 5
识别应该推倒的 Presentation Layer

↓

Step 6
建立 Design Tokens

↓

Step 7
重构 App Shell

↓

Step 8
重构首屏 / 核心工作区

↓

Step 9
重构主要组件

↓

Step 10
加入统一 Motion System

↓

Step 11
启动 localhost

↓

Step 12
截图

↓

Step 13
与目标站比较

↓

Step 14
修正宏观差异

↓

Step 15
修正组件细节

↓

Step 16
修正 Motion

↓

Step 17
检查实际性能

↓

Step 18
Responsive

↓

Step 19
Console / Network

↓

Step 20
Build / Test
```

---

# 56. 首轮必须完成的内容

第一轮不要只改一个 Button。

优先完整完成：

```text
App Shell
+
Header
+
Sidebar / Navigation
+
Main Workspace
+
首屏核心区域
+
Typography
+
Global Background
+
Primary Cards
+
Primary Motion System
```

完成后：

用户必须明显感受到：

> **项目整体 UI 已经被重新设计。**

---

# 57. Motion Tokens

建议在项目中建立统一 Motion Token。

例如：

```css
--motion-fast: 140ms;
--motion-normal: 220ms;
--motion-slow: 320ms;

--ease-out-premium: cubic-bezier(0.22, 1, 0.36, 1);
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
```

所有组件尽量复用。

不要每个组件：

```text
自己随便写 duration / easing
```

---

# 58. Transition 统一

建议统一基础交互：

```css
transition:
  transform var(--motion-fast) var(--ease-out-premium),
  opacity var(--motion-fast) var(--ease-out-premium),
  background-color var(--motion-fast) var(--ease-out-premium),
  border-color var(--motion-fast) var(--ease-out-premium);
```

根据实际组件调整。

不要无脑：

```css
transition: all;
```

---

# 59. 禁止 transition: all 泛滥

尽量明确声明：

```text
transform
opacity
background-color
border-color
box-shadow
```

避免：

```css
transition: all 300ms;
```

导致不必要 Layout 动画和性能问题。

---

# 60. Animation Budget

每个页面同时运行的明显动画必须有限。

默认原则：

```text
用户当前操作相关元素
>
页面核心元素
>
其他元素
```

不要：

```text
页面所有组件同时不停动
```

---

# 61. Background Motion

如果目标站具有动态背景：

可以考虑：

- Subtle Gradient Shift；
- Slow Light Movement；
- Ambient Glow；
- Noise Texture；
- Mesh Gradient。

但必须：

```text
非常慢
非常克制
不影响文本阅读
不明显占用 GPU
```

---

# 62. 视觉设计最终标准

最终页面应该给人的感觉是：

```text
精致
高级
现代
有力量
干净
流畅
稳定
统一
```

而不是：

```text
花哨
廉价
过度
杂乱
炫技
```

---

# 63. 性能最终标准

如果某个视觉效果造成：

- 滚动掉帧；
- CPU 占用明显增加；
- GPU 压力过大；
- 输入延迟；
- Hover 卡顿；
- 页面首次加载过慢；

必须优化或删除。

---

# 64. 工程标准

同时要求：

- 不大量重复 CSS；
- 不大量 Inline Style；
- 不堆 `!important`；
- 不疯狂使用 `::v-deep`；
- 不建立三套 Theme；
- 不增加无意义依赖；
- 不破坏 TypeScript；
- 不破坏已有功能；
- 不通过 Hack 达成视觉效果。

---

# 65. 最终验收

完成之前必须确认：

## Visual

- 新旧页面一眼可辨；
- 具有明显视觉冲击力；
- 视觉语言统一；
- 首屏足够高级；
- Typography 有层级；
- Surface 有层次；
- Spacing 有节奏；
- 核心模块被真正重构。

## Motion

- Hover 自然；
- Button 有反馈；
- Navigation 连贯；
- Modal / Drawer 丝滑；
- Page Transition 克制；
- Loading 不跳；
- 动画无明显卡顿；
- 不存在大量无意义动画。

## Performance

- 常用操作流畅；
- Scroll 流畅；
- 动画尽量保持高帧率；
- 无明显 Layout Shift；
- 无明显 Long Task；
- 没有为了视觉牺牲实际可用性。

## Functional

- API 正常；
- Router 正常；
- Store 正常；
- 权限正常；
- 核心业务正常。

---

# 66. 最终完成判断

不要问：

```text
代码写完了吗？
```

要问：

```text
这个页面现在是否真正具备：
极致丝滑
+
强视觉冲击力
+
高级产品感
+
完整统一的设计语言？
```

如果答案不是明确的：

```text
YES
```

继续优化。

---

# 67. 最终执行指令

现在开始执行。

目标网站：

```text
https://xc.agent.richbest.cn/
```

严格遵守：

```text
1. 使用 Browser 打开目标网站
2. 观察真实布局、视觉、交互和动效
3. 分析当前项目
4. 保护 Business Core
5. 大胆重构 Presentation Layer
6. 不追求 Minimal Diff
7. 不停留在文档分析
8. 优先重构 App Shell
9. 优先重构首屏
10. 优先打造强视觉焦点
11. 建立统一 Typography
12. 建立统一 Design Tokens
13. 建立统一 Motion System
14. Hover / Active / Focus 必须自然
15. Modal / Drawer / Navigation 必须丝滑
16. 动画优先使用 transform / opacity
17. 避免重型视觉特效造成掉帧
18. 启动 localhost
19. 使用 Browser / Playwright 截图
20. 与目标站真实页面对比
21. 优先修复宏观 Layout
22. 再优化组件
23. 再优化 Motion
24. 检查实际流畅度
25. 检查 Responsive
26. 检查 Console / Network
27. Build / Test
28. 如果最终截图仍然像旧版，继续重构
29. 如果动画卡顿，继续优化
30. 如果只是组件库换肤，继续重构
```

---

# 68. 一句话最高原则

> **保留业务，推倒旧视觉；以目标网站为参考，打造一套具备强烈视觉冲击力、极致丝滑交互、高级设计语言和真实高性能的全新前端体验。**
