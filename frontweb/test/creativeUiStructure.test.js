import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('自由创作只渲染一个提示词编辑器', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')
  const editorTags = source.match(/<OmniAssetPromptEditor\b/g) || []

  assert.equal(editorTags.length, 1)
  assert.match(source, /<div class="shot-script"><OmniAssetPromptEditor\s+ref="promptEditorRef"\s+v-model="prompt"/)
  assert.match(source, /class="insert-at-caret"/)
  assert.match(source, /promptEditorRef\?\.insertAtCaret\(asset\)/)
  assert.match(source, /@keydown\.up\.prevent="selectRelative\(-1\)"/)
  assert.match(source, /@keydown\.down\.prevent="selectRelative\(1\)"/)
})

test('首页委托共享头部提供新建、账户和素材入口', async () => {
  const [source, header] = await Promise.all([
    readSource('../src/views/FilmList.vue'),
    readSource('../src/components/ui/AppHeader.vue'),
  ])

  assert.match(source, /<AppHeader/)
  assert.match(source, /@create-command="handleCreateCommand"/)
  assert.match(source, /@account-command="handleHeaderCommand"/)
  for (const command of ['project', 'import', 'theme', 'deleted', 'config', 'account', 'logout']) {
    assert.match(header, new RegExp(`command="${command}"`))
  }
  assert.match(header, /emit\('create-omni'\)/)
})

test('自由创作素材上传区保留可识别的大图预览', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')

  assert.match(source, /grid-template-columns:minmax\(300px,340px\) minmax\(0,1fr\) minmax\(280px,320px\)!important/)
  assert.match(source, /\.material-pool\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important;gap:8px;max-height:264px\}/)
  assert.match(source, /\.material-card\{height:auto!important;min-height:126px;display:grid;grid-template-rows:minmax\(94px,1fr\) auto\}/)
})

test('分镜生成操作保留 main 的紫色可用与禁用层级', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')

  assert.match(source, /creation-generate-actions \.generate-button\.el-button--primary:not\(\.is-disabled\):not\(:disabled\)/)
  assert.match(source, /creation-generate-actions \.generate-button\.el-button--primary\.is-disabled/)
  assert.match(source, /border-color:color-mix\(in srgb,var\(--studio-accent\) 52%,var\(--border-color\)\)!important/)
})

test('工作台不以镜头时长重复模拟生成进度', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')

  assert.match(source, /class="generation-progress" role="status"/)
  assert.match(source, /class="time-ruler" aria-label="镜头时长"><span>时长 \{\{ duration \}\} 秒<\/span><span>最多 \{\{ maxDuration \}\} 秒<\/span>/)
  assert.doesNotMatch(source, /class="time-ruler"><span>0秒<\/span><div><i/)
})

