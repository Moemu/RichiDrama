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
  assert.match(source, /promptEditorRef\?\.insertAtCaret\(promptAssetFor\(asset\)\)/)
  assert.match(source, /@keydown\.up\.prevent="selectRelative\(-1\)"/)
  assert.match(source, /@keydown\.down\.prevent="selectRelative\(1\)"/)
})

test('维护者工作流恢复一键入口、资源模型和分镜实时刷新', async () => {
  const [film, freeCreate, characters, scenes, props] = await Promise.all([
    readSource('../src/views/FilmCreate.vue'),
    readSource('../src/views/FreeCreate.vue'),
    readSource('../src/composables/filmCreate/useCharacters.js'),
    readSource('../src/composables/filmCreate/useScenes.js'),
    readSource('../src/composables/filmCreate/useProps.js'),
  ])

  assert.match(film, /const showLegacyPipeline = ref\(true\)/)
  assert.match(film, /const pipelinePanelExpanded = ref\(false\)/)
  assert.match(film, /v-model="resourceImageModel"/)
  assert.match(film, /onGenerateCharacterImage\(char, resourceImageModel \|\| undefined\)/)
  assert.match(film, /onGenerateSceneImage\(scene, sceneUseQuadGrid, resourceImageModel \|\| undefined\)/)
  assert.match(film, /onGeneratePropImage\(prop, propUseQuadGrid, resourceImageModel \|\| undefined\)/)
  assert.match(film, /AI 生成分镜/)
  assert.match(film, /每段\(秒\)/)
  assert.match(film, /\.storyboard-stage-active \.workflow-shell\{[^}]*overflow:clip!important/)
  assert.match(film, /freeCreateRef\.value/)
  assert.match(freeCreate, /defineExpose\(\{ refreshProjectShots \}\)/)
  assert.match(characters, /characterAPI\.generateImage\(char\.id, model \|\| undefined/)
  assert.match(scenes, /model: model \|\| undefined/)
  assert.match(props, /propAPI\.generateImage\(prop\.id, model \|\| undefined/)
})

test('自由创作报价由后端按模型的有效计量单位计算', async () => {
  const [source, apiSource] = await Promise.all([
    readSource('../src/views/FreeCreate.vue'),
    readSource('../src/api/omniVideo.js'),
  ])

  const quoteHandler = source.slice(source.indexOf('async function quoteCurrentRequest'), source.indexOf('function confirmSubmit'))
  assert.match(apiSource, /request\.post\('\/omni-video-jobs\/quote', body\)/)
  assert.match(quoteHandler, /model: currentCapability\.value\.model/)
  assert.match(quoteHandler, /duration: normalizeDuration\(duration\.value\)/)
  assert.doesNotMatch(quoteHandler, /usage:\s*\{\s*second:/)
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

test('镜头素材仅移出本镜，项目素材归档与全局解除引用分离', async () => {
  const [filmSource, freeSource, librarySource, apiSource] = await Promise.all([
    readSource('../src/views/FilmCreate.vue'),
    readSource('../src/views/FreeCreate.vue'),
    readSource('../src/views/MediaLibrary.vue'),
    readSource('../src/api/omniVideo.js'),
  ])

  assert.match(filmSource, /class="sb-omni-material-delete"/)
  assert.match(filmSource, /v-if="item\.poolType === 'asset'"/)
  assert.match(filmSource, /@click\.stop="deleteSbOmniPoolAsset\(activeSb, item\)"/)
  assert.match(filmSource, /async function deleteSbOmniPoolAsset\(_sb, item\)/)
  assert.match(filmSource, /await deleteResourceMedia\(item\)/)
  assert.match(freeSource, /class="material-delete"/)
  assert.match(freeSource, /title="移出当前镜头"/)
  assert.match(freeSource, /@click\.stop="remove\(asset\.id\)"/)
  assert.match(freeSource, /当前镜头的“移出”是一个完整的镜头级动作/)
  assert.match(freeSource, /refs: \(promptDocument\.value\?\.refs \|\| \[\]\)\.filter\(\(ref\) => Number\(ref\.asset_id\) !== Number\(id\)\)/)
  assert.doesNotMatch(freeSource, /function deleteMaterialAsset/)
  assert.match(freeSource, /!asset\.archived_at/)
  assert.match(freeSource, /await omniVideoAPI\.linkProjectResource\(\{/)
  assert.match(librarySource, /确定归档该素材/)
  assert.match(librarySource, /一键归档/)
  assert.match(librarySource, /从全部可编辑镜头解除并归档/)
  assert.match(librarySource, /async function forceDetachItem/)
  assert.match(apiSource, /forceDetachAsset\(id\)/)
})

test('角色资源卡提供音色绑定、更换与试听入口', async () => {
  const source = await readSource('../src/views/FilmCreate.vue')

  assert.match(source, /绑定音色/)
  assert.match(source, /音色已绑定/)
  assert.match(source, /更换音色/)
  assert.match(source, /试听/)
  assert.match(source, /onSd2VoicePrimaryAction\(item\)/)
  assert.match(source, /onSd2VoiceReplace\(item\)/)
  assert.match(source, /playSd2Voice\(item\)/)
})

test('统一资源浏览器的卡片操作会换行，资源页可纵向滚动', async () => {
  const source = await readSource('../src/views/FilmCreate.vue')

  assert.match(source, /\.resource-browser-card-actions\{display:flex;flex-wrap:wrap/)
  assert.match(source, /\.resources-stage-active>\.main\{display:block;overflow-y:auto/)
  assert.match(source, /\.resources-stage-active \.resource-browser-grid\{min-height:15rem;max-height:min\(52dvh,34rem\);overflow:auto\}/)
})

test('提示词富文本编辑器优先处理滚轮，不被工作台外层取消', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')

  assert.match(source, /textarea\.el-textarea__inner, \.prompt-rich-editor/)
  assert.match(source, /promptEditor\.scrollHeight <= promptEditor\.clientHeight/)
})

test('提示词引用使用稳定素材别名并展示更清晰的缩略图', async () => {
  const [workbench, editor] = await Promise.all([
    readSource('../src/views/FreeCreate.vue'),
    readSource('../src/components/OmniAssetPromptEditor.vue'),
  ])

  assert.match(workbench, /function assetDisplayName\(asset\)/)
  assert.match(workbench, /legacy_aliases: assetLegacyAliases\(asset\)/)
  assert.match(workbench, /:assets="promptAssets"/)
  assert.match(workbench, /:reference-document="promptDocument"/)
  assert.match(editor, /referenceDocument/)
  assert.match(editor, /function assetMatchesAlias\(asset, alias\)/)
  assert.match(editor, /width:30px; height:30px/)
})

test('提示词引用只解析当前镜头工作集，不能借用其他镜头素材', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')

  assert.match(source, /<OmniAssetPromptEditor[\s\S]*:assets="promptAssets"/)
  assert.match(source, /项目库素材必须先“加入本镜”/)
})

test('新建项目镜头先切换到服务端返回的空素材工作集', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')

  assert.match(source, /const newShot = projectShot\(shot\)/)
  assert.match(source, /shots\.value = list\s*loadShot\(newShot\)\s*await persistShotOrder\(list\)/)
  assert.match(source, /不能在排序、视频列表等[\s\S]*错误显示“已加入本镜”/)
})

test('统一资源中心以可搜索的单一资源浏览器代替三列长列表', async () => {
  const source = await readSource('../src/views/FilmCreate.vue')

  for (const marker of [
    'class="resource-browser-tabs"',
    'class="resource-browser"',
    'const resourceCatalogTabs = computed',
    'const filteredResourceCatalogItems = computed',
    '搜索${resourceCatalogMeta.label}名称或描述',
    'key: \'with-image\'',
    'key: \'missing-image\'',
    'class="resource-browser-grid"',
  ]) {
    assert.ok(source.includes(marker), `missing resource browser marker: ${marker}`)
  }
  assert.match(source, /项目素材.*分镜中按需加入/)
  assert.match(source, /\.resource-center-grid,\.resource-media-library\{display:none\}/)
})

test('分镜素材区默认只展示本镜工作集，项目素材通过检索面板按需加入', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')

  assert.match(source, /仅显示本镜已加入的素材；上传后会自动加入本镜/)
  assert.match(source, /v-for="asset in chosenAssets"/)
  assert.match(source, /current-shot-material-pool/)
  assert.match(source, /projectLibraryOpen = ref\(false\)/)
  assert.match(source, /从项目素材库加入本镜/)
  assert.match(source, /const filteredProjectLibraryAssets = computed/)
  assert.match(source, /\$\{typeName\(asset\.type\)\}/)
  assert.match(source, /v-for="asset in filteredProjectLibraryAssets"/)
  assert.match(source, /点击素材即可加入或移出当前镜头/)
  assert.match(source, /project-asset-library-grid/)
})

test('提示词引用只改变勾选态，不清空已加入本镜的素材', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')

  assert.match(source, /勾选只代表提示词中的 @ 引用；本镜已加入素材由 selectedOrder 独立保存/)
  assert.match(source, /selected\.value = new Set\(referencedIds\)/)
  const handler = source.slice(source.indexOf('function setPromptReferences'), source.indexOf('function showCertificationError'))
  assert.match(handler, /selected\.value = new Set\(referencedIds\)/)
  assert.doesNotMatch(handler, /selectedOrder\.value/)
  assert.match(source, /const referencedAssets = computed\(\(\) => chosenAssets\.value\.filter/)
  assert.match(source, /v-for="asset in referencedAssets"/)
})

test('从项目素材库加入本镜不会自动改写提示词', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')
  const handler = source.slice(source.indexOf('function toggleProjectLibraryAsset'), source.indexOf('function onMaterialCardClick'))

  assert.match(handler, /addShotMaterial\(asset\)/)
  assert.doesNotMatch(handler, /selected\.value\.add/)
  assert.doesNotMatch(handler, /insertAtCaret/)
})

test('镜头素材集合从镜头保存的 assets 恢复，未引用素材不丢失', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')
  const handler = source.slice(source.indexOf('function loadShot'), source.indexOf('async function loadShotHistory'))

  assert.match(handler, /const materialIds = \(shot\.assets \|\| \[\]\)\.map/)
  assert.match(handler, /selectedOrder\.value = \[\.\.\.new Set\(materialIds\)\]/)
  assert.match(source, /:class="\{ selected: selected\.has\(asset\.id\) \}"/)
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
  assert.match(source, /<template v-if="heroVideos\.length"><video v-for="video in heroVideos"/)
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
  // 标题改为单行展示，不再强制换行。
  assert.match(tools, /<h1>AI <em>工具箱<\/em><\/h1>/)
  assert.match(tools, /manifesto-copy h1 \{[^}]*white-space:nowrap/)
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

test('每次工具与自由全能生成都要求并传递唯一的计费归属项目', async () => {
  const [workbench, media, freeCreate] = await Promise.all([
    readSource('../src/views/ToolWorkbench.vue'),
    readSource('../src/views/ToolMediaGeneration.vue'),
    readSource('../src/views/FreeCreate.vue'),
  ])

  for (const source of [workbench, media]) {
    assert.match(source, /计费归属项目/)
    assert.match(source, /dramaAPI\.list\(\{\s*page_size:\s*100\s*\}\)/)
    assert.match(source, /drama_id:\s*Number\(dramaId\.value\)/)
  }
  assert.match(freeCreate, /placeholder="选择计费项目" aria-label="选择计费归属项目"/)
  assert.match(freeCreate, /class="billing-project-field" aria-labelledby="billing-project-title"/)
  assert.match(freeCreate, /首次生成后将锁定，避免跨项目混账/)
  assert.match(freeCreate, /drama_id:\s*Number\(freeProjectId\.value\)/)
  assert.match(freeCreate, /:disabled="!!sequence\?\.drama_id"/)
  assert.match(freeCreate, /if \(Number\(seq\?\.drama_id\)\) freeProjectId\.value = Number\(seq\.drama_id\)/)
  assert.match(freeCreate, /请选择计费归属项目并补齐生成参数/)
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

test('运营模型用量同时显示账号与显示名，避免把账号误认为用户名称', async () => {
  const source = await readSource('../src/views/AdminConsole.vue')

  assert.match(source, /<el-table-column prop="username" label="账号" min-width="110"\/>/)
  assert.match(source, /<el-table-column prop="display_name" label="显示名" min-width="110"\/>/)
  assert.match(source, /<el-table-column prop="display_name" label="显示名" min-width="100"\/>/)
})

test('运营价目表展示条件费率，支持审计带视频和不带视频输入', async () => {
  const source = await readSource('../src/views/AdminConsole.vue')

  assert.match(source, /条件费率与审计说明/)
  assert.match(source, /priceConditions\(row\)\.default_rate_id/)
  assert.match(source, /has_video_input: \{ true: '带视频', false: '不带视频' \}/)
  assert.match(source, /fps_tier: '帧率档'/)
  assert.match(source, /pricing_note/)
  assert.match(source, /来源：/)
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
  assert.match(film, /\.film-create>\.main\{width:100%;max-width:none/)
  assert.match(film, /A restrained sense of motion keeps the production flow visually alive/)
  assert.match(film, /@keyframes workflow-orbit/)
  assert.doesNotMatch(film, /storyboard-workbench-toolbar/)
})

test('主页使用本地完成视频组成可控轮播舞台', async () => {
  const source = await readSource('../src/views/FilmList.vue')

  assert.match(source, /const heroVideos = computed/)
  assert.match(source, /const activeHeroVideo = computed/)
  assert.match(source, /const nextHeroVideo = computed/)
  assert.match(source, /const heroVideoElements = new Map\(\)/)
  assert.match(source, /const incomingHeroVideoKey = ref\(''\)/)
  assert.match(source, /function revealHeroVideo\(video, element\)/)
  assert.match(source, /requestVideoFrameCallback/)
  assert.match(source, /旧视频保持全亮。新视频在上层完成淡入后，才替换当前视频。/)
  assert.doesNotMatch(source, /:poster="heroPoster/)
  assert.doesNotMatch(source, /<img v-else-if="heroMedia\[0\]"/)
  assert.match(source, /const recentSeen = new Set\(\)/)
  assert.match(source, /const defaultSeen = new Set\(\)/)
  assert.match(source, /同一项目的多个成片也属于可轮播作品/)
  assert.doesNotMatch(source, /const projects = new Set\(\)/)
  assert.match(source, /\.slice\(0, 4\)/)
  assert.doesNotMatch(source, /class="hero-video-preload"/)
  assert.match(source, /@loadeddata="markHeroVideoReady\(video, \$event\)" @canplay="markHeroVideoReady\(video, \$event\)"/)
  assert.match(source, /@timeupdate="maybeAdvanceHeroVideo\(video, \$event\)"/)
  assert.match(source, /@error="discardHeroVideo\(video\)"/)
  assert.match(source, /class="hero-video-controls"/)
  assert.match(source, /\.hero-video-layer\.is-ready\.is-incoming\{z-index:3;opacity:1\}/)
  assert.match(source, /\.media-stage>\.media-canvas\{position:absolute;z-index:0;inset:0;isolation:isolate\}/)
  assert.match(source, /onBeforeUnmount\(\(\) => \{ stopHeroRotation\(\); window\.clearTimeout\(heroVideoRevealTimer\); window\.clearTimeout\(heroVideoTransitionTimer\); pauseInactiveHeroVideos\(''\) \}\)/)
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
  assert.match(film, /左侧导航栏已移除，工作区占满整个视口宽度/)
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

test('生产工作流保持稳定导航、比例预览和可展开的次要信息', async () => {
  const [film, free] = await Promise.all([
    readSource('../src/views/FilmCreate.vue'),
    readSource('../src/views/FreeCreate.vue'),
  ])

  assert.match(film, /\.workflow-step:hover,\.workflow-step\.active\{transform:none!important\}/)
  assert.match(film, /\.workflow-step\.active\{animation:none!important\}/)
  assert.match(film, /script-story-block/)
  assert.match(film, /script-content-block/)
  assert.match(film, /\.story-textarea:deep\(\.el-textarea__inner\.is-focus\)\{outline-offset:-2px!important\}/)
  assert.match(film, /\.merge-stage-active \.video-option-hint,\.merge-stage-active \.video-watermark-input\{grid-column:1 \/ -1;width:100%;min-width:0/)
  assert.match(film, /\.merge-stage-active \.main>:is\(\.merge-settings,\.merge-output\)\{overflow-y:auto;overscroll-behavior-y:contain/)
  assert.match(free, /'--preview-aspect-ratio': previewAspectRatio/)
  assert.match(free, /\.project-storyboard-page \.player-tools\{flex:0 0 44px;min-height:44px;overflow:visible\}/)
  assert.match(free, /\.project-storyboard-page \.video-stage\{flex:0 0 auto!important;width:auto;height:clamp\(190px,28dvh,300px\);margin:12px auto!important;aspect-ratio:var\(--preview-aspect-ratio,16 \/ 9\)\}/)
  assert.match(free, /video-stage\.has-video \.main-video\{inset:0!important;transform:none\}/)
  assert.match(free, /class="creation-secondary-section"/)
  assert.match(free, /尚未配置视频模型/)
})

test('切换成片先预加载下一条，再替换主播放器画面', async () => {
  const source = await readSource('../src/views/FreeCreate.vue')

  assert.match(source, /<template v-if="mediaLayers\.length"><video v-for="layer in mediaLayers" :key="layer\.id" :src="layer\.url"/)
  assert.match(source, /function promoteMediaLayer\(id\)/)
  assert.match(source, /@canplay="promoteMediaLayer\(layer\.id\)" @error="discardMediaLayer\(layer\.id\)"/)
  assert.match(source, /mediaLayers\.value = \[current\]/)
  assert.match(source, /main-video\.is-ready\{opacity:1;pointer-events:auto\}/)
})