test('主工作台使用真实媒体主舞台和可搜索创作档案而不是卡片墙', async () => {
  const source = await readSource('../src/views/FilmList.vue')

  for (const marker of [
    'class="media-stage"',
    'class="media-canvas"',
    'class="records-workspace"',
    'class="record-search"',
    'class="record-list"',
    'class="media-filmstrip"',
  ]) {
    assert.ok(source.includes(marker), `missing redesigned project desk marker: ${marker}`)
  }
  assert.match(source, /const allRecords = computed/)
  assert.match(source, /const filteredRecords = computed/)
  assert.match(source, /omniVideoAPI\.assets\(\{ page: 1, page_size: 40 \}\)/)
  assert.match(source, /videosAPI\.list\(\{ page: 1, page_size: 12, status: 'completed' \}\)/)
  assert.match(source, /<template v-if="heroVideoLayers\.length"><video v-for="layer in heroVideoLayers"/)
  assert.match(source, /\.media-stage::before \{ content: none; \}/)
  assert.match(source, /@click="openRecord\(record\)"/)
  assert.match(source, /class="record-actions record-actions--panel"/)
  assert.match(source, /@click\.stop="record\.type === 'drama' \? onDelete\(record\.source\) : deleteOmniProject\(record\.source\)"/)
  assert.doesNotMatch(source, /<div class="project-grid"/)
  assert.doesNotMatch(source, /class="command-dock"/)
  assert.match(source, /\.film-list \{ height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; \}/)
  assert.doesNotMatch(source, /records-scrim/)
  assert.doesNotMatch(source, /\.records-workspace \{ position: fixed;/)
  assert.match(source, /projects-wrap\.showing-records/)
})

test('workbench and media library expose the premium entry surfaces', async () => {
  const [tools, library] = await Promise.all([
    readSource('../src/views/AITools.vue'),
    readSource('../src/views/MediaLibrary.vue'),
  ])

  assert.match(tools, /class="tool-manifesto"/)
  assert.match(tools, /class="directory-list"/)
  assert.match(tools, /AI<br \/><em>工具箱<\/em>/)
  assert.doesNotMatch(tools, /灵感不该|困在工具里/)
  assert.doesNotMatch(tools, /class="tool-grid"/)
  assert.match(library, /class="page-header library-header"/)
  assert.match(library, /素材 · \{\{ total \}\} 项/)
  assert.doesNotMatch(library, /ASSET ATLAS|SELECT A CAPABILITY|RICH MEDIA · AI STUDIO/)
  assert.match(library, /Asset room: a full-height library rail/)
})

test('专项工具页沿用中文工作台标签和产品主色', async () => {
  const [workbench, media] = await Promise.all([
    readSource('../src/views/ToolWorkbench.vue'),
    readSource('../src/views/ToolMediaGeneration.vue'),
  ])

  for (const marker of ['创作工具', "content:'创作输入'", "content:'运行历史'", "content:'生成结果'"]) {
    assert.match(workbench, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(workbench, /AI RUN STUDIO|INPUT DECK|RUN ARCHIVE|OUTPUT STAGE/)
  assert.match(media, /<p>结果预览<\/p>/)
  assert.doesNotMatch(media, /OUTPUT PREVIEW/)
})

test('generation settings keep configured model identifiers unchanged', async () => {
  const source = await readSource('../src/components/GenerationSettings.vue')
  assert.match(source, /return String\(model \|\| ''\) \|\| '未选择'/)
  assert.doesNotMatch(source, /Seedance .*标准版|可灵视频模型|万相视频模型|混元视频模型/)
})

test('运营页面始终提供返回主页入口', async () => {
  const [consoleSource, reportsSource] = await Promise.all([
    readSource('../src/views/AdminConsole.vue'),
    readSource('../src/views/OperationsScale.vue'),
  ])

  for (const source of [consoleSource, reportsSource]) {
    assert.match(source, /返回主页/)
    assert.match(source, /\$router\.push\('\/'\)/)
  }
})

test('运营账本提供日期和角色筛选，列表操作保持中性层级', async () => {
  const source = await readSource('../src/views/AdminConsole.vue')

  assert.match(source, /按日期筛选资金流水/)
  assert.match(source, /label="管理员" value="admin"/)
  assert.match(source, /label="普通用户" value="user"/)
  assert.match(source, /按具体用户筛选资金流水/)
  assert.match(source, /filteredBillingUsers/)
  assert.match(source, /billingUserLabel/)
  assert.match(source, /user_id: null/)
  assert.match(source, /billingFilterParams/)
  assert.match(source, /filters\.billing\.user_id/)
  assert.match(source, /class="balance-adjust-action"/)
  assert.match(source, /\.balance-adjust-action\)\{padding:\.28rem/)
})

test('运营后台支持查看和调整用户项目分组', async () => {
  const source = await readSource('../src/views/AdminConsole.vue')

  assert.match(source, /label="项目分组"/)
  assert.match(source, /openUserGroup/)
  assert.match(source, /saveUserGroup/)
  assert.match(source, /adminAPI\.setTenantMember/)
  assert.match(source, /使用所选分组绑定的 API 与价目表/)
})

test('创作账号不再加载运营专属 AI 配置资源，管理员可直达项目分组 API 设置', async () => {
  const [film, filmList, config, header, admin] = await Promise.all([
    readSource('../src/views/FilmCreate.vue'),
    readSource('../src/views/FilmList.vue'),
    readSource('../src/components/AIConfigContent.vue'),
    readSource('../src/components/ui/AppHeader.vue'),
    readSource('../src/views/AdminConsole.vue'),
  ])

  assert.match(film, /v-if="isAdmin" class="btn-ai-config"/)
  assert.match(film, /v-if="isAdmin" v-model="showAiConfigDialog"/)
  assert.match(film, /由项目分组统一配置/)
  assert.match(filmList, /if \(!isAdmin\) return/)
  assert.match(config, /user\?\.console_access !== true/)
  assert.match(header, /command="group-settings"/)
  assert.match(header, /项目分组 API/)
  assert.match(admin, /route\.query\.settings === 'tenants'/)
  assert.match(admin, /AI \/ SD2 配置/)
  assert.match(admin, /:tenant-id="configTenant.id"/)
})

test('项目分组从专属 AI／SD2 页面维护默认配置，价目保存不覆盖绑定', async () => {
  const [source, aiConfig] = await Promise.all([
    readSource('../src/views/AdminConsole.vue'),
    readSource('../src/components/AIConfigContent.vue'),
  ])

  assert.match(source, /AI \/ SD2 配置/)
  assert.match(source, /:tenant-id="configTenant.id"/)
  assert.match(source, /保存价目不会改动这些配置/)
  assert.match(source, /ai_configs: \(tenant\.configs \|\| \[\]\)\.map/)
  assert.match(source, /adminAPI\.updateTenant\(tenantForm\.id, \{ name: tenantForm\.name\.trim\(\) \}\)/)
  assert.doesNotMatch(source, /v-model="tenantForm\.name" :disabled="!!tenantForm\.id"/)
  assert.match(aiConfig, /const tenantId = computed/)
  assert.match(aiConfig, /tenant_id: tenantId\.value/)
})

test('运营工作台把纵向滚动交给页面，表格只承接横向滚动', async () => {
  const source = await readSource('../src/views/AdminConsole.vue')

  assert.match(source, /:global\(body\)\{overflow-x:hidden!important;overflow-y:auto!important\}/)
  assert.match(source, /\.console,\.console\.overview-mode,\.console\.workspace-mode\{height:auto!important;max-height:none!important;overflow:visible!important;overscroll-behavior:auto\}/)
  assert.match(source, /\.overview-mode \.hero-grid>\.command-card,\.overview-mode \.dashboard-grid>\.command-card\{height:auto!important;max-height:none!important;overflow:visible!important\}/)
  assert.match(source, /\.workspace-mode>\.workbench>\.table-scroll\{overflow-x:auto\}/)
})

test('账户和运营页面使用工作台层级而非传统驾驶舱卡片墙', async () => {
  const [account, admin, trendChart] = await Promise.all([
    readSource('../src/views/AccountCenter.vue'),
    readSource('../src/views/AdminConsole.vue'),
    readSource('../src/components/OperationsTrendChart.vue'),
  ])

  assert.match(account, /账户与用量/)
  assert.match(account, /我的账户/)
  assert.match(account, /class="account-intro"/)
  assert.match(account, /Account workspace: calm ledger hierarchy/)
  assert.match(admin, /<h1>运营工作台<\/h1>/)
  assert.match(admin, /当前待办/)
  assert.match(admin, /<OperationsTrendChart :trend="overview\?\.trend \|\| \[\]"/)
  assert.match(trendChart, /近七日生产/)
  assert.match(trendChart, /from 'echarts\/core'/)
  assert.match(trendChart, /echarts\.init\(chartElement\.value/)
  assert.match(admin, /Operations workspace: clear priorities/)
  assert.match(admin, /在一屏内完成“发现问题、判断生产、进入处置”/)
  assert.match(admin, /\.overview-mode \.trend-card :deep\(\.operations-echart\)\{height:11rem/)
  assert.doesNotMatch(admin, /AI 漫剧运营驾驶舱/)
})

test('工作区在缩放时让舞台优先收缩，运营导航提供图标语义', async () => {
  const [base, workspaces, admin, free, film] = await Promise.all([
    readSource('../src/styles/base.css'),
    readSource('../src/styles/workspaces.css'),
    readSource('../src/views/AdminConsole.vue'),
    readSource('../src/views/FreeCreate.vue'),
    readSource('../src/views/FilmCreate.vue'),
  ])

  assert.match(base, /Zoom-safe baseline/)
  assert.match(workspaces, /grid-template-columns: var\(--ui-rail-width\) minmax\(0, 1fr\) var\(--ui-inspector-width\)/)
  assert.match(admin, /<component :is="item\.icon" \/>/)
  assert.match(admin, /\.workspace-nav button \.el-icon/)
  assert.match(admin, /\.metric-card>\.el-icon/)
  assert.match(free, /缩放与窄屏：三栏按可用宽度收缩/)
  assert.match(free, /grid-template-columns:minmax\(196px,230px\) minmax\(0,1fr\) minmax\(292px,350px\)/)
  assert.match(free, /project-storyboard-page \.workbench\{height:min\(820px,calc\(100dvh - 120px\)\)/)
  assert.match(film, /width:calc\(100% - 214px\);max-width:none/)
  assert.match(film, /A restrained sense of motion keeps the production flow visually alive/)
  assert.match(film, /@keyframes workflow-orbit/)
  assert.doesNotMatch(film, /storyboard-workbench-toolbar/)
})

test('主页使用本地完成视频组成可控轮播舞台', async () => {
  const source = await readSource('../src/views/FilmList.vue')

  assert.match(source, /const heroVideos = computed/)
  assert.match(source, /const activeHeroVideo = computed/)
  assert.match(source, /const nextHeroVideo = computed/)
  assert.match(source, /const heroVideoLayers = ref\(\[\]\)/)
  assert.match(source, /function promoteHeroVideoLayer\(id, event\)/)
  assert.match(source, /主页切换不再闪出静态封面/)
  assert.doesNotMatch(source, /:poster="heroPoster/)
  assert.doesNotMatch(source, /<img v-else-if="heroMedia\[0\]"/)
  assert.match(source, /const seen = new Set\(\)/)
  assert.match(source, /同一项目的多个成片也属于可轮播作品/)
  assert.doesNotMatch(source, /const projects = new Set\(\)/)
  assert.match(source, /\.slice\(0, 4\)/)
  assert.match(source, /class="hero-video-preload"/)
  assert.match(source, /preload="metadata"/)
  assert.match(source, /@ended="layer\.id === activeHeroLayerId && advanceHeroVideo\(\)"/)
  assert.match(source, /@loadeddata="promoteHeroVideoLayer\(layer\.id, \$event\)" @canplay="promoteHeroVideoLayer\(layer\.id, \$event\)"/)
  assert.match(source, /@error="discardHeroVideoLayer\(layer\.id\)"/)
  assert.match(source, /class="hero-video-controls"/)
  assert.match(source, /onBeforeUnmount\(\(\) => \{ stopHeroRotation\(\); window\.clearTimeout\(heroVideoLayerTransitionTimer\) \}\)/)
})

test('无作品账号使用固定的全局默认媒体资源', async () => {
  const source = await readSource('../src/views/FilmList.vue')
  assert.match(source, /const defaultHeroVideos = ref\(\[\]\)/)
  assert.match(source, /videosAPI\.defaultHomepageVideos\(\)/)
  assert.match(source, /recentVideos\.length \? recentVideos : defaults/)
  assert.match(source, /\.slice\(0, 3\)/)
  assert.doesNotMatch(source, /MediaRecorder|captureStream\(/)
})

test('单集项目页使用紧凑的制作概览而非展示型大标题', async () => {
  const source = await readSource('../src/views/DramaDetail.vue')

  assert.match(source, /class="episode-progress-heading"/)
  assert.match(source, /制作概览/)
  assert.match(source, /第 \{\{ episodes\[0\]\?\.episode_number/)
  assert.match(source, /单集概览以“剧集信息 \+ 下一步”成对呈现/)
  assert.match(source, /episode-next-step h3\{font-size:clamp\(1\.55rem,2\.15vw,2\.35rem\)/)
  assert.match(source, /episodes-section\.is-single \.episode-grid\{height:auto;min-height:27rem/)
})

test('视频创作界面展示已持久化的任务进度和最近状态说明', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')
  assert.match(source, /class="generation-progress"/)
  assert.match(source, /const generationProgress = computed/)
  assert.match(source, /task_progress/)
  assert.match(source, /task_message/)
  assert.match(source, /const pollingJobIds = new Set\(\)/)
  assert.match(source, /状态连接暂不可用，正在重试/)
  assert.match(source, /activeGenerationStatuses\.has\(job\.status\)/)
  assert.match(source, /generationStallMinutes/)
  assert.match(source, /分钟未收到新状态，仍在持续查询/)
})

test('成片操作栏不会覆盖视频，嵌入分镜保持三栏创作节奏', async () => {
  const [free, film] = await Promise.all([
    readSource('../src/views/FreeCreate.vue'),
    readSource('../src/views/FilmCreate.vue'),
  ])

  const videoStageStart = free.indexOf('<div class="video-stage"')
  const frameActionsStart = free.indexOf('<div v-if="activeVideoUrl" class="frame-actions"')
  assert.ok(videoStageStart >= 0 && frameActionsStart > videoStageStart, 'the frame actions must follow the video stage')
  assert.doesNotMatch(free.slice(videoStageStart, frameActionsStart), /<div class="frame-actions"/)
  assert.match(free, /\.frame-actions\{display:flex;flex:0 0 auto/)
  assert.match(film, /storyboard breakpoints are\n   based on the remaining work area/)
  assert.match(free, /project-storyboard-page \.creation-panel\{grid-column:1;grid-row:1/)
  assert.match(free, /project-storyboard-page \.center-stage\{grid-column:2;grid-row:1/)
  assert.match(free, /project-storyboard-page \.shot-panel\{grid-column:3;grid-row:1/)
  assert.match(free, /独立自由创作与项目分镜使用同一工作台方向/)
  assert.match(free, /omni-page:not\(\.project-storyboard-page\) \.creation-panel\{grid-column:1;grid-row:1/)
  assert.match(free, /omni-page:not\(\.project-storyboard-page\) \.shot-panel\{grid-column:3;grid-row:1/)
  assert.match(free, /shot-video-placeholder\{background:radial-gradient\(circle at 50% 42%,#704cff/)
  assert.match(free, /'has-video': !!activeVideoUrl/)
  assert.match(free, /video-stage\.has-video::before\{display:none!important\}/)
  assert.match(free, /video-stage\.rendering::before\{animation:stage-atmosphere/)
  assert.match(free, /video-stage\.rendering \.render-play\{animation:stage-pulse/)
  assert.match(free, /shot-script\{min-height:300px/)
})

test('切换成片先预加载下一条，再替换主播放器画面', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')

  assert.match(source, /<template v-if="mediaLayers\.length"><video v-for="layer in mediaLayers" :key="layer\.id" :src="layer\.url"/)
  assert.match(source, /function promoteMediaLayer\(id\)/)
  assert.match(source, /@canplay="promoteMediaLayer\(layer\.id\)" @error="discardMediaLayer\(layer\.id\)"/)
  assert.match(source, /mediaLayers\.value = \[current\]/)
  assert.match(source, /main-video\.is-ready\{opacity:1;pointer-events:auto\}/)
})
