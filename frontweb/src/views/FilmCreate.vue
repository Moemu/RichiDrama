<template>
  <div class="film-create" :class="{ 'script-stage-active': workflowStage === 'script', 'resources-stage-active': workflowStage === 'resources', 'storyboard-stage-active': workflowStage === 'storyboard', 'merge-stage-active': workflowStage === 'merge' }">

    <!-- 顶部 -->
    <header class="header">
      <div class="header-inner">
        <h1 class="logo" @click="goList">
          <span class="richi-brand-mark" aria-hidden="true"><img src="/brand/richi-logo-color.png" alt="" /></span>
          <span class="richi-brand-copy"><span class="logo-main">瑞池传媒短剧平台</span><span class="logo-sub">创作工作台</span></span>
        </h1>
        <span class="breadcrumb-sep">›</span>
        <span class="page-title">{{ dramaId ? (store.drama?.title || '项目') : '新建故事' }}</span>
        <el-select
          v-if="dramaId && (store.drama?.episodes || []).length"
          v-model="selectedEpisodeId"
          class="header-episode-select"
          size="small"
          aria-label="切换当前剧集"
          placeholder="选择剧集"
          @change="onEpisodeSelect"
        >
          <el-option
            v-for="ep in (store.drama?.episodes || [])"
            :key="ep.id"
            :label="ep.title || '第' + (ep.episode_number || 0) + '集'"
            :value="ep.id"
          />
        </el-select>
        <el-button v-if="dramaId" class="btn-back-drama" @click="router.push('/drama/' + dramaId)">
          <el-icon><ArrowLeft /></el-icon>
          返回剧集
        </el-button>
        <el-button v-if="dramaId" type="primary" plain class="btn-canvas-mode" @click="goCanvasMode">
          <el-icon><Grid /></el-icon>
          画布模式
        </el-button>
        <div class="header-actions">
          <AccountBalanceBadge />
          <el-button class="btn-theme" :title="isDark ? '切换到浅色模式' : '切换到暗色模式'" @click="toggleTheme">
            <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
            {{ isDark ? '浅色' : '暗色' }}
          </el-button><el-button v-if="isAdmin" class="btn-ai-config" @click="showAiConfigDialog = true">
            <el-icon><Setting /></el-icon>
            AI配置
          </el-button>
        </div>
      </div>
    </header>

    <!-- 左侧固定侧边栏 -->

    <main class="main">
      <ProjectCollaborationBar v-if="dramaId" :drama-id="dramaId" @refresh="loadDrama" />
      <section class="workflow-shell" aria-label="短剧制作工作流">
        <div class="workflow-head">
          <div>
            <span class="workflow-kicker">制作工作流</span>
            <h2>{{ workflowStageMeta.title }}</h2>
            <p>{{ workflowStageMeta.description }}</p>
          </div>
          <span class="workflow-episode">{{ currentEpisode?.title || '请选择剧集' }}</span>
        </div>
        <div class="workflow-steps" role="tablist" aria-label="工作阶段">
          <button v-for="(step, index) in workflowStages" :key="step.key" type="button" class="workflow-step" :class="{ active: workflowStage === step.key, complete: step.complete }" role="tab" :aria-selected="workflowStage === step.key" @click="setWorkflowStage(step.key)">
            <span>{{ index + 1 }}</span>{{ step.label }}
          </button>
        </div>
      </section>
      <!-- 角色/道具/场景上传图片用，单例放在外层避免 v-for 导致 ref 为数组 -->
      <input
        ref="resourceImageFileInput"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style="display: none"
        @change="onResourceImageFileChange"
      />
      <input
        ref="resourceMediaFileInput"
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        style="display: none"
        @change="onResourceMediaFileChange"
      />

      <!-- 剧本工作台：单卡片 + 选项卡（创作 / 选择） -->
      <section v-show="workflowStage === 'script'" class="section card script-workbench-unified">
        <el-tabs v-model="scriptWorkbenchMode" class="script-workbench-tabs">
          <el-tab-pane label="创作剧本" name="create">
            <div class="script-pane-inner">
              <div class="script-sub-block script-story-block">
                <h2 class="section-title">故事生成</h2>
                <p class="section-desc">输入故事梗概生成剧本，或导入小说章节</p>
                <el-input
 :disabled="projectSession.enabled && !projectSession.canEdit"                  v-project-text="{ kind: 'dramas', id: dramaId, field: 'description' }" v-model="storyInput"
                  type="textarea"
                  :rows="4"
                  placeholder="例如：一个少女在森林里遇见会说话的狐狸，一起寻找失落的宝石..."
                  class="story-textarea"
                />
                <div class="row gap" style="margin-top: 10px; flex-wrap: wrap;">
                  <el-select :disabled="projectSession.enabled && !projectSession.canEdit" v-model="storyStyle" placeholder="故事风格" clearable style="width: 120px" @change="() => saveProjectSettings(false)">
                    <el-option label="现代" value="modern" />
                    <el-option label="古风" value="ancient" />
                    <el-option label="奇幻" value="fantasy" />
                    <el-option label="日常" value="daily" />
                  </el-select>
                  <el-select :disabled="projectSession.enabled && !projectSession.canEdit" v-model="storyType" placeholder="剧本类型" clearable style="width: 120px" @change="() => saveProjectSettings(false)">
                    <el-option label="剧情" value="drama" />
                    <el-option label="喜剧" value="comedy" />
                    <el-option label="冒险" value="adventure" />
                  </el-select>
                  <div style="display:flex;align-items:center;gap:6px;font-size:13px">
                    <span>集数</span>
                    <el-input-number
 :disabled="projectSession.enabled && !projectSession.canEdit"                      v-model="storyEpisodeCount"
                      :min="1"
                      :step="1"
                      :precision="0"
                      controls-position="right"
                      style="width: 100px"
                    />
                  </div>
                  <el-button :disabled="projectSession.enabled && !projectSession.canEdit" type="primary" :loading="isStoryGenRunning" @click="onGenerateStory">
                    生成剧本
                  </el-button>
                  <el-button plain :disabled="projectSession.enabled && !projectSession.canEdit" @click="showNovelImport = true">
                    <el-icon><DocumentAdd /></el-icon>
                    导入小说
                  </el-button>
                </div>
              </div>
              <div class="script-sub-divider" />
              <div id="anchor-script" class="script-sub-block script-content-block">
                <h2 class="section-title">剧本</h2>
                <div class="row gap" style="margin-bottom: 10px; flex-wrap: wrap;">
                  <el-select
                    v-model="selectedEpisodeId"
                    placeholder="选择集数"
                    clearable
                    style="width: 130px"
                    :disabled="!dramaId"
                    @change="onEpisodeSelect"
                  >
                    <el-option
                      v-for="ep in (store.drama?.episodes || [])"
                      :key="ep.id"
                      :label="ep.title || '第' + (ep.episode_number || 0) + '集'"
                      :value="ep.id"
                    />
                  </el-select>
                  <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="scriptTitle" placeholder="集标题" style="width: 150px" />
                  <el-button :disabled="projectSession.enabled && !projectSession.canEdit" v-if="dramaId" style="margin-left: auto" @click="onAddEpisode">
                    <el-icon><Plus /></el-icon>添加一集
                  </el-button>
                </div>
                <el-input
 :disabled="projectSession.enabled && !projectSession.canEdit"                  v-project-text="{ kind: 'episodes', id: currentEpisodeId, field: 'script_content' }" v-model="scriptContent"
                  type="textarea"
                  :rows="8"
                  placeholder="剧本内容将显示在这里，可直接编辑..."
                  class="story-textarea"
                />
                <div class="row gap" style="margin-top: 8px; flex-wrap: wrap;">
                  <el-button
                    :loading="scriptGenerating"
                    :disabled="(projectSession.enabled && !projectSession.canEdit) || (!!dramaId && (store.drama?.episodes?.length > 0) && !currentEpisodeId)"
                    @click="onGenerateScript"
                  >
                    保存剧本
                  </el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>
          <el-tab-pane label="选择剧本" name="select">
            <el-button type="primary" @click="openSelectScriptDialog">
              <el-icon><Document /></el-icon>
              从已有剧本中选择…
            </el-button>
            <div v-if="dramaId && (store.drama?.episodes?.length || storyInput)" class="script-preview-wrap">
              <h3 class="preview-block-title">故事梗概</h3>
              <el-input
                :model-value="storyInput"
                type="textarea"
                :rows="3"
                readonly
                class="story-textarea"
              />
              <template v-if="(store.drama?.episodes || []).length > 1">
                <h3 class="preview-block-title">分集剧本</h3>
                <el-tabs v-model="selectPreviewEpisodeId" class="preview-ep-tabs">
                  <el-tab-pane
                    v-for="ep in (store.drama?.episodes || [])"
                    :key="ep.id"
                    :label="ep.title || ('第' + (ep.episode_number || 0) + '集')"
                    :name="String(ep.id)"
                  >
                    <el-input
                      :model-value="ep.script_content || ''"
                      type="textarea"
                      :rows="12"
                      readonly
                      class="story-textarea"
                    />
                  </el-tab-pane>
                </el-tabs>
              </template>
              <template v-else>
                <h3 class="preview-block-title">剧本正文</h3>
                <el-input
                  :model-value="scriptContent"
                  type="textarea"
                  :rows="12"
                  readonly
                  class="story-textarea"
                />
              </template>
              <div class="preview-actions">
                <el-button type="primary" plain @click="scriptWorkbenchMode = 'create'">切换到创作剧本以编辑</el-button>
              </div>
            </div>
            <p v-else class="script-select-empty">尚未选择剧本，请点击上方按钮</p>
          </el-tab-pane>
        </el-tabs>
      </section>
      <div v-show="workflowStage === 'script'" class="workflow-next-action">
        <span>剧本确认后，再集中准备可复用资源。</span>
        <el-button type="primary" :disabled="!scriptContent?.trim()" @click="setWorkflowStage('resources')">进入统一资源管理</el-button>
      </div>

      <el-dialog
        v-model="showSelectScriptDialog"
        title="从剧本库导入"
        width="640px"
        destroy-on-close
        @open="loadSelectScriptList"
      >
        <div v-loading="selectScriptLoading || selectScriptImporting" class="select-script-list">
          <div
            v-for="d in selectableScriptDramas"
            :key="d.id"
            class="select-script-item"
            :class="{ disabled: selectScriptImporting }"
            @click="!selectScriptImporting && onPickScriptFromDialog(d.id)"
          >
            <div class="select-script-title">{{ d.title || '未命名' }}</div>
            <div class="select-script-desc">{{ (d.description || '暂无简介').slice(0, 200) }}{{ (d.description && d.description.length > 200) ? '…' : '' }}</div>
          </div>
          <div v-if="!selectScriptLoading && selectScriptDramas.length === 0" class="select-script-empty">剧本库为空，请先在「剧本管理」创建剧本</div>
          <div v-else-if="!selectScriptLoading && selectableScriptDramas.length === 0" class="select-script-empty">没有可导入的其他剧本</div>
        </div>
      </el-dialog>

      <!-- 一键全流程生成:默认收起为细条,避免挤压剧本编辑区 -->
      <section v-if="workflowStage === 'script'" class="section card pipeline-section" :class="{ collapsed: !pipelinePanelExpanded }">
        <div class="one-click-actions">
          <span class="one-click-label">🚀 一键全流程</span>
          <el-button
            type="primary"
            :loading="pipelineRunning && !pipelinePaused"
            :disabled="(projectSession.enabled && !projectSession.canEdit) || !currentEpisodeId || pipelineRunning"
            @click="startOneClickPipeline"
          >
            一键成片带图片视频
          </el-button>
          <el-button
            :loading="pipelineRunning && !pipelinePaused"
            :disabled="(projectSession.enabled && !projectSession.canEdit) || !currentEpisodeId || pipelineRunning"
            title="仅提取角色、场景、道具与生成分镜文本，不生成图片与视频"
            @click="startTextFrameworkPipeline"
          >
            生成文本框架
          </el-button>
          <el-button size="small" text @click="pipelinePanelExpanded = !pipelinePanelExpanded">
            {{ pipelinePanelExpanded ? '收起配置 ▴' : '展开配置 ▾' }}
          </el-button>
          <template v-if="pipelinePanelExpanded">
            <GenerationSettings :model-value="projectGenerationSettings" :max-duration="15" include-generation-quote @update:model-value="updateProjectGenerationSettings" />
            <el-button :disabled="projectSession.enabled && !projectSession.canEdit" size="small" plain @click="applyProjectGenerationSettingsToStoryboards">应用到全部分镜</el-button>
            <el-select :disabled="projectSession.enabled && !projectSession.canEdit" v-model="scriptLanguage" placeholder="分镜语言" clearable style="width: 105px">
              <el-option label="中文" value="zh" />
              <el-option label="英文" value="en" />
            </el-select>
            <StylePickerButton
              v-model="generationStyle"
              :options="generationStyleOptions"
              @change="() => saveProjectSettings(true)"
            />
          </template>
          <template v-if="pipelineRunning">
            <el-button v-if="!pipelinePaused" type="warning" @click="pipelinePaused = true">⏸ 暂停</el-button>
            <el-button v-else type="success" @click="onPipelineResume">▶ 继续</el-button>
          </template>
        </div>
        <div v-if="pipelineRunning || pipelineErrorLog.length > 0" class="pipeline-status">
          <div v-if="pipelineCurrentStep" class="pipeline-current-step">
            <span v-if="pipelineStepIndex > 0" class="pipeline-step-badge">{{ pipelineStepIndex }}/{{ pipelineStepTotal }}</span>
            {{ pipelineCurrentStep.replace(/^\[步骤 \d+\/\d+\] /, '') }}
          </div>
          <!-- 阶段间倒计时 -->
          <div v-if="pipelineCountdown > 0" class="pipeline-countdown">
            <div class="pipeline-countdown-ring">
              <span class="pipeline-countdown-num">{{ pipelineCountdown }}</span>
              <span class="pipeline-countdown-unit">秒</span>
            </div>
            <div class="pipeline-countdown-body">
              <p class="pipeline-countdown-msg">{{ pipelineCountdownMsg }}</p>
              <div class="pipeline-countdown-actions">
                <el-button size="small" type="success" @click="skipPipelineCountdown">⚡ 立即开始下一阶段</el-button>
                <el-button v-if="!pipelinePaused" size="small" type="warning" @click="pipelinePaused = true">⏸ 暂停倒计时</el-button>
                <span v-else class="pipeline-countdown-paused">已暂停 — 点击右上角"继续"恢复</span>
              </div>
            </div>
          </div>
          <div v-if="pipelineActiveTasks.size > 0" class="pipeline-active-tasks">
            <span
              v-for="label in Array.from(pipelineActiveTasks)"
              :key="label"
              class="pipeline-task-chip"
            >
              <span class="pipeline-task-dot" />{{ label }}
            </span>
          </div>
          <div v-if="pipelineErrorLog.length > 0" class="pipeline-error-log">
            <div class="pipeline-error-title">执行过程中的错误：</div>
            <div v-for="(entry, idx) in pipelineErrorLog" :key="idx" class="pipeline-error-line">
              [{{ entry.step }}] {{ entry.message }}
            </div>
          </div>
        </div>
      </section>

      <!-- 素材编排：统一资源库（常驻左侧，作用于当前选中分镜；点击分镜卡片切换） -->
      <section v-show="workflowStage === 'resources'" class="section card resource-center">
        <div class="resource-center-heading">
          <div>
            <h2 class="section-title">统一资源管理</h2>
          </div>
          <el-button :disabled="projectSession.enabled && !projectSession.canEdit" type="primary" plain :loading="resourceMediaUploading" @click="openResourceMediaUpload"><el-icon><Upload /></el-icon>上传媒体素材</el-button>
        </div>
        <nav class="resource-browser-tabs" aria-label="资源类别">
          <button v-for="tab in resourceCatalogTabs" :key="tab.key" type="button" :class="{ active: resourceCatalogType === tab.key }" :aria-current="resourceCatalogType === tab.key ? 'page' : undefined" @click="resourceCatalogType = tab.key">
            {{ tab.label }} <span>{{ tab.count }}</span>
          </button>
        </nav>
        <section class="resource-browser" :aria-label="`${resourceCatalogMeta.label}资源浏览器`">
          <header class="resource-browser-toolbar">
            <label class="resource-browser-search">
              <span class="sr-only">搜索{{ resourceCatalogMeta.label }}</span>
              <el-input v-model="resourceCatalogKeyword" clearable :placeholder="`搜索${resourceCatalogMeta.label}名称或描述`" />
            </label>
            <div class="resource-browser-filters" role="group" aria-label="资源状态筛选">
              <button v-for="filter in resourceCatalogFilters" :key="filter.key" type="button" :class="{ active: resourceCatalogFilter === filter.key }" :aria-pressed="resourceCatalogFilter === filter.key" @click="resourceCatalogFilter = filter.key">{{ filter.label }}</button>
            </div>
            <div class="resource-browser-actions">
              <el-button v-if="resourceCatalogType === 'character'" size="small" :disabled="(projectSession.enabled && !projectSession.canEdit) || !currentEpisodeId" @click="showCharLibrary = true">从项目选择</el-button>
              <el-button v-else-if="resourceCatalogType === 'scene'" size="small" :disabled="(projectSession.enabled && !projectSession.canEdit) || !currentEpisodeId" @click="showSceneLibrary = true">从项目选择</el-button>
              <el-button v-else-if="resourceCatalogType === 'prop'" size="small" :disabled="(projectSession.enabled && !projectSession.canEdit) || !currentEpisodeId" @click="showPropLibrary = true">从项目选择</el-button>
              <el-button :disabled="projectSession.enabled && !projectSession.canEdit" v-if="resourceCatalogType !== 'media' && resourceCatalogItems.length" size="small" :loading="resourceBatchUploading === resourceCatalogType" @click="batchUploadResourcesToMaterialLibrary(resourceCatalogType)">批量上传至素材库</el-button>
              <el-button v-if="resourceCatalogType === 'character'" size="small" :loading="charactersGenerating" :disabled="(projectSession.enabled && !projectSession.canEdit) || (!dramaId)" @click="onGenerateCharacters">从剧本提取</el-button>
              <el-button v-if="resourceCatalogType === 'scene'" size="small" :loading="scenesExtracting" :disabled="(projectSession.enabled && !projectSession.canEdit) || (!currentEpisodeId)" @click="onExtractScenes">从剧本提取</el-button>
              <el-button v-if="resourceCatalogType === 'prop'" size="small" :loading="propsExtracting" :disabled="(projectSession.enabled && !projectSession.canEdit) || (!currentEpisodeId)" @click="onExtractProps">从剧本提取</el-button>
              <el-button v-if="resourceCatalogType === 'character'" :disabled="projectSession.enabled && !projectSession.canEdit" size="small" @click="openAddCharacter">添加角色</el-button>
              <el-button v-else-if="resourceCatalogType === 'scene'" :disabled="projectSession.enabled && !projectSession.canEdit" size="small" @click="openAddScene">添加场景</el-button>
              <el-button v-else-if="resourceCatalogType === 'prop'" :disabled="projectSession.enabled && !projectSession.canEdit" size="small" @click="showAddProp = true">添加道具</el-button>
              <el-button :disabled="projectSession.enabled && !projectSession.canEdit" v-if="resourceCatalogType !== 'media' && resourceCatalogItems.length" size="small" type="primary" plain :loading="resourceBatchGenerating === resourceCatalogType" @click="onGenerateMissingResourceImages(resourceCatalogType)">生成缺图</el-button>
              <el-button v-if="resourceCatalogType === 'media'" size="small" @click="projectLibraryDialogOpen = true">管理项目素材</el-button>
              <el-button :disabled="projectSession.enabled && !projectSession.canEdit" v-if="resourceCatalogSelectedCount" size="small" type="danger" plain @click="batchDeleteUnifiedResources(resourceCatalogType)">批量删除（{{ resourceCatalogSelectedCount }}）</el-button>
            </div>
          </header>
          <p class="resource-browser-summary" role="status">显示 {{ filteredResourceCatalogItems.length }} / {{ resourceCatalogItems.length }} 个{{ resourceCatalogMeta.label }}{{ resourceCatalogSelectedCount ? `，已选择 ${resourceCatalogSelectedCount} 个` : '' }}</p>
          <div v-if="filteredResourceCatalogItems.length" class="resource-browser-grid">
            <article v-for="item in filteredResourceCatalogItems" :key="item.id" class="resource-browser-card" :class="{ selected: isUnifiedResourceSelected(resourceCatalogType, item.id), 'is-character': resourceCatalogType === 'character' }">
              <el-checkbox class="resource-browser-select" :model-value="isUnifiedResourceSelected(resourceCatalogType, item.id)" :aria-label="`选择${resourceCatalogMeta.label} ${resourceCatalogItemName(item)}`" @click.stop @change="toggleUnifiedResourceSelection(resourceCatalogType, item.id)" />
              <span v-if="resourceCatalogType === 'character'" class="resource-hosting-status" :class="resourceHostingStatusClass(item)" :title="item.seedance2_asset?.error || `素材库托管：${sd2StatusLabel(item)}`">{{ sd2StatusLabel(item) }}</span>
              <img v-if="resourceCatalogHasImage(item)" :src="resourceCatalogImageUrl(item)" :alt="resourceCatalogItemName(item)" width="160" height="112" loading="lazy" />
              <span v-else class="resource-browser-placeholder" aria-hidden="true">{{ resourceCatalogMeta.label }}</span>
              <div class="resource-browser-card-copy"><b>{{ resourceCatalogItemName(item) }}</b><small>{{ resourceCatalogItemDescription(item) }}</small></div>
              <div class="resource-browser-card-actions" :class="{ 'character-card-actions': resourceCatalogType === 'character' }">
                <template v-if="resourceCatalogType === 'media'"><el-button :disabled="projectSession.enabled && !projectSession.canEdit" size="small" text @click="renameResourceMedia(item)">重命名</el-button><el-button :disabled="projectSession.enabled && !projectSession.canEdit" size="small" type="warning" text @click="deleteResourceMedia(item)">归档</el-button></template>
                <template v-else-if="resourceCatalogType === 'character'"><el-button class="character-card-edit" size="small" @click="openResourceEditor(resourceCatalogType, item)">{{ projectSession.enabled && !projectSession.canEdit ? '查看' : '编辑' }}</el-button><el-button :disabled="projectSession.enabled && !projectSession.canEdit" size="small" text :loading="uploadingResourceId === `character-${item.id}`" @click="onUploadResourceClick('character', item.id)">上传图</el-button><el-button :disabled="projectSession.enabled && !projectSession.canEdit && item.seedance2_asset?.status !== 'active'" size="small" type="primary" text :loading="sd2CertifyingId === item.id" @click="onSd2PrimaryAction(item)">{{ sd2ActionLabel(item) }}</el-button><el-button :disabled="projectSession.enabled && !projectSession.canEdit" size="small" type="primary" text :loading="resourceCatalogGenerating(item)" @click="generateResourceCatalogItem(item)">生成图</el-button><el-button :disabled="projectSession.enabled && !projectSession.canEdit" class="character-card-delete" size="small" type="danger" plain @click="deleteResourceCatalogItem(item)">删除</el-button></template>
                <template v-else><el-button size="small" text @click="openResourceEditor(resourceCatalogType, item)">{{ projectSession.enabled && !projectSession.canEdit ? '查看' : '编辑' }}</el-button><el-button :disabled="projectSession.enabled && !projectSession.canEdit" size="small" text @click="openResourceAssetPicker(resourceCatalogType, item)">素材库</el-button><el-button :disabled="projectSession.enabled && !projectSession.canEdit" size="small" text :loading="uploadingResourceId === `${resourceCatalogType}-${item.id}`" @click="onUploadResourceClick(resourceCatalogType, item.id)">上传图</el-button><el-button :disabled="projectSession.enabled && !projectSession.canEdit" size="small" type="primary" text :loading="resourceCatalogGenerating(item)" @click="generateResourceCatalogItem(item)">生成图</el-button><el-button :disabled="projectSession.enabled && !projectSession.canEdit" size="small" type="danger" text @click="deleteResourceCatalogItem(item)">删除</el-button></template>
              </div>
            </article>
          </div>
          <div v-else class="resource-browser-empty"><b>暂无匹配的{{ resourceCatalogMeta.label }}</b><p>{{ resourceCatalogKeyword ? '请清空搜索词或调整筛选条件。' : resourceCatalogMeta.empty }}</p></div>
          <div v-if="resourceCatalogType === 'media' && detachedResourceLinks.length" class="resource-media-grid"><article v-for="link in detachedResourceLinks" :key="`detached-${link.id}`" class="resource-media-card"><span>已解除</span><small>{{ link.asset_name || `${link.resource_type} #${link.resource_id}` }}</small><small>历史分镜引用仍保留</small><el-button :disabled="projectSession.enabled && !projectSession.canEdit" size="small" type="primary" text @click="restoreResourceMedia(link)">恢复关联</el-button></article></div>
        </section>
      </section>

      <el-dialog v-model="showResourceBatchImageDialog" title="生成缺图" class="resource-batch-image-dialog" width="min(520px, calc(100vw - 32px))" append-to-body>
        <div class="resource-batch-image-summary">
          <b>{{ resourceBatchImageMeta.label }}缺图</b>
          <span>将为 {{ resourceBatchMissingItems.length }} 个{{ resourceBatchImageMeta.label }}生成图片。</span>
        </div>
        <el-form :disabled="projectSession.enabled && !projectSession.canEdit" label-position="top">
          <el-form-item label="图像模型" required>
            <el-select :disabled="projectSession.enabled && !projectSession.canEdit" v-model="resourceBatchImageModel" filterable placeholder="选择图像模型" style="width:100%">
              <el-option v-for="model in resourceImageModels" :key="model" :label="model" :value="model" />
            </el-select>
            <small v-if="!resourceImageModels.length" class="resource-batch-image-hint">请先在 AI 配置中启用图像模型。</small>
          </el-form-item>
        </el-form>
        <div class="resource-batch-image-quote" :class="{ error: resourceBatchImageQuoteError }" role="status">
          <span v-if="resourceBatchImageQuoteLoading">正在计算积分…</span>
          <template v-else-if="resourceBatchImageQuote">
            <b>预计消耗 {{ resourceBatchImageQuote.amount }} 积分</b>
            <small>共 {{ resourceBatchImageQuote.count }} 张，其中 {{ resourceBatchImageQuote.image_input_count }} 张使用参考图。</small>
          </template>
          <span v-else>{{ resourceBatchImageQuoteError || '选择模型后显示积分预估。' }}</span>
        </div>
        <template #footer>
          <el-button @click="showResourceBatchImageDialog = false">取消</el-button>
          <el-button type="primary" :disabled="(projectSession.enabled && !projectSession.canEdit) || (!resourceBatchImageModel || !resourceBatchImageQuote || Boolean(resourceBatchImageQuoteError))" @click="submitGenerateMissingResourceImages">确认生成</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="showPropAssetPicker" :title="`为「${resourceAssetPickerTarget?.name || resourceAssetPickerTarget?.location || '资源'}」选择图片素材`" width="720px">
        <div v-if="propAssetPickerImages.length" class="resource-media-grid prop-asset-picker-grid">
          <button v-for="asset in propAssetPickerImages" :key="asset.id" type="button" class="resource-media-card prop-asset-picker-card" @click="bindAssetToResource(asset)">
            <img :src="sbOmniAssetUrl(asset)" :alt="asset.name || '图片素材'" />
            <small>{{ asset.name || `素材 ${asset.id}` }}</small>
          </button>
        </div>
        <p v-else class="resource-center-empty">媒体素材库中还没有图片，请先上传图片素材。</p>
      </el-dialog>

      <div v-show="workflowStage === 'resources'" class="workflow-next-action">
        <span>资源会在分镜中按需选择、拖入提示词并形成 @ 引用。</span>
        <el-button type="primary" :disabled="!currentEpisodeId" @click="setWorkflowStage('storyboard')">进入分镜管理</el-button>
      </div>

      <FreeCreate v-if="workflowStage === 'storyboard' && currentEpisodeId" ref="freeCreateRef" :project-episode-id="currentEpisodeId" :project-drama-id="dramaId" embedded @reordered="loadDrama" @changed="loadDrama" />

      <div v-show="workflowStage === 'storyboard'" class="workflow-next-action sb-stage-actions">
        <span>{{ storyboards.length ? `已有 ${storyboards.length} 个分镜，生成完成后可合成。` : '请先生成至少一个分镜。' }}</span>
        <div class="sb-stage-gen-group">
          <span class="sb-stage-gen-label" title="留空由 AI 按剧本估算">分镜数量</span>
          <el-input-number :disabled="projectSession.enabled && !projectSession.canEdit" v-model="storyboardCount" :min="1" :max="200" :step="5" placeholder="自动" size="small" controls-position="right" style="width: 96px" />
          <span class="sb-stage-gen-label" title="每段视频的时长">每段(秒)</span>
          <el-select :disabled="projectSession.enabled && !projectSession.canEdit" v-model="videoClipDuration" size="small" style="width: 82px" @change="() => saveProjectSettings(false)">
            <el-option v-for="sec in [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]" :key="sec" :label="`${sec} 秒`" :value="sec" />
          </el-select>
          <span class="sb-stage-gen-label" title="总时长仅作参考">总时长(秒)</span>
          <el-input-number :disabled="projectSession.enabled && !projectSession.canEdit" v-model="videoDuration" :min="10" :max="600" :step="5" placeholder="自动" size="small" controls-position="right" style="width: 96px" />
          <el-button
            type="success"
            :loading="storyboardGenerating || universalOmniPolishRunning"
            :disabled="(projectSession.enabled && !projectSession.canEdit) || (!currentEpisodeId || storyboardGenerating || universalOmniPolishRunning)"
            @click="onGenerateStoryboard"
          >
            {{ storyboards.length ? '重新生成分镜' : 'AI 生成分镜' }}
          </el-button>
          <template v-if="storyboards.length > 0">
            <el-button
              plain
              :loading="batchImageRunning"
              :disabled="!currentEpisodeId || batchImageRunning || batchVideoRunning || pipelineRunning"
              @click="startBatchImageGeneration"
            >
              批量生成分镜图
            </el-button>
            <el-button
              type="warning"
              plain
              :loading="batchVideoRunning"
              :disabled="!currentEpisodeId || batchImageRunning || batchVideoRunning || pipelineRunning"
              @click="startBatchVideoGeneration"
            >
              批量生成分镜视频
            </el-button>
          </template>
        </div>
        <el-button type="primary" :disabled="!storyboards.length" @click="setWorkflowStage('merge')">进入视频合成</el-button>
      </div>

      <!-- 7. 视频配置 + AI 模型配置 -->
      <section v-show="workflowStage === 'merge'" class="section card merge-settings">
        <h2 class="section-title">视频配置</h2>
        <div class="config-grid">
          <el-form-item label="分辨率（新分镜默认）">
            <el-select :disabled="projectSession.enabled && !projectSession.canEdit" v-model="videoResolution" style="width: 160px">
              <el-option label="480p" value="480p" />
              <el-option label="720p" value="720p" />
              <el-option label="1080p" value="1080p" />
            </el-select>
          </el-form-item>
          <el-form-item label="字幕">
            <div class="video-option-row">
              <el-switch :disabled="projectSession.enabled && !projectSession.canEdit" v-model="videoSubtitle" />
              <span v-if="videoSubtitle" class="video-option-hint">开启后按解说旁白自动生成字幕并烧录到成片。</span>
            </div>
          </el-form-item>
          <el-form-item label="对白烧录">
            <div class="video-option-row">
              <el-switch :disabled="projectSession.enabled && !projectSession.canEdit" v-model="videoBurnDialogue" />
              <span v-if="videoBurnDialogue" class="video-option-hint">开启后把各镜「配音」生成的对白混入成片；可与字幕同时开启，两条音轨会同时出现。</span>
            </div>
          </el-form-item>
          <el-form-item label="水印">
            <div class="video-option-row">
              <el-switch :disabled="projectSession.enabled && !projectSession.canEdit" v-model="videoWatermark" />
              <el-input
 :disabled="projectSession.enabled && !projectSession.canEdit"                v-if="videoWatermark"
                v-model="videoWatermarkText"
                placeholder="右下角水印文字"
                maxlength="200"
                show-word-limit
                clearable
                class="video-watermark-input"
              />
            </div>
          </el-form-item>
        </div>
        <p class="config-tip" v-if="isAdmin">文本/图片/视频使用的模型以「<el-link type="primary" underline="never" @click="showAiConfigDialog = true">AI 配置</el-link>」中设为默认的为准。</p>
        <p class="config-tip" v-else>文本、图片和视频模型由项目分组统一配置；请联系组管理员或运营管理员调整。</p>
        <div class="merge-format-preview" aria-label="输出格式预览">
          <div class="merge-format-frame" :class="{ landscape: ['16:9', '4:3', '3:2', '21:9'].includes(projectAspectRatio), square: projectAspectRatio === '1:1' }"><span>{{ projectAspectRatio }}</span><b>{{ videoResolution }}</b></div>
        </div>
      </section>

      <!-- 8. 合成视频 -->
      <section v-show="workflowStage === 'merge'" id="anchor-video" class="section card merge-output">
        <h2 class="section-title">合成视频</h2>
        <div class="merge-readiness" :class="{ ready: mergeReadiness.total > 0 && mergeReadiness.missing === 0 }">
          <b>镜头就绪：{{ mergeReadiness.ready }} / {{ mergeReadiness.total }}</b>
          <span v-if="mergeReadiness.missing">还有 {{ mergeReadiness.missing }} 个分镜没有可用于合成的视频。</span>
          <span v-else>请先在分镜管理中生成视频。</span>
        </div>
        <div v-if="storyboards.length" class="merge-shot-grid" aria-label="分镜视频就绪状态">
          <button v-for="(shot, index) in storyboards" :key="shot.id" type="button" :class="{ ready: getSbAllVideos(shot.id).length > 0 }" :title="`镜头 ${index + 1}：${getSbAllVideos(shot.id).length > 0 ? '已就绪' : '缺少视频'}`" @click="getSbAllVideos(shot.id).length === 0 && setWorkflowStage('storyboard')"><span>{{ String(index + 1).padStart(2, '0') }}</span><i></i></button>
        </div>
        <el-button v-if="mergeReadiness.missing" plain @click="setWorkflowStage('storyboard')">返回分镜补齐视频</el-button>
        <el-button
          type="primary"
          size="large"
          :loading="videoStatus === 'generating'"
          :disabled="(projectSession.enabled && !projectSession.canEdit) || (!currentEpisodeId || mergeReadiness.total === 0 || mergeReadiness.missing > 0 || videoStatus === 'generating')"
          @click="onGenerateVideo"
        >
          合成视频
        </el-button>
        <div v-if="videoStatus === 'generating'" class="video-progress">
          <el-progress :percentage="videoProgress" :status="videoProgress >= 100 ? 'success' : undefined" />
          <p>视频生成中...</p>
        </div>
        <div v-if="videoStatus === 'done'" class="video-done">
          <el-alert type="success" title="视频生成完成" show-icon />
        </div>
        <div v-else-if="videoStatus === 'error'" class="video-error">
          <el-alert type="error" :title="videoErrorMsg" show-icon />
        </div>
        <div v-if="currentEpisodeVideoUrl" class="video-preview-wrap">
          <p class="video-preview-label">本集合成视频预览</p>
          <video
            :key="currentEpisodeVideoUrl"
            :src="currentEpisodeVideoUrl"
            controls
            class="video-preview-player"
            preload="metadata"
            @error="onEpisodeVideoError"
          />
        </div>
      </section>
    </main>

    <!-- 添加道具弹窗 -->
    <el-dialog v-model="showAddProp" title="添加道具" width="600px" @close="() => { addPropForm = { name: '', type: '', description: '', prompt: '' }; addPropAddRefImage = null }">
      <el-form :disabled="projectSession.enabled && !projectSession.canEdit" label-width="90px">
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <div class="ref-image-box" :aria-disabled="projectSession.enabled && !projectSession.canEdit" @click="!(projectSession.enabled && !projectSession.canEdit) && addPropAddRefFileInput?.click()" @drop.prevent="onRefImageDrop2('addProp', $event)" @dragover.prevent>
              <img v-if="addPropAddRefImage" :src="addPropAddRefImage.dataUrl" class="ref-preview-img" />
              <div v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></div>
            </div>
            <div v-if="addPropAddRefImage" class="ref-actions">
              <el-button :disabled="projectSession.enabled && !projectSession.canEdit" type="primary" size="small" :loading="extractingPropAddDesc" @click="doExtractFromRef2('addProp')">提取特征描述</el-button>
              <el-button size="small" @click="addPropAddRefImage = null">移除</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="addPropForm.name" placeholder="道具名称" />
        </el-form-item>
        <el-form-item label="类型">
          <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="addPropForm.type" placeholder="如：物品、建筑" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="addPropForm.description" type="textarea" :rows="3" placeholder="描述" />
        </el-form-item>
        <el-form-item label="图生提示词">
          <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="addPropForm.prompt" type="textarea" :rows="2" placeholder="画面描述提示词" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddProp = false">取消</el-button>
        <el-button type="primary" :loading="addPropSaving" :disabled="(projectSession.enabled && !projectSession.canEdit) || !addPropForm.name.trim()" @click="submitAddProp">确定</el-button>
      </template>
    </el-dialog>

    <!-- 隐藏的文件输入框（放在弹窗外层，避免 el-form-item 干扰） -->
    <input ref="addCharRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange('character', $event)" />
    <input ref="addSceneRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange('scene', $event)" />
    <input ref="addPropRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange('prop', $event)" />
    <input ref="addPropAddRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange2('addProp', $event)" />

    <!-- 添加/编辑角色弹窗 -->
    <el-dialog v-model="showEditCharacter" :title="editCharacterForm?.id ? (projectSession.enabled && !projectSession.canEdit ? '查看角色' : '编辑角色') : '添加角色'" class="character-editor-dialog" width="min(920px, calc(100vw - 32px))" append-to-body @opened="resetCharacterEditorScroll" @close="onCloseCharDialog">
      <el-form :disabled="projectSession.enabled && !projectSession.canEdit" v-if="editCharacterForm" label-width="90px">
        <!-- 参考图上传区（新增/编辑均显示） -->
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <div class="ref-image-box" :aria-disabled="projectSession.enabled && !projectSession.canEdit" @click="!(projectSession.enabled && !projectSession.canEdit) && addCharRefFileInput?.click()" @drop.prevent="onRefImageDrop('character', $event)" @dragover.prevent>
              <!-- 优先：刚上传的新参考图 -->
              <img v-if="addCharRefImage" :src="addCharRefImage.dataUrl" class="ref-preview-img" />
              <!-- 次之：已保存的参考图 -->
              <img v-else-if="editCharacterForm.ref_image"
                :src="editCharacterForm.ref_image.startsWith('http') ? editCharacterForm.ref_image : '/static/' + editCharacterForm.ref_image"
                class="ref-preview-img" />
              <!-- 最后：主图（半透明，提示可上传参考图替代） -->
              <img v-else-if="editCharacterForm.id && (editCharacterForm.image_url || editCharacterForm.local_path)"
                :src="assetImageUrl(editCharacterForm)"
                class="ref-preview-img" style="opacity:0.5" />
              <div v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></div>
              <button v-if="addCharRefImage || editCharacterForm.ref_image" type="button" class="ref-image-remove" aria-label="移除参考图" @click.stop="removeEditCharacterReferenceImage">×</button>
            </div>
            <div class="ref-image-meta">
              <div class="ref-upload-tip">支持 jpg/png/gif/webp，单张不超过 {{ MAX_IMAGE_SIZE_MB }}MB</div>
              <el-button v-if="editCharacterForm.id" size="small" type="primary" plain :loading="generatingCharIds.has(editCharacterForm.id)" @click="onEditCharacterGenerateImage">生成角色图</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="editCharacterForm.name" placeholder="角色名称" />
        </el-form-item>
        <el-form-item label="身份/定位">
          <el-select :disabled="projectSession.enabled && !projectSession.canEdit" v-model="editCharacterForm.role" placeholder="请选择角色类型" style="width:200px">
            <el-option value="main" label="主角" />
            <el-option value="supporting" label="配角" />
            <el-option value="minor" label="次要角色" />
          </el-select>
        </el-form-item>
        <el-form-item label="外貌描述">
          <div class="character-field-stack">
            <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="editCharacterForm.appearance" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" placeholder="外貌描述（尽量详细）" />
            <div class="character-field-actions">
              <el-button v-if="characterDescriptionSourceLabel" size="small" :loading="extractingCharAppearance" @click="extractEditCharacterDescription">{{ characterDescriptionSourceLabel }}</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="简介">
          <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="editCharacterForm.description" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="角色背景简介" />
        </el-form-item>
        <el-form-item v-if="editCharacterForm.id" label="音色参考">
          <div class="character-inline-control">
            <div class="character-field-actions">
              <el-button :disabled="projectSession.enabled && !projectSession.canEdit && editCharacterForm.seedance2_voice_asset?.status !== 'active'" size="small" :loading="sd2VoiceUploadingId === editCharacterForm.id" @click="onEditCharacterVoiceAction">{{ editCharacterForm.seedance2_voice_asset?.status === 'active' ? '音色已绑定' : '绑定音色' }}</el-button>
              <el-button v-if="editCharacterForm.seedance2_voice_asset?.status === 'active'" size="small" @click="onEditCharacterVoiceReplace">更换音色</el-button>
              <el-button v-if="editCharacterForm.seedance2_voice_asset?.url" size="small" @click="playSd2Voice(editCharacterForm)">试听</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item v-if="editCharacterForm.id">
          <template #label>
            <span style="font-size:12px;line-height:1.4;white-space:normal;word-break:break-all;display:inline-block;width:90px">图生提示词</span>
          </template>
          <div style="width:100%">
            <div class="character-field-help">最终提示词，可修改</div>
            <el-input
              v-model="editCharacterForm.polished_prompt"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 16 }"
              :placeholder="editCharacterPromptGenerating ? 'AI 正在生成提示词，请稍候…' : '点击「重新生成提示词」由 AI 自动生成，或直接在此输入'"
              :disabled="(projectSession.enabled && !projectSession.canEdit) || (editCharacterPromptGenerating)"
              style="font-size:12px"
            />
            <div class="character-field-actions">
              <el-button size="small" :loading="editCharacterPromptGenerating" @click="doGenerateCharacterPrompt">重新生成提示词</el-button>
            </div>
          </div>
        </el-form-item>
        <!-- P0-2: 视觉锚点（identity_anchors） -->
        <el-form-item v-if="editCharacterForm.id" label="视觉锚点">
          <div style="width:100%">
            <div class="character-field-help">角色的关键外观特征，用于保持形象一致</div>
            <el-input
              v-if="editCharacterForm.identity_anchors"
              :value="typeof editCharacterForm.identity_anchors === 'string'
                ? editCharacterForm.identity_anchors
                : JSON.stringify(editCharacterForm.identity_anchors, null, 2)"
              type="textarea"
              :rows="4"
              readonly
              style="font-size:11px;font-family:monospace"
              placeholder="点击「提炼视觉锚点」生成"
            />
            <div v-else style="font-size:12px;color:#c0c4cc;padding:4px 0">暂无锚点，点击「提炼视觉锚点」自动提炼</div>
            <div class="character-field-actions">
              <el-button size="small" :loading="extractingAnchors" :disabled="(projectSession.enabled && !projectSession.canEdit) || (!editCharacterForm.appearance)" @click="extractIdentityAnchors">提炼视觉锚点</el-button>
            </div>
          </div>
        </el-form-item>
        <!-- P1-3: 多阶段造型（stages） -->
        <el-form-item v-if="editCharacterForm.id" label="多阶段造型">
          <div style="width:100%">
            <el-input
 :disabled="projectSession.enabled && !projectSession.canEdit"              v-model="editCharacterForm.stages"
              type="textarea"
              :rows="4"
              placeholder='例：[{"episode_range":[1,5],"appearance":"白衣少年"},{"episode_range":[6,10],"appearance":"黑衣武者"}]'
              style="font-size:12px;font-family:monospace"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="character-editor-footer">
          <el-button v-if="editCharacterForm?.id" :disabled="projectSession.enabled && !projectSession.canEdit && editCharacterForm.seedance2_asset?.status !== 'active'" type="primary" plain :loading="sd2CertifyingId === editCharacterForm.id" @click="onEditCharacterSd2Action">{{ sd2ActionLabel(editCharacterForm) }}</el-button>
          <div class="character-editor-footer-main">
            <el-button @click="showEditCharacter = false">取消</el-button>
            <el-button type="primary" :loading="editCharacterSaving" :disabled="(projectSession.enabled && !projectSession.canEdit) || !editCharacterForm?.name?.trim()" @click="submitEditCharacter">{{ editCharacterForm?.id ? '保存' : '添加' }}</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showCharSd2Cert"
      title="角色素材详情"
      width="min(720px, 92vw)"
      destroy-on-close
      class="sd2-cert-dialog"
    >
      <template v-if="charSd2CertPayload">
        <el-descriptions :column="1" border size="small" class="sd2-cert-desc">
          <el-descriptions-item label="素材 ID">
            <span class="sd2-cert-value">{{ charSd2CertPayload.hub_asset_id || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="asset_url">
            <code class="sd2-cert-value">{{ charSd2CertPayload.asset_url || '—' }}</code>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <span class="sd2-cert-value">{{ charSd2CertPayload.status || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item v-if="charSd2CertPayload.stage" label="处理阶段">
            <span class="sd2-cert-value">{{ charSd2CertPayload.stage }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="登记图片 URL">
            <span class="sd2-cert-value">{{ charSd2CertPayload.certified_image_url || charSd2CertPayload.source_image_url || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item v-if="charSd2CertPayload.sd2_provider" label="登记提供方">
            <span class="sd2-cert-value">{{ charSd2CertPayload.sd2_provider }}</span>
          </el-descriptions-item>
          <el-descriptions-item v-if="charSd2CertPayload.error" label="失败原因">
            <span class="sd2-cert-value">{{ charSd2CertPayload.error }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </template>
      <template #footer>
        <el-button @click="showCharSd2Cert = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 编辑道具弹窗 -->
    <el-dialog v-model="showEditProp" :title="editPropForm?.id ? '编辑道具' : '添加道具'" width="75%" @close="onClosePropDialog">
      <el-form :disabled="projectSession.enabled && !projectSession.canEdit" v-if="editPropForm" label-width="90px">
        <!-- 参考图上传区（新增/编辑均显示） -->
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <div class="ref-image-box" :aria-disabled="projectSession.enabled && !projectSession.canEdit" @click="!(projectSession.enabled && !projectSession.canEdit) && addPropRefFileInput?.click()" @drop.prevent="onRefImageDrop('prop', $event)" @dragover.prevent>
              <img v-if="addPropRefImage" :src="addPropRefImage.dataUrl" class="ref-preview-img" />
              <img v-else-if="editPropForm.ref_image"
                :src="editPropForm.ref_image.startsWith('http') ? editPropForm.ref_image : '/static/' + editPropForm.ref_image"
                class="ref-preview-img" />
              <img v-else-if="editPropForm.id && (editPropForm.image_url || editPropForm.local_path)"
                :src="assetImageUrl(editPropForm)" class="ref-preview-img" style="opacity:0.5" />
              <div v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></div>
            </div>
            <div v-if="addPropRefImage" class="ref-actions">
              <el-button :disabled="projectSession.enabled && !projectSession.canEdit" type="primary" size="small" :loading="extractingPropDesc" @click="doExtractFromRef('prop')">提取特征描述</el-button>
              <el-button size="small" @click="addPropRefImage = null">移除</el-button>
            </div>
            <div v-else-if="editPropForm.ref_image" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingPropDesc" @click="doExtractPropFromImage">从参考图提取描述</el-button>
              <el-button size="small" @click="clearPropRefImage">移除参考图</el-button>
            </div>
            <div v-else-if="editPropForm.id && (editPropForm.image_url || editPropForm.local_path) && !editPropForm.description" class="ref-actions">
              <el-button size="small" :loading="extractingPropDesc" @click="doExtractPropFromImage">从主图提取描述</el-button>
            </div>
            <div class="ref-upload-tip">支持 jpg/png/gif/webp，单张不超过 {{ MAX_IMAGE_SIZE_MB }}MB</div>
          </div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="editPropForm.name" placeholder="道具名称" />
        </el-form-item>
        <el-form-item label="类型">
          <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="editPropForm.type" placeholder="如：物品、建筑" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="editPropForm.description" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="道具描述" />
        </el-form-item>
        <el-form-item label="图生提示词">
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">AI 润色后的图片提示词，生成图片时直接使用；可手动修改</span>
              <el-button size="small" :loading="editPropPromptGenerating" @click="doGeneratePropPrompt">重新生成提示词</el-button>
            </div>
            <el-input
              v-model="editPropForm.prompt"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 16 }"
              :placeholder="editPropPromptGenerating ? 'AI 正在生成提示词，请稍候…' : '点击「重新生成提示词」由 AI 自动生成，或直接在此输入'"
              :disabled="(projectSession.enabled && !projectSession.canEdit) || (editPropPromptGenerating)"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditProp = false">取消</el-button>
        <el-button type="primary" :loading="editPropSaving" :disabled="(projectSession.enabled && !projectSession.canEdit) || !editPropForm?.name?.trim()" @click="submitEditProp">保存</el-button>
      </template>
    </el-dialog>

    <!-- 添加/编辑场景弹窗 -->
    <el-dialog v-model="showEditScene" :title="editSceneForm?.id ? '编辑场景' : '添加场景'" width="75%" @close="onCloseSceneDialog">
      <el-form :disabled="projectSession.enabled && !projectSession.canEdit" v-if="editSceneForm" label-width="90px">
        <!-- 参考图上传区（新增/编辑均显示） -->
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <div class="ref-image-box" :aria-disabled="projectSession.enabled && !projectSession.canEdit" @click="!(projectSession.enabled && !projectSession.canEdit) && addSceneRefFileInput?.click()" @drop.prevent="onRefImageDrop('scene', $event)" @dragover.prevent>
              <img v-if="addSceneRefImage" :src="addSceneRefImage.dataUrl" class="ref-preview-img" />
              <img v-else-if="editSceneForm.ref_image"
                :src="editSceneForm.ref_image.startsWith('http') ? editSceneForm.ref_image : '/static/' + editSceneForm.ref_image"
                class="ref-preview-img" />
              <img v-else-if="editSceneForm.id && (editSceneForm.image_url || editSceneForm.local_path)"
                :src="assetImageUrl(editSceneForm)" class="ref-preview-img" style="opacity:0.5" />
              <div v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></div>
            </div>
            <div v-if="addSceneRefImage" class="ref-actions">
              <el-button :disabled="projectSession.enabled && !projectSession.canEdit" type="primary" size="small" :loading="extractingSceneDesc" @click="doExtractFromRef('scene')">提取特征描述</el-button>
              <el-button size="small" @click="addSceneRefImage = null">移除</el-button>
            </div>
            <div v-else-if="editSceneForm.ref_image" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingSceneDesc" @click="doExtractSceneFromImage">从参考图提取描述</el-button>
              <el-button size="small" @click="clearSceneRefImage">移除参考图</el-button>
            </div>
            <div v-else-if="editSceneForm.id && (editSceneForm.image_url || editSceneForm.local_path) && !editSceneForm.prompt" class="ref-actions">
              <el-button size="small" :loading="extractingSceneDesc" @click="doExtractSceneFromImage">从主图提取描述</el-button>
            </div>
            <div class="ref-upload-tip">支持 jpg/png/gif/webp，单张不超过 {{ MAX_IMAGE_SIZE_MB }}MB</div>
          </div>
        </el-form-item>
        <el-form-item label="地点" required>
          <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="editSceneForm.location" placeholder="如：森林、教室" />
        </el-form-item>
        <el-form-item label="时间">
          <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="editSceneForm.time" placeholder="如：白天、傍晚" />
        </el-form-item>
        <el-form-item label="场景描述">
          <el-input :disabled="projectSession.enabled && !projectSession.canEdit" v-model="editSceneForm.prompt" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="场景的简要描述，供 AI 生成四视图时参考" />
        </el-form-item>
        <el-form-item v-if="editSceneForm.id">
          <template #label>
            <span style="font-size:12px;line-height:1.4;white-space:normal;word-break:break-all;display:inline-block;width:90px">单图提示词</span>
          </template>
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">单图场景的完整图片提示词（不含四宫格布局），生图时直接使用；可手动修改</span>
              <el-button size="small" :loading="editScenePromptGenerating" @click="doGenerateSceneSinglePrompt">重新生成提示词</el-button>
            </div>
            <el-input
 :disabled="projectSession.enabled && !projectSession.canEdit"              v-model="editSceneForm.polished_prompt_single"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 16 }"
              placeholder="单图场景提示词，点击场景列表的「AI 生成」按钮（不勾选四宫格）后会自动生成"
              style="font-size:12px"
            />
          </div>
        </el-form-item>
        <el-form-item v-if="editSceneForm.id">
          <template #label>
            <span style="font-size:12px;line-height:1.4;white-space:normal;word-break:break-all;display:inline-block;width:90px">四视图提示词</span>
          </template>
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">AI 生成的完整四视图图片提示词，生图时直接使用；可手动修改</span>
              <el-button size="small" :loading="editScenePromptGenerating" @click="doGenerateScenePrompt">重新生成提示词</el-button>
            </div>
            <el-input
              v-model="editSceneForm.polished_prompt"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 16 }"
              :placeholder="editScenePromptGenerating ? 'AI 正在生成四视图提示词，请稍候…' : '点击「重新生成提示词」由 AI 自动生成，或直接在此输入'"
              :disabled="(projectSession.enabled && !projectSession.canEdit) || (editScenePromptGenerating)"
              style="font-size:12px"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditScene = false">取消</el-button>
        <el-button type="primary" :loading="editSceneSaving" :disabled="(projectSession.enabled && !projectSession.canEdit) || !editSceneForm?.location?.trim()" @click="submitEditScene">{{ editSceneForm?.id ? '保存' : '添加' }}</el-button>
      </template>
    </el-dialog>

    <!-- 角色资源库（本剧库 / 本剧全部角色 / 团队库） -->
    <el-dialog v-model="showCharLibrary" title="角色资源库" width="min(720px, calc(100vw - 24px))" destroy-on-close class="library-dialog" @open="onCharLibraryDialogOpen">
      <el-tabs v-model="charLibraryTab" class="char-library-tabs" @tab-change="onCharLibraryTabChange">
        <el-tab-pane v-if="charLibraryTotal > 0 || charLibraryTab === 'library'" label="历史项目库" name="library">
          <div class="library-toolbar">
            <el-input v-model="charLibraryKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadCharLibrary()" />
          </div>
          <div v-loading="charLibraryLoading" class="library-list">
            <div v-for="item in charLibraryList" :key="'lib-' + item.id" class="library-item">
              <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || '').slice(0, 60) }}{{ (item.description || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isCharAddToEpisodeLoading('library', item.id)" :disabled="!currentEpisodeId" @click="onAddCharFromLibrary(item)">加入本集</el-button>
                  <el-button size="small" @click="openEditCharLibrary(item)">编辑</el-button>
                  <el-button :disabled="projectSession.enabled && !projectSession.canEdit" size="small" type="danger" plain @click="onDeleteCharLibrary(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!charLibraryLoading && charLibraryList.length === 0" class="library-empty">未找到历史角色素材。新增素材请在项目详情页导入制作资源。</div>
          </div>
          <div class="library-pagination">
            <el-pagination
              v-model:current-page="charLibraryPage"
              v-model:page-size="charLibraryPageSize"
              :total="charLibraryTotal"
              :page-sizes="[10, 20, 50]"
              layout="total, sizes, prev, pager, next"
              @current-change="loadCharLibraryList"
              @size-change="loadCharLibraryList"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane label="本剧所有角色" name="drama">
          <div class="library-toolbar">
            <el-input v-model="dramaAllCharKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadDramaAllCharList()" />
          </div>
          <div v-loading="dramaAllCharLoading" class="library-list">
            <div v-for="item in dramaAllCharList" :key="'drama-' + item.id" class="library-item">
              <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">
                  {{ item.name || '未命名' }}
                  <el-tag v-if="item.role" size="small" type="info" style="margin-left: 6px">{{ charRoleLabel(item.role) }}</el-tag>
                </div>
                <div class="library-item-desc">{{ (item.description || item.appearance || '').slice(0, 60) }}{{ (item.description || item.appearance || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isCharAddToEpisodeLoading('drama', item.id)" :disabled="!currentEpisodeId" @click="onAddDramaCharToEpisode(item)">加入本集</el-button>
                </div>
              </div>
            </div>
            <div v-if="!dramaAllCharLoading && dramaAllCharList.length === 0" class="library-empty">本剧暂无制作角色，请先在角色面板创建</div>
          </div>
          <div class="library-pagination">
            <el-pagination
              v-model:current-page="dramaAllCharPage"
              v-model:page-size="dramaAllCharPageSize"
              :total="dramaAllCharTotal"
              :page-sizes="[10, 20, 50]"
              layout="total, sizes, prev, pager, next"
              @current-change="loadDramaAllCharList"
              @size-change="loadDramaAllCharList"
            />
          </div>
        </el-tab-pane>

      </el-tabs>
      <template #footer>
        <el-button @click="showCharLibrary = false">关闭</el-button>
      </template>
    </el-dialog>
    <!-- 编辑公共角色 -->
    <el-dialog v-model="showEditCharLibrary" title="编辑公共角色" width="440px" @close="editCharLibraryForm = null">
      <el-form :disabled="projectSession.enabled && !projectSession.canEdit" v-if="editCharLibraryForm" label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="editCharLibraryForm.name" placeholder="角色名称" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="editCharLibraryForm.category" placeholder="可选" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editCharLibraryForm.description" type="textarea" :rows="3" placeholder="可选" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="editCharLibraryForm.tags" placeholder="可选，逗号分隔" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditCharLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editCharLibrarySaving" @click="submitEditCharLibrary">保存</el-button>
      </template>
    </el-dialog>

    <!-- 道具资源库 -->
    <el-dialog v-model="showPropLibrary" title="道具资源库" width="min(720px, calc(100vw - 24px))" destroy-on-close class="library-dialog" @open="onPropLibraryDialogOpen">
      <el-tabs v-model="propLibraryTab" class="char-library-tabs" @tab-change="onPropLibraryTabChange">
        <el-tab-pane v-if="propLibraryTotal > 0 || propLibraryTab === 'library'" label="历史项目库" name="library">
          <div class="library-toolbar">
            <el-input v-model="propLibraryKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadPropLibrary()" />
          </div>
          <div v-loading="propLibraryLoading" class="library-list">
            <div v-for="item in propLibraryList" :key="'plib-' + item.id" class="library-item">
              <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isPropAddToEpisodeLoading('library', item.id)" :disabled="!currentEpisodeId" @click="onAddPropFromLibrary(item)">加入本集</el-button>
                  <el-button size="small" @click="openEditPropLibrary(item)">编辑</el-button>
                  <el-button :disabled="projectSession.enabled && !projectSession.canEdit" size="small" type="danger" plain @click="onDeletePropLibrary(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!propLibraryLoading && propLibraryList.length === 0" class="library-empty">未找到历史道具素材。新增素材请在项目详情页导入制作资源。</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="propLibraryPage" v-model:page-size="propLibraryPageSize" :total="propLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadPropLibraryList" @size-change="loadPropLibraryList" />
          </div>
        </el-tab-pane>
        <el-tab-pane label="本剧所有道具" name="drama">
          <div class="library-toolbar">
            <el-input v-model="dramaAllPropKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadDramaAllPropList()" />
          </div>
          <div v-loading="dramaAllPropLoading" class="library-list">
            <div v-for="item in dramaAllPropList" :key="'pdr-' + item.id" class="library-item">
              <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isPropAddToEpisodeLoading('drama', item.id)" :disabled="!currentEpisodeId" @click="onAddDramaPropToEpisode(item)">加入本集</el-button>
                </div>
              </div>
            </div>
            <div v-if="!dramaAllPropLoading && dramaAllPropList.length === 0" class="library-empty">本剧暂无制作道具，请先在道具面板创建</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="dramaAllPropPage" v-model:page-size="dramaAllPropPageSize" :total="dramaAllPropTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadDramaAllPropList" @size-change="loadDramaAllPropList" />
          </div>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="showPropLibrary = false">关闭</el-button>
      </template>
    </el-dialog>
    <!-- 编辑公共道具 -->
    <el-dialog v-model="showEditPropLibrary" title="编辑公共道具" width="440px" @close="editPropLibraryForm = null">
      <el-form :disabled="projectSession.enabled && !projectSession.canEdit" v-if="editPropLibraryForm" label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="editPropLibraryForm.name" placeholder="道具名称" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="editPropLibraryForm.category" placeholder="可选" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editPropLibraryForm.description" type="textarea" :rows="3" placeholder="可选" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="editPropLibraryForm.tags" placeholder="可选，逗号分隔" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditPropLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editPropLibrarySaving" @click="submitEditPropLibrary">保存</el-button>
      </template>
    </el-dialog>

    <!-- 场景资源库 -->
    <el-dialog v-model="showSceneLibrary" title="场景资源库" width="min(720px, calc(100vw - 24px))" destroy-on-close class="library-dialog" @open="onSceneLibraryDialogOpen">
      <el-tabs v-model="sceneLibraryTab" class="char-library-tabs" @tab-change="onSceneLibraryTabChange">
        <el-tab-pane v-if="sceneLibraryTotal > 0 || sceneLibraryTab === 'library'" label="历史项目库" name="library">
          <div class="library-toolbar">
            <el-input v-model="sceneLibraryKeyword" placeholder="搜索地点或描述" clearable style="width: 200px" @input="debouncedLoadSceneLibrary()" />
          </div>
          <div v-loading="sceneLibraryLoading" class="library-list">
            <div v-for="item in sceneLibraryList" :key="'slib-' + item.id" class="library-item">
              <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.location || item.time || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isSceneAddToEpisodeLoading('library', item.id)" :disabled="!currentEpisodeId" @click="onAddSceneFromLibrary(item)">加入本集</el-button>
                  <el-button size="small" @click="openEditSceneLibrary(item)">编辑</el-button>
                  <el-button :disabled="projectSession.enabled && !projectSession.canEdit" size="small" type="danger" plain @click="onDeleteSceneLibrary(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!sceneLibraryLoading && sceneLibraryList.length === 0" class="library-empty">未找到历史场景素材。新增素材请在项目详情页导入制作资源。</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="sceneLibraryPage" v-model:page-size="sceneLibraryPageSize" :total="sceneLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadSceneLibraryList" @size-change="loadSceneLibraryList" />
          </div>
        </el-tab-pane>
        <el-tab-pane label="本剧所有场景" name="drama">
          <div class="library-toolbar">
            <el-input v-model="dramaAllSceneKeyword" placeholder="搜索地点或描述" clearable style="width: 200px" @input="debouncedLoadDramaAllSceneList()" />
          </div>
          <div v-loading="dramaAllSceneLoading" class="library-list">
            <div v-for="item in dramaAllSceneList" :key="'sdr-' + item.id" class="library-item">
              <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.location || '未命名' }}<span v-if="item.time" class="library-item-sub"> · {{ item.time }}</span></div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isSceneAddToEpisodeLoading('drama', item.id)" :disabled="!currentEpisodeId" @click="onAddDramaSceneToEpisode(item)">加入本集</el-button>
                </div>
              </div>
            </div>
            <div v-if="!dramaAllSceneLoading && dramaAllSceneList.length === 0" class="library-empty">本剧暂无制作场景，请先在场景面板创建</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="dramaAllScenePage" v-model:page-size="dramaAllScenePageSize" :total="dramaAllSceneTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadDramaAllSceneList" @size-change="loadDramaAllSceneList" />
          </div>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="showSceneLibrary = false">关闭</el-button>
      </template>
    </el-dialog>
    <!-- 编辑公共场景 -->
    <el-dialog v-model="showEditSceneLibrary" title="编辑公共场景" width="440px" @close="editSceneLibraryForm = null">
      <el-form :disabled="projectSession.enabled && !projectSession.canEdit" v-if="editSceneLibraryForm" label-width="80px">
        <el-form-item label="地点">
          <el-input v-model="editSceneLibraryForm.location" placeholder="场景地点" />
        </el-form-item>
        <el-form-item label="时间">
          <el-input v-model="editSceneLibraryForm.time" placeholder="如：浅色/夜晚" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="editSceneLibraryForm.category" placeholder="可选" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editSceneLibraryForm.description" type="textarea" :rows="3" placeholder="可选" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="editSceneLibraryForm.tags" placeholder="可选，逗号分隔" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditSceneLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editSceneLibrarySaving" @click="submitEditSceneLibrary">保存</el-button>
      </template>
    </el-dialog>

    <ProjectAssetLibraryDialog
      v-model="projectLibraryDialogOpen"
      v-model:keyword="projectLibraryKeyword"
      :assets="projectLibraryDialogAssets"
      title="项目素材库"
      :joinable="false"
      @upload="onProjectLibraryUpload"
      @open-full="openProjectMediaLibrary"
    />

    <!-- P1-2: 导入小说弹窗 -->
    <el-dialog v-model="showNovelImport" title="导入小说/长文" width="600px" @close="novelImportReset">
      <div class="novel-import-dialog">
        <p style="color:#6b7280;font-size:13px;margin-bottom:12px">支持粘贴小说文本或上传 txt 文件，AI 自动识别章节并转换为剧本集数</p>
        <el-tabs v-model="novelImportMode">
          <el-tab-pane label="粘贴文本" name="text">
            <el-input
 :disabled="projectSession.enabled && !projectSession.canEdit"              v-model="novelText"
              type="textarea"
              :rows="10"
              placeholder="粘贴小说正文，AI 会自动识别章节..."
            />
          </el-tab-pane>
          <el-tab-pane label="上传文件" name="file">
            <el-upload
              drag
              :auto-upload="false"
              :on-change="onNovelFileChange"
              accept=".txt,.md"
              :show-file-list="false"
            >
              <el-icon class="el-icon--upload"><DocumentAdd /></el-icon>
              <div class="el-upload__text">拖拽 .txt / .md 文件到此处，或<em>点击上传</em></div>
            </el-upload>
            <div v-if="novelFileName" style="margin-top:8px;font-size:13px;color:#409eff">已选择：{{ novelFileName }}</div>
          </el-tab-pane>
        </el-tabs>
        <div class="novel-import-options" style="margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px;font-size:13px">
            <span>最多导入集数：</span>
            <el-input-number :disabled="projectSession.enabled && !projectSession.canEdit" v-model="novelMaxChapters" :min="1" :max="20" size="small" style="width:100px" />
          </div>
          <el-checkbox v-model="novelAiSummarize" size="small">AI 转换为剧本格式（会消耗 Token）</el-checkbox>
        </div>
      </div>
      <template #footer>
        <el-button @click="showNovelImport = false">取消</el-button>
        <el-button type="primary" :loading="novelImporting" @click="onImportNovel">开始导入</el-button>
      </template>
    </el-dialog>

    <!-- AI 配置弹窗（不跳转，避免本页内容丢失） -->
    <el-dialog v-if="isAdmin" v-model="showAiConfigDialog" title="AI 配置" width="90%" destroy-on-close class="ai-config-dialog">
      <AIConfigContent v-if="showAiConfigDialog" />
    </el-dialog>

    <!-- 图片放大预览：点击遮罩或图片关闭 -->
    <Teleport to="body">
      <div
        v-if="previewImageUrl"
        class="image-preview-overlay"
        @click="closeImagePreview"
      >
        <img :src="previewImageUrl" alt="" class="image-preview-img" @click.stop="closeImagePreview" />
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { projectSession } from '@/composables/useProjectCollaboration'
import ProjectCollaborationBar from '@/components/ProjectCollaborationBar.vue'
import { ref, computed, onMounted, watch, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Setting, Plus, Sunny, Moon, Upload, Document, DocumentAdd, Grid } from '@element-plus/icons-vue'
import { useTheme } from '@/composables/useTheme'

import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'
import GenerationSettings from '@/components/GenerationSettings.vue'
import { useFilmStore } from '@/stores/film'
import { useGenerationTaskStore, GEN_RESOURCE } from '@/stores/generationTaskStore'
import { syncGeneratingSetsFromStore, buildEpisodeContext, buildExtractTaskMeta, isEpisodeExtractRunning } from '@/composables/useGenerationTaskSync'
import { dramaAPI } from '@/api/drama'
import { generationAPI } from '@/api/generation'

import { characterAPI } from '@/api/characters'
import { propAPI } from '@/api/props'
import { sceneAPI } from '@/api/scenes'
import { taskAPI } from '@/api/task'
import { imagesAPI } from '@/api/images'
import { videosAPI } from '@/api/videos'
import { omniVideoAPI } from '@/api/omniVideo'
import { accountAPI } from '@/api/account'
import { storyboardsAPI as rawStoryboardsAPI } from '@/api/storyboards'
import { uploadAPI } from '@/api/upload'

import { generationSettingsAPI } from '@/api/prompts'
import { parseScriptIntoEpisodes, episodesListToPlainScript } from '@/utils/scriptEpisodes'

import { formatChinaTime } from '@/utils/time'

import StylePickerButton from '@/components/StylePickerButton.vue'
import AIConfigContent from '@/components/AIConfigContent.vue'

import ProjectAssetLibraryDialog from '@/components/ProjectAssetLibraryDialog.vue'
import FreeCreate from '@/views/FreeCreate.vue'
import { clearPromptDraft, currentDraftUserId, readPromptDraft, shouldRestorePromptDraft } from '@/utils/promptDraft'
import { generationStyleOptions, stylePromptMetadataForSave, backfillDramaStylePromptMetadataIfNeeded } from '@/constants/styleOptions'
import { MAX_IMAGE_SIZE_MB, checkImageFile } from '@/constants/uploadLimits'
import { runGenerateStoryFromPremise } from '@/composables/useStoryGeneration'
import { useCharacters } from '@/composables/filmCreate/useCharacters'
import { useProps as usePropsComposable } from '@/composables/filmCreate/useProps'
import { useScenes } from '@/composables/filmCreate/useScenes'
import { useModelOptions } from '@/composables/useModelOptions'

const route = useRoute()
const router = useRouter()
const store = useFilmStore()
const genStore = useGenerationTaskStore()
const { isDark, toggle: toggleTheme } = useTheme()
const { videoResolution: storeVideoResolution } = storeToRefs(store)
const isAdmin = computed(() => JSON.parse(localStorage.getItem('lmd_auth_user') || 'null')?.console_access === true)

// ── Composable: Navigation ─────────────────────────────

function goList() {
  router.push('/')
}

function goCanvasMode() {
  if (!dramaId.value) return
  const query = selectedEpisodeId.value ? { episode: String(selectedEpisodeId.value) } : {}
  router.push({ path: `/film/${dramaId.value}/canvas`, query })
}

function openProjectMediaLibrary() {
  if (!dramaId.value) return
  router.push({
    path: '/media-library',
    query: { drama_id: dramaId.value, return_to: route.fullPath },
  })
}

const projectLibraryDialogOpen = ref(false)
const projectLibraryKeyword = ref('')
const projectLibraryDialogAssets = computed(() => {
  const keyword = projectLibraryKeyword.value.trim().toLowerCase()
  if (!keyword) return universalLibraryAssets.value
  return universalLibraryAssets.value.filter((asset) => `${asset.name || ''} ${asset.description || ''}`.toLowerCase().includes(keyword))
})
function onProjectLibraryUpload(files) { onResourceMediaFileChange({ target: { files } }) }

const showAiConfigDialog = ref(false)
const storyInput = ref('')
const storyStyle = ref('')
const storyType = ref('')
const storyEpisodeCount = ref(1)
const storyGenerating = ref(false)
/** 剧本工作台：create 创作 | select 选择预览 */
const scriptWorkbenchMode = ref('create')
const showSelectScriptDialog = ref(false)
const selectScriptLoading = ref(false)
const selectScriptImporting = ref(false)
const selectScriptDramas = ref([])
/** 选择剧本弹窗列表：排除当前打开的项目，避免误点「导入」到自身 */
const selectableScriptDramas = computed(() => {
  const cur = store.dramaId
  const list = selectScriptDramas.value || []
  if (cur == null) return list
  return list.filter((d) => Number(d.id) !== Number(cur))
})
const selectPreviewEpisodeId = ref('')
// P1-2: 小说导入
const showNovelImport = ref(false)
const novelImportMode = ref('text')
const novelText = ref('')
const novelFileName = ref('')
const novelFileContent = ref('')
const novelMaxChapters = ref(10)
const novelAiSummarize = ref(false)
const novelImporting = ref(false)
const scriptTitle = ref('')
const selectedEpisodeId = ref(null)
/** 保存剧本后用于恢复选中集（后端重插后 id 会变，用 episode_number 匹配） */
const savedCurrentEpisodeNumber = ref(1)
const scriptLanguage = ref('zh')
const scriptStoryboardStyle = ref('')
const scriptGenerating = ref(false)
const isStoryGenRunning = computed(() => {
  if (storyGenerating.value || scriptGenerating.value) return true
  return genStore.getAllRunningTasks().some(
    (t) => Number(t.dramaId) === Number(dramaId.value) && t.resourceType === GEN_RESOURCE.GENERATE_STORY
  )
})
const generationStyle = ref('')
const projectAspectRatio = ref('16:9')
const videoClipDuration = ref(15)
const projectVideoModel = ref('auto')
const projectUpscaleResolution = ref('1080p')
const projectTargetFps = ref(null)
const universalLibraryAssets = ref([])
const detachedResourceLinks = ref([])
const unifiedResourceSelection = reactive({ character: new Set(), scene: new Set(), prop: new Set(), media: new Set() })
const resourceCatalogType = ref('character')
const resourceCatalogKeyword = ref('')
const resourceCatalogFilter = ref('all')
const resourceCatalogFilters = [
  { key: 'all', label: '全部' },
  { key: 'with-image', label: '有图片' },
  { key: 'missing-image', label: '待补图' },
]
const projectGenerationSettings = computed(() => ({
  video_model: projectVideoModel.value || 'auto',
  duration: Number(videoClipDuration.value) || 15,
  resolution: videoResolution.value || '720p',
  aspect_ratio: projectAspectRatio.value || '16:9',
  upscale_resolution: projectUpscaleResolution.value || null,
  target_fps: projectTargetFps.value || null,
}))
function setProjectGenerationSettings(next = {}) {
  projectVideoModel.value = next.video_model || 'auto'
  if (next.duration != null) videoClipDuration.value = Math.min(15, Math.max(1, Number(next.duration) || 15))
  if (next.resolution) videoResolution.value = next.resolution
  if (next.aspect_ratio) projectAspectRatio.value = next.aspect_ratio
  projectUpscaleResolution.value = next.upscale_resolution || null
  projectTargetFps.value = next.target_fps || null
}
function updateProjectGenerationSettings(next) {
  setProjectGenerationSettings(next)
  saveProjectSettings(false)
}

/** 根据 value 查找样式选项对象 */
function _findStyleOption(val) {
  for (const group of generationStyleOptions) {
    const found = group.options.find(o => o.value === val)
    if (found) return found
  }
  return null
}

/** 传给图像/视频 AI 用的英文 prompt（效果最好）；
 *  找不到 promptEn 时降级到 prompt，再降级到原始值 */
function getSelectedStylePrompt() {
  const val = (generationStyle.value || '').toString().trim()
  if (!val) return undefined
  const opt = _findStyleOption(val)
  if (opt) return opt.promptEn || opt.prompt || val
  return val
}

/** 中文风格描述（用于界面展示或中文场景提示词拼接） */
function getSelectedStylePromptZh() {
  const val = (generationStyle.value || '').toString().trim()
  if (!val) return undefined
  const opt = _findStyleOption(val)
  if (opt) return opt.prompt || opt.promptEn || val
  return val
}

function projectStylePromptMetadata() {
  return stylePromptMetadataForSave(generationStyle.value)
}

const scriptContent = computed({
  get: () => store.scriptContent,
  set: (v) => store.setScriptContent(v)
})
const videoResolution = storeVideoResolution
const videoSubtitle = ref(false)
/** 合成整集时把各镜对白 TTS（audio_local_path）按分镜时长对齐并混入成片 */
const videoBurnDialogue = ref(false)
const videoWatermark = ref(false)
/** 水印开启时烧录到成片右下角 */
const videoWatermarkText = ref('')

const dramaId = computed(() => store.dramaId)
// Historical projects may contain null placeholders after a resource or a
// storyboard was removed. Never let one stale row break the whole editor (or
// prevent an otherwise valid resource from being submitted for video).
const validRows = (value) => Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
const characters = computed(() => validRows(store.characters))
const scenes = computed(() => validRows(store.scenes))
const props = computed(() => validRows(store.props))
const storyboards = computed(() => validRows(store.storyboards))
const resourceCatalogTabs = computed(() => [
  { key: 'character', label: '角色', count: characters.value.length },
  { key: 'scene', label: '场景', count: scenes.value.length },
  { key: 'prop', label: '道具', count: props.value.length },
  { key: 'media', label: '项目素材', count: universalLibraryAssets.value.length },
])
const resourceCatalogMeta = computed(() => ({
  character: { label: '角色', empty: '可从剧本提取，或手动添加角色。' },
  scene: { label: '场景', empty: '可从当前剧本提取，或手动添加场景。' },
  prop: { label: '道具', empty: '可从当前剧本提取，或手动添加道具。' },
  media: { label: '项目素材', empty: '上传图片、视频或音频后，可在分镜中按需加入。' },
}[resourceCatalogType.value] || { label: '资源', empty: '' }))
const resourceCatalogItems = computed(() => ({
  character: characters.value,
  scene: scenes.value,
  prop: props.value,
  media: universalLibraryAssets.value,
}[resourceCatalogType.value] || []))
const resourceBatchImageMeta = computed(() => ({
  character: { label: '角色' },
  scene: { label: '场景' },
  prop: { label: '道具' },
}[resourceBatchImageType.value] || { label: '资源' }))
const resourceBatchMissingItems = computed(() => {
  const items = resourceBatchImageType.value === 'character'
    ? characters.value
    : resourceBatchImageType.value === 'scene'
      ? scenes.value
      : props.value
  return items.filter((item) => !hasAssetImage(item))
})
const resourceCatalogSelectedCount = computed(() => unifiedResourceSelection[resourceCatalogType.value]?.size || 0)
function resourceCatalogItemName(item) {
  if (resourceCatalogType.value === 'scene') return item?.location || item?.name || '未命名场景'
  return item?.name || `素材 ${item?.id || ''}`
}
function resourceCatalogItemDescription(item) {
  if (resourceCatalogType.value === 'character') return item?.appearance || item?.description || '待补充描述'
  if (resourceCatalogType.value === 'scene') return item?.description || item?.prompt || item?.time || '待补充描述'
  if (resourceCatalogType.value === 'prop') return item?.description || item?.prompt || item?.type || '待补充描述'
  return item?.library_scope === 'global' ? '我的全局素材' : '当前项目素材'
}
function resourceCatalogHasImage(item) {
  return resourceCatalogType.value === 'media' ? item?.type === 'image' : hasAssetImage(item)
}
function resourceCatalogImageUrl(item) {
  return resourceCatalogType.value === 'media' ? sbOmniAssetUrl(item) : assetImageUrl(item)
}
const filteredResourceCatalogItems = computed(() => {
  const keyword = resourceCatalogKeyword.value.trim().toLocaleLowerCase()
  return resourceCatalogItems.value.filter((item) => {
    const hasImage = resourceCatalogHasImage(item)
    if (resourceCatalogFilter.value === 'with-image' && !hasImage) return false
    if (resourceCatalogFilter.value === 'missing-image' && hasImage) return false
    if (!keyword) return true
    return `${resourceCatalogItemName(item)} ${resourceCatalogItemDescription(item)}`.toLocaleLowerCase().includes(keyword)
  })
})

// FilmCreate 与自由创作页可能同时编辑同一分镜。所有从本页发起的更新都携带
// 当前快照版本，成功后回写服务端的新 updated_at，避免旧页面的整行保存覆盖新编辑。
function findStoryboardForVersion(id) {
  return (storyboards.value || []).find((item) => Number(item.id) === Number(id)) || null
}

const storyboardsAPI = {
  ...rawStoryboardsAPI,
  async update(id, data = {}) {
    const row = findStoryboardForVersion(id)
    const expectedUpdatedAt = data.expected_updated_at ?? row?.updated_at
    const payload = expectedUpdatedAt != null
      ? { ...data, expected_updated_at: expectedUpdatedAt }
      : data
    const updated = await rawStoryboardsAPI.update(id, payload)
    if (row && updated && typeof updated === 'object') Object.assign(row, updated)
    return updated
  },
}
const WORKFLOW_STAGE_KEYS = ['script', 'resources', 'storyboard', 'merge']
function normalizeWorkflowStage(value) {
  const stage = Array.isArray(value) ? value[0] : value
  return WORKFLOW_STAGE_KEYS.includes(stage) ? stage : 'script'
}
const workflowStage = ref(normalizeWorkflowStage(route.query.stage))
// 嵌入的分镜工作台(FreeCreate)实例:外部 AI 生成分镜时调用其 refreshProjectShots 实时渲染
const freeCreateRef = ref(null)
// 资源阶段生成角色/场景/道具图使用的图像模型(留空走 AI 配置默认)
const resourceImageModels = useModelOptions('image')
const showResourceBatchImageDialog = ref(false)
const resourceBatchImageType = ref('character')
const resourceBatchImageModel = ref('')
const resourceBatchImageQuote = ref(null)
const resourceBatchImageQuoteError = ref('')
const resourceBatchImageQuoteLoading = ref(false)
let resourceBatchImageQuoteSequence = 0
// 默认收起为一条细横条(仅保留两个执行按钮),避免挤压剧本编辑区
const pipelinePanelExpanded = ref(false)
const resourceMediaFileInput = ref(null)
const resourceMediaUploading = ref(false)
const workflowStages = computed(() => [
  { key: 'script', label: '剧本管理', complete: !!scriptContent.value?.trim() },
  { key: 'resources', label: '统一资源', complete: characters.value.length + scenes.value.length + props.value.length + universalLibraryAssets.value.length > 0 },
  { key: 'storyboard', label: '分镜管理', complete: storyboards.value.length > 0 },
  { key: 'merge', label: '视频合成', complete: !!currentEpisode.value?.video_url },
])
const workflowStageMeta = computed(() => ({
  script: { title: '剧本管理', description: '确定故事与当前集剧本，再进入资源准备。' },
  resources: { title: '统一资源管理', description: '集中维护角色、场景、道具和媒体素材。' },
  storyboard: { title: '分镜管理', description: '为每个分镜拖入素材并用 @ 引用，再生成镜头视频。' },
  merge: { title: '视频合成', description: '检查镜头视频就绪状态后合成当前集成片。' },
}[workflowStage.value] || {}))
function setWorkflowStage(stage) {
  if (!WORKFLOW_STAGE_KEYS.includes(stage)) return
  workflowStage.value = stage
  if (route.query.stage !== stage) {
    router.replace({ query: { ...route.query, stage }, hash: route.hash }).catch(() => {})
  }
}
watch(() => route.query.stage, (stage) => {
  workflowStage.value = normalizeWorkflowStage(stage)
})
const currentEpisode = computed(() => store.currentEpisode)
const currentEpisodeId = computed(() => store.currentEpisode?.id ?? null)
const videoProgress = computed(() => store.videoProgress)
const videoStatus = computed(() => store.videoStatus)
const mergeReadiness = computed(() => {
  const total = storyboards.value.length
  const ready = storyboards.value.filter((sb) => getSbAllVideos(sb.id).length > 0).length
  return { total, ready, missing: Math.max(0, total - ready) }
})

/** 当前集合成视频的播放地址（用于按钮下方预览） */
const currentEpisodeVideoUrl = computed(() => {
  const url = currentEpisode.value?.video_url
  if (!url || !String(url).trim()) return ''
  const s = String(url).trim()
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  // 每次合成完成后 URL 都带完成时间，避免 Chromium 复用旧的 Range
  // 缓存条目（ERR_CACHE_OPERATION_NOT_SUPPORTED）而不重新读取成片。
  const version = currentEpisode.value?.updated_at || currentEpisode.value?.video_updated_at || ''
  const query = version ? `?v=${encodeURIComponent(version)}` : ''
  return '/static/' + s.replace(/^\//, '') + query
})

function onEpisodeVideoError(event) {
  const mediaError = event?.target?.error
  const detail = mediaError?.message || (mediaError?.code ? `媒体错误 ${mediaError.code}` : '浏览器无法读取成片文件')
  videoErrorMsg.value = `${detail}。请刷新页面后重试；若仍失败，请检查后端静态文件服务。`
}

const storyboardGenerating = computed(() =>
  isEpisodeExtractRunning(genStore, dramaId.value, currentEpisodeId.value, GEN_RESOURCE.GENERATE_STORYBOARD)
)
/** 分镜批量生成结束后，按镜序逐个润色全能片段（仅勾选全能模式且各镜为 universal 且有正文时） */
const universalOmniPolishRunning = ref(false)
const universalOmniPolishAbort = ref(false)
const universalOmniPolishProgress = ref({ current: 0, total: 0, label: '' })
const sbTruncatedWarning = ref(false)
const sbTruncatedDismissed = ref(false)
const videoErrorMsg = ref('')
// 一键全流程流水线
const pipelineRunning = ref(false)
const pipelinePaused = ref(false)
const pipelineAbortRequested = ref(false)
const pipelineErrorLog = ref([])
const pipelineCurrentStep = ref('')
const pipelineStepIndex = ref(0)    // 当前步骤序号（1-based）
/** 全流程 10 步；仅文本框架为前 4 步 */
const pipelineStepTotal = ref(10)
let pipelineResolveResume = null
// 倒计时（两个生成阶段之间的确认窗口）
const pipelineCountdown = ref(0)      // 剩余秒数，0 表示不在倒计时
const pipelineCountdownMsg = ref('')  // 倒计时说明文字
const pipelineConcurrency = ref(3)
const pipelineVideoConcurrency = ref(3)
const pipelineActiveTasks = reactive(new Set())

async function loadPipelineConcurrency() {
  try {
    const res = await generationSettingsAPI.get()
    pipelineConcurrency.value = Math.max(1, Number(res?.concurrency) || 3)
    pipelineVideoConcurrency.value = Math.max(1, Number(res?.video_concurrency) || 3)
  } catch (_) {}
}

/**
 * 带并发度的批量执行器。
 * @param {Array} items - 需要处理的项目列表
 * @param {number} concurrency - 最大并发数
 * @param {Function} fn - async (item, index) => void，内部可 throw 或 return {paused}
 * @param {{ getLabel?: (item) => string }} options
 * @returns {Promise<{paused: boolean}>}
 */
async function runConcurrently(items, concurrency, fn, options = {}) {
  let index = 0
  let anyPaused = false
  const getLabel = options.getLabel || (() => null)

  async function worker() {
    while (index < items.length) {
      const i = index++
      const item = items[i]
      const label = getLabel(item)
      if (label) pipelineActiveTasks.add(label)
      try {
        const result = await fn(item, i)
        if (result && typeof result === 'object' && result.paused) {
          anyPaused = true
          return
        }
      } finally {
        if (label) pipelineActiveTasks.delete(label)
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.allSettled(workers)
  return { paused: anyPaused }
}
// ── Composable: Characters ────────────────────────────
const {
  showEditCharacter, editCharacterForm, editCharacterSaving, editCharacterPromptGenerating,
  extractingCharAppearance, extractingAnchors, addCharRefImage, addCharRefFileInput,
  charactersGenerating, generatingCharIds, sd2CertifyingId, showCharSd2Cert, charSd2CertPayload,
  sd2VoiceUploadingId,
  showCharLibrary, charLibraryList, charLibraryLoading, charLibraryPage, charLibraryPageSize,
  charLibraryTotal, charLibraryKeyword, charLibraryTab,
  dramaAllCharList, dramaAllCharLoading, dramaAllCharPage, dramaAllCharPageSize, dramaAllCharTotal, dramaAllCharKeyword,
  showEditCharLibrary, editCharLibraryForm,
  editCharLibrarySaving, addingCharToLibraryId, addingCharToMaterialId, addingCharFromLibraryId,
  charRoleLabel, onGenerateCharacters, openAddCharacter, stopCharacterPromptPoll, editCharacter,
  saveCharRefImageIfAny, submitEditCharacter, doGenerateCharacterPrompt, doExtractCharFromImage,
  extractIdentityAnchors, clearCharRefImage, onCloseCharDialog, onDeleteCharacter, onGenerateCharacterImage, onSd2CertifyCharacter, onSd2CertifyRefresh, sd2ActionLabel, sd2StatusLabel, onSd2PrimaryAction, openCharSd2CertDialog,
  onSd2VoicePrimaryAction, onSd2VoiceReplace, sd2VoiceActionLabel, playSd2Voice,
  loadCharLibraryList, debouncedLoadCharLibrary, loadDramaAllCharList, debouncedLoadDramaAllCharList,
  onCharLibraryDialogOpen, onCharLibraryTabChange, isCharAddToEpisodeLoading,
  openEditCharLibrary, submitEditCharLibrary,
  onDeleteCharLibrary, onAddCharacterToLibrary, onAddCharacterToMaterialLibrary,
  onAddCharFromLibrary, onAddDramaCharToEpisode,
} = useCharacters({ store, dramaId, currentEpisodeId, getSelectedStyle, loadDrama, pollTask, pollUntilResourceHasImage, hasAssetImage })

// ── Composable: Props ──────────────────────────────────
const {
  showAddProp, addPropSaving, addPropForm,
  showEditProp, editPropForm, editPropSaving, editPropPromptGenerating,
  extractingPropDesc, addPropRefImage, addPropRefFileInput,
  addPropAddRefImage, addPropAddRefFileInput, extractingPropAddDesc,
  propsExtracting, generatingPropIds,
  showPropLibrary, propLibraryList, propLibraryLoading, propLibraryPage, propLibraryPageSize,
  propLibraryTotal, propLibraryKeyword, propLibraryTab,
  dramaAllPropList, dramaAllPropLoading, dramaAllPropPage, dramaAllPropPageSize, dramaAllPropTotal, dramaAllPropKeyword,
  showEditPropLibrary, editPropLibraryForm,
  editPropLibrarySaving, addingPropToLibraryId, addingPropToMaterialId, addingPropFromLibraryId,
  onExtractProps, stopPropPromptPoll, editProp, doGeneratePropPrompt, savePropRefImageIfAny,
  clearPropRefImage, doExtractPropFromImage, submitEditProp, submitAddProp,
  onClosePropDialog, onDeleteProp, onGeneratePropImage,
  loadPropLibraryList, debouncedLoadPropLibrary, loadDramaAllPropList, debouncedLoadDramaAllPropList,
  onPropLibraryDialogOpen, onPropLibraryTabChange, isPropAddToEpisodeLoading,
  openEditPropLibrary, submitEditPropLibrary,
  onDeletePropLibrary, onAddPropToLibrary, onAddPropToMaterialLibrary,
  onAddPropFromLibrary, onAddDramaPropToEpisode,
  doExtractFromRef2,
} = usePropsComposable({ store, dramaId, currentEpisodeId, getSelectedStyle, loadDrama, pollTask, pollUntilResourceHasImage, hasAssetImage })

// ── Composable: Scenes ─────────────────────────────────
const {
  showEditScene, editSceneForm, editSceneSaving, editScenePromptGenerating,
  extractingSceneDesc, addSceneRefImage, addSceneRefFileInput,
  scenesExtracting, generatingSceneIds,
  // 场景多视角额外 state（由 FilmCreate 管理）
  showSceneLibrary, sceneLibraryList, sceneLibraryLoading, sceneLibraryPage, sceneLibraryPageSize,
  sceneLibraryTotal, sceneLibraryKeyword, sceneLibraryTab,
  dramaAllSceneList, dramaAllSceneLoading, dramaAllScenePage, dramaAllScenePageSize, dramaAllSceneTotal, dramaAllSceneKeyword,
  showEditSceneLibrary, editSceneLibraryForm,
  editSceneLibrarySaving, addingSceneToLibraryId, addingSceneToMaterialId, addingSceneFromLibraryId,
  onExtractScenes, openAddScene, stopScenePromptPoll, editScene, doGenerateScenePrompt, doGenerateSceneSinglePrompt,
  saveSceneRefImageIfAny, clearSceneRefImage, doExtractSceneFromImage, submitEditScene,
  onCloseSceneDialog, onDeleteScene, onGenerateSceneImage,
  loadSceneLibraryList, debouncedLoadSceneLibrary, loadDramaAllSceneList, debouncedLoadDramaAllSceneList,
  onSceneLibraryDialogOpen, onSceneLibraryTabChange, isSceneAddToEpisodeLoading,
  openEditSceneLibrary, submitEditSceneLibrary,
  onDeleteSceneLibrary, onAddSceneToLibrary, onAddSceneToMaterialLibrary,
  onAddSceneFromLibrary, onAddDramaSceneToEpisode,
} = useScenes({ store, dramaId, currentEpisodeId, getSelectedStyle, scriptLanguage, loadDrama, pollTask, pollUntilResourceHasImage, hasAssetImage, dramaAPI })

const sceneUseQuadGrid = ref(false)
const propUseQuadGrid = ref(false)  // 道具四视图（与场景四宫格同级选项）

// 分镜行内编辑状态（按 storyboard id 存储）

const sbCharacterIds = ref({})  // sbId -> number[] 多选角色
const sbPropIds = ref({})       // sbId -> number[] 多选物品
const sbSceneId = ref({})
const sbDialogue = ref({})
const sbNarration = ref({})
const sbShotType = ref({})
/** 视频提示词组成（可编辑），key 为分镜 id */
const sbTitle = ref({})
const sbLocation = ref({})
const sbTime = ref({})
const sbDuration = ref({})
const sbAction = ref({})
const sbResult = ref({})
const sbAtmosphere = ref({})
const sbAngle = ref({})
const sbAngleH = ref({})   // 结构化视角：水平方向
const sbAngleV = ref({})   // 结构化视角：俯仰角度
const sbAngleS = ref({})   // 结构化视角：景别
const sbMovement = ref({})
const sbLighting = ref({})   // 灯光风格
const sbDof = ref({})        // 景深
const sbLayoutDescription = ref({})  // 空间布局与人物站位描述（生成分镜时 AI 输出的最高优先级合同，用于首尾帧强制一致）
  // 正在 AI 重新生成布局描述的分镜 id 集合
/** 分镜创作模式：classic | universal（默认 classic，存库 storyboards.creation_mode） */
const sbCreationMode = ref({})
const sbGenerationSettings = ref({})
/** 全能模式片段描述（存库 universal_segment_text，与经典参考图字段独立） */
const sbUniversalSegmentText = ref({})
let restoredUniversalDraftNoticeShown = false

function universalPromptDraftIdentity(storyboardId) {
  return {
    userId: currentDraftUserId(), workspace: 'film-create-universal', dramaId: dramaId.value,
    episodeId: currentEpisodeId.value, shotId: storyboardId,
  }
}

const sbOmniAssetIds = ref({})
const sbAudioStrategy = ref({})
const sbKeepOriginalAudio = ref({})
const sbAudioVolume = ref({})
const sbAudioFadeSeconds = ref({})
const sbOmniCreationMode = ref({})
const sbOmniFirstFrameAssetId = ref({})
const sbOmniLastFrameAssetId = ref({})
const sbOmniAssetUsage = ref({})
// 分镜图片/视频列表（由 /images?storyboard_id=xx 和 /videos?storyboard_id=xx 拉取）
const sbImages = ref({})
const sbVideos = ref({})
const generatingSbImageIds = reactive(new Set())
const generatingSbVideoIds = reactive(new Set())
const generatingUniversalSegmentIds = reactive(new Set())
// 批量生成分镜图
const batchImageRunning = ref(false)
const batchImageStopping = ref(false)
const batchImageProgress = ref({ current: 0, total: 0, failed: 0 })
const batchImageErrors = ref([])
// 批量生成分镜视频
const batchVideoRunning = ref(false)
const batchVideoStopping = ref(false)
const batchVideoProgress = ref({ current: 0, total: 0, failed: 0 })
const batchVideoErrors = ref([])
// P0-1: 连贯帧模式
const videoFrameContiguity = ref(false)
/** 正在编辑图片提示词的分镜 id（行内编辑，保留供内部 onSaveSbImagePrompt 使用） */
const editingSbImagePromptId = ref(null)
const editingSbImagePromptText = ref('')
       // 原始 image_prompt
    // AI 优化后 polished_prompt
       // video_prompt
 // 'first' | 'last'
// 角色/道具/场景 上传图片
const resourceImageFileInput = ref(null)
const resourceUploadType = ref(null) // 'character' | 'prop' | 'scene'
const resourceUploadId = ref(null)
const uploadingResourceId = ref(null) // 'char-1' | 'prop-2' | 'scene-3'
const showPropAssetPicker = ref(false)
const resourceAssetPickerTarget = ref(null)
const resourceAssetPickerType = ref(null)
const propAssetPickerImages = computed(() => universalLibraryAssets.value.filter((asset) => asset.type === 'image' && asset.local_path))
const resourceBatchGenerating = ref(null)
const resourceBatchUploading = ref(null)
// 公共库弹窗状态已移至各 composable
const storyboardCount = ref(null) // 分镜数量
const videoDuration = ref(null) // 视频总长度
/** 分镜生成时是否要求 AI 输出 narration（解说旁白） */
const storyboardIncludeNarration = ref(false)
/** 分镜生成是否使用全能模式（universal_segment_text，对接 Seedance / 可灵 Omni） */
const storyboardUniversalOmni = ref(false)
const storyboardUseFirstLastFrame = ref(false)
/** 生成尾帧时是否注入首帧作站位/构图参考（默认开启） */
const lastFrameUseFirstLayoutLock = ref(true)
const gridMode = ref('single') // 序列图模式：single / quad_grid / nine_grid

// ── 剧本长度 → 估算总时长；自动分镜数与项目「每段秒数」(videoClipDuration) 对齐 ──

/** 用于估算的每段时长（秒），与一键成片处「X秒/段」一致 */
function clipSecondsForStoryboardEstimate() {
  const c = Number(videoClipDuration.value)
  return Math.max(2, Math.min(60, Number.isFinite(c) && c > 0 ? c : 5))
}

/** 由估算总时长与每段秒数得镜数中枢与宽松参考区间（±1 镜） */
function shotCountEstimateFromDurationSec(sec) {
  const s = Math.max(10, Math.min(600, Math.round(Number(sec) || 0)))
  const clip = clipSecondsForStoryboardEstimate()
  const ideal = s / clip
  const locked = Math.max(1, Math.min(200, Math.round(ideal)))
  const minR = Math.max(1, locked - 1)
  const maxR = Math.min(200, locked + 1)
  const range = minR >= maxR ? { min: locked, max: locked } : { min: minR, max: maxR }
  return { locked, range, clip }
}

/** 由剧本字符数粗估成片总时长（短剧偏长镜）：秒数 = round(10 + (字数/600)×60)，夹在 10–600s */
function estimateVideoDurationSecFromCharLen(charLen) {
  const len = Math.max(0, Math.floor(Number(charLen) || 0))
  if (len < 1) return null
  const raw = Math.round(10 + (len / 600) * 60)
  return Math.min(600, Math.max(10, raw))
}

function scriptTextTrimmedForEstimate() {
  return (scriptContent.value || '').toString().trim()
}

function userFilledStoryboardCount() {
  const v = storyboardCount.value
  return v != null && Number.isFinite(Number(v)) && Number(v) >= 1
}

function userFilledVideoDuration() {
  const v = videoDuration.value
  return v != null && Number.isFinite(Number(v)) && Number(v) >= 10
}

/** 请求后端的视频总时长：仅未手动填时传剧本估算 */
function getVideoDurationForApi() {
  if (userFilledVideoDuration()) return Math.round(Number(videoDuration.value))
  const len = scriptTextTrimmedForEstimate().length
  if (len < 1) return undefined
  return estimateVideoDurationSecFromCharLen(len) ?? undefined
}

/** 请求后端的分镜数量：仅未手动填时按「估算总时长 ÷ 每段秒数」推算，与项目 X秒/段 一致 */
function getStoryboardCountForApi() {
  if (userFilledStoryboardCount()) return Math.round(Number(storyboardCount.value))
  const sec = getVideoDurationForApi()
  if (sec == null || !Number.isFinite(sec)) return undefined
  return shotCountEstimateFromDurationSec(sec).locked
}

function getFirstImageFile(dataTransfer) {
  if (!dataTransfer?.files?.length) return null
  const file = Array.from(dataTransfer.files).find((f) => f.type.startsWith('image/'))
  return file || null
}

// ── 参考图文件读取工具 ──────────────────────────────────
function readFileAsRefImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve({ dataUrl: ev.target.result, filename: file.name })
    reader.readAsDataURL(file)
  })
}

/**
 * 校验参考图文件（类型 + 大小），不通过则弹提示并返回 null。
 * 在读取/上传前调用，避免选完图、填完表单点保存才报错。
 */
function validateRefImageFile(file) {
  if (!file) return null
  const result = checkImageFile(file)
  if (!result.ok) {
    ElMessage.warning(result.message)
    return null
  }
  return file
}

/**
 * 处理角色/道具/场景参考图文件选择（<input type="file"> change 事件）
 * type: 'character' | 'prop' | 'scene'
 */
async function onRefImageFileChange(type, event) {
  if (projectSession.enabled && !projectSession.canEdit) return
  const file = event.target?.files?.[0]
  if (!file) return
  if (!validateRefImageFile(file)) {
    event.target.value = ''
    return
  }
  const result = await readFileAsRefImage(file)
  if (type === 'character') addCharRefImage.value = result
  else if (type === 'prop') addPropRefImage.value = result
  else if (type === 'scene') addSceneRefImage.value = result
  event.target.value = ''
}

/**
 * 处理角色/道具/场景参考图拖放（drop 事件）
 * type: 'character' | 'prop' | 'scene'
 */
async function onRefImageDrop(type, event) {
  if (projectSession.enabled && !projectSession.canEdit) return
  const file = getFirstImageFile(event.dataTransfer)
  if (!file) return
  if (!validateRefImageFile(file)) return
  const result = await readFileAsRefImage(file)
  if (type === 'character') addCharRefImage.value = result
  else if (type === 'prop') addPropRefImage.value = result
  else if (type === 'scene') addSceneRefImage.value = result
}

/**
 * 处理"添加道具"简单弹窗的参考图文件选择
 * type: 'addProp'
 */
async function onRefImageFileChange2(type, event) {
  if (projectSession.enabled && !projectSession.canEdit) return
  const file = event.target?.files?.[0]
  if (!file) return
  if (!validateRefImageFile(file)) {
    event.target.value = ''
    return
  }
  const result = await readFileAsRefImage(file)
  if (type === 'addProp') addPropAddRefImage.value = result
  event.target.value = ''
}

/**
 * 处理"添加道具"简单弹窗的参考图拖放
 * type: 'addProp'
 */
async function onRefImageDrop2(type, event) {
  if (projectSession.enabled && !projectSession.canEdit) return
  const file = getFirstImageFile(event.dataTransfer)
  if (!file) return
  if (!validateRefImageFile(file)) return
  const result = await readFileAsRefImage(file)
  if (type === 'addProp') addPropAddRefImage.value = result
}

/**
 * 从本地选择（尚未保存到服务器）的参考图中提取特征描述
 * type: 'character' | 'prop' | 'scene'
 */
async function doExtractFromRef(type) {
  if (type === 'character') {
    const refImage = addCharRefImage.value
    if (!refImage) return
    extractingCharAppearance.value = true
    try {
      const name = editCharacterForm.value?.name || ''
      const res = await uploadAPI.extractDescriptionFromImage('character', refImage.dataUrl, name)
      if (res?.description && editCharacterForm.value) {
        editCharacterForm.value.appearance = res.description
        ElMessage.success('已从参考图提取外貌描述')
      }
    } catch (e) {
      ElMessage.error(e.message || '提取失败，请检查 AI 配置中是否有支持视觉的模型')
    } finally {
      extractingCharAppearance.value = false
    }
  } else if (type === 'prop') {
    const refImage = addPropRefImage.value
    if (!refImage) return
    extractingPropDesc.value = true
    try {
      const name = editPropForm.value?.name || ''
      const res = await uploadAPI.extractDescriptionFromImage('prop', refImage.dataUrl, name)
      if (res?.description && editPropForm.value) {
        editPropForm.value.description = res.description
        ElMessage.success('已从参考图提取特征描述')
      }
    } catch (e) {
      ElMessage.error(e.message || '提取失败，请检查 AI 配置中是否有支持视觉的模型')
    } finally {
      extractingPropDesc.value = false
    }
  } else if (type === 'scene') {
    const refImage = addSceneRefImage.value
    if (!refImage) return
    extractingSceneDesc.value = true
    try {
      const name = editSceneForm.value?.name || ''
      const res = await uploadAPI.extractDescriptionFromImage('scene', refImage.dataUrl, name)
      if (res?.description && editSceneForm.value) {
        editSceneForm.value.description = res.description
        ElMessage.success('已从参考图提取场景描述')
      }
    } catch (e) {
      ElMessage.error(e.message || '提取失败，请检查 AI 配置中是否有支持视觉的模型')
    } finally {
      extractingSceneDesc.value = false
    }
  }
}

const baseUrl = ref('')
const previewImageUrl = ref(null)
function imageUrl(url) {
  if (!url) return ''
  if (url.startsWith('http')) return url
  const base = (baseUrl.value || '').replace(/\/$/, '')
  return base ? base + '/' + url.replace(/^\//, '') : url
}
/** 优先使用本地地址，避免远程图失效。item 为 { image_url, local_path } 或字符串 url */
function assetImageUrl(item) {
  if (!item) return ''
  if (typeof item === 'string') return imageUrl(item)
  const localPath = item.local_path && String(item.local_path).trim()
  if (localPath) {
    const p = localPath.replace(/^\//, '')
    return '/static/' + p
  }
  if (item.image_url) return imageUrl(item.image_url)
  const refImage = item.ref_image && String(item.ref_image).trim()
  if (refImage) {
    if (/^(https?:|data:|\/static\/)/i.test(refImage)) return refImage
    return '/static/' + refImage.replace(/^\//, '')
  }
  return ''
}
function hasAssetImage(item) {
  if (!item) return false
  return !!(item.image_url || item.local_path || item.ref_image)
}
function getSelectedStyle() {
  return getSelectedStylePrompt()
}
function openImagePreview(url) {
  previewImageUrl.value = url
}
function closeImagePreview() {
  previewImageUrl.value = null
}
/** 远程视频须为 http(s)，避免上游 FAILURE 时把错误文案写入 video_url */
function isHttpVideoUrl(url) {
  if (!url || typeof url !== 'string') return false
  const t = url.trim()
  return t.startsWith('http://') || t.startsWith('https://')
}
/** 列表项是否具备可播放地址（避免仅有空白 local_path 时外层有卡片、内层无 <video>） */
function recordHasPlayableVideoUrl(i) {
  if (!i) return false
  const lp = i.local_path && String(i.local_path).trim()
  if (lp) return true
  return isHttpVideoUrl(i.video_url)
}
function frameTypeForSlot(slot) {
  return slot === 'last' ? 'storyboard_last' : 'storyboard_first'
}

function resolveSbImageById(storyboardId, imageId) {
  if (imageId == null) return null
  const images = getSbAllImages(storyboardId)
  return images.find((i) => i.id === imageId) || null
}

/** 首帧图（首尾帧模式下严格优先服务器绑定的 first_frame_image_id） */
function getSbFirstImage(storyboardId) {
  const images = getSbAllImages(storyboardId)
  const sb = (store.storyboards || []).find((b) => b.id === storyboardId)

  // 最高权威：服务器已绑定的首帧
  if (sb?.first_frame_image_id != null) {
    const bound = resolveSbImageById(storyboardId, sb.first_frame_image_id)
    if (bound) return bound
  }

  const sel = sbSelectedImgId.value[storyboardId]
  if (sel != null) {
    const found = images.find((i) => i.id === sel)
    if (found) return found
  }

  const typed = images.find((i) => i.frame_type === 'storyboard_first')
  if (typed) return typed
  // 不再回退到 images[0]，避免把尾帧图片误显示为首帧
  return null
}

/** 尾帧图（首尾帧模式下严格优先服务器绑定的 last_frame_image_id） */
function getSbLastImage(storyboardId) {
  const images = getSbAllImages(storyboardId)
  const sb = (store.storyboards || []).find((b) => b.id === storyboardId)

  // 最高权威：服务器已绑定的尾帧（后端 bindStoryboardFrameImage 正确写入的 last_frame_image_id）
  if (sb?.last_frame_image_id != null) {
    const bound = resolveSbImageById(storyboardId, sb.last_frame_image_id)
    if (bound) return bound
  }

  // 仅在没有服务器绑定时才考虑手动选择（首尾帧生成后我们会主动清除手动选择）
  const sel = sbSelectedLastImgId.value[storyboardId]
  if (sel != null) {
    const found = images.find((i) => i.id === sel)
    if (found) return found
  }

  const typed = images.find((i) => i.frame_type === 'storyboard_last')
  if (typed) return typed

  if (sb?.last_frame_image_url || sb?.last_frame_local_path) {
    return {
      id: sb.last_frame_image_id,
      image_url: sb.last_frame_image_url,
      local_path: sb.last_frame_local_path,
      frame_type: 'storyboard_last',
    }
  }
  return null
}

/** 该分镜是否有图（接口拉取的或 composed_image） */
function hasSbImage(sb) {
  if (storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)) {
    return !!(getSbFirstImage(sb.id) || (sb && (sb.composed_image || sb.image_url)))
  }
  return !!(getSbImage(sb.id) || (sb && (sb.composed_image || sb.image_url)))
}

/** 取该分镜下所有已完成的非四宫格图片列表 */
function getSbAllImages(storyboardId) {
  const list = sbImages.value[storyboardId]
  if (!Array.isArray(list)) return []
  return list.filter((i) => i.status === 'completed' && i.frame_type !== 'quad_grid' && i.frame_type !== 'nine_grid' && (i.image_url || i.local_path))
}
/** 取当前主图（首尾帧模式下等同首帧） */
function getSbImage(storyboardId) {
  if (storyboardUseFirstLastFrame.value) return getSbFirstImage(storyboardId)
  const images = getSbAllImages(storyboardId)
  if (!images.length) return null
  const selectedId = sbSelectedImgId.value[storyboardId]
  if (selectedId != null) {
    const found = images.find((i) => i.id === selectedId)
    if (found) return found
  }
  return images[0]
}
/** 取该分镜所有已完成的视频记录 */
function getSbAllVideos(storyboardId) {
  const list = sbVideos.value[storyboardId]
  if (!Array.isArray(list)) return []
  return list.filter((i) => i.status === 'completed' && recordHasPlayableVideoUrl(i))
}
async function loadStoryboardMedia() {
  const boards = store.storyboards || []
  if (boards.length === 0) {
    sbImages.value = {}
    sbVideos.value = {}
    return
  }
  const nextImages = { ...sbImages.value }
  const nextVideos = { ...sbVideos.value }
  await Promise.all(
    boards.map(async (sb) => {
      try {
        const [imgRes, vidRes] = await Promise.all([
          imagesAPI.list({ storyboard_id: sb.id, page: 1, page_size: 100 }),
          videosAPI.list({ storyboard_id: sb.id, page: 1, page_size: 50 })
        ])
        nextImages[sb.id] = (imgRes && imgRes.items) ? imgRes.items : []
        nextVideos[sb.id] = (vidRes && vidRes.items) ? vidRes.items : []
      } catch (_) {
        nextImages[sb.id] = []
        nextVideos[sb.id] = []
      }
    })
  )
  sbImages.value = nextImages
  sbVideos.value = nextVideos
  // 从后端恢复主图选择
  restoreSelectionsFromBackend()
}

function getGeneratingSetsBag() {
  return {
    generatingCharIds,
    generatingPropIds,
    generatingSceneIds,
    generatingSbImageIds,
    generatingSbFirstImageIds,
    generatingSbLastImageIds,
    generatingSbVideoIds,
  }
}

function buildSbGenMeta(sb, resourceType, labelPrefix) {
  const num = sb?.storyboard_number ?? sb?.id
  const epNum = store.currentEpisode?.episode_number
  const dramaTitle = store.drama?.title || ''
  const epLabel = dramaTitle ? `${dramaTitle} · 第${epNum ?? ''}集` : `第${epNum ?? ''}集`
  return {
    dramaId: dramaId.value,
    episodeId: currentEpisodeId.value,
    dramaTitle,
    episodeNumber: epNum,
    resourceType,
    resourceId: sb.id,
    label: `${epLabel} ${labelPrefix} #${num}`,
  }
}

async function recoverAndSyncEpisodeTasks(epId) {
  const did = dramaId.value
  const eid = epId ?? currentEpisodeId.value
  if (!did || !eid) return
  const ctx = buildEpisodeContext(store, did, eid)
  await genStore.recoverPendingForEpisode({
    ...ctx,
    ElMessage,
    callbacks: {
      onStoryboardMedia: (sbId) => loadSingleStoryboardMedia(sbId),
      onDramaRefresh: () => loadDrama(),
      onEpisodeMergeComplete: () => {
        store.setVideoStatus('done', did, eid)
        store.setVideoProgress(100, did, eid)
      },
      onEpisodeMergeFailed: (err) => {
        store.setVideoStatus('error', did, eid)
        videoErrorMsg.value = err || '视频生成失败'
      },
    },
  })
  syncGeneratingSetsFromStore(genStore, did, eid, getGeneratingSetsBag())
  const mergeRunning = genStore.getRunningForEpisode(did, eid).some(
    (t) => t.resourceType === GEN_RESOURCE.EPISODE_MERGE
  )
  if (mergeRunning) {
    store.setVideoStatus('generating', did, eid)
  }
}

/** 只刷新单条分镜的图片/视频，避免每次单图操作都全量请求所有分镜 */
async function loadSingleStoryboardMedia(sbId) {
  if (!sbId) return
  try {
    const [imgRes, vidRes] = await Promise.all([
      imagesAPI.list({ storyboard_id: sbId, page: 1, page_size: 100 }),
      videosAPI.list({ storyboard_id: sbId, page: 1, page_size: 50 })
    ])
    sbImages.value = {
      ...sbImages.value,
      [sbId]: (imgRes && imgRes.items) ? imgRes.items : []
    }
    sbVideos.value = {
      ...sbVideos.value,
      [sbId]: (vidRes && vidRes.items) ? vidRes.items : []
    }
    restoreSelectionsFromBackend()
  } catch (_) {
    // 静默忽略，不影响其他分镜的显示
  }
}

// ── 主图选择 ─────────────────────────────────────────────────────────

const sbSelectedImgId = ref({})   // sbId → 选中的首帧/主图 image_generation.id
const sbSelectedLastImgId = ref({}) // sbId → 选中的尾帧 image_generation.id
const sbSelectedVideoId = ref({}) // sbId → 选中的 video_generation.id
const generatingSbFirstImageIds = reactive(new Set())
const generatingSbLastImageIds = reactive(new Set())
/**
 * 从后端 storyboard.image_url / local_path 恢复主图选择状态。
 * 与 image_generation 记录比对，找到匹配的记录并恢复 sbSelectedImgId。
 */
function restoreSelectionsFromBackend() {
  const boards = store.storyboards || []
  for (const sb of boards) {
    const images = getSbAllImages(sb.id)
    if (sbSelectedImgId.value[sb.id] == null) {
      if (sb.first_frame_image_id != null) {
        sbSelectedImgId.value = { ...sbSelectedImgId.value, [sb.id]: sb.first_frame_image_id }
      } else {
        const sbPath = (sb.local_path || '').trim()
        const sbUrl = (sb.image_url || '').trim()
        if (sbPath || sbUrl) {
          const matched = images.find(
            (img) =>
              (sbPath && img.local_path && img.local_path === sbPath) ||
              (sbUrl && img.image_url && img.image_url === sbUrl)
          )
          if (matched) {
            sbSelectedImgId.value = { ...sbSelectedImgId.value, [sb.id]: matched.id }
          }
        }
      }
    }
    if (sbSelectedLastImgId.value[sb.id] == null && sb.last_frame_image_id != null) {
      sbSelectedLastImgId.value = { ...sbSelectedLastImgId.value, [sb.id]: sb.last_frame_image_id }
    }
    if (sbSelectedVideoId.value[sb.id] == null && sb.active_video_generation_id != null) {
      const videos = getSbAllVideos(sb.id)
      if (videos.some((video) => Number(video.id) === Number(sb.active_video_generation_id))) {
        sbSelectedVideoId.value = { ...sbSelectedVideoId.value, [sb.id]: Number(sb.active_video_generation_id) }
      }
    }
  }
}

/** 首帧图生提示词（与 onGenerateSbFrameImage 首帧分支一致） */
function buildFirstFrameImagePrompt(sbId) {
  const sbRow = (store.storyboards || []).find((b) => b.id === sbId)
  return (sbRow?.polished_prompt || sbRow?.image_prompt || sbRow?.description || '').toString().trim()
}

function buildLastFrameImagePrompt(sbId) {
  const parts = []
  const loc = (sbLocation.value[sbId] || '').toString().trim()
  const time = (sbTime.value[sbId] || '').toString().trim()
  if (loc) parts.push(time ? loc + '，' + time : loc)
  const shotType = (sbShotType.value[sbId] || '').toString().trim()
  if (shotType) parts.push(shotType)
  const angleH = sbAngleH.value[sbId] || ''
  const angleV = sbAngleV.value[sbId] || ''
  const angleS = sbAngleS.value[sbId] || ''
  if (angleH && angleV && angleS) {
    const { label } = angleToPromptFragment(angleH, angleV, angleS)
    parts.push(label)
  }
  const result = (sbResult.value[sbId] || '').toString().trim()
  const action = (sbAction.value[sbId] || '').toString().trim()
  if (result) parts.push(result)
  else if (action) parts.push(action)
  const atmosphere = (sbAtmosphere.value[sbId] || '').toString().trim()
  if (atmosphere) parts.push(atmosphere)
  const style = getSelectedStylePromptZh() || getSelectedStylePrompt() || ''
  if (style) parts.push(style)
  parts.push('尾帧静止画面，展示动作完成后的最终状态与情绪余韵')
  return parts.join('，')
}

/** 从 frame_prompts 表读取已生成的专业帧提示词 */
async function getCachedFramePromptFromDb(sbId, slot) {
  const frameType = slot === 'last' ? 'last' : 'first'
  try {
    const res = await storyboardsAPI.getFramePrompts(sbId)
    const row = (res?.frame_prompts || []).find((r) => r.frame_type === frameType)
    return row?.prompt?.trim() || ''
  } catch (_) {
    return ''
  }
}

/**
 * 首尾帧模式：优先走 framePromptService（专用系统提示词 + 文本 AI），失败则回退字段拼接。
 */
async function ensureProfessionalFramePrompt(sb, slot, { forceRegenerate = false } = {}) {
  const frameType = slot === 'last' ? 'last' : 'first'
  if (!forceRegenerate) {
    const cached = await getCachedFramePromptFromDb(sb.id, slot)
    if (cached) return cached
  }
  try {
    const genRes = await storyboardsAPI.generateFramePrompt(sb.id, {
      frame_type: frameType,
      model: getSbTextModel(sb),
    })
    if (!genRes?.task_id) throw new Error('帧提示词任务未创建')
    const pollRes = await pollTask(genRes.task_id)
    if (pollRes?.status !== 'completed') {
      throw new Error(pollRes?.error || '帧提示词生成失败')
    }
    const fromTask = pollRes.result?.response?.single_frame?.prompt
    if (fromTask && String(fromTask).trim()) return String(fromTask).trim()
    const cached2 = await getCachedFramePromptFromDb(sb.id, slot)
    if (cached2) return cached2
  } catch (e) {
    console.warn('[首尾帧] 专业帧提示词生成失败，使用拼接回退', e?.message)
  }
  return slot === 'last' ? buildLastFrameImagePrompt(sb.id) : buildFirstFrameImagePrompt(sb.id)
}

// 兼容旧调用

async function onGenerateSbFrameImage(sb, slot) {
  if (!dramaId.value || !sb?.id) return
  const isLast = slot === 'last'
  const loadingSet = isLast ? generatingSbLastImageIds : generatingSbFirstImageIds
  const meta = buildSbGenMeta(
    sb,
    isLast ? GEN_RESOURCE.SB_LAST_IMAGE : GEN_RESOURCE.SB_FIRST_IMAGE,
    isLast ? '尾帧' : '首帧'
  )
  if (loadingSet.has(sb.id) || genStore.isRunning(meta)) return
  sb.errorMsg = ''
  sb.error_msg = ''
  loadingSet.add(sb.id)
  genStore.markRunning(meta)
  try {
    let idsToSave = sbCharacterIds.value[sb.id]
    if (idsToSave === undefined) {
      const sbRowForChars = (store.storyboards || []).find((b) => b.id === sb.id)
      const charList = Array.isArray(sbRowForChars?.characters) ? sbRowForChars.characters : []
      idsToSave = charList
        .map((c) => Number(typeof c === 'object' && c != null ? c.id : c))
        .filter((n) => Number.isFinite(n))
    }
    const sbRow = (store.storyboards || []).find((b) => b.id === sb.id)
    let prompt = ''
    if (storyboardUseFirstLastFrame.value) {
      // 须在 update(character_ids) 之前读取缓存：后端在角色未变时保留 frame_prompts，但先读可避免旧版误删
      prompt = await ensureProfessionalFramePrompt(sb, isLast ? 'last' : 'first')
    } else if (isLast) {
      prompt = buildLastFrameImagePrompt(sb.id) || sbRow?.image_prompt || sbRow?.description || ''
    } else {
      prompt = sbRow?.polished_prompt || sbRow?.image_prompt || sbRow?.description || ''
    }
    try {
      await storyboardsAPI.update(sb.id, { character_ids: Array.isArray(idsToSave) ? idsToSave : [] })
    } catch (e) {
      ElMessage.warning('保存分镜角色失败')
      return
    }
    // 尾帧可选附带首帧作构图/站位参考（「首帧站位」勾选时；后端亦会按 use_first_frame_layout_lock 兜底）
    let refImagesForCreate = undefined
    const useFirstLayoutLock = isLast && lastFrameUseFirstLayoutLock.value
    if (useFirstLayoutLock) {
      const firstImg = getSbFirstImage(sb.id)
      if (firstImg) {
        const firstUrl = assetImageUrl(firstImg) || firstImg.image_url || firstImg.local_path
        if (firstUrl) {
          refImagesForCreate = [firstUrl]
        }
      }
    }
    const res = await imagesAPI.create({
      storyboard_id: sb.id,
      drama_id: dramaId.value,
      prompt,
      model: undefined,
      style: getSelectedStyle(),
      frame_type: frameTypeForSlot(slot),
      aspect_ratio: projectAspectRatio.value || '16:9',
      reference_images: refImagesForCreate,
      use_first_frame_layout_lock: isLast ? !!lastFrameUseFirstLayoutLock.value : undefined,
    })
    ElMessage.success(isLast ? '尾帧生成任务已提交' : '首帧生成任务已提交')
    if (res?.task_id) {
      const pollRes = await pollTask(res.task_id, () => loadSingleStoryboardMedia(sb.id), meta)
      if (pollRes?.status === 'failed') {
        sb.errorMsg = pollRes.error || '生成失败'
      } else {
        await loadDrama()
        restoreSelectionsFromBackend()

        // 关键修复：专用首/尾帧生成成功后，立即清除手动选择残留
        // 让 getSbLastImage / getSbFirstImage 严格走服务器已更新的 sb.last_frame_image_id（避免新图跑到历史列表）
        if (storyboardUseFirstLastFrame.value) {
          if (isLast) {
            delete sbSelectedLastImgId.value[sb.id]
          } else {
            delete sbSelectedImgId.value[sb.id]
          }
        }
      }
    } else {
      await loadSingleStoryboardMedia(sb.id)
      restoreSelectionsFromBackend()

      if (storyboardUseFirstLastFrame.value) {
        if (isLast) {
          delete sbSelectedLastImgId.value[sb.id]
        } else {
          delete sbSelectedImgId.value[sb.id]
        }
      }
    }
  } catch (e) {
    sb.errorMsg = e.message || '生成失败'
    ElMessage.error(e.message || '生成失败')
  } finally {
    loadingSet.delete(sb.id)
    genStore.markDone(meta)
  }
}

function syncStoryboardStateFromEpisode(ep) {
  const boards = validRows(ep?.storyboards)
  const nextCharIds = {}
  const nextPropIds = {}
  const nextScene = {}
  const nextDialogue = {}
  const nextNarration = {}
  const nextShot = {}
  const nextTitle = {}
  const nextLocation = {}
  const nextTime = {}
  const nextDuration = {}
  const nextAction = {}
  const nextResult = {}
  const nextAtmosphere = {}
  const nextAngle = {}
  const nextAngleH = {}
  const nextAngleV = {}
  const nextAngleS = {}
  const nextMovement = {}
  const nextLighting = {}
  const nextDof = {}
  const nextLayoutDescription = {}
  const nextCreationMode = {}
  const nextGenerationSettings = {}
  const nextUniversalSegment = {}
  const nextOmniAssetIds = {}
  const nextAudioStrategy = {}
  const nextKeepOriginalAudio = {}
  const nextAudioVolume = {}
  const nextAudioFadeSeconds = {}
  const nextOmniCreationMode = {}
  const nextOmniFirstFrameAssetId = {}
  const nextOmniLastFrameAssetId = {}
  const nextOmniAssetUsage = {}
  for (const sb of boards) {
    nextScene[sb.id] = sb.scene_id ?? null
    nextDialogue[sb.id] = sb.dialogue ?? ''
    nextNarration[sb.id] = sb.narration ?? ''
    nextShot[sb.id] = (sb.shot_type ?? '').toString() || ''
    nextTitle[sb.id] = (sb.title ?? '').toString()
    nextLocation[sb.id] = (sb.location ?? '').toString()
    nextTime[sb.id] = (sb.time ?? '').toString()
    nextDuration[sb.id] = sb.duration != null ? Number(sb.duration) : 5
    nextAction[sb.id] = (sb.action ?? '').toString()
    nextResult[sb.id] = (sb.result ?? '').toString()
    nextAtmosphere[sb.id] = (sb.atmosphere ?? '').toString()
    nextAngle[sb.id] = (sb.angle ?? '').toString()
    nextAngleH[sb.id] = sb.angle_h || ''
    nextAngleV[sb.id] = sb.angle_v || ''
    nextAngleS[sb.id] = sb.angle_s || ''
    nextMovement[sb.id] = (sb.movement ?? '').toString()
    nextLighting[sb.id] = sb.lighting_style || ''
    nextDof[sb.id] = sb.depth_of_field || ''
    nextLayoutDescription[sb.id] = (sb.layout_description ?? '').toString()
    const charList = Array.isArray(sb.characters) ? sb.characters : (sb.characters != null ? [sb.characters] : [])
    nextCharIds[sb.id] = charList.map((c) => (typeof c === 'object' && c != null ? Number(c.id) : Number(c))).filter((n) => Number.isFinite(n))
    nextPropIds[sb.id] = Array.isArray(sb.prop_ids) ? sb.prop_ids : []
    nextCreationMode[sb.id] = sb.creation_mode === 'universal' ? 'universal' : 'classic'
    nextGenerationSettings[sb.id] = {
      text_model: sb.text_model || 'auto',
      video_model: sb.video_model || projectVideoModel.value || 'auto',
      duration: sb.duration != null ? Number(sb.duration) : (Number(videoClipDuration.value) || 15),
      resolution: sb.video_resolution || videoResolution.value || '720p',
      aspect_ratio: sb.video_aspect_ratio || projectAspectRatio.value || '16:9',
      upscale_resolution: sb.video_upscale_resolution || null,
      target_fps: sb.video_target_fps || null,
    }
    const serverUniversalPrompt = (sb.universal_segment_text ?? '').toString()
    const localUniversalDraft = readPromptDraft(localStorage, universalPromptDraftIdentity(sb.id))
    if (localUniversalDraft && shouldRestorePromptDraft(localUniversalDraft, sb.updated_at)) {
      nextUniversalSegment[sb.id] = localUniversalDraft.payload?.prompt == null ? '' : String(localUniversalDraft.payload.prompt)
      if (!restoredUniversalDraftNoticeShown) {
        restoredUniversalDraftNoticeShown = true
        queueMicrotask(() => ElMessage.info('已恢复刷新前尚未保存的分镜提示词草稿'))
      }
    } else {
      nextUniversalSegment[sb.id] = serverUniversalPrompt
      if (localUniversalDraft) clearPromptDraft(localStorage, universalPromptDraftIdentity(sb.id))
    }
    nextOmniAssetIds[sb.id] = Array.isArray(sb.omni_asset_ids) ? sb.omni_asset_ids.map(Number).filter((id) => Number.isFinite(id)) : []
    nextAudioStrategy[sb.id] = sb.audio_strategy || 'reference_only'
    nextKeepOriginalAudio[sb.id] = !!sb.keep_original_audio
    nextAudioVolume[sb.id] = Number(sb.audio_volume ?? 1)
    nextAudioFadeSeconds[sb.id] = Number(sb.audio_fade_seconds ?? 0)
    nextOmniCreationMode[sb.id] = sb.omni_creation_mode === 'first_last_frame' ? 'first_last_frame' : 'multi_reference'
    nextOmniFirstFrameAssetId[sb.id] = sb.omni_first_frame_asset_id != null ? Number(sb.omni_first_frame_asset_id) : null
    nextOmniLastFrameAssetId[sb.id] = sb.omni_last_frame_asset_id != null ? Number(sb.omni_last_frame_asset_id) : null
    nextOmniAssetUsage[sb.id] = sb.omni_asset_usage && typeof sb.omni_asset_usage === 'object' ? { ...sb.omni_asset_usage } : {}
  }
  sbCharacterIds.value = nextCharIds
  sbPropIds.value = nextPropIds
  sbSceneId.value = nextScene
  sbDialogue.value = nextDialogue
  sbNarration.value = nextNarration
  sbShotType.value = nextShot
  sbTitle.value = nextTitle
  sbLocation.value = nextLocation
  sbTime.value = nextTime
  sbDuration.value = nextDuration
  sbAction.value = nextAction
  sbResult.value = nextResult
  sbAtmosphere.value = nextAtmosphere
  sbAngle.value = nextAngle
  sbAngleH.value = nextAngleH
  sbAngleV.value = nextAngleV
  sbAngleS.value = nextAngleS
  sbMovement.value = nextMovement
  sbLighting.value = nextLighting
  sbDof.value = nextDof
  sbLayoutDescription.value = nextLayoutDescription
  sbCreationMode.value = nextCreationMode
  sbGenerationSettings.value = nextGenerationSettings
  sbUniversalSegmentText.value = nextUniversalSegment
  sbOmniAssetIds.value = nextOmniAssetIds
  sbAudioStrategy.value = nextAudioStrategy
  sbKeepOriginalAudio.value = nextKeepOriginalAudio
  sbAudioVolume.value = nextAudioVolume
  sbAudioFadeSeconds.value = nextAudioFadeSeconds
  sbOmniCreationMode.value = nextOmniCreationMode
  sbOmniFirstFrameAssetId.value = nextOmniFirstFrameAssetId
  sbOmniLastFrameAssetId.value = nextOmniLastFrameAssetId
  sbOmniAssetUsage.value = nextOmniAssetUsage
}

function onEpisodeSelect(epId) {
  if (epId == null) {
    store.setCurrentEpisode(null)
    store.setScriptContent('')
    scriptTitle.value = ''
    syncStoryboardStateFromEpisode(null)
    return
  }
  const list = store.drama?.episodes || []
  const ep = list.find((e) => Number(e.id) === Number(epId))
  if (!ep) return
  store.setCurrentEpisode(ep)
  store.setScriptContent(ep.script_content || '')
  scriptTitle.value = ep.title || '第' + (ep.episode_number || 0) + '集'
  syncStoryboardStateFromEpisode(ep)
  loadStoryboardMedia()
  recoverAndSyncEpisodeTasks(epId)
}

async function loadDrama() {
  if (!store.dramaId) return
  try {
    let d = await dramaAPI.get(store.dramaId)
    if (!d.permissions?.collaboration_enabled) d = await backfillDramaStylePromptMetadataIfNeeded(dramaAPI, store.dramaId, d)
    store.setDrama(d)
    // 恢复「故事生成」框的梗概（项目 description 存的是故事梗概）
    storyInput.value = (d.description || '').toString().trim()
    storyStyle.value = (d.metadata && d.metadata.story_style) ? d.metadata.story_style : ''
    storyType.value = d.genre || ''
    generationStyle.value = d.style || ''
    projectAspectRatio.value = (d.metadata && d.metadata.aspect_ratio) ? d.metadata.aspect_ratio : '16:9'
    videoClipDuration.value = (d.metadata && d.metadata.video_clip_duration) ? Number(d.metadata.video_clip_duration) : 15
    projectVideoModel.value = (d.metadata && d.metadata.video_model) ? d.metadata.video_model : 'auto'
    if (d.metadata && d.metadata.video_resolution) videoResolution.value = d.metadata.video_resolution
    storyboardIncludeNarration.value = !!(d.metadata && d.metadata.storyboard_include_narration)
    storyboardUniversalOmni.value = !!(d.metadata && d.metadata.storyboard_universal_omni)
    storyboardUseFirstLastFrame.value = !!(d.metadata && d.metadata.storyboard_use_first_last_frame)
    lastFrameUseFirstLayoutLock.value = d.metadata?.last_frame_use_first_layout_lock !== false
    if (storyboardUseFirstLastFrame.value && gridMode.value !== 'single') {
      gridMode.value = 'single'
    }
    const list = d.episodes || []
    // 优先保持当前选中的集（按 id 在最新列表中查找），避免 AI 生成角色等操作后误切到其他集
    const currentId = selectedEpisodeId.value
    // 兼容分享链接中的 episode=集数（例如 episode=4）和旧链接中的 episode_id。
    // 之前只按数据库 id 匹配，集数 4 的真实 id 不等于 4 时会静默回退到第 1 集，
    // 造成用户误以为第 4 集的分镜视频没有渲染。
    let ep = currentId != null
      ? (list.find((e) => Number(e.id) === Number(currentId))
        || list.find((e) => Number(e.episode_number) === Number(currentId)))
      : null
    if (!ep) {
      const wantNum = savedCurrentEpisodeNumber.value
      ep = list.find((e) => Number(e.episode_number) === Number(wantNum)) || list[0] || null
    }
    store.setCurrentEpisode(ep)
    if (ep) {
      store.setScriptContent(ep.script_content || '')
      scriptTitle.value = ep.title || '第' + (ep.episode_number || 0) + '集'
      selectedEpisodeId.value = ep.id
    } else {
      store.setScriptContent('')
      scriptTitle.value = ''
      selectedEpisodeId.value = null
    }
    syncStoryboardStateFromEpisode(ep)
    await loadStoryboardMedia()
    await loadUniversalLibraryAssets()
    await recoverAndSyncEpisodeTasks(ep?.id)
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  }
}

/** 将当前剧本内容保存到后端（创建/更新项目与集数），供「保存剧本」与「AI 生成」后自动保存共用 */
async function saveScriptToBackend(content) {
  const trimmed = (content ?? '').toString().trim()
  if (!trimmed) return
  const parsed = parseScriptIntoEpisodes(trimmed)
  const multiFromMarkers = parsed.split && parsed.episodes.length >= 2
  const toPayload = (list) =>
    list.map((e, i) => ({
      episode_number: i + 1,
      title: (e.title && String(e.title).trim()) || '第' + (i + 1) + '集',
      script_content: e.script_content ?? '',
      description: null,
      duration: 0,
    }))

  let dramaId = store.dramaId
  const curEp = store.currentEpisode
  if (!dramaId) {
    const drama = await dramaAPI.create({
      title: scriptTitle.value || '新故事',
      description: storyInput.value?.trim() || trimmed.slice(0, 200),
      genre: storyType.value || undefined,
      style: generationStyle.value || undefined,
      metadata: {
        ...projectStylePromptMetadata(),
        story_style: storyStyle.value || undefined,
        aspect_ratio: projectAspectRatio.value || '16:9',
      },
    })
    store.setDrama(drama)
    dramaId = drama.id
    savedCurrentEpisodeNumber.value = 1
    const first = parsed.episodes[0] || { title: '', script_content: trimmed }
    const episodes = multiFromMarkers
      ? toPayload(parsed.episodes)
      : [
          {
            episode_number: 1,
            title: scriptTitle.value || first.title || '第1集',
            script_content: first.script_content || trimmed,
          },
        ]
    await dramaAPI.saveEpisodes(dramaId, episodes)
    await loadDrama()
    if (route.params.id === 'new') {
      router.replace('/film/' + dramaId)
    }
    if (multiFromMarkers) {
      ElMessage.success(`已按「第N集/章/节」拆分为 ${episodes.length} 集`)
    }
    return { created: true }
  }
  if (multiFromMarkers) {
    savedCurrentEpisodeNumber.value = 1
    const payload = toPayload(parsed.episodes)
    await dramaAPI.saveEpisodes(dramaId, payload)
    if (storyInput.value?.trim()) {
      await dramaAPI.saveOutline(dramaId, {
        summary: storyInput.value.trim(),
        genre: storyType.value || undefined,
        style: generationStyle.value || undefined,
        metadata: {
          ...projectStylePromptMetadata(),
          story_style: storyStyle.value || undefined,
          aspect_ratio: projectAspectRatio.value || '16:9',
        },
      }).catch(() => {})
    }
    await loadDrama()
    ElMessage.success(`已按「第N集/章/节」拆分为 ${payload.length} 集`)
    return { created: false, splitEpisodes: true }
  }
  const episodes = store.drama?.episodes || []
  savedCurrentEpisodeNumber.value = curEp?.episode_number ?? 1
  const updated = episodes.map((ep, i) => {
    const num = ep.episode_number ?? i + 1
    const isCurrent = curEp && Number(ep.id) === Number(curEp.id)
    const first = parsed.episodes[0]
    const singleBody = first?.script_content ?? trimmed
    const singleTitle = first?.title && String(first.title).trim()
    return {
      episode_number: num,
      title: isCurrent
        ? scriptTitle.value || singleTitle || '第' + num + '集'
        : ep.title || '',
      script_content: isCurrent ? (parsed.episodes.length === 1 && singleTitle ? singleBody : trimmed) : (ep.script_content || ''),
      description: ep.description,
      duration: ep.duration,
    }
  })
  if (updated.length === 0) {
    updated.push({ episode_number: 1, title: scriptTitle.value || '第1集', script_content: trimmed })
  }
  await dramaAPI.saveEpisodes(dramaId, updated)
  if (storyInput.value?.trim()) {
    await dramaAPI.saveOutline(dramaId, {
      summary: storyInput.value.trim(),
      genre: storyType.value || undefined,
      style: generationStyle.value || undefined,
      metadata: {
        ...projectStylePromptMetadata(),
        story_style: storyStyle.value || undefined,
        aspect_ratio: projectAspectRatio.value || '16:9',
      },
    }).catch(() => {})
  }
  await loadDrama()
  return { created: false }
}

/**
 * @param {boolean} includeGenerationStyle - 仅在选择「画面风格」为 true：写入 dramas.style 与 style_prompt_*。
 * 其它项目设置改为 false，避免界面未刷新时仍用旧的 generationStyle 覆盖外部已更新的画风（如直接调 API PUT outline）。
 */
async function saveProjectSettings(includeGenerationStyle = false) {
  if (!store.dramaId || (projectSession.enabled && !projectSession.canEdit)) return
  const metadata = {
    story_style: storyStyle.value || undefined,
    aspect_ratio: projectAspectRatio.value || '16:9',
    video_clip_duration: videoClipDuration.value || 15,
    video_model: projectVideoModel.value || 'auto',
    video_resolution: videoResolution.value || '720p',
    storyboard_include_narration: !!storyboardIncludeNarration.value,
    storyboard_universal_omni: !!storyboardUniversalOmni.value,
    storyboard_use_first_last_frame: !!storyboardUseFirstLastFrame.value,
    last_frame_use_first_layout_lock: !!lastFrameUseFirstLayoutLock.value,
  }
  if (includeGenerationStyle) {
    Object.assign(metadata, projectStylePromptMetadata())
  }
  const payload = {
    genre: storyType.value || undefined,
    metadata,
  }
  if (includeGenerationStyle) {
    payload.style = generationStyle.value || undefined
  }
  dramaAPI.saveOutline(store.dramaId, payload).catch(e => console.error('Settings auto-save failed', e))
}

async function onGenerateStory() {

  await runGenerateStoryFromPremise({
    premise: storyInput.value,
    storyStyle: storyStyle.value,
    storyType: storyType.value,
    storyEpisodeCount: storyEpisodeCount.value,
    scriptTitle: scriptTitle.value,
    generationStyle: generationStyle.value,
    projectAspectRatio: projectAspectRatio.value,
    store,
    router,
    route,
    loadDrama,
    savedCurrentEpisodeNumber,
    selectedEpisodeId,
    onEpisodeSelect,
  storyGenerating,
  scriptGenerating,
  pollTask,
  replaceRouteWhenNew: true,
    skipPostLoad: false,

  })
}

function openSelectScriptDialog() {
  showSelectScriptDialog.value = true
}

async function loadSelectScriptList() {
  selectScriptLoading.value = true
  try {
    const res = await dramaAPI.list({ page: 1, page_size: 100 })
    const items = res?.items ?? []
    selectScriptDramas.value = items.filter((d) => d?.metadata?.script_template === true)
  } catch {
    selectScriptDramas.value = []
  } finally {
    selectScriptLoading.value = false
  }
}

/**
 * 将源剧本的梗概 + 各集剧本写入当前工程（不跳转、不导入角色/分镜/视频）。
 * 在「新建故事」且尚未落库时，会创建新项目并跳转。
 */
async function onPickScriptFromDialog(sourceId) {
  if (!sourceId || selectScriptImporting.value) return
  const srcNum = Number(sourceId)
  const routeId = route.params.id
  const targetFromRoute = routeId && routeId !== 'new' ? Number(routeId) : null
  const targetId = store.dramaId ?? targetFromRoute ?? null

  if (targetId != null && Number(targetId) === srcNum) {
    ElMessage.info('当前打开的就是该项目')
    return
  }

  if (targetId != null) {
    try {
      await ElMessageBox.confirm(
        '将把所选剧本的「故事梗概」与「各集剧本正文」写入当前工程。不会导入角色、场景、分镜与视频。若源剧本集数更少，多出来的分集将从本工程移除（原分镜可能失效）。是否继续？',
        '导入剧本到当前工程',
        { type: 'warning', confirmButtonText: '导入', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
  }

  selectScriptImporting.value = true
  try {
    const src = await dramaAPI.get(srcNum)
    const rawEps = [...(src.episodes || [])].sort(
      (a, b) => (Number(a.episode_number) || 0) - (Number(b.episode_number) || 0)
    )
    const summary = (src.description || '').toString().trim()
    const episodesPayload = rawEps.map((ep, i) => ({
      episode_number: ep.episode_number != null ? Number(ep.episode_number) : i + 1,
      title: (ep.title || '').toString(),
      script_content: ep.script_content ?? '',
      description: ep.description ?? null,
      duration: ep.duration ?? 0,
    }))

    if (!targetId) {
      if (episodesPayload.length === 0 && !summary) {
        ElMessage.warning('所选剧本没有可导入的梗概或分集正文')
        return
      }
      const title = (src.title || '新故事').toString().trim() || '新故事'
      const created = await dramaAPI.create({
        title,
        description: summary || undefined,
        metadata: {},
      })
      const workId = created.id
      store.setDrama({ id: workId })
      if (episodesPayload.length > 0) {
        await dramaAPI.saveEpisodes(workId, episodesPayload)
      }
      if (summary) {
        await dramaAPI.saveOutline(workId, { summary }).catch(() => {})
      }
      showSelectScriptDialog.value = false
      router.replace('/film/' + workId)
      ElMessage.success('已根据所选剧本创建项目并导入梗概与正文')
      scriptWorkbenchMode.value = 'select'
      return
    }

    if (summary) {
      await dramaAPI.saveOutline(targetId, { summary }).catch(() => {})
    }
    if (episodesPayload.length > 0) {
      await dramaAPI.saveEpisodes(targetId, episodesPayload)
    } else if (!summary) {
      ElMessage.warning('所选剧本没有可导入的梗概或分集正文')
      return
    }

    showSelectScriptDialog.value = false
    await loadDrama()
    ElMessage.success('已导入故事梗概与剧本（当前工程未切换）')
    scriptWorkbenchMode.value = 'select'
  } catch (e) {
    ElMessage.error(e.message || '导入失败')
  } finally {
    selectScriptImporting.value = false
  }
}

watch(
  () => [store.drama?.episodes, selectedEpisodeId.value],
  () => {
    const eps = store.drama?.episodes || []
    if (eps.length > 1) {
      const cur = selectedEpisodeId.value
      const hit = cur != null && eps.some((e) => Number(e.id) === Number(cur))
      selectPreviewEpisodeId.value = hit ? String(cur) : String(eps[0].id)
    } else {
      selectPreviewEpisodeId.value = ''
    }
  },
  { deep: true, immediate: true }
)

function novelImportReset() {
  novelText.value = ''
  novelFileName.value = ''
  novelFileContent.value = ''
}

function onNovelFileChange(file) {
  novelFileName.value = file.name
  const reader = new FileReader()
  reader.onload = (ev) => { novelFileContent.value = ev.target.result }
  reader.readAsText(file.raw || file, 'utf-8')
}

async function onImportNovel() {
  const text = novelImportMode.value === 'file' ? novelFileContent.value : novelText.value
  if (!text?.trim()) {
    ElMessage.warning('请输入或上传小说内容')
    return
  }
  novelImporting.value = true
  try {
    const formData = new FormData()
    if (novelImportMode.value === 'file' && novelFileContent.value) {
      const blob = new Blob([novelFileContent.value], { type: 'text/plain' })
      formData.append('file', blob, novelFileName.value || 'novel.txt')
    } else {
      formData.append('text', text)
    }
    formData.append('title', scriptTitle.value || '导入小说')
    formData.append('max_chapters', String(novelMaxChapters.value))
    formData.append('ai_summarize', String(novelAiSummarize.value))
    const { default: axios } = await import('axios')
    const baseURL = (await import('@/utils/request')).default.defaults.baseURL || '/api/v1'
    const res = await axios.post(`${baseURL}/dramas/import-novel`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    let chapters = res.data?.data?.chapters || res.data?.chapters || []
    if (!chapters.length) {
      ElMessage.warning('未能识别到章节内容')
      return
    }
    // 若后端只识别出 1 章，但正文里有多处「第N集」行首标题，用前端规则再拆（与保存剧本一致）
    const clientParsed = parseScriptIntoEpisodes(text)
    if (clientParsed.split && clientParsed.episodes.length > chapters.length) {
      chapters = clientParsed.episodes.map((e, i) => ({
        index: i + 1,
        title: e.title,
        content: e.script_content,
        script: e.script_content,
      }))
    }
    const toEpisodeRow = (ch, i) => ({
      episode_number: i + 1,
      title: (ch.title && String(ch.title).trim()) || '第' + (i + 1) + '集',
      script_content: String(ch.script ?? ch.content ?? '').trimEnd(),
      description: null,
      duration: 0,
    })
    const rows = chapters.map(toEpisodeRow)
    const plainScript = episodesListToPlainScript(
      rows.map((r) => ({ title: r.title, script_content: r.script_content }))
    )
    if (store.dramaId && rows.length >= 2) {
      await dramaAPI.saveEpisodes(store.dramaId, rows)
      await loadDrama()
      ElMessage.success(`已导入并拆分为 ${rows.length} 集`)
    } else {
      store.setScriptContent(plainScript || rows[0]?.script_content || '')
      ElMessage.success(
        rows.length >= 2
          ? `已导入 ${rows.length} 个章节（保存剧本时将写入多集）`
          : `成功导入 ${rows.length} 个章节，请继续编辑剧本`
      )
    }
    showNovelImport.value = false
    novelImportReset()
  } catch (e) {
    ElMessage.error(e.message || '导入失败')
  } finally {
    novelImporting.value = false
  }
}

async function onGenerateScript() {
  if (scriptGenerating.value) return

  const content = (scriptContent.value ?? store.scriptContent ?? '').toString().trim()
  if (!content) {
    ElMessage.warning('请先在「故事生成」中点击 AI 生成，或手动输入剧本内容')
    return
  }
  scriptGenerating.value = true
  try {
    const result = await saveScriptToBackend(content)
    if (result?.created) {
      ElMessage.success('项目已创建，剧本已保存')
    } else {
      ElMessage.success('剧本已保存')
    }

  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    scriptGenerating.value = false
  }
}

async function onAddEpisode() {
  if (!store.dramaId) return
  const list = store.drama?.episodes || []
  const nextNum = list.length > 0
    ? Math.max(...list.map((e) => Number(e.episode_number) || 0), 0) + 1
    : 1
  const updated = list.map((ep, i) => ({
    episode_number: ep.episode_number ?? i + 1,
    title: ep.title || '第' + (ep.episode_number ?? i + 1) + '集',
    script_content: ep.script_content || '',
    description: ep.description,
    duration: ep.duration
  }))
  updated.push({
    episode_number: nextNum,
    title: '第' + nextNum + '集',
    script_content: '',
    description: null,
    duration: 0
  })
  try {
    await dramaAPI.saveEpisodes(store.dramaId, updated)
    savedCurrentEpisodeNumber.value = nextNum
    await loadDrama()
    ElMessage.success('已添加第' + nextNum + '集')
  } catch (e) {
    ElMessage.error(e.message || '添加失败')
  }
}

function onUploadResourceClick(type, id) {
  resourceUploadType.value = type
  resourceUploadId.value = id
  resourceImageFileInput.value?.click()
}

function openResourceAssetPicker(type, resource) {
  if (projectSession.enabled && !projectSession.canEdit) return
  resourceAssetPickerType.value = type
  resourceAssetPickerTarget.value = resource
  showPropAssetPicker.value = true
}

async function bindAssetToResource(asset) {
  const resource = resourceAssetPickerTarget.value
  const type = resourceAssetPickerType.value
  if (!resource?.id || !asset?.local_path || !type) return
  try {
    const payload = {
      local_path: asset.local_path,
      image_url: asset.url || `/static/${String(asset.local_path).replace(/^\//, '')}`,
    }
    if (type === 'character') await characterAPI.putImage(resource.id, payload)
    else if (type === 'scene') await sceneAPI.update(resource.id, payload)
    else await propAPI.update(resource.id, payload)
    if (type === 'character') await characterAPI.addToMaterialLibrary(resource.id)
    else if (type === 'scene') await sceneAPI.addToMaterialLibrary(resource.id)
    else await propAPI.addToMaterialLibrary(resource.id)
    showPropAssetPicker.value = false
    resourceAssetPickerTarget.value = null
    resourceAssetPickerType.value = null
    await loadDrama()
    ElMessage.success('图片已绑定到资源')
  } catch (e) {
    ElMessage.error(e.message || '绑定资源图片失败')
  }
}

function hasResourceQuoteReference(item) {
  return Boolean(String(item?.ref_image || '').trim())
}

async function refreshResourceBatchImageQuote() {
  const sequence = ++resourceBatchImageQuoteSequence
  resourceBatchImageQuote.value = null
  resourceBatchImageQuoteError.value = ''
  if (!showResourceBatchImageDialog.value || !resourceBatchImageModel.value || !resourceBatchMissingItems.value.length) return
  resourceBatchImageQuoteLoading.value = true
  try {
    const items = resourceBatchMissingItems.value
    const quote = await accountAPI.quoteResourceImages({
      model: resourceBatchImageModel.value,
      count: items.length,
      image_input_count: items.filter(hasResourceQuoteReference).length,
    })
    if (sequence !== resourceBatchImageQuoteSequence) return
    resourceBatchImageQuote.value = quote?.data ?? quote
  } catch (error) {
    if (sequence !== resourceBatchImageQuoteSequence) return
    resourceBatchImageQuoteError.value = error?.message || '无法计算积分，请检查模型价目。'
  } finally {
    if (sequence === resourceBatchImageQuoteSequence) resourceBatchImageQuoteLoading.value = false
  }
}

function onGenerateMissingResourceImages(type) {
  const items = type === 'character' ? characters.value : type === 'scene' ? scenes.value : props.value
  const missing = items.filter((item) => !hasAssetImage(item))
  if (!missing.length) return ElMessage.info('当前资源都已有图片')
  resourceBatchImageType.value = type
  if (!resourceBatchImageModel.value || !resourceImageModels.value.includes(resourceBatchImageModel.value)) {
    resourceBatchImageModel.value = resourceImageModels.value[0] || ''
  }
  showResourceBatchImageDialog.value = true
}

async function submitGenerateMissingResourceImages() {
  const type = resourceBatchImageType.value
  const missing = [...resourceBatchMissingItems.value]
  const model = resourceBatchImageModel.value
  if (!missing.length || !model || !resourceBatchImageQuote.value || resourceBatchImageQuoteError.value) return
  showResourceBatchImageDialog.value = false
  resourceBatchGenerating.value = type
  try {
    for (const item of missing) {
      if (type === 'character') await onGenerateCharacterImage(item, model)
      else if (type === 'scene') await onGenerateSceneImage(item, sceneUseQuadGrid.value, model)
      else await onGeneratePropImage(item, propUseQuadGrid.value, model)
    }
  } finally {
    resourceBatchGenerating.value = null
  }
}

watch(
  [showResourceBatchImageDialog, resourceBatchImageModel, () => resourceBatchMissingItems.value.map((item) => `${item.id}:${item.ref_image || ''}`).join('|')],
  refreshResourceBatchImageQuote
)

watch(resourceImageModels, (models) => {
  if (showResourceBatchImageDialog.value && !resourceBatchImageModel.value && models[0]) resourceBatchImageModel.value = models[0]
})

function resourceHostingStatusClass(item) {
  const status = String(item?.seedance2_asset?.status || 'none').toLowerCase()
  if (status === 'active') return 'is-active'
  if (['failed', 'stale', 'invalid'].includes(status)) return 'is-error'
  if (['queued', 'uploading', 'registering', 'processing', 'reconciling'].includes(status)) return 'is-processing'
  return 'is-empty'
}

async function batchUploadResourcesToMaterialLibrary(type) {
  const items = type === 'character' ? characters.value : type === 'scene' ? scenes.value : props.value
  const waiting = new Set(['queued', 'uploading', 'registering', 'processing', 'reconciling', 'active'])
  const targets = items.filter((item) => hasAssetImage(item) && !waiting.has(String(item?.seedance2_asset?.status || '').toLowerCase()))
  if (!targets.length) return ElMessage.info('没有需要上传的图片素材')
  resourceBatchUploading.value = type
  let succeeded = 0
  try {
    for (const item of targets) {
      try {
        if (type === 'character') await characterAPI.sd2Certify(item.id)
        else if (type === 'scene') await sceneAPI.certifySd2(item.id)
        else await propAPI.certifySd2(item.id)
        succeeded += 1
      } catch (_) {
        // 继续处理其他资源，结束时统一显示结果。
      }
    }
    await loadDrama()
    const failed = targets.length - succeeded
    if (failed) ElMessage.warning(`已提交 ${succeeded} 项，${failed} 项失败`)
    else ElMessage.success(`已提交 ${succeeded} 项到素材库`)
  } finally {
    resourceBatchUploading.value = null
  }
}

function openResourceEditor(type, item) {
  if (type === 'character') editCharacter(item)
  else if (type === 'scene') editScene(item)
  else if (type === 'prop') editProp(item)
}

function resetCharacterEditorScroll() {
  document.querySelector('.character-editor-dialog .el-dialog__body')?.scrollTo({ top: 0 })
}

function resourceCatalogGenerating(item) {
  const ids = resourceCatalogType.value === 'character'
    ? generatingCharIds
    : resourceCatalogType.value === 'scene'
      ? generatingSceneIds
      : generatingPropIds
  const set = ids?.value || ids
  return Boolean(set?.has?.(item.id))
}

async function generateResourceCatalogItem(item) {
  if (resourceCatalogType.value === 'character') return onGenerateCharacterImage(item, undefined)
  if (resourceCatalogType.value === 'scene') return onGenerateSceneImage(item, sceneUseQuadGrid.value, undefined)
  return onGeneratePropImage(item, propUseQuadGrid.value, undefined)
}

async function deleteResourceCatalogItem(item) {
  if (resourceCatalogType.value === 'character') return onDeleteCharacter(item)
  if (resourceCatalogType.value === 'scene') return onDeleteScene(item)
  return onDeleteProp(item)
}

// 解析 extra_images JSON，返回 local_path 数组
function parseExtraImages(item) {
  if (!item?.extra_images) return []
  try {
    const arr = typeof item.extra_images === 'string' ? JSON.parse(item.extra_images) : item.extra_images
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch { return [] }
}

// 查找角色/道具/场景在 store 中的当前对象
function findResource(type, id) {
  const list = type === 'character' ? (store.characters ?? [])
    : type === 'prop' ? (store.props ?? [])
    : (store.scenes ?? [])
  return list.find((x) => Number(x.id) === Number(id)) || null
}

function syncEditCharacterRuntimeState() {
  const form = editCharacterForm.value
  if (!form?.id) return
  const current = findResource('character', form.id)
  if (!current) return
  form.image_url = current.image_url || ''
  form.local_path = current.local_path || ''
  form.extra_images = current.extra_images || ''
  form.seedance2_asset = current.seedance2_asset ? { ...current.seedance2_asset } : null
  form.seedance2_voice_asset = current.seedance2_voice_asset ? { ...current.seedance2_voice_asset } : null
}

async function onEditCharacterGenerateImage() {
  if (!editCharacterForm.value?.id) return
  await onGenerateCharacterImage(editCharacterForm.value, undefined)
  syncEditCharacterRuntimeState()
}

const characterDescriptionSourceLabel = computed(() => {
  const form = editCharacterForm.value
  if (!form) return ''
  if (addCharRefImage.value || form.ref_image) return '从参考图提取描述'
  if (form.id && (form.image_url || form.local_path)) return '从主图提取描述'
  return ''
})

async function extractEditCharacterDescription() {
  if (addCharRefImage.value) return doExtractFromRef('character')
  return doExtractCharFromImage()
}

async function removeEditCharacterReferenceImage() {
  if (addCharRefImage.value) {
    addCharRefImage.value = null
    return
  }
  await clearCharRefImage()
}

async function onEditCharacterSd2Action() {
  if (!editCharacterForm.value?.id) return
  await onSd2PrimaryAction(editCharacterForm.value)
  syncEditCharacterRuntimeState()
}

async function onEditCharacterVoiceAction() {
  if (!editCharacterForm.value?.id) return
  await onSd2VoicePrimaryAction(editCharacterForm.value)
  syncEditCharacterRuntimeState()
}

async function onEditCharacterVoiceReplace() {
  if (!editCharacterForm.value?.id) return
  await onSd2VoiceReplace(editCharacterForm.value)
  syncEditCharacterRuntimeState()
}

watch(() => store.characters, () => {
  if (showEditCharacter.value) syncEditCharacterRuntimeState()
})

async function doUploadResourceImage(type, id, file) {
  if (!file || !type || id == null) return
  const key = type === 'character' ? 'char-' : type === 'prop' ? 'prop-' : 'scene-'
  uploadingResourceId.value = key + id
  try {
    const res = await uploadAPI.uploadImage(file, { dramaId: dramaId.value })
    const data = res?.data ?? res
    const uploadedLocalPath = data?.local_path || data?.path || null
    const url = data?.url || uploadedLocalPath
    if (!url) { ElMessage.error('上传未返回地址'); return }

    const current = findResource(type, id)
    const hasPrimary = !!(current?.local_path || current?.image_url)

    if (hasPrimary) {
      // 已有主图 → 追加到 extra_images
      const extras = parseExtraImages(current)
      const newPath = uploadedLocalPath || url
      if (!extras.includes(newPath)) extras.push(newPath)
      const extraJson = JSON.stringify(extras)
      if (type === 'character') {
        await characterAPI.putImage(id, { extra_images: extraJson })
      } else if (type === 'prop') {
        await propAPI.update(id, { extra_images: extraJson })
      } else if (type === 'scene') {
        await sceneAPI.update(id, { extra_images: extraJson })
      }
    } else {
      // 无主图 → 设为主图
      if (type === 'character') {
        await characterAPI.putImage(id, { image_url: url, local_path: uploadedLocalPath ?? null })
      } else if (type === 'prop') {
        await propAPI.update(id, { image_url: url, local_path: uploadedLocalPath ?? null })
      } else if (type === 'scene') {
        await sceneAPI.update(id, { image_url: url, local_path: uploadedLocalPath ?? null })
      }
    }
    // 角色/场景/道具图片是项目统一资源的一部分：上传完成后立即同步为可引用素材。
    // 这样不论是手工上传还是后续重新打开项目，都能进入分镜工作台。
    if (type === 'character') await characterAPI.addToMaterialLibrary(id)
    else if (type === 'prop') await propAPI.addToMaterialLibrary(id)
    else if (type === 'scene') await sceneAPI.addToMaterialLibrary(id)
    await loadDrama()
    ElMessage.success('上传成功')
  } catch (e) {
    ElMessage.error(e.message || '上传失败')
  } finally {
    uploadingResourceId.value = null
  }
}

function onResourceImageFileChange(ev) {
  const file = ev.target?.files?.[0]
  const type = resourceUploadType.value
  const id = resourceUploadId.value
  if (!file || !type || id == null) {
    ev.target.value = ''
    return
  }
  doUploadResourceImage(type, id, file).finally(() => {
    resourceUploadType.value = null
    resourceUploadId.value = null
    ev.target.value = ''
  })
}

function getSbFirstFrameUrl(sb) {
  const img = storyboardUseFirstLastFrame.value ? getSbFirstImage(sb.id) : getSbImage(sb.id)
  if (img && (img.image_url || img.local_path)) return assetImageUrl(img)
  if (sb.composed_image || sb.image_url) return imageUrl(sb.composed_image || sb.image_url)
  return ''
}

function getSbLastFrameUrl(sb) {
  const img = getSbLastImage(sb.id)
  if (img && (img.image_url || img.local_path)) return assetImageUrl(img)
  if (sb.last_frame_image_url || sb.last_frame_local_path) {
    return assetImageUrl({ image_url: sb.last_frame_image_url, local_path: sb.last_frame_local_path })
  }
  return ''
}

/** 经典模式视频：首帧 URL（连贯帧可覆盖首帧）+ 可选尾帧 */
function sbVideoFirstLastUrls(sb, universal, contiguityFirstFrameUrl) {
  let first =
    contiguityFirstFrameUrl ||
    (universal ? '' : toAbsoluteImageUrl(getSbFirstFrameUrl(sb) || ''))
  if (!first && !universal) {
    first = toAbsoluteImageUrl(getSbFirstFrameUrl(sb) || '')
  }
  let last = undefined
  if (storyboardUseFirstLastFrame.value && !universal) {
    const lu = getSbLastFrameUrl(sb)
    if (lu) last = toAbsoluteImageUrl(lu)
  }
  return { first: first || undefined, last }
}

/**
 * P0-1: 从视频 URL 捕获末帧（浏览器 canvas 方案）
 * 返回 Blob（JPEG），失败返回 null
 */
async function captureVideoLastFrame(videoUrl) {
  return new Promise((resolve) => {
    if (!videoUrl) return resolve(null)
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'metadata'
    let captured = false
    const timeout = setTimeout(() => { if (!captured) resolve(null) }, 12000)
    video.addEventListener('error', () => { clearTimeout(timeout); if (!captured) resolve(null) })
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.max(0, video.duration - 0.5)
    })
    video.addEventListener('seeked', () => {
      if (captured) return
      captured = true
      clearTimeout(timeout)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 512
        canvas.height = video.videoHeight || 288
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0)
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85)
      } catch (_) {
        resolve(null)
      }
    })
    video.src = videoUrl
  })
}

function isSbUniversalMode(sbId) {
  return sbCreationMode.value[sbId] === 'universal'
}

function universalSegmentDurationSecForSb(sb) {
  const dUi = Number(sbDuration.value[sb?.id])
  const dRow = Number(sb?.duration)
  const dProj = Number(videoClipDuration.value)
  return Number.isFinite(dUi) && dUi > 0
    ? dUi
    : Number.isFinite(dRow) && dRow > 0
      ? dRow
      : Number.isFinite(dProj) && dProj > 0
        ? dProj
        : 5
}

/** 提交视频 API 时使用的时长：优先本分镜配置，其次项目「每段秒数」 */
function getSbVideoDurationForApi(sb) {
  const perSb = Number(sbGenerationSettings.value[sb?.id]?.duration ?? sbDuration.value[sb?.id] ?? sb?.duration)
  if (Number.isFinite(perSb) && perSb > 0) return perSb
  const clip = Number(videoClipDuration.value)
  if (Number.isFinite(clip) && clip > 0) return clip
  return undefined
}

/** 本镜已选素材：严格按用户勾选顺序返回（@图片N 与提交顺序一致） */
function getSelectedUniversalLibraryAssets(sb) {
  const ids = (sbOmniAssetIds.value[sb?.id] || []).map(Number)
  const byId = new Map(validRows(universalLibraryAssets.value).map((asset) => [Number(asset.id), asset]))
  return ids.map((id) => byId.get(id)).filter(Boolean)
}

function sbOmniAssetUrl(asset) {
  if (!asset) return ''
  return asset.local_path ? '/static/' + String(asset.local_path).replace(/^\/+/, '') : (asset.url || '')
}

function omniDefaultUsage(asset) { return asset?.type === 'video' ? 'motion' : asset?.type === 'audio' ? 'ambience' : 'reference' }
function openResourceMediaUpload() {
  if (projectSession.enabled && !projectSession.canEdit) return
  resourceMediaFileInput.value?.click()
}

async function onResourceMediaFileChange(e) {
  if (projectSession.enabled && !projectSession.canEdit) return
  const files = Array.from(e.target?.files || [])
  e.target.value = ''
  if (!files.length) return
  resourceMediaUploading.value = true
  try {
    for (const file of files) {
      const result = await omniVideoAPI.upload(file, { name: file.name, drama_id: dramaId.value })
      const asset = result?.asset
      if (asset && !universalLibraryAssets.value.some((item) => Number(item.id) === Number(asset.id))) {
        universalLibraryAssets.value = [asset, ...universalLibraryAssets.value]
      }
    }
    ElMessage.success(`已加入 ${files.length} 个统一媒体素材`)
  } catch (err) {
    ElMessage.error(err?.message || '媒体素材上传失败')
  } finally {
    resourceMediaUploading.value = false
  }
}

async function renameResourceMedia(asset) {
  try {
    const { value } = await ElMessageBox.prompt('请输入素材名称', '重命名素材', { inputValue: asset.name || '' })
    const name = String(value || '').trim()
    if (!name) return
    const updated = await omniVideoAPI.updateAsset(asset.id, { name })
    Object.assign(asset, updated || {}, { name })
    ElMessage.success('素材名称已更新')
  } catch (_) {}
}

function isUnifiedResourceSelected(type, id) {
  return unifiedResourceSelection[type]?.has(Number(id)) || false
}

function toggleUnifiedResourceSelection(type, id) {
  const selected = unifiedResourceSelection[type]
  const normalizedId = Number(id)
  if (!selected || !Number.isInteger(normalizedId)) return
  if (selected.has(normalizedId)) selected.delete(normalizedId)
  else selected.add(normalizedId)
}

async function batchDeleteUnifiedResources(type) {
  const selected = unifiedResourceSelection[type]
  const ids = selected ? [...selected] : []
  if (!ids.length) return
  const labels = { character: '角色', scene: '场景', prop: '道具', media: '媒体素材' }
  const label = labels[type] || '资源'
  const globalMediaCount = type === 'media'
    ? universalLibraryAssets.value.filter((asset) => ids.includes(Number(asset.id)) && asset.library_scope === 'global').length
    : 0
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${ids.length} 个${label}？${globalMediaCount ? `其中 ${globalMediaCount} 个为全局素材，删除后其他项目也将不可见。` : '相关镜头引用会同步移除。'}`,
      `批量删除${label}`,
      { type: 'warning', confirmButtonText: '删除选中项', cancelButtonText: '取消' }
    )
    const removeByType = {
      character: (id) => characterAPI.delete(id),
      scene: (id) => sceneAPI.delete(id),
      prop: (id) => propAPI.delete(id),
      // 逐个走资源删除路由：项目资源会被正确解除关联，不能用素材表批删绕开这条语义。
      media: (id) => omniVideoAPI.deleteAsset(id),
    }
    const results = await Promise.allSettled(ids.map((id) => removeByType[type](id)))
    const succeeded = ids.filter((_, index) => results[index].status === 'fulfilled')
    succeeded.forEach((id) => selected.delete(id))
    const failed = ids.length - succeeded.length
    if (type === 'media') {
      universalLibraryAssets.value = universalLibraryAssets.value.filter((asset) => !succeeded.includes(Number(asset.id)))
      await loadDetachedResourceLinks()
    } else {
      await loadDrama()
    }
    if (failed) ElMessage.warning(`已处理 ${succeeded.length} 个${label}，${failed} 个删除失败，请重试`)
    else ElMessage.success(`已删除 ${succeeded.length} 个${label}`)
  } catch (err) {
    if (err !== 'cancel' && err?.action !== 'cancel') ElMessage.error(err?.message || `批量删除${label}失败`)
  }
}

async function deleteResourceMedia(asset) {
  try {
    const globalAsset = asset.library_scope === 'global'
    await ElMessageBox.confirm(`确定归档“${asset.name || `素材 ${asset.id}`}”？归档后新镜头不能再选用；已有镜头不受影响。`, globalAsset ? '归档全局素材' : '归档项目素材', { type: 'warning' })
    await omniVideoAPI.deleteAsset(asset.id)
    universalLibraryAssets.value = universalLibraryAssets.value.filter((item) => Number(item.id) !== Number(asset.id))
    ElMessage.success('已归档；已有镜头引用保持不变')
  } catch (err) {
    if (err !== 'cancel' && err?.action !== 'cancel') ElMessage.error(err?.message || '删除素材失败')
  }
}

async function loadDetachedResourceLinks() {
  try {
    detachedResourceLinks.value = await omniVideoAPI.listResourceLinks({ drama_id: dramaId.value, status: 'detached' }) || []
  } catch (_) {
    detachedResourceLinks.value = []
  }
}

async function restoreResourceMedia(link) {
  try {
    await omniVideoAPI.restoreResourceLink(link.id)
    await loadUniversalLibraryAssets()
    ElMessage.success('素材关联已恢复，原素材 ID 与历史分镜引用继续有效')
  } catch (err) {
    ElMessage.error(err?.message || '恢复素材关联失败')
  }
}

async function loadUniversalLibraryAssets() {
  // 素材池加载全部媒体素材（不按当前剧集过滤）：媒体素材库上传的图片/视频/音频
  // 未绑定 drama_id，按剧集过滤会导致本地上传的素材（如音频）永远看不到、参考不了。
  // 与媒体素材库页 /media-library、全能创作台 /free-create 的加载口径保持一致。
  try {
    const [result] = await Promise.all([
      loadAllUniversalLibraryAssets(),
      loadDetachedResourceLinks(),
    ])
    universalLibraryAssets.value = (result?.items || []).filter((asset) => asset && Number.isFinite(Number(asset.id)) && ['image', 'video', 'audio'].includes(asset.type) && asset.processing_status !== 'processing')
    await reconcileUnavailableStoryboardAssets()
  } catch (_) {
    universalLibraryAssets.value = []
  }
}

// A detached or temporarily invisible material remains an auditable history
// reference. Never rewrite a storyboard simply because this pool cannot show
// it; replacement/removal must be an explicit user action.
async function reconcileUnavailableStoryboardAssets() {
  const available = new Set(validRows(universalLibraryAssets.value).map((asset) => Number(asset.id)))
  let unavailableCount = 0
  for (const sb of validRows(storyboards.value)) {
    const current = (sbOmniAssetIds.value[sb.id] || []).map(Number)
    const first = sbOmniFirstFrameAssetId.value[sb.id]
    const last = sbOmniLastFrameAssetId.value[sb.id]
    const missing = current.filter((id) => !available.has(id))
    if (first != null && !available.has(Number(first))) missing.push(Number(first))
    if (last != null && !available.has(Number(last))) missing.push(Number(last))
    // Keep the persisted IDs unchanged. The pool may be narrower than the
    // historical reference set after an explicit detach or scope switch.
    if (missing.length) {
      unavailableCount += new Set(missing).size
      console.warn('[assets] storyboard keeps unavailable references', { storyboard_id: sb.id, asset_ids: [...new Set(missing)] })
    }
  }
  if (unavailableCount) ElMessage.warning(`有 ${unavailableCount} 个历史素材引用当前不可用，系统已保留引用，请显式恢复、替换或移除。`)
}

async function loadAllUniversalLibraryAssets() {
  const loadScope = async (scope, extra = {}) => {
    const items = []
    let page = 1
    let total = Infinity
    while (items.length < total) {
      const result = await omniVideoAPI.assets({ scope, ...extra, page, page_size: 100 })
      const batch = (result?.items || []).filter((asset) => asset && Number.isFinite(Number(asset.id)))
        .map((asset) => ({ ...asset, library_scope: scope }))
      items.push(...batch)
      total = Number(result?.pagination?.total ?? items.length)
      if (!batch.length || page >= Number(result?.pagination?.total_pages || 1)) break
      page += 1
    }
    return items
  }
  const [projectItems, globalItems] = await Promise.all([
    loadScope('project', { drama_id: dramaId.value }),
    loadScope('global'),
  ])
  return { items: [...projectItems, ...globalItems] }
}

function getSbVideoRequestSettings(sb) {
  const settings = sbGenerationSettings.value[sb?.id] || {}
  return {
    model: settings.video_model && settings.video_model !== 'auto'
      ? settings.video_model
      : (projectVideoModel.value && projectVideoModel.value !== 'auto' ? projectVideoModel.value : undefined),
    aspect_ratio: settings.aspect_ratio || projectAspectRatio.value || '16:9',
    resolution: settings.resolution || videoResolution.value || undefined,
    duration: getSbVideoDurationForApi(sb),
    upscale_resolution: settings.upscale_resolution || null,
    target_fps: settings.target_fps || null,
  }
}

function getSbTextModel(sb) {
  const selected = sbGenerationSettings.value[sb?.id]?.text_model
  return selected && selected !== 'auto' ? selected : undefined
}

function applyGenerationSettingsContract(result) {
  if (!result) return
  const nextSettings = { ...sbGenerationSettings.value }
  const durationMap = { ...sbDuration.value }
  const rows = Array.isArray(result.storyboards) ? result.storyboards : [result]
  for (const item of rows) {
    if (!item?.id || !item.effective) continue
    nextSettings[item.id] = { ...item.effective }
    durationMap[item.id] = item.effective.duration
  }
  sbGenerationSettings.value = nextSettings
  sbDuration.value = durationMap
  if (result.defaults) setProjectGenerationSettings(result.defaults)
}

async function loadEpisodeGenerationSettings(episodeId = currentEpisodeId.value) {
  if (!episodeId) return
  try { applyGenerationSettingsContract(await storyboardsAPI.getEpisodeGenerationSettings(episodeId)) } catch (_) {}
}

async function applyProjectGenerationSettingsToStoryboards() {
  const shots = storyboards.value || []
  if (!shots.length) return ElMessage.info('暂无可应用的分镜')
  const settings = projectGenerationSettings.value
  try {
    const contract = await storyboardsAPI.updateEpisodeGenerationSettings(currentEpisodeId.value, { defaults: settings, override_policy: 'replace' })
    applyGenerationSettingsContract(contract)
    await saveProjectSettings(false)
    ElMessage.success('项目视频参数已应用到全部分镜')
  } catch (err) {
    ElMessage.error(err?.message || '应用视频参数失败')
  }
}

/** 全能提示词生成/润色：提交当前编辑区中的分镜字段（避免未点保存时仍用库内旧对白） */
function buildUniversalSegmentFieldOverrides(sb) {
  if (!sb?.id) return {}
  const id = sb.id
  const trimOrNull = (v) => {
    const s = (v ?? '').toString().trim()
    return s || null
  }
  return {
    title: trimOrNull(sbTitle.value[id] ?? sb.title),
    description: trimOrNull(sb.description),
    location: trimOrNull(sbLocation.value[id] ?? sb.location),
    time: trimOrNull(sbTime.value[id] ?? sb.time),
    action: trimOrNull(sbAction.value[id] ?? sb.action),
    dialogue: trimOrNull(sbDialogue.value[id] ?? sb.dialogue),
    narration: trimOrNull(sbNarration.value[id] ?? sb.narration),
    result: trimOrNull(sbResult.value[id] ?? sb.result),
    atmosphere: trimOrNull(sbAtmosphere.value[id] ?? sb.atmosphere),
    shot_type: trimOrNull(sbShotType.value[id] ?? sb.shot_type),
    movement: trimOrNull(sbMovement.value[id] ?? sb.movement),
    layout_description: trimOrNull(sbLayoutDescription.value[id] ?? sb.layout_description),
  }
}

/**
 * 分镜脚本生成完成后：按镜序逐个流式润色全能片段（服务端已落库）。
 * @param {{ checkPause?: () => Promise<void>, onShotProgress?: (cur:number,total:number,sb:object)=>void, onShotError?: (sb:object,msg:string)=>void }} opts
 */
async function polishUniversalSegmentsAfterGeneration(opts = {}) {
  const checkPause = typeof opts.checkPause === 'function' ? opts.checkPause : async () => {}
  const onShotProgress = typeof opts.onShotProgress === 'function' ? opts.onShotProgress : null
  const onShotError = typeof opts.onShotError === 'function' ? opts.onShotError : null

  if (!storyboardUniversalOmni.value) return { polished: 0, skipped: true }

  const rawList = store.currentEpisode?.storyboards || []
  const list = rawList.slice().sort((a, b) => (Number(a.storyboard_number) || 0) - (Number(b.storyboard_number) || 0))
  const targets = list.filter((sb) => sb?.id && isSbUniversalMode(sb.id) && sbUniversalSegmentTrimmed(sb))

  if (!targets.length) return { polished: 0, skipped: true }

  universalOmniPolishRunning.value = true
  universalOmniPolishAbort.value = false
  universalOmniPolishProgress.value = { current: 0, total: targets.length, label: '' }
  let polished = 0
  try {
    for (let i = 0; i < targets.length; i++) {
      if (universalOmniPolishAbort.value) break
      await checkPause()
      const sb = targets[i]
      const cur = i + 1
      const label = '#' + (sb.storyboard_number ?? cur) + (sb.title ? ' ' + String(sb.title).slice(0, 20) : '')
      universalOmniPolishProgress.value = { current: cur, total: targets.length, label }
      if (onShotProgress) onShotProgress(cur, targets.length, sb)

      const draft = sbUniversalSegmentTrimmed(sb)
      if (!draft) continue

      generatingUniversalSegmentIds.add(sb.id)
      let live = ''
      try {
        const durationSec = universalSegmentDurationSecForSb(sb)
        const data = await storyboardsAPI.polishUniversalSegmentPromptStream(
          sb.id,
          {
            duration: durationSec,
            draft_universal_segment_text: draft,
            model: getSbTextModel(sb),
            field_overrides: buildUniversalSegmentFieldOverrides(sb),
            force_without_reference_images: true,
          },
          (delta) => {
            live += delta
            sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: live }
          }
        )
        const text = (data?.universal_segment_text ?? '').toString().trim()
        if (text) {
          polished += 1
          sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: text }
          const storyList = store.currentEpisode?.storyboards
          if (Array.isArray(storyList)) {
            const row = storyList.find((x) => Number(x.id) === Number(sb.id))
            if (row) row.universal_segment_text = text
          }
        }
      } catch (e) {
        const msg = e?.message || String(e)
        if (onShotError) onShotError(sb, msg)
        else ElMessage.warning(`分镜 #${sb.storyboard_number ?? sb.id} 全能润色失败：${msg}`)
      } finally {
        generatingUniversalSegmentIds.delete(sb.id)
      }
      await pipelineRest()
    }
  } finally {
    universalOmniPolishRunning.value = false
    universalOmniPolishProgress.value = { current: 0, total: 0, label: '' }
  }
  return { polished, skipped: false }
}

/** 为视频生成获取参考图的真实 URL */
async function getMainImageUrlForVideo(sb) {
  return getSbFirstFrameUrl(sb)
}

/** 转为视频接口可请求的绝对 URL（后端/第三方需能访问） */
function toAbsoluteImageUrl(url) {
  if (!url || !String(url).trim()) return ''
  const s = String(url).trim()
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  const base = (baseUrl.value || '').replace(/\/$/, '') || (typeof window !== 'undefined' ? window.location.origin : '')
  return base ? base + (s.startsWith('/') ? s : '/' + s) : s
}

function sbUniversalSegmentTrimmed(sb) {
  if (!sb?.id) return ''
  return (sbUniversalSegmentText.value[sb.id] ?? sb.universal_segment_text ?? '').toString().trim()
}

function sbCanSubmitVideo(sb) {
  if (!sb) return false
  const vp = (sb.video_prompt || '').toString().trim()
  if (vp) return true
  if (isSbUniversalMode(sb.id)) {
    if (!sbUniversalSegmentTrimmed(sb)) return false
    if ((sbOmniCreationMode.value[sb.id] || 'multi_reference') === 'first_last_frame') {
      const first = Number(sbOmniFirstFrameAssetId.value[sb.id])
      const last = Number(sbOmniLastFrameAssetId.value[sb.id])
      return Number.isFinite(first) && Number.isFinite(last) && first > 0 && last > 0 && first !== last
    }
    return true
  }
  return false
}

/** 提交给视频 API 的文案：全能模式有片段描述时仅提交该段（不拼接 video_prompt，避免动作/旁白盖过 @图片 等编排） */
function buildSbVideoPromptForApi(sb, { preferClassicPrompt = false } = {}) {
  const vp = (sb.video_prompt || '').toString().trim()
  const seg = sbUniversalSegmentTrimmed(sb)
  if (preferClassicPrompt) return vp || seg
  if (isSbUniversalMode(sb.id)) {
    if (seg) return seg
    return vp
  }
  return vp
}

/**
 * 全能模式参考条目（提交顺序，@图片N 与之一一对应）：
 * 多参考模式 = 本镜已选素材（用户勾选/排序顺序）；首尾帧模式 = 仅首帧、尾帧两张图。
 * 场景/角色/道具图需在素材池勾选后（自动导入素材库）才会成为参考，不隐式自动加入。
 */
function sbOmniReferenceEntries(sb) {
  if (!sb?.id) return []
  const creationMode = sbOmniCreationMode.value[sb.id] || 'multi_reference'
  const entries = []
  if (creationMode === 'first_last_frame') {
    const firstId = Number(sbOmniFirstFrameAssetId.value[sb.id])
    const lastId = Number(sbOmniLastFrameAssetId.value[sb.id])
    if (!Number.isFinite(firstId) || !Number.isFinite(lastId) || firstId <= 0 || lastId <= 0 || firstId === lastId) return []
    const byId = new Map(universalLibraryAssets.value.map((a) => [Number(a.id), a]))
    for (const [id, usage] of [[firstId, 'first_frame'], [lastId, 'last_frame']]) {
      const asset = byId.get(id)
      if (!asset) continue
      entries.push({ asset_id: asset.id, type: 'image', alias: asset.name || `素材${asset.id}`, usage, role: 'reference', url: sbOmniAssetUrl(asset), thumbUrl: sbOmniAssetUrl(asset), asset, kind: 'asset', name: asset.name || `素材${asset.id}` })
    }
    return entries
  }
  const usageMap = sbOmniAssetUsage.value[sb.id] || {}
  for (const asset of getSelectedUniversalLibraryAssets(sb)) {
    entries.push({
      asset_id: asset.id, type: asset.type, alias: asset.name || `素材${asset.id}`,
      usage: usageMap[asset.id] || omniDefaultUsage(asset),
      role: usageMap[asset.id] === 'identity' ? 'identity' : 'reference',
      url: sbOmniAssetUrl(asset), thumbUrl: asset.type === 'image' ? sbOmniAssetUrl(asset) : '',
      asset, kind: 'asset', name: asset.name || `素材${asset.id}`,
    })
  }
  return entries
}

/** 全能模式：全部参考图片 → 绝对 URL（提交顺序，最多 10 张） */
function collectSbOmniReferenceAbsoluteUrls(sb) {
  if (!sb?.id) return []
  const urls = []
  const seen = new Set()
  for (const entry of sbOmniReferenceEntries(sb)) {
    if (entry.type !== 'image') continue
    const raw = entry.url || (entry.asset ? sbOmniAssetUrl(entry.asset) : '')
    const abs = toAbsoluteImageUrl(raw)
    if (!abs || seen.has(abs)) continue
    seen.add(abs)
    urls.push(abs)
  }
  return urls.slice(0, 10)
}

async function onSaveSbImagePrompt(sb) {
  if (!sb?.id) return
  try {
    await storyboardsAPI.update(sb.id, { image_prompt: (editingSbImagePromptText.value || '').toString().trim() || null })
    await loadDrama()
    editingSbImagePromptId.value = null
    ElMessage.success('图片提示词已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  }
}

/** 将结构化视角三元组转为英文描述片段 + 中文标签（与 angleService.js 保持一致） */
function angleToPromptFragment(h, v, s) {
  const hDesc = { front:'shooting from the front', front_left:'shooting from front-left at 45-degree angle', left:'shooting from the left side, profile view', back_left:'shooting from back-left at 135-degree angle', back:"shooting from behind, character's back to camera", back_right:'shooting from back-right at 135-degree angle', right:'shooting from the right side, profile view', front_right:'shooting from front-right at 45-degree angle' }
  const vDesc = { worm:"extreme low-angle worm's eye view, camera near ground pointing sharply upward, strong upward perspective distortion, background shows sky/ceiling", low:'low-angle upward shot, camera below eye-line, slight upward tilt, empowering perspective', eye_level:'eye-level shot, neutral perspective, natural horizontal framing', high:"high-angle bird's eye view, camera above looking down, background shows floor/ground with downward perspective distortion" }
  const sDesc = { close_up:'close-up shot (face/bust framing), subject fills most of frame, shallow depth of field, background softly blurred', medium:'medium shot (waist-up to full body), character and immediate surroundings visible, moderate depth of field', wide:'wide shot (full body with environment), subject small relative to scene, deep depth of field, environment context prominent' }
  const hLabel = { front:'正面', front_left:'前左', left:'左侧', back_left:'后左', back:'背面', back_right:'后右', right:'右侧', front_right:'前右' }
  const vLabel = { worm:'虫眼仰', low:'仰拍', eye_level:'平视', high:'俯拍' }
  const sLabel = { close_up:'特写', medium:'中景', wide:'远景' }
  const fragment = [sDesc[s] || sDesc.medium, vDesc[v] || vDesc.eye_level, hDesc[h] || hDesc.front].join(', ')
  const label = `${sLabel[s] || '中景'}·${vLabel[v] || '平视'}·${hLabel[h] || '正面'}`
  return { fragment, label }
}

async function refreshStoryboardsForEpisode(episodeId) {
  if (!episodeId) return
  try {
    const res = await dramaAPI.getStoryboards(episodeId)
    const list = Array.isArray(res) ? res : (res?.storyboards ?? null)
    if (!Array.isArray(list)) return
    if (Number(store.currentEpisode?.id) === Number(episodeId)) {
      store.currentEpisode.storyboards = list
    }
    const epInDrama = store.drama?.episodes?.find((e) => Number(e.id) === Number(episodeId))
    if (epInDrama) {
      epInDrama.storyboards = list
    }
  } catch (_) { /* 静默忽略，不影响主流程 */ }
}

/** @deprecated 使用 refreshStoryboardsForEpisode */
async function refreshStoryboardsOnly() {
  return refreshStoryboardsForEpisode(currentEpisodeId.value)
}

async function onGenerateStoryboard() {

  const epId = currentEpisodeId.value
  if (!epId) return
  const meta = buildExtractTaskMeta(store, dramaId.value, epId, GEN_RESOURCE.GENERATE_STORYBOARD, 'AI生成分镜')
  if (genStore.isRunning(meta)) return
  genStore.markRunning(meta)
  // 生成期间每 2 秒刷新该集分镜列表，让已解析的分镜逐步出现（切集后仍更新原集缓存）
  // 分镜工作台(FreeCreate)自持镜头状态,不会响应 store 变化:
  // 生成期间用轻量刷新(仅分镜+生成合同)让新镜头实时渲染,结束时全量刷新(含视频)
  let fcRefreshInFlight = false
  const refreshEmbeddedWorkbench = async (light) => {
    if (fcRefreshInFlight) return
    const fc = freeCreateRef.value
    if (!fc?.refreshProjectShots) return
    fcRefreshInFlight = true
    try { await fc.refreshProjectShots(undefined, { light }) } catch (_) {} finally { fcRefreshInFlight = false }
  }
  const refreshTimer = setInterval(() => { refreshStoryboardsForEpisode(epId); refreshEmbeddedWorkbench(true) }, 2000)
  try {
    const res = await dramaAPI.generateStoryboard(epId, {
      model: undefined,
      style: getSelectedStyle(),
      storyboard_count: getStoryboardCountForApi(),
      video_duration: getVideoDurationForApi(),
      aspect_ratio: projectAspectRatio.value || '16:9',
      include_narration: !!storyboardIncludeNarration.value,
      universal_omni_storyboard: !!storyboardUniversalOmni.value,
    })
    const taskId = res?.task_id ?? (typeof res === 'string' ? res : null)
    if (taskId) {
      const pollRes = await pollTask(taskId, () => loadDrama(), meta)
      // failed / timeout：pollTask 内已展示对应提示，直接返回，不显示「完成」
      if (pollRes?.status !== 'completed') return
      if (pollRes?.result?.truncated) {
        sbTruncatedWarning.value = true
        sbTruncatedDismissed.value = false
      }
    }
    await loadDrama()
    // 生成完成后静默补全空缺的摄影参数（只填未填字段，不覆盖 AI 已填的）
    storyboardsAPI.batchInferParams(epId, false).catch(() => {})
    const polishRes = await polishUniversalSegmentsAfterGeneration({})
    const polishedN = polishRes?.polished ?? 0
    ElMessage.success(
      storyboardUniversalOmni.value
        ? polishedN > 0
          ? `全能分镜生成完成，已自动润色 ${polishedN} 条片段`
          : '全能分镜生成完成'
        : '分镜生成完成'
    )

  } catch (e) {
    // HTTP 错误由 request 拦截器统一展示，此处仅处理拦截器未覆盖的异常
    if (!e.response) ElMessage.error(e.message || '生成失败')
  } finally {
    clearInterval(refreshTimer)
    genStore.markDone(meta)
    // 成功/失败/超时都同步一次嵌入工作台(全量,含视频),确保镜头最终状态可见
    refreshEmbeddedWorkbench(false)
  }
}

async function startBatchImageGeneration() {
  if (!currentEpisodeId.value || batchImageRunning.value || pipelineRunning.value) return
  batchImageErrors.value = []
  batchImageStopping.value = false
  batchImageRunning.value = true
  try {
    // 仅当媒体数据尚未加载时才全量拉取，避免点击时触发大量冗余请求
    if (Object.keys(sbImages.value).length === 0) {
      await loadStoryboardMedia()
    }
    const boards = store.storyboards || []
    if (boards.length === 0) {
      ElMessage.warning({ message: '当前集还没有分镜，请先生成或新建分镜', grouping: true })
      return
    }
    const todo = boards.filter((sb) => !hasSbImage(sb))
    if (todo.length === 0) {
      ElMessage.info({ message: '当前集分镜均已有图片，无需重复生成', grouping: true })
      return
    }
    batchImageProgress.value = { current: 0, total: todo.length, failed: 0 }
    const concurrency = pipelineConcurrency.value || 3
    let doneCount = 0

    // 并发执行，使用与 pipeline 相同的并发模型
    let queueIdx = 0
    const worker = async () => {
      while (queueIdx < todo.length) {
        if (batchImageStopping.value) break
        const sb = todo[queueIdx++]
        const useFirstLast = storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)
        try {
          let prompt = sb.polished_prompt || sb.image_prompt || sb.description || ''
          let frameTypeForCreate = gridMode.value !== 'single' ? gridMode.value : undefined
          if (useFirstLast) {
            // 首尾帧模式下，批量生成分镜图也必须走专业首帧提示词（含 layout_description 空间合同、专用 system prompt 等）
            prompt = await ensureProfessionalFramePrompt(sb, 'first')
            frameTypeForCreate = 'storyboard_first'
          }
          const res = await imagesAPI.create({
            storyboard_id: sb.id,
            drama_id: dramaId.value,
            prompt,
            style: getSelectedStyle(),
            frame_type: frameTypeForCreate,
            aspect_ratio: projectAspectRatio.value || '16:9',
          })
          if (res?.task_id) {
            const pollRes = await pollTask(res.task_id, () => loadSingleStoryboardMedia(sb.id))
            if (pollRes?.status === 'failed') {
              batchImageErrors.value.push(`#${sb.storyboard_number ?? sb.id}: ${pollRes.error || '生成失败'}`)
              batchImageProgress.value = { ...batchImageProgress.value, failed: batchImageProgress.value.failed + 1 }
            }
          } else {
            await loadSingleStoryboardMedia(sb.id)
          }
          // 成功后清理手动选中，让服务器 first_frame_image_id 成为权威（与单条生成首帧的清理逻辑一致）
          if (useFirstLast) {
            delete sbSelectedImgId.value[sb.id]
          }
        } catch (e) {
          batchImageErrors.value.push(`#${sb.storyboard_number ?? sb.id}: ${e.message || '提交失败'}`)
          batchImageProgress.value = { ...batchImageProgress.value, failed: batchImageProgress.value.failed + 1 }
        }
        doneCount++
        batchImageProgress.value = { ...batchImageProgress.value, current: doneCount }
      }
    }
    await Promise.allSettled(Array.from({ length: Math.min(concurrency, todo.length) }, () => worker()))
    if (!batchImageStopping.value) {
      // 最终统一恢复选中状态，确保所有首帧生成后服务器绑定立即生效（与单条生成路径一致）
      restoreSelectionsFromBackend()
      if (batchImageProgress.value.failed === 0) ElMessage.success(`分镜图批量生成完成（共 ${todo.length} 条）`)
      else ElMessage.warning(`批量完成，${batchImageProgress.value.failed}/${todo.length} 条失败`)
    } else {
      ElMessage.info('批量生成已停止')
    }
  } finally {
    batchImageRunning.value = false
  }
}

async function startBatchVideoGeneration() {
  if (!currentEpisodeId.value || batchVideoRunning.value || pipelineRunning.value) return
  batchVideoErrors.value = []
  batchVideoStopping.value = false
  batchVideoRunning.value = true
  try {
    // 仅当媒体数据尚未加载时才全量拉取，避免点击时触发大量冗余请求
    if (Object.keys(sbVideos.value).length === 0) {
      await loadStoryboardMedia()
    }
    const boards = store.storyboards || []
    if (boards.length === 0) {
      ElMessage.warning({ message: '当前集还没有分镜，请先生成或新建分镜', grouping: true })
      return
    }
    let completedVideoCount = 0
    let missingReferenceCount = 0
    // 只处理：有参考图（经典=分镜主图；全能=场景/角色/道具，不含经典主图）且 还没有已完成视频 的分镜
    const todo = boards.filter((sb) => {
      const vidList = sbVideos.value[sb.id] || []
      if (vidList.some((v) => v.status === 'completed' && recordHasPlayableVideoUrl(v))) {
        completedVideoCount += 1
        return false
      }
      if (isSbUniversalMode(sb.id)) {
        const hasReference = sbCanSubmitVideo(sb) && collectSbOmniReferenceAbsoluteUrls(sb).length > 0
        if (!hasReference) missingReferenceCount += 1
        return hasReference
      }
      const hasReference = !!getSbFirstFrameUrl(sb)
      if (!hasReference) missingReferenceCount += 1
      return hasReference
    })
    if (todo.length === 0) {
      if (completedVideoCount === boards.length) {
        ElMessage.info({ message: '当前集分镜均已有视频，无需重复生成', grouping: true })
      } else if (completedVideoCount > 0) {
        ElMessage.warning({
          message: `没有可生成视频的分镜：${completedVideoCount} 镜已有视频，${missingReferenceCount} 镜缺少参考图`,
          grouping: true,
        })
      } else {
        ElMessage.warning({ message: '当前集分镜缺少可用参考图，请先生成或选择分镜图', grouping: true })
      }
      return
    }
    batchVideoProgress.value = { current: 0, total: todo.length, failed: 0 }
    const contiguity = videoFrameContiguity.value
    // 连贯帧模式强制顺序（concurrency=1），普通模式并发
    const videoConcurrency = contiguity ? 1 : (pipelineVideoConcurrency.value || 2)
    let videoDoneCount = 0
    let prevVideoItem = null  // 连贯帧：保存上一条已完成的视频记录

    let videoQueueIdx = 0
    const videoWorker = async () => {
      while (videoQueueIdx < todo.length) {
        if (batchVideoStopping.value) break
        const sb = todo[videoQueueIdx++]
        const universal = isSbUniversalMode(sb.id)
        const omniRefs = universal ? collectSbOmniReferenceAbsoluteUrls(sb) : []
        if (!universal && !getSbFirstFrameUrl(sb)) {
          videoDoneCount++
          batchVideoProgress.value = { ...batchVideoProgress.value, current: videoDoneCount }
          continue
        }
        if (universal && !omniRefs.length) {
          videoDoneCount++
          batchVideoProgress.value = { ...batchVideoProgress.value, current: videoDoneCount }
          continue
        }
        try {
          generatingSbVideoIds.add(sb.id)
          // 批量生成时清除手动指定的视频，确保合成时使用最新生成记录
          storyboardsAPI.update(sb.id, { video_url: null, active_video_generation_id: null }).catch((error) => {
            ElMessage.warning(error?.message || `分镜 #${sb.shot_number || sb.id} 清除旧视频标记失败`)
          })
          if (sbSelectedVideoId.value[sb.id] != null) {
            const next = { ...sbSelectedVideoId.value }
            delete next[sb.id]
            sbSelectedVideoId.value = next
          }
          const firstFrameUrl = await getMainImageUrlForVideo(sb)
          const absoluteUrl = universal ? (omniRefs[0] || '') : toAbsoluteImageUrl(firstFrameUrl)
          // 连贯帧：提取上一条视频末帧作为参考（全能模式不走连贯帧替换）
          let contiguityFirstFrameUrl = absoluteUrl
          if (contiguity && prevVideoItem && !universal) {
            const prevVideoUrl = prevVideoItem.local_path
              ? toAbsoluteImageUrl('/static/' + prevVideoItem.local_path.replace(/^\//, ''))
              : prevVideoItem.video_url
            if (prevVideoUrl) {
              try {
                const lastFrameBlob = await captureVideoLastFrame(prevVideoUrl)
                if (lastFrameBlob) {
                  const file = new File([lastFrameBlob], 'continuity_frame.jpg', { type: 'image/jpeg' })
                  const uploadRes = await uploadAPI.uploadImage(file, { dramaId: dramaId.value })
                  if (uploadRes?.local_path) {
                    contiguityFirstFrameUrl = toAbsoluteImageUrl('/static/' + uploadRes.local_path.replace(/^\//, ''))
                  }
                }
              } catch (_) {}
            }
          }
          const { first: vFirst, last: vLast } = sbVideoFirstLastUrls(sb, universal, contiguityFirstFrameUrl || undefined)
          let refUrls = universal
            ? (omniRefs.length ? omniRefs : undefined)
            : (absoluteUrl ? [absoluteUrl] : undefined)
          if (!universal && vLast && refUrls && !refUrls.includes(vLast)) {
            refUrls = [...refUrls, vLast]
          }
          const res = await videosAPI.create({
            drama_id: dramaId.value,
            storyboard_id: sb.id,
            prompt: buildSbVideoPromptForApi(sb),
            image_url: vFirst || undefined,
            first_frame_url: vFirst,
            last_frame_url: vLast,
            reference_image_urls: refUrls,
            style: getSelectedStyle(),
            ...getSbVideoRequestSettings(sb),
          })
          if (res?.task_id) {
            const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_VIDEO, '分镜视频')
            const pollRes = await pollTask(res.task_id, () => loadSingleStoryboardMedia(sb.id), meta)
            if (pollRes?.status === 'failed') {
              batchVideoErrors.value.push(`#${sb.storyboard_number ?? sb.id}: ${pollRes.error || '生成失败'}`)
              batchVideoProgress.value = { ...batchVideoProgress.value, failed: batchVideoProgress.value.failed + 1 }
              prevVideoItem = null
            } else if (contiguity && pollRes?.status === 'completed') {
              // 连贯帧：保存本条视频用于下一条
              const vList = sbVideos.value[sb.id] || []
              prevVideoItem = vList.find((v) => v.status === 'completed') || null
            }
          } else {
            await loadSingleStoryboardMedia(sb.id)
            if (contiguity) {
              const vList = sbVideos.value[sb.id] || []
              prevVideoItem = vList.find((v) => v.status === 'completed') || null
            }
          }
        } catch (e) {
          batchVideoErrors.value.push(`#${sb.storyboard_number ?? sb.id}: ${e.message || '提交失败'}`)
          batchVideoProgress.value = { ...batchVideoProgress.value, failed: batchVideoProgress.value.failed + 1 }
          if (contiguity) prevVideoItem = null
        } finally {
          generatingSbVideoIds.delete(sb.id)
        }
        videoDoneCount++
        batchVideoProgress.value = { ...batchVideoProgress.value, current: videoDoneCount }
      }
    }
    await Promise.allSettled(Array.from({ length: Math.min(videoConcurrency, todo.length) }, () => videoWorker()))
    if (!batchVideoStopping.value) {
      if (batchVideoProgress.value.failed === 0) ElMessage.success(`分镜视频批量生成完成（共 ${todo.length} 条）`)
      else ElMessage.warning(`批量完成，${batchVideoProgress.value.failed}/${todo.length} 条失败`)
    } else {
      ElMessage.info('批量生成已停止')
    }
  } finally {
    batchVideoRunning.value = false
  }
}

function getFinalizeMergeOptions() {
  return {
    burn_narration_subtitles: !!videoSubtitle.value,
    burn_dialogue_audio: !!videoBurnDialogue.value,
    watermark_text: videoWatermark.value ? String(videoWatermarkText.value || '').trim().slice(0, 200) : '',
  }
}

async function onGenerateVideo() {
  if (!currentEpisodeId.value) return
  const epId = currentEpisodeId.value
  const did = dramaId.value
  const dramaTitle = store.drama?.title || ''
  const epNum = store.currentEpisode?.episode_number
  const epLabel = dramaTitle ? `${dramaTitle} · 第${epNum ?? ''}集` : `第${epNum ?? ''}集`
  const mergeMeta = {
    dramaId: did,
    episodeId: epId,
    dramaTitle,
    episodeNumber: epNum,
    resourceType: GEN_RESOURCE.EPISODE_MERGE,
    resourceId: epId,
    label: `${epLabel} 合成视频`,
  }
  if (genStore.isRunning(mergeMeta)) return
  store.setVideoStatus('generating', did, epId)
  store.setVideoProgress(5, did, epId)
  genStore.markRunning(mergeMeta)
  videoErrorMsg.value = ''
  try {
    const result = await dramaAPI.finalizeEpisode(epId, getFinalizeMergeOptions())
    if (result?.task_id != null) {
      store.setVideoProgress(10, did, epId)
      ElMessage.success(result?.message || '视频合成任务已提交，请稍后查看')
      const pollResult = await pollTask(result.task_id, () => loadDrama(), mergeMeta)
      await loadDrama()
      if (pollResult?.status === 'completed') {
        store.setVideoProgress(100, did, epId)
        if (currentEpisodeVideoUrl.value) {
          store.setVideoStatus('done', did, epId)
          ElMessage.success('视频生成完成')
        } else {
          store.setVideoStatus('error', did, epId)
          videoErrorMsg.value = '视频生成完成但未获取到播放地址，请稍后刷新'
          ElMessage.warning(videoErrorMsg.value)
        }
      } else if (pollResult?.status === 'failed') {
        store.setVideoStatus('error', did, epId)
        videoErrorMsg.value = pollResult?.error || '视频生成失败'
      } else if (pollResult?.status === 'timeout') {
        store.setVideoStatus('generating', did, epId)
        videoErrorMsg.value = '任务仍在排队或生成中，请稍后刷新查看'
        ElMessage.warning(videoErrorMsg.value)
      }
    } else {
      store.setVideoStatus('error', did, epId)
      const msg = result?.message || '本集没有可合成的视频片段'
      videoErrorMsg.value = msg
      ElMessage.warning(msg)
    }
  } catch (e) {
    videoErrorMsg.value = e.message || '生成失败'
    store.setVideoStatus('error', did, epId)
  } finally {
    if (store.getVideoStatus(did, epId) !== 'generating') {
      genStore.markDone(mergeMeta)
    }
  }
}

/** 无 task_id 时轮询刷新直到资源出现图片或超时（用于角色/道具/场景图生成） */
async function pollUntilResourceHasImage(checker, maxAttempts = 20, intervalMs = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs))
    await loadDrama()
    if (checker()) return
  }
}

function resolvePollMeta(meta = {}) {
  return {
    dramaId: meta.dramaId ?? dramaId.value,
    episodeId: meta.episodeId ?? currentEpisodeId.value,
    dramaTitle: meta.dramaTitle ?? store.drama?.title,
    episodeNumber: meta.episodeNumber ?? store.currentEpisode?.episode_number,
    resourceType: meta.resourceType || 'unknown',
    resourceId: meta.resourceId,
    label: meta.label,
    ...meta,
  }
}

function pollTask(taskId, onDone, meta = {}) {
  return genStore.pollTask(taskId, resolvePollMeta(meta), onDone, { ElMessage })
}

/** 一键生成视频：暂停时等待，返回 { paused: true } 表示被暂停中断 */
function pollTaskWithPause(taskId, onDone, meta = {}) {
  const resolvedMeta = resolvePollMeta(meta)
  const trackInStore = resolvedMeta.resourceType !== 'unknown' && resolvedMeta.resourceId != null
  if (trackInStore && taskId) {
    genStore.markRunning({ ...resolvedMeta, taskId })
  }
  const maxAttempts = 450  // 450 × 2s = 15 分钟
  const interval = 2000
  let attempts = 0
  return new Promise((resolve, reject) => {
    const finishStore = (status, error) => {
      if (!trackInStore || !taskId) return
      if (status === 'completed') genStore.markDone({ ...resolvedMeta, taskId })
      else genStore.markFailed({ ...resolvedMeta, taskId }, error || '任务失败')
    }
    const tick = async () => {
      if (pipelineAbortRequested.value) {
        finishStore('failed', '全流程已取消')
        reject(Object.assign(new Error('全流程已取消'), { pipelineAborted: true }))
        return
      }
      if (pipelinePaused.value) {
        resolve({ paused: true })
        return
      }
      attempts++
      try {
        const t = await taskAPI.get(taskId)
        if (pipelineAbortRequested.value) {
          finishStore('failed', '全流程已取消')
          reject(Object.assign(new Error('全流程已取消'), { pipelineAborted: true }))
          return
        }
        if (t.status === 'completed') {
          if (onDone) await onDone()
          finishStore('completed')
          resolve({ status: 'completed', result: t.result })
          return
        }
        if (t.status === 'failed') {
          const errMsg = (t.error || t.message || '任务失败').trim()
          finishStore('failed', errMsg)
          resolve({ status: 'failed', error: errMsg })
          return
        }
      } catch (pollErr) {
        console.warn('[pollTaskWithPause] poll attempt failed:', pollErr?.message)
      }
      if (attempts < maxAttempts) setTimeout(tick, interval)
      else {
        const timeoutMsg = '任务查询超时（超过15分钟）'
        finishStore('failed', timeoutMsg)
        resolve({ status: 'timeout', error: timeoutMsg })
      }
    }
    setTimeout(tick, interval)
  })
}

function waitForResume() {
  return new Promise((resolve) => {
    pipelineResolveResume = resolve
  })
}

function onPipelineResume() {
  pipelinePaused.value = false
  if (pipelineResolveResume) {
    pipelineResolveResume()
    pipelineResolveResume = null
  }
}

function addPipelineError(step, message) {
  const time = formatChinaTime(new Date())
  pipelineErrorLog.value = [...pipelineErrorLog.value, { time, step, message }]
}

async function checkPause() {
  if (pipelineAbortRequested.value) {
    throw Object.assign(new Error('全流程已取消'), { pipelineAborted: true })
  }
  while (pipelinePaused.value) {
    if (pipelineAbortRequested.value) {
      throw Object.assign(new Error('全流程已取消'), { pipelineAborted: true })
    }
    await waitForResume()
  }
}

/** 每生成好一个图片或内容后休息，防止任务队列过紧 */
function pipelineRest() {
  return new Promise((r) => setTimeout(r, 1000))
}

/** 跳过倒计时，立即进入下一阶段 */
function skipPipelineCountdown() {
  pipelineCountdown.value = 0
}

/** 阶段间倒计时，支持暂停冻结 + 立即跳过 */
async function runPipelineCountdown(totalSeconds, msg) {
  pipelineCountdown.value = totalSeconds
  pipelineCountdownMsg.value = msg
  try {
    while (pipelineCountdown.value > 0) {
      await checkPause()                              // 暂停时冻结在此
      await new Promise((r) => setTimeout(r, 1000))  // 等 1 秒
      if (pipelineCountdown.value > 0) pipelineCountdown.value--
    }
  } finally {
    pipelineCountdown.value = 0
    pipelineCountdownMsg.value = ''
  }
}

/** 执行可失败步骤，失败时重试最多 maxRetries 次；fn 返回 { paused: true } 表示暂停不重试；返回 true 表示成功；抛错会触发重试 */
async function pipelineWithRetry(stepName, fn, maxRetries = 3) {
  let lastErr
  for (let r = 0; r < maxRetries; r++) {
    try {
      const result = await fn()
      if (result && result.paused === true) return result
      return true
    } catch (e) {
      lastErr = e
      if (r < maxRetries - 1) await pipelineRest()
    }
  }
  addPipelineError(stepName, '重试3次均失败: ' + (lastErr?.message || String(lastErr)))
  return false
}

async function startOneClickPipeline() {
  if (!currentEpisodeId.value || pipelineRunning.value) return

  pipelineErrorLog.value = []
  pipelineCurrentStep.value = ''
  pipelineStepIndex.value = 0
  pipelineActiveTasks.clear()
  pipelineStepTotal.value = 10
  pipelineRunning.value = true
  pipelinePaused.value = false
  pipelineAbortRequested.value = false
  try {
    await runOneClickPipeline(false)
  } catch (e) {
    if (!e?.pipelineAborted) throw e
  } finally {
    pipelineRunning.value = false
    pipelineActiveTasks.clear()
  }
}

async function startTextFrameworkPipeline() {
  if (!currentEpisodeId.value || pipelineRunning.value) return
  pipelineErrorLog.value = []
  pipelineCurrentStep.value = ''
  pipelineStepIndex.value = 0
  pipelineActiveTasks.clear()
  pipelineStepTotal.value = 4
  pipelineRunning.value = true
  pipelinePaused.value = false
  pipelineAbortRequested.value = false
  try {
    await runOneClickPipeline(true)
  } catch (e) {
    if (!e?.pipelineAborted) throw e
  } finally {
    pipelineRunning.value = false
    pipelineActiveTasks.clear()
  }
}

function setPipelineStep(idx, text) {
  pipelineStepIndex.value = idx
  pipelineCurrentStep.value = `[步骤 ${idx}/${pipelineStepTotal.value}] ${text}`
}

async function runOneClickPipeline(textOnly = false) {
  const episodeId = currentEpisodeId.value
  const dramaIdVal = dramaId.value
  if (!episodeId || !dramaIdVal) return
  const style = getSelectedStyle()

  try {
    // ════════════════════════════════════════════════════════
    // 阶段一：内容提取 & 分镜生成（快速、低成本）
    // ════════════════════════════════════════════════════════

    // 步骤 1：提取角色
    await checkPause()
    let chars = store.currentEpisode?.characters ?? []
    if (chars.length === 0) {
      setPipelineStep(1, '提取角色...')
      try {
        const outline = (store.scriptContent || '').toString().trim() || (storyInput.value || '').toString().trim() || undefined
        const res = await generationAPI.generateCharacters(dramaIdVal, { episode_id: store.currentEpisode?.id ?? undefined, outline: outline || undefined })
        const taskId = res?.task_id
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('提取角色', result.error); return }
        } else {
          await loadDrama()
        }
        await pipelineRest()
      } catch (e) {
        addPipelineError('提取角色', e.message || String(e))
        return
      }
      chars = store.currentEpisode?.characters ?? []
    } else {
      setPipelineStep(1, `已有 ${chars.length} 个角色，跳过提取`)
    }

    // 步骤 2：提取场景
    await checkPause()
    let sceneList = store.currentEpisode?.scenes ?? []
    if (sceneList.length === 0) {
      setPipelineStep(2, '提取场景...')
      try {
        const res = await dramaAPI.extractBackgrounds(episodeId, { model: undefined, style, language: scriptLanguage.value })
        const taskId = res?.task_id
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('提取场景', result.error); return }
        } else {
          await loadDrama()
        }
        await pipelineRest()
      } catch (e) {
        addPipelineError('提取场景', e.message || String(e))
        return
      }
      sceneList = store.currentEpisode?.scenes ?? []
    } else {
      setPipelineStep(2, `已有 ${sceneList.length} 个场景，跳过提取`)
    }

    // 步骤 3：提取道具
    await checkPause()
    let propList = store.props ?? []
    if (propList.length === 0) {
      setPipelineStep(3, '提取道具...')
      try {
        const res = await propAPI.extractFromScript(episodeId)
        const taskId = res?.task_id
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('提取道具', result.error); return }
        } else {
          await loadDrama()
        }
        await pipelineRest()
      } catch (e) {
        addPipelineError('提取道具', e.message || String(e))
        // 道具提取失败不中断流程
      }
      propList = store.props ?? []
    } else {
      setPipelineStep(3, `已有 ${propList.length} 个道具，跳过提取`)
    }

    // 步骤 4：生成分镜脚本
    await checkPause()
    await loadStoryboardMedia()
    let boards = store.storyboards || []
    const hadBoardsBeforeStep4 = boards.length > 0
    if (boards.length === 0) {
      setPipelineStep(4, '生成分镜脚本...')
      // 与手动生成一样，每 2 秒刷新一次分镜列表，让已解析的分镜逐步显示
      const sbRefreshTimer = setInterval(refreshStoryboardsOnly, 2000)
      try {
        const res = await dramaAPI.generateStoryboard(episodeId, {
          style,
          aspect_ratio: projectAspectRatio.value || '16:9',
          storyboard_count: getStoryboardCountForApi(),
          video_duration: getVideoDurationForApi(),
          include_narration: !!storyboardIncludeNarration.value,
          universal_omni_storyboard: !!storyboardUniversalOmni.value,
        })
        const taskId = res?.task_id ?? (typeof res === 'string' ? res : null)
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { clearInterval(sbRefreshTimer); await waitForResume(); return }
          if (result?.error) {
            // 任务失败，但后端可能已保存了部分分镜，确保最新状态显示出来再停止
            await loadDrama()
            addPipelineError('生成分镜', result.error)
            clearInterval(sbRefreshTimer)
            return
          }
          if (result?.result?.truncated) {
            sbTruncatedWarning.value = true
            sbTruncatedDismissed.value = false
          }
        }
        await loadDrama()
        await pipelineRest()
      } catch (e) {
        addPipelineError('生成分镜', e.message || String(e))
        clearInterval(sbRefreshTimer)
        return
      }
      clearInterval(sbRefreshTimer)
      await loadStoryboardMedia()
      boards = store.storyboards || []
    } else {
      setPipelineStep(4, `已有 ${boards.length} 个分镜，跳过生成`)
    }

    const generatedSbThisPipeline = !hadBoardsBeforeStep4
    if (generatedSbThisPipeline && storyboardUniversalOmni.value) {
      await checkPause()
      await polishUniversalSegmentsAfterGeneration({
        checkPause,
        onShotProgress: (cur, total, sb) =>
          setPipelineStep(
            4,
            `润色全能分镜(${cur}/${total}) #${sb.storyboard_number ?? cur} ${(sb.title || '').slice(0, 16)}`
          ),
        onShotError: (sb, msg) =>
          addPipelineError('润色全能分镜', `镜#${sb.storyboard_number ?? sb.id}: ${msg}`),
      })
      await loadDrama()
      await loadStoryboardMedia()
    }

    if (textOnly) {
      pipelineCurrentStep.value = '文本框架已就绪（未生成图片与视频）'
      ElMessage.success('文本框架已生成：角色、场景、道具与分镜脚本已就绪')
      return
    }

    // ════════════════════════════════════════════════════════
    // ⏱ 倒计时 20 秒：请浏览分镜内容，确认后开始生成角色/场景/道具图片
    // ════════════════════════════════════════════════════════
    await runPipelineCountdown(20, '分镜脚本生成完毕，请浏览确认内容。倒计时结束后将开始生成角色、场景、道具图片。')
    await checkPause()

    // ════════════════════════════════════════════════════════
    // 阶段二：角色 / 场景 / 道具 图片生成（中等消耗）
    // ════════════════════════════════════════════════════════

    // 步骤 5：生成角色图
    {
      const charsWithoutImage = chars.filter((c) => !hasAssetImage(c))
      const concurrency = pipelineConcurrency.value
      setPipelineStep(5, `生成角色图（${charsWithoutImage.length} 个，并发 ${concurrency}）...`)
      const { paused } = await runConcurrently(charsWithoutImage, concurrency, async (char) => {
        await checkPause()
        generatingCharIds.add(char.id)
        try {
          const stepName = '角色图 ' + (char.name || char.id)
          const ok = await pipelineWithRetry(stepName, async () => {
            const res = await characterAPI.generateImage(char.id, undefined, style)
            const taskId = res?.image_generation?.task_id ?? res?.task_id
            if (taskId) {
              const result = await pollTaskWithPause(taskId, () => loadDrama())
              if (result?.paused) return { paused: true }
              if (result?.error) throw new Error(result.error)
            } else {
              await loadDrama()
              await pollUntilResourceHasImage(() => {
                const list = store.currentEpisode?.characters ?? []
                const c = list.find((x) => Number(x.id) === Number(char.id))
                return !!(c && (c.image_url || c.local_path))
              })
            }
          })
          if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
        } finally {
          generatingCharIds.delete(char.id)
        }
      }, { getLabel: (char) => '角色图 ' + (char.name || char.id) })
      if (paused) { await waitForResume() }
    }

    // 步骤 6：生成场景图
    {
      const scenesWithoutImage = sceneList.filter((s) => !hasAssetImage(s))
      const concurrency = pipelineConcurrency.value
      setPipelineStep(6, `生成场景图（${scenesWithoutImage.length} 个，并发 ${concurrency}）...`)
      await checkPause()
      const { paused } = await runConcurrently(scenesWithoutImage, concurrency, async (scene) => {
        await checkPause()
        generatingSceneIds.add(scene.id)
        try {
          const stepName = '场景图 ' + (scene.location || scene.id)
          const ok = await pipelineWithRetry(stepName, async () => {
            const useQuad = !!sceneUseQuadGrid.value
            const res = await sceneAPI.generateImage({ scene_id: scene.id, model: undefined, style, use_quad_grid: useQuad })
            const taskId = res?.image_generation?.task_id ?? res?.task_id
            if (taskId) {
              const result = await pollTaskWithPause(taskId, () => loadDrama())
              if (result?.paused) return { paused: true }
              if (result?.error) throw new Error(result.error)
            } else {
              await loadDrama()
              await pollUntilResourceHasImage(() => {
                const list = store.currentEpisode?.scenes ?? []
                const s = list.find((x) => Number(x.id) === Number(scene.id))
                return !!(s && (s.image_url || s.local_path))
              })
            }
          })
          if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
        } finally {
          generatingSceneIds.delete(scene.id)
        }
      }, { getLabel: (scene) => '场景图 ' + (scene.location || scene.id) })
      if (paused) { await waitForResume() }
    }

    // 步骤 7：生成道具图
    {
      const propsWithoutImage = propList.filter((p) => !hasAssetImage(p))
      const concurrency = pipelineConcurrency.value
      setPipelineStep(7, `生成道具图（${propsWithoutImage.length} 个，并发 ${concurrency}）...`)
      await checkPause()
      const { paused } = await runConcurrently(propsWithoutImage, concurrency, async (prop) => {
        await checkPause()
        generatingPropIds.add(prop.id)
        try {
          const stepName = '道具图 ' + (prop.name || prop.id)
          const ok = await pipelineWithRetry(stepName, async () => {
            const res = await propAPI.generateImage(prop.id, undefined, style)
            const taskId = res?.image_generation?.task_id ?? res?.task_id
            if (taskId) {
              const result = await pollTaskWithPause(taskId, () => loadDrama())
              if (result?.paused) return { paused: true }
              if (result?.error) throw new Error(result.error)
            } else {
              await loadDrama()
              await pollUntilResourceHasImage(() => {
                const list = store.props ?? []
                const p = list.find((x) => Number(x.id) === Number(prop.id))
                return !!(p && (p.image_url || p.local_path))
              })
            }
          })
          if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
        } finally {
          generatingPropIds.delete(prop.id)
        }
      }, { getLabel: (prop) => '道具图 ' + (prop.name || prop.id) })
      if (paused) { await waitForResume() }
    }

    // ════════════════════════════════════════════════════════
    // ⏱ 倒计时 30 秒：请浏览角色/场景/道具图，确认后开始生成分镜图
    // ════════════════════════════════════════════════════════
    await runPipelineCountdown(30, '角色、场景、道具图片生成完毕，请浏览确认效果。倒计时结束后将开始生成分镜图（消耗较多 Token）。')
    await checkPause()

    // ════════════════════════════════════════════════════════
    // 阶段三：分镜图生成（较高消耗）
    // ════════════════════════════════════════════════════════

    // 步骤 8：生成分镜图
    {
      await loadStoryboardMedia()
      boards = store.storyboards || []
      const boardsWithoutImg = boards.filter((sb) => !hasSbImage(sb))
      const concurrency = pipelineConcurrency.value
      setPipelineStep(8, `生成分镜图（${boardsWithoutImg.length} 个，并发 ${concurrency}）...`)
      const { paused } = await runConcurrently(boardsWithoutImg, concurrency, async (sb) => {
        await checkPause()
        generatingSbImageIds.add(sb.id)
        try {
          const stepName = '分镜图 #' + (sb.storyboard_number ?? sb.id)
          const ok = await pipelineWithRetry(stepName, async () => {
            const useFirstLast = storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)
            let prompt = sb.polished_prompt || sb.image_prompt || sb.description || ''
            let frameTypeForCreate = undefined
            if (useFirstLast) {
              prompt = await ensureProfessionalFramePrompt(sb, 'first')
              frameTypeForCreate = 'storyboard_first'
            }
            const res = await imagesAPI.create({
              storyboard_id: sb.id,
              drama_id: dramaIdVal,
              prompt,
              model: undefined,
              style,
              frame_type: frameTypeForCreate,
              aspect_ratio: projectAspectRatio.value || '16:9',
            })
            if (res?.task_id) {
              const result = await pollTaskWithPause(res.task_id, () => loadSingleStoryboardMedia(sb.id))
              if (result?.paused) return { paused: true }
              if (result?.error) throw new Error(result.error)
            } else await loadSingleStoryboardMedia(sb.id)
          })
          if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
        } finally {
          generatingSbImageIds.delete(sb.id)
        }
      }, { getLabel: (sb) => '分镜图 #' + (sb.storyboard_number ?? sb.id) })
      if (paused) { await waitForResume() }
    }

    // ════════════════════════════════════════════════════════
    // ⏱ 倒计时 20 秒：请浏览分镜图，确认后开始生成分镜视频
    // ════════════════════════════════════════════════════════
    await runPipelineCountdown(20, '分镜图生成完毕，请浏览确认图片效果。倒计时结束后将开始生成分镜视频（消耗最多 Token）。')
    await checkPause()

    // ════════════════════════════════════════════════════════
    // 阶段四：分镜视频 & 合集（最高消耗）
    // ════════════════════════════════════════════════════════

    // 步骤 9：生成分镜视频
    {
      await loadStoryboardMedia()
      const boards2 = (store.storyboards || []).filter((sb) => {
        const vidList = sbVideos.value[sb.id] || []
        if (vidList.some((v) => v.status === 'completed' && recordHasPlayableVideoUrl(v))) return false
        if (isSbUniversalMode(sb.id)) {
          if (!sbCanSubmitVideo(sb)) return false
          return collectSbOmniReferenceAbsoluteUrls(sb).length > 0
        }
        return !!getSbFirstFrameUrl(sb)
      })
      const concurrency = pipelineVideoConcurrency.value
      setPipelineStep(9, `生成分镜视频（${boards2.length} 个，并发 ${concurrency}）...`)
      const { paused } = await runConcurrently(boards2, concurrency, async (sb) => {
        await checkPause()
        generatingSbVideoIds.add(sb.id)
        try {
          const stepName = '分镜视频 #' + (sb.storyboard_number ?? sb.id)
          const ok = await pipelineWithRetry(stepName, async () => {
            const universal = isSbUniversalMode(sb.id)
            const omniRefs = universal ? collectSbOmniReferenceAbsoluteUrls(sb) : []
            const firstFrameUrl = await getMainImageUrlForVideo(sb)
            const absoluteUrl = universal ? (omniRefs[0] || '') : toAbsoluteImageUrl(firstFrameUrl)
            const { first: vFirst, last: vLast } = sbVideoFirstLastUrls(sb, universal, null)
            let refUrls = universal
              ? (omniRefs.length ? omniRefs : undefined)
              : (absoluteUrl ? [absoluteUrl] : undefined)
            if (!universal && vLast && refUrls && !refUrls.includes(vLast)) {
              refUrls = [...refUrls, vLast]
            }
            const res = await videosAPI.create({
              drama_id: dramaIdVal,
              storyboard_id: sb.id,
              prompt: buildSbVideoPromptForApi(sb),
              image_url: vFirst || undefined,
              first_frame_url: vFirst,
              last_frame_url: vLast,
              reference_image_urls: refUrls,
              style,
              ...getSbVideoRequestSettings(sb),
            })
            if (res?.task_id) {
              const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_VIDEO, '分镜视频')
              const result = await pollTaskWithPause(res.task_id, () => loadSingleStoryboardMedia(sb.id), meta)
              if (result?.paused) return { paused: true }
              if (result?.error) throw new Error(result.error)
            } else await loadSingleStoryboardMedia(sb.id)
          })
          if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
        } finally {
          generatingSbVideoIds.delete(sb.id)
        }
      }, { getLabel: (sb) => '分镜视频 #' + (sb.storyboard_number ?? sb.id) })
      if (paused) { await waitForResume() }
    }

    // 步骤 10：合成整集视频
    await checkPause()
    setPipelineStep(10, '合成整集视频...')
    try {
      const result = await dramaAPI.finalizeEpisode(episodeId, getFinalizeMergeOptions())
      if (result?.task_id != null) {
        const pollResult = await pollTaskWithPause(result.task_id, () => loadDrama())
        if (pollResult?.paused) { await waitForResume(); return }
        if (pollResult?.error) addPipelineError('合成整集视频', pollResult.error)
        else await pipelineRest()
      } else {
        addPipelineError('合成整集视频', result?.message || '本集没有可合成的视频片段')
      }
    } catch (e) {
      addPipelineError('合成整集视频', e.message || String(e))
    }

    pipelineCurrentStep.value = '一键生成视频流程已执行完成'
    ElMessage.success('一键生成视频流程已执行完成')

  } catch (e) {
    addPipelineError('流程', e.message || String(e))

  }
}

function applyRouteToStore() {
  const id = route.params.id
  if (id && id !== 'new') {
    store.setDrama({ id: Number(id) })
    if (route.query.episode) {
      selectedEpisodeId.value = Number(route.query.episode)
    }
    loadDrama()
  } else {
    store.reset()
    storyInput.value = ''
    scriptTitle.value = ''
    selectedEpisodeId.value = null
    savedCurrentEpisodeNumber.value = 1
    storyStyle.value = ''
    storyType.value = ''
    scriptLanguage.value = 'zh'
    scriptStoryboardStyle.value = ''
    generationStyle.value = ''
  }
}

onMounted(async () => {
  loadPipelineConcurrency()
  applyRouteToStore()
})

watch(() => route.params.id, () => {
  applyRouteToStore()
})

watch(() => currentEpisodeId.value, (episodeId) => {
  if (episodeId) loadEpisodeGenerationSettings(episodeId)
}, { immediate: true })

// 剧本分集切换时同步 URL query 参数（?episode=<episode_id>），使刷新/分享页面仍保持当前选中集
// 同时监听 query 变化，支持浏览器前进/后退时自动切换对应集次
watch(
  () => selectedEpisodeId.value,
  (newId) => {
    if (!dramaId.value) return
    const currentInQuery = route.query.episode != null ? Number(route.query.episode) : null
    const desired = newId != null ? Number(newId) : null
    if (currentInQuery !== desired) {
      const newQuery = { ...route.query }
      if (desired != null) {
        newQuery.episode = String(desired)
      } else {
        delete newQuery.episode
      }
      router.replace({ query: newQuery, hash: route.hash }).catch(() => {})
    }
  },
  { flush: 'post' }
)

watch(
  () => route.query.episode,
  (newEp) => {
    if (!dramaId.value) return
    const newVal = newEp != null ? Number(newEp) : null
    const currentSel = selectedEpisodeId.value != null ? Number(selectedEpisodeId.value) : null
    if (currentSel !== newVal) {
      onEpisodeSelect(newVal)
    }
  }
)
</script>

<style scoped>
.script-workbench-unified {
  margin-bottom: 0;
}
.script-workbench-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}
.script-workbench-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
}
.script-workbench-tabs :deep(.el-tabs__item) {
  font-size: 15px;
  font-weight: 600;
}
.script-pane-inner {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.script-sub-block {
  padding-top: 4px;
}
.script-sub-divider {
  margin: 20px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
html.light .script-sub-divider {
  border-top-color: rgba(0, 0, 0, 0.08);
}
.script-mode-hint {
  margin-top: 0;
  margin-bottom: 12px;
}
.script-preview-wrap {
  margin-top: 20px;
}
.preview-block-title {
  margin: 16px 0 8px;
  font-size: 0.95rem;
  font-weight: 600;
  color: #a1a1aa;
}
html.light .preview-block-title {
  color: #64748b;
}
.preview-block-title:first-of-type {
  margin-top: 0;
}
.preview-actions {
  margin-top: 16px;
}
.script-select-empty {
  margin-top: 16px;
  color: #71717a;
  font-size: 14px;
}
.select-script-list {
  min-height: 120px;
  max-height: 420px;
  overflow-y: auto;
}
.select-script-item {
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.select-script-item:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(99, 102, 241, 0.35);
}
.select-script-item.disabled,
.select-script-item.disabled:hover {
  cursor: not-allowed;
  opacity: 0.55;
  border-color: rgba(255, 255, 255, 0.06);
  background: transparent;
}
html.light .select-script-item {
  border-color: rgba(99, 102, 241, 0.15);
}
html.light .select-script-item:hover {
  background: rgba(99, 102, 241, 0.06);
}
.select-script-title {
  font-weight: 600;
  color: #e4e4e7;
  margin-bottom: 6px;
}
html.light .select-script-title {
  color: #1e1b4b;
}
.select-script-desc {
  font-size: 13px;
  color: #9ca0b2;
  line-height: 1.45;
}
.select-script-empty {
  text-align: center;
  color: #71717a;
  padding: 24px;
}
.preview-ep-tabs {
  margin-top: 4px;
}

.film-create {
  min-height: 100vh;
  background: #16171e;
  background-image:
    radial-gradient(ellipse 80% 50% at 60% -5%, rgba(99, 102, 241, 0.13) 0%, transparent 65%),
    radial-gradient(ellipse 50% 40% at 90% 50%, rgba(139, 92, 246, 0.07) 0%, transparent 55%),
    radial-gradient(ellipse 45% 35% at 5% 75%, rgba(79, 70, 229, 0.06) 0%, transparent 55%),
    linear-gradient(180deg, #16171e 0%, #1a1b24 40%, #1e1f29 100%);
  color: #e4e4e7;
}
html.light .film-create {
  background: #f8f7ff;
  background-image:
    radial-gradient(ellipse 80% 50% at 10% -10%, rgba(139, 92, 246, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse 50% 40% at 85% 110%, rgba(99, 102, 241, 0.06) 0%, transparent 50%);
  color: #1e1b4b;
}
.header {
  background: rgba(20, 21, 28, 0.78);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding: 10px 28px;
  position: sticky;
  top: 0;
  z-index: 200;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.15), 0 4px 20px rgba(0, 0, 0, 0.2);
}
html.light .header {
  background: rgba(255, 255, 255, 0.82) !important;
  border-bottom-color: rgba(139, 92, 246, 0.1) !important;
  box-shadow: 0 1px 0 rgba(139,92,246,0.06), 0 4px 20px rgba(139, 92, 246, 0.05) !important;
}
.header-inner {
  display: flex;
  align-items: center;
  gap: 16px;
}
.logo {
  margin: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1;
  transition: filter 0.3s;
}
.logo:hover { filter: drop-shadow(0 0 10px rgba(139, 92, 246, 0.5)); }
.logo-main {
  font-size: 1.05rem;
  font-weight: 700;
  background: linear-gradient(135deg, #d0d5e8 0%, #a8b0cc 50%, #8890b0 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: -0.01em;
  filter: drop-shadow(0 0 8px rgba(160, 170, 200, 0.15));
}
.logo-sub {
  font-size: 0.65rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: #52525e;
  -webkit-text-fill-color: #52525e;
  text-transform: uppercase;
}
html.light .logo-main {
  background: linear-gradient(135deg, #6d28d9, #4f46e5);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
html.light .logo-sub {
  color: #9ca3af;
  -webkit-text-fill-color: #9ca3af;
}
.breadcrumb-sep {
  color: #3a3a44;
  font-size: 0.9rem;
  font-weight: 300;
  flex-shrink: 0;
  user-select: none;
}
html.light .breadcrumb-sep { color: #d1d5db; }
.page-title {
  font-size: 0.82rem;
  font-weight: 500;
  color: #7a7a88;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 4px 12px;
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
html.light .page-title {
  color: #6b7280;
  background: rgba(99, 102, 241, 0.04);
  border-color: rgba(99, 102, 241, 0.1);
}
.header-episode-select {
  flex-shrink: 0;
  width: 168px;
}
.btn-back-drama {
  flex-shrink: 0;
}
.header-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.btn-theme {
  --el-button-bg-color: rgba(255, 255, 255, 0.04);
  --el-button-border-color: rgba(255, 255, 255, 0.08);
  --el-button-text-color: #8b8b96;
  --el-button-hover-bg-color: rgba(255, 255, 255, 0.08);
  --el-button-hover-border-color: rgba(255, 255, 255, 0.18);
  --el-button-hover-text-color: #c8c8d0;
  transition: all 0.2s ease;
}
html.light .btn-theme {
  --el-button-bg-color: rgba(99, 102, 241, 0.04);
  --el-button-border-color: rgba(99, 102, 241, 0.12);
  --el-button-text-color: #6b7280;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.08);
  --el-button-hover-border-color: rgba(99, 102, 241, 0.3);
  --el-button-hover-text-color: #4f46e5;
}
@media (max-width: 768px) {
  .main { padding: 16px 12px 48px; }
  .asset-list-two { grid-template-columns: 1fr; }
}
/* 当前任务面板 */
.atp-panel {
  margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 6px 0 4px;
}
.atp-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 4px;
}
.atp-title {
  font-size: 0.72rem;
  font-weight: 600;
  color: #a78bfa;
  letter-spacing: 0.03em;
  flex: 1;
}
.atp-count-badge {
  font-size: 0.68rem;
  background: rgba(139, 92, 246, 0.25);
  color: #c4b5fd;
  border-radius: 8px;
  padding: 1px 5px;
  min-width: 16px;
  text-align: center;
}
.atp-spin-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a78bfa;
  flex-shrink: 0;
  animation: atp-pulse 1.2s ease-in-out infinite;
}
@keyframes atp-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}
.atp-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.atp-list :deep(.el-tooltip__trigger) {
  display: block;
  width: 100%;
  min-width: 0;
}
.atp-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 6px;
  transition: background 0.15s;
  min-width: 0;
  cursor: default;
}
.atp-item:hover { background: rgba(255,255,255,0.05); }
.atp-item-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #3479ae;
  flex-shrink: 0;
  animation: atp-pulse 1.6s ease-in-out infinite;
}
.atp-item-label {
  font-size: 0.72rem;
  color: #a1a1aa;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.atp-item-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #71717a;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}
.atp-item:hover .atp-item-close,
.atp-item-close:focus-visible {
  opacity: 1;
}
.atp-item-close:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}
.atp-more {
  font-size: 0.68rem;
  color: #71717a;
  padding: 2px 10px 2px 19px;
}
/* 折叠态任务徽章 */
.atp-collapsed-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 4px 0;
  cursor: default;
}
.atp-collapsed-count {
  font-size: 0.65rem;
  color: #a78bfa;
  font-weight: 700;
  line-height: 1;
}
html.light .atp-title { color: #3479ae; }
html.light .atp-count-badge { background: rgba(52,121,174,0.12); color: #3479ae; }
html.light .atp-spin-dot { background: #3479ae; }
html.light .atp-item-dot { background: #4b91c8; }
html.light .atp-item-label { color: #374151; }
html.light .atp-item:hover { background: rgba(0,0,0,0.04); }
html.light .atp-item-close { color: #9ca3af; }
html.light .atp-item-close:hover { background: rgba(239,68,68,0.1); color: #dc2626; }
html.light .atp-panel { border-top-color: rgba(139,92,246,0.15); }
.nav-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 8px;
  flex-shrink: 0;
}
html.light .nav-sidebar-header { border-bottom-color: rgba(139, 92, 246, 0.12); }
.nav-sidebar-title {
  font-size: 13px;
  font-weight: 600;
  color: #7a7a88;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
}
html.light .nav-sidebar-title { color: #3479ae; }
.nav-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  cursor: pointer;
  color: #5a5a66;
  transition: color 0.15s, background 0.15s;
  border-radius: 6px;
  flex-shrink: 0;
  font-size: 16px;
}
.nav-toggle:hover { color: #c8c8d0; background: rgba(255,255,255,0.06); }
html.light .nav-toggle { color: #9ca3af; }
html.light .nav-toggle:hover { color: #374151; background: rgba(0,0,0,0.05); }

/* ─── Steps ─── */
.nav-steps {
  display: flex;
  flex-direction: column;
  padding: 0 10px 0 10px;
}
.nav-step {
  display: flex;
  align-items: stretch;
  gap: 8px;
  cursor: pointer;
  border-radius: 6px;
  padding: 3px 6px 3px 0;
  transition: background 0.2s ease;
  user-select: none;
}
.nav-step:hover { background: rgba(255,255,255,0.04); }
html.light .nav-step:hover { background: rgba(99,102,241,0.05); }

/* connector column */
.step-connector-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 20px;
  flex-shrink: 0;
}
.step-line {
  width: 2px;
  flex: 1;
  min-height: 6px;
  background: rgba(255,255,255,0.1);
  border-radius: 1px;
  transition: background 0.3s;
}
html.light .step-line { background: rgba(0,0,0,0.1); }
.step-line.filled { background: rgba(34, 197, 94, 0.5); }

/* dot */
.step-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  transition: all 0.25s;
  border: 2px solid transparent;
}
.dot-pending {
  background: rgba(39,39,42,0.6);
  border-color: rgba(63,63,70,0.4);
  color: #52525b;
}
html.light .dot-pending {
  background: rgba(229,231,235,0.6);
  border-color: rgba(156,163,175,0.3);
  color: #9ca3af;
}
.dot-partial {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.45);
  color: #f59e0b;
}
.dot-generating {
  background: rgba(139, 92, 246, 0.15);
  border-color: rgba(139, 92, 246, 0.5);
  color: #a78bfa;
  box-shadow: 0 0 8px rgba(139, 92, 246, 0.2);
}
.dot-done {
  background: rgba(34, 197, 94, 0.12);
  border-color: rgba(34, 197, 94, 0.5);
  color: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.15);
}
.dot-icon { font-size: 13px; }
.dot-num { font-size: 11px; line-height: 1; }

/* step body */
.step-body {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  padding: 3px 0;
  min-width: 0;
}
.step-label {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #71717a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.2s ease;
}
html.light .step-label { color: #6b7280; }
.nav-step:hover .step-label { color: #d4d4d8; }
html.light .nav-step:hover .step-label { color: #1e1b4b; }
.status-done .step-label { color: #6ee7b7; }
html.light .status-done .step-label { color: #059669; }
.status-generating .step-label { color: #c4b5fd; }
html.light .status-generating .step-label { color: #3479ae; }
.status-partial .step-label { color: #fbbf24; }
html.light .status-partial .step-label { color: #d97706; }

.step-count {
  font-size: 10px;
  color: #52525b;
  background: rgba(255,255,255,0.04);
  border-radius: 10px;
  padding: 1px 5px;
  flex-shrink: 0;
  font-weight: 500;
}
html.light .step-count { background: rgba(0,0,0,0.04); color: #9ca3af; }

.step-badge {
  display: flex;
  align-items: center;
  font-size: 11px;
  flex-shrink: 0;
}
.partial-badge { color: #f59e0b; }
.gen-badge { color: #a78bfa; }

/* spin animation */
@keyframes navSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.spin { animation: navSpin 1s linear infinite; display: inline-flex; }

/* sub-toggle & sub-list */
.nav-group { margin-top: 4px; }
.nav-sub-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 12px;
  color: #5a5a66;
  cursor: pointer;
  transition: color 0.15s;
  border-top: 1px solid rgba(255,255,255,0.04);
}
html.light .nav-sub-toggle { border-top-color: rgba(0,0,0,0.07); color: #9ca3af; }
.nav-sub-toggle:hover { color: #e4e4e7; }
html.light .nav-sub-toggle:hover { color: #374151; }
.nav-sub-list {
  background: rgba(0,0,0,0.15);
  padding: 4px 0;
  border-radius: 0 0 6px 6px;
}
html.light .nav-sub-list { background: rgba(99,102,241,0.03); }
.nav-sub-item {
  padding: 4px 10px 4px 26px;
  font-size: 11.5px;
  color: #52525b;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.15s, background 0.15s;
  border-radius: 4px;
  margin: 0 4px;
}
html.light .nav-sub-item { color: #9ca3af; }
.nav-sub-item:hover { color: #d4d4d8; background: rgba(255,255,255,0.04); }
html.light .nav-sub-item:hover { color: #1e1b4b; background: rgba(99,102,241,0.06); }
.nav-sub-item { display: flex; align-items: center; gap: 4px; }
.nav-sub-item .nav-sb-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-sub-item .nav-sb-move { display: inline-flex; align-items: center; gap: 0; opacity: 0; transition: opacity 0.15s; flex: none; }
.nav-sub-item:hover .nav-sb-move { opacity: 1; }
.nav-sub-item .nav-sb-move .el-button { padding: 0 2px; font-size: 10px; margin: 0; }

.main {
  margin-left: 0;
  margin-right: 0;
  padding: 24px 32px 48px;
}
.storyboard-stage-active{height:100dvh;overflow:hidden}
.storyboard-stage-active .main{max-width:none;height:calc(100dvh - 58px);box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;padding:10px 32px}
.storyboard-stage-active .workflow-shell{flex:none;margin:0 0 8px;padding:8px 14px;overflow:clip!important}
.storyboard-stage-active .workflow-head{display:none}
.storyboard-stage-active .workflow-steps{margin-top:0}
.storyboard-stage-active .omni-page.embedded.project-storyboard-page{position:static!important;top:auto;height:auto!important;min-height:0!important;overflow:hidden!important;flex:1;z-index:auto}
.storyboard-stage-active .omni-page.embedded.project-storyboard-page .workbench{height:100%!important;min-height:0!important}
.storyboard-stage-active .workflow-next-action{flex:none;margin:8px 0 0;padding:8px 12px}
.sb-stage-gen-group{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}
.sb-stage-gen-label{font-size:12px;color:var(--el-text-color-secondary);white-space:nowrap}
.storyboard-stage-active .sb-stage-actions{flex-wrap:wrap;row-gap:8px}
@media(max-width:960px){.storyboard-stage-active{height:auto;overflow:visible}.storyboard-stage-active .main{height:auto;overflow:visible;display:block;padding:16px 12px}.storyboard-stage-active .workflow-head{display:flex}.storyboard-stage-active .omni-page.embedded.project-storyboard-page{overflow:visible!important}}
.section {
  margin-bottom: 24px;
}
.card {
  background: #1e1f28;
  border-radius: 14px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease;
}
.card:hover {
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.25);
}
html.light .card {
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(16px) saturate(1.3);
  -webkit-backdrop-filter: blur(16px) saturate(1.3);
  border-color: rgba(139, 92, 246, 0.08);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 4px 20px rgba(99, 102, 241, 0.05);
}
html.light .card:hover {
  border-color: rgba(139, 92, 246, 0.18);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 8px 36px rgba(99, 102, 241, 0.08);
}
.section-title {
  font-size: 1.05rem;
  margin: 0 0 4px;
  color: #f4f4f5;
  font-weight: 600;
  letter-spacing: -0.01em;
}
html.light .section-title { color: #1e1b4b; }
.pipeline-section {
  padding: 12px 16px !important;
}
.pipeline-section.collapsed {
  padding: 6px 16px !important;
}
.one-click-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.one-click-label {
  font-size: 14px;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  font-weight: 600;
}
.pipeline-status {
  margin-top: 12px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  font-size: 13px;
}
.pipeline-current-step {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--el-text-color-primary);
  font-weight: 500;
  font-size: 13px;
}
.pipeline-step-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  padding: 1px 7px;
  border-radius: 10px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}
.pipeline-active-tasks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.pipeline-task-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px 2px 6px;
  border-radius: 12px;
  background: rgba(64, 158, 255, 0.12);
  border: 1px solid rgba(64, 158, 255, 0.3);
  color: var(--el-color-primary);
  font-size: 12px;
  white-space: nowrap;
}
.pipeline-task-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-primary);
  flex-shrink: 0;
  animation: pipeline-dot-pulse 1.2s ease-in-out infinite;
}
@keyframes pipeline-dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}
.pipeline-error-log {
  margin-top: 0;
  padding: 12px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  font-size: 13px;
  color: #fca5a5;
  max-height: 200px;
  overflow-y: auto;
}
.pipeline-status .pipeline-error-log {
  margin-top: 8px;
}
.pipeline-error-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.pipeline-error-line {
  margin-bottom: 4px;
  word-break: break-all;
}
/* 阶段间倒计时 */
.pipeline-countdown {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin: 10px 0 8px;
  padding: 12px 14px;
  background: rgba(103, 194, 58, 0.08);
  border: 1px solid rgba(103, 194, 58, 0.35);
  border-radius: 10px;
}
.pipeline-countdown-ring {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 54px;
  height: 54px;
  border-radius: 50%;
  background: rgba(103, 194, 58, 0.15);
  border: 2px solid rgba(103, 194, 58, 0.6);
  flex-shrink: 0;
}
.pipeline-countdown-num {
  font-size: 22px;
  font-weight: 700;
  color: var(--el-color-success);
  line-height: 1;
}
.pipeline-countdown-unit {
  font-size: 11px;
  color: var(--el-color-success);
  opacity: 0.8;
}
.pipeline-countdown-body {
  flex: 1;
  min-width: 0;
}
.pipeline-countdown-msg {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--el-text-color-primary);
  line-height: 1.5;
}
.pipeline-countdown-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.pipeline-countdown-paused {
  font-size: 12px;
  color: var(--el-color-warning);
}
/* 批量生成分镜图/视频 */
.batch-status {
  margin-top: 12px;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.batch-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--el-text-color-primary);
  font-weight: 500;
}
.batch-failed {
  color: var(--el-color-danger);
  font-size: 12px;
}
.batch-stopping {
  color: var(--el-color-warning);
  font-size: 12px;
}
.batch-error-log {
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  font-size: 13px;
  color: #fca5a5;
  max-height: 160px;
  overflow-y: auto;
}
.batch-error-title {
  font-weight: 600;
  margin-bottom: 6px;
  color: #f87171;
}
.batch-error-line {
  margin-bottom: 3px;
  word-break: break-all;
}
/* 角色/场景/道具 → 影响的分镜 */
.asset-storyboard-link {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
  padding: 6px 8px;
  background: rgba(99, 102, 241, 0.07);
  border: 1px solid rgba(99, 102, 241, 0.18);
  border-radius: 6px;
  min-height: 28px;
}
.asl-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}
.asl-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  background: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.35);
  color: #a5b4fc;
  cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s;
  white-space: nowrap;
}
.asl-chip:hover {
  background: rgba(99, 102, 241, 0.28);
  box-shadow: 0 0 6px rgba(99, 102, 241, 0.4);
  color: #c7d2fe;
}
.asl-regen-btn {
  margin-left: auto !important;
  flex-shrink: 0;
  height: 22px !important;
  padding: 0 10px !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  background: rgba(251, 146, 60, 0.15) !important;
  border: 1px solid rgba(251, 146, 60, 0.5) !important;
  color: #fb923c !important;
  border-radius: 11px !important;
  transition: background 0.15s, box-shadow 0.15s !important;
}
.asl-regen-btn:not(.is-loading):hover {
  background: rgba(251, 146, 60, 0.28) !important;
  box-shadow: 0 0 6px rgba(251, 146, 60, 0.35) !important;
  color: #fdba74 !important;
}
.asl-progress {
  font-size: 11px;
  color: #fb923c;
  margin-left: 4px;
  flex-shrink: 0;
}
/* 参考图上传区（添加角色/道具/场景弹窗顶部） */
.ref-image-zone {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.ref-image-box {
  width: 120px;
  height: 120px;
  border: 2px dashed #c0c4cc;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  background: #fafafa;
  flex-shrink: 0;
  transition: border-color 0.2s;
}
.ref-image-box:hover {
  border-color: #409eff;
}
.ref-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ref-upload-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #909399;
  font-size: 12px;
  text-align: center;
  padding: 8px;
}
.ref-upload-icon {
  font-size: 28px;
  line-height: 1;
}
.ref-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ref-upload-tip {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.4;
}

/* 资源管理大面板 + 可折叠标题 */
.resource-panel {
  padding: 0;
  overflow: hidden;
}
.collapse-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}
.collapse-header:hover {
  background: rgba(255, 255, 255, 0.04);
}
.resource-panel .collapse-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.resource-panel .collapse-header .section-title {
  margin: 0;
}
.collapse-icon {
  font-size: 1.1rem;
  color: #a1a1aa;
  flex-shrink: 0;
  margin-left: 8px;
}
.resource-panel-body {
  padding: 16px 20px 20px;
}
.resource-block {
  margin-bottom: 20px;
  padding: 0;
  overflow: hidden;
}
.resource-block:last-child {
  margin-bottom: 0;
}
.resource-block-header {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.resource-block-header .collapse-icon {
  font-size: 1rem;
}
.resource-block-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  color: #e4e4e7;
}
html.light .resource-block-title {
  color: #18181b;
}
.resource-block-body {
  padding: 12px 14px 14px;
}
.resource-block-body .asset-actions {
  margin-bottom: 12px;
}
.resource-block-body .asset-list-two {
  gap: 16px;
}
.section-desc {
  color: #52525b;
  font-size: 0.82rem;
  margin: 0 0 14px;
  line-height: 1.5;
}
html.light .section-desc { color: #6b7280; }
.story-textarea {
  margin-bottom: 12px;
}
.row { display: flex; flex-wrap: wrap; align-items: center; }
.gap { gap: 12px; }
.asset-actions { margin-bottom: 12px; }
.asset-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.asset-list-two {
  grid-template-columns: repeat(auto-fill, minmax(460px, 1fr));
  gap: 20px;
}
.asset-item {
  background: #22232d;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.asset-item-left-right {
  flex-direction: row;
  align-items: stretch;
}
.asset-item-left-right .asset-info {
  flex: 1;
  min-width: 0;
  padding: 16px;
  display: flex;
  flex-direction: column;
}
.asset-item-left-right .asset-name {
  font-size: 1.05rem;
  margin-bottom: 8px;
}
.asset-item-left-right .asset-desc-full {
  flex: 1;
  font-size: 0.875rem;
  color: #a1a1aa;
  line-height: 1.5;
  margin-bottom: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.asset-item-left-right .asset-cover-wrap {
  flex-shrink: 0;
  align-self: flex-start;
}
.asset-item-left-right .asset-cover {
  width: 200px;
  height: 200px;
}
.asset-item-left-right .asset-cover.asset-cover--clickable {
  cursor: pointer;
}
.asset-cover {
  width: 100%;
  aspect-ratio: 1;
  background: #2a2b36;
  position: relative;
  overflow: hidden;
}
.asset-item-left-right .asset-cover .cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #5a5a66;
  font-size: 0.85rem;
}
.cover-placeholder.error {
  background: #450a0a;
  color: #f87171;
  font-size: 0.8rem;
  padding: 8px;
  line-height: 1.4;
  word-break: break-all;
  text-align: center;
}
.asset-cover--dragover {
  outline: 2px dashed var(--el-color-primary);
  outline-offset: -2px;
  background: rgba(64, 158, 255, 0.08);
}
.asset-cover-drop-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.9rem;
  pointer-events: none;
}
.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(10, 10, 15, 0.88);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.image-preview-img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  cursor: pointer;
  pointer-events: auto;
}
.asset-info { padding: 10px; }
.asset-name { font-weight: 600; margin-bottom: 4px; color: #e4e4e7; }
.asset-desc {
  font-size: 0.8rem;
  color: #a1a1aa;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-desc-full {
  font-size: 0.875rem;
  color: #a1a1aa;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.asset-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; }
.asset-item-left-right .asset-name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.asset-item-left-right .asset-name span { flex: 1; min-width: 0; }
.btn-delete-icon { flex-shrink: 0; padding: 2px 4px !important; opacity: 0.45; transition: opacity 0.15s; }
.btn-delete-icon:hover { opacity: 1; }
/* 图片 + 操作按钮 竖向包裹 */
.asset-cover-wrap {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 200px;
}
.asset-cover-actions {
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.asset-cover-actions .el-button { flex: 1; justify-content: center; }
html.light .asset-cover-actions { border-top-color: rgba(139,92,246,0.1); }
/* 额外参考图缩略图条 */
.extra-images-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 5px 8px;
  background: rgba(0,0,0,0.15);
}
.extra-thumb {
  position: relative;
  width: 52px;
  height: 52px;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  border: 1.5px solid transparent;
  transition: border-color 0.15s;
}
.extra-thumb:hover { border-color: #a78bfa; }
.extra-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.extra-thumb-remove {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 16px;
  height: 16px;
  background: rgba(239,68,68,0.85);
  color: #fff;
  border: none;
  border-radius: 50%;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  cursor: pointer;
  padding: 0;
  opacity: 0;
  transition: opacity 0.15s;
}
.thumb-preview-btn {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 16px;
  height: 16px;
  background: rgba(59,130,246,0.85);
  color: #fff;
  border: none;
  border-radius: 50%;
  font-size: 9px;
  line-height: 1;
  text-align: center;
  cursor: pointer;
  padding: 0;
  opacity: 0;
  transition: opacity 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.thumb-preview-btn .el-icon,
.thumb-preview-btn svg {
  width: 10px;
  height: 10px;
}
.extra-thumb:hover .extra-thumb-remove,
.extra-thumb:hover .thumb-preview-btn { opacity: 1; }
html.light .extra-images-strip { background: rgba(139,92,246,0.05); }
.empty-tip {
  color: #5a5a66;
  font-size: 0.9rem;
  padding: 16px 0;
}

/* 亮色模式：资源卡片 */
html.light .asset-item {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(139, 92, 246, 0.12);
  box-shadow: 0 2px 10px rgba(139, 92, 246, 0.06);
}
html.light .asset-item:hover {
  box-shadow: 0 6px 20px rgba(139, 92, 246, 0.12);
  border-color: rgba(139, 92, 246, 0.3);
  transform: translateY(-2px);
  transition: box-shadow 0.25s, transform 0.2s, border-color 0.25s;
}
html.light .asset-cover {
  background: #f3f4f6;
}
html.light .asset-name {
  color: #18181b;
}
html.light .asset-desc,
html.light .asset-desc-full,
html.light .asset-item-left-right .asset-desc-full {
  color: #6b7280;
}
html.light .cover-placeholder {
  color: #9ca3af;
  background: #f3f4f6;
}
html.light .cover-placeholder.error {
  background: #fef2f2;
  color: #dc2626;
}
html.light .empty-tip {
  color: #9ca3af;
}

/* 分镜：每行一个，三列布局 */
@keyframes sb-fade-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* ── 段落分隔标头 ─────────────────────────────── */
.segment-header {
  margin: 24px 0 14px;
  position: relative;
}
.segment-header:first-child { margin-top: 0; }
.segment-header-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  background: linear-gradient(90deg, rgba(139,92,246,0.12) 0%, transparent 80%);
  border-left: 3px solid rgba(139,92,246,0.6);
  border-radius: 0 10px 10px 0;
}
.segment-index-badge {
  font-size: 11px;
  font-weight: 600;
  color: #a78bfa;
  background: rgba(139,92,246,0.15);
  padding: 2px 8px;
  border-radius: 20px;
  letter-spacing: 0.3px;
  white-space: nowrap;
}
.segment-title-text {
  font-size: 14px;
  font-weight: 600;
  color: #d4d4d8;
  flex: 1;
  letter-spacing: -0.01em;
}
.segment-shot-range {
  font-size: 11px;
  color: #52525b;
  white-space: nowrap;
}
html.light .segment-header-inner {
  background: linear-gradient(90deg, rgba(139,92,246,0.07) 0%, transparent 80%);
  border-left-color: rgba(124,58,237,0.5);
}
html.light .segment-title-text { color: #1e1b4b; }
html.light .segment-index-badge { color: #3479ae; background: rgba(52,121,174,0.08); }
html.light .segment-shot-range { color: #9ca3af; }

/* 左侧导航段落标签 */
.nav-segment-label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px 2px;
  font-size: 10px;
  font-weight: 700;
  color: #a78bfa;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.nav-segment-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4b91c8;
  flex-shrink: 0;
}

.sb-panel {
  flex: 1;
  min-width: 0;
  padding: 14px 16px;
  border-right: 1px solid rgba(255,255,255,0.05);
  display: flex;
  flex-direction: column;
}
html.light .sb-panel {
  border-right-color: rgba(139,92,246,0.08);
}
.sb-panel:last-child { border-right: none; }
/* 分镜管理与自由创作保持同一优先级：全能提示词是 T0 输入，不再随
   左侧素材编排或右侧镜头列表被压缩成一行。 */
/* 有四宫格或多图时，image-area 改为纵向滚动布局 */
/* 普通多图缩略图条 */
/* 主图容器 */
/* 主图下方提示词预览 */
/* 四宫格整图作为上方预览时稍微缩小 */
/* 四宫格拆分中占位 */
.quad-splitting-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 8px;
}
.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px 24px;
  margin-bottom: 16px;
}
.video-option-hint {
  flex: 1;
  min-width: 200px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
}
.video-option-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px 12px;
}
.video-watermark-input {
  flex: 1;
  min-width: 200px;
  max-width: 360px;
}
.config-tip {
  margin: 12px 0 0;
  font-size: 0.9rem;
  color: #a1a1aa;
}
.config-tip .el-link { font-size: inherit; }
/* 分镜生成中提示条 */
@keyframes sb-dot-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40%            { transform: scale(1);   opacity: 1;   }
}
/* 解说导出行：避免浅色主题下勾选文案与卡片背景对比度不足 */
/* 分镜内解说旁白输入框：强制字/底对比，避免主题变量与页面继承冲突导致「看不见字」 */
.sub-title {
  font-size: 1rem;
  margin: 16px 0 8px;
  color: #e4e4e7;
}
.video-progress, .video-done, .video-error {
  margin-top: 16px;
}
.video-preview-wrap {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.video-preview-label {
  margin: 0 0 10px;
  font-size: 0.95rem;
  color: #a1a1aa;
}
.video-preview-player {
  display: block;
  max-width: 100%;
  max-height: 360px;
  border-radius: 8px;
  background: #1a1b24;
}

/* 公共库弹窗 */
.library-dialog .el-dialog__body { padding-top: 8px; }
.sd2-cert-dialog .el-dialog__body { padding-top: 10px; }
.sd2-cert-desc :deep(.el-descriptions__cell) {
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.sd2-cert-value {
  display: inline-block;
  max-width: 100%;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.5;
}
.library-toolbar { margin-bottom: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.library-team-hint { font-size: 12px; color: var(--el-text-color-secondary); }
.library-team-hint--warn { color: var(--el-color-warning); }
.char-library-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.library-item-sub { font-size: 12px; color: var(--el-text-color-secondary); font-weight: normal; }
.library-list {
  min-height: 200px;
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.library-item {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px;
  background: #1e1f28;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}
.library-item-cover {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  background: #252630;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.library-item-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.library-item-placeholder {
  font-size: 0.8rem;
  color: #5a5a66;
}
.library-item-info { flex: 1; min-width: 0; }
.library-item-name { font-weight: 500; margin-bottom: 4px; }
.library-item-desc { font-size: 0.85rem; color: #7a7a88; margin-bottom: 8px; }
.library-item-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.library-item-actions .el-button + .el-button { margin-left: 0; }
.library-pagination :deep(.el-pagination) { flex-wrap: wrap; justify-content: center; gap: 4px; }
.library-empty {
  text-align: center;
  color: #5a5a66;
  padding: 40px 20px;
}
.library-pagination {
  margin-top: 12px;
  display: flex;
  justify-content: center;
}
.library-placeholder {
  padding: 40px 20px;
  text-align: center;
  color: #5a5a66;
}

/* 专业帧提示词弹窗 - 干净美观版 */

/* 空间布局锚点展示（首尾帧一致性合同） */
.main-generation-controls{display:flex;align-items:center;gap:10px;flex:1;min-width:420px;padding:6px 10px;border:1px solid var(--el-border-color);border-radius:8px;background:var(--el-fill-color-light)}.main-generation-controls .generation-settings{flex:1;min-width:0;padding:0;border:0;background:transparent}.main-generation-label{font-size:12px;font-weight:600;color:var(--el-text-color-primary);white-space:nowrap}.sd2-resource-control{font-weight:600}.asset-btns{display:flex;flex-wrap:wrap;gap:6px}.asset-btns .sd2-resource-control{margin-left:0}@media(max-width:900px){.main-generation-controls{min-width:0;flex-wrap:wrap}.main-generation-controls .generation-settings{flex-basis:100%}}
.workflow-shell{margin:0 0 18px;padding:22px 24px;border:1px solid #ded8ce;border-radius:14px;background:#fffdf9;box-shadow:0 8px 24px #372d2010}.workflow-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.workflow-head h2{margin:3px 0 4px;color:#28231d;font-size:22px}.workflow-head p{margin:0;color:#746c62;font-size:14px}.workflow-kicker{font-size:12px;font-weight:700;letter-spacing:.08em;color:#8c6a44}.workflow-episode{padding:6px 9px;border-radius:99px;background:#f5efe5;color:#6b5842;font-size:13px}.workflow-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:20px}.workflow-step{display:flex;align-items:center;justify-content:center;gap:8px;min-height:42px;border:1px solid #dfd8ce;border-radius:8px;background:#fff;color:#756c61;cursor:pointer;font:inherit;font-size:14px}.workflow-step span{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#eee9e1;color:#746b60;font-size:12px}.workflow-step:hover{border-color:#a68b68;color:#514333}.workflow-step.active{border-color:#755d43;background:#3d342a;color:#fff}.workflow-step.active span{background:#fff;color:#3d342a}.workflow-step.complete:not(.active) span{background:#d9e7da;color:#45624a}.resource-center{background:#fffdf9!important}.resource-center-heading,.resource-media-library>header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.resource-center-heading{margin-bottom:18px}.resource-center-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.resource-center-group,.resource-media-library{border:1px solid #e2ddd5;border-radius:10px;background:#fff;padding:14px}.resource-center-group>header,.resource-media-library>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.resource-center-group>header b,.resource-media-library b{color:#302a23}.resource-center-group>header span,.resource-media-library>header>span{display:grid;place-items:center;min-width:24px;height:24px;border-radius:99px;background:#f0ebe3;color:#735e46;font-size:12px}.resource-center-actions{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.resource-center-list{display:grid;gap:9px;max-height:400px;overflow:auto}.resource-center-item{display:grid;grid-template-columns:76px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px;border-radius:7px;background:#faf8f5}.resource-center-item img,.resource-center-placeholder{width:76px;height:58px;border-radius:5px;object-fit:cover}.resource-center-placeholder{display:grid;place-items:center;background:#ece6dc;color:#8a7e6d;font-size:12px}.resource-center-item b,.resource-center-item small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.resource-center-item b{font-size:14px;color:#3e372f}.resource-center-item small{margin-top:3px;color:#8a8176;font-size:13px}.resource-center-empty{margin:18px 0;color:#92877b;font-size:14px}.resource-media-library{margin-top:14px}.resource-media-library header small{display:block;margin-top:4px;color:#8c8378;font-size:14px}.resource-media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.resource-media-card{overflow:hidden;border:1px solid #e7e2da;border-radius:7px;background:#faf8f5}.resource-media-card img,.resource-media-card>span{display:grid;width:100%;height:100px;object-fit:cover;place-items:center;background:#efe9df;color:#857765;font-size:14px}.resource-media-card small{display:block;padding:7px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#5c5247;font-size:13px}@media(max-width:900px){.workflow-head{flex-direction:column}.workflow-steps{grid-template-columns:repeat(2,minmax(0,1fr))}.resource-center-grid{grid-template-columns:1fr}}
.workflow-next-action{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:12px 0 22px;padding:14px 16px;border:1px solid #ded8ce;border-radius:10px;background:#f9f5ee;color:#665b4e;font-size:13px}.merge-readiness{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 0 14px;padding:11px 13px;border:1px solid #ead6b1;border-radius:8px;background:#fff7e8;color:#89622c;font-size:13px}.merge-readiness.ready{border-color:#c9dfca;background:#f0f8ef;color:#426c46}.merge-readiness b{color:inherit}@media(max-width:680px){.workflow-next-action{align-items:stretch;flex-direction:column}.workflow-next-action .el-button{width:100%}}

/* Workflow and resource-center are used inside the primary storyboard flow.
   They must inherit the global workbench palette instead of their old warm light skin. */
.workflow-shell,.resource-center{background:var(--bg-surface)!important;border-color:var(--border-color)!important;box-shadow:var(--shadow-sm)}
.workflow-head h2,.resource-center-group>header b,.resource-media-library b{color:var(--text-primary)}
.workflow-head p,.resource-center-empty,.resource-media-library header small{color:var(--text-muted)}
.workflow-kicker{color:var(--text-faint)}
.workflow-episode,.resource-center-group>header span,.resource-media-library>header>span{background:var(--bg-hover);color:var(--text-regular)}
.workflow-step{border-color:var(--border-color);background:var(--bg-raised);color:var(--text-muted)}
.workflow-step span{background:var(--bg-hover);color:var(--text-regular)}
.workflow-step:hover{border-color:var(--border-strong);color:var(--text-primary)}
.workflow-step.active{border-color:var(--accent);background:var(--accent);color:var(--accent-contrast)}
.workflow-step.active span{background:var(--bg-surface);color:var(--text-primary)}
.workflow-step.complete:not(.active) span{background:var(--bg-active);color:var(--text-primary)}
.resource-center-group,.resource-media-library{border-color:var(--border-subtle);background:var(--bg-raised)}
.resource-center-item,.resource-media-card{background:var(--bg-surface);border-color:var(--border-subtle)}
.resource-center-placeholder,.resource-media-card img,.resource-media-card>span{background:var(--bg-hover);color:var(--text-muted)}
.resource-center-item b{color:var(--text-regular)}
.resource-center-item small,.resource-media-card small{color:var(--text-muted)}
.resource-center-item-actions{display:flex;align-items:center;gap:2px;white-space:nowrap}.resource-center-item-actions .el-button{margin:0}.prop-asset-picker-grid{max-height:440px;overflow:auto;padding:2px}.prop-asset-picker-card{padding:0;cursor:pointer;text-align:left;font:inherit}.prop-asset-picker-card:hover{border-color:var(--el-color-primary)}
.resource-media-card{position:relative}.resource-media-delete{position:absolute!important;top:5px;right:5px;z-index:2;margin:0!important;min-width:24px!important;width:24px;height:24px;padding:0!important;background:#b84242!important;color:#fff!important;border-color:#f29a9a!important;font-weight:800}.resources-stage-active .resource-media-delete{display:grid!important;place-items:center}
.resource-center-item{position:relative}.resource-select{position:absolute;top:8px;left:8px;z-index:3;padding:2px;border-radius:4px;background:color-mix(in srgb,var(--bg-surface) 82%,transparent)}.resource-center-item.selected{box-shadow:inset 0 0 0 2px var(--accent),0 0 0 1px color-mix(in srgb,var(--accent) 36%,transparent)}.resource-media-card.selected{border:2px solid var(--accent)!important;box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 48%,transparent)}.resource-media-select{position:absolute;top:6px;left:6px;z-index:3;padding:2px;border-radius:4px;background:color-mix(in srgb,var(--bg-surface) 82%,transparent)}
.resource-center-grid,.resource-media-library{display:none}.resource-browser-tabs{display:flex;gap:8px;overflow:auto;padding-bottom:2px}.resource-browser-tabs button{display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:0 13px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-surface);color:var(--text-regular);font:inherit;cursor:pointer;white-space:nowrap}.resource-browser-tabs button:hover,.resource-browser-tabs button:focus-visible{border-color:var(--accent);outline:2px solid color-mix(in srgb,var(--accent) 32%,transparent);outline-offset:2px}.resource-browser-tabs button.active{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,var(--bg-surface));color:var(--accent)}.resource-browser-tabs span{display:grid;place-items:center;min-width:22px;height:22px;border-radius:99px;background:var(--bg-hover);color:var(--text-muted);font-size:12px}.resource-browser{display:flex;flex-direction:column;min-height:0;margin-top:14px;padding:14px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg-raised)}.resource-browser-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.resource-browser-search{flex:1 1 230px;max-width:340px}.resource-browser-filters{display:flex;gap:4px;padding:3px;border-radius:8px;background:var(--bg-hover)}.resource-browser-filters button{min-height:30px;padding:0 9px;border:0;border-radius:6px;background:transparent;color:var(--text-muted);font:inherit;font-size:13px;cursor:pointer}.resource-browser-filters button:hover,.resource-browser-filters button:focus-visible{color:var(--text-primary);outline:2px solid color-mix(in srgb,var(--accent) 34%,transparent);outline-offset:1px}.resource-browser-filters button.active{background:var(--bg-raised);color:var(--text-primary);box-shadow:var(--shadow-sm)}.resource-browser-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}.resource-browser-summary{margin:12px 0 10px;color:var(--text-muted);font-size:13px}.resource-browser-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:10px;min-height:0;overflow:auto;padding:2px}.resource-browser-card{position:relative;display:grid;grid-template-rows:112px auto auto;align-content:start;min-width:0;overflow:hidden;border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-surface)}.resource-browser-card.is-character{grid-template-rows:112px 1fr auto;min-height:216px;font-family:"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;font-weight:400}.resource-browser-card.selected{border-color:var(--accent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 50%,transparent)}.resource-browser-card>img,.resource-browser-placeholder{width:100%;height:112px;object-fit:cover;background:var(--bg-hover)}.resource-browser-placeholder{display:grid;place-items:center;color:var(--text-muted);font-size:13px}.resource-browser-select{position:absolute;top:8px;left:8px;z-index:1;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none}.resource-browser-select :deep(.el-checkbox__input){filter:none}.resource-browser-select :deep(.el-checkbox__inner){box-shadow:none}.resource-browser-card-copy{min-width:0;padding:10px 11px 7px}.resource-browser-card-copy b,.resource-browser-card-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.resource-browser-card-copy b{color:var(--text-primary);font-size:15px;font-weight:600;line-height:1.4}.resource-browser-card-copy small{margin-top:4px;color:var(--text-muted);font-size:13px;font-weight:400;line-height:1.5}.resource-sd2-status{display:block;max-width:100%;margin-top:5px;color:var(--accent);font-size:12px;font-weight:400;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.resource-browser-card-actions{display:flex;flex-wrap:wrap;align-content:flex-start;gap:4px;min-width:0;padding:0 6px 8px}.resource-browser-card-actions .el-button{min-height:26px;margin:0;padding-inline:5px}.resource-browser-card-actions.character-card-actions{justify-content:space-between;align-items:center;padding:4px 8px 9px}.character-card-actions .el-button{min-height:30px;padding-inline:7px;font-family:"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;font-size:13px;font-weight:400}.character-card-actions .character-card-delete{color:var(--el-color-danger)!important}.resource-browser-empty{display:grid;place-items:center;min-height:220px;text-align:center;color:var(--text-muted)}.resource-browser-empty b{color:var(--text-primary)}.resource-browser-empty p{margin:7px 0 0;font-size:14px}@media(max-width:900px){.resource-browser-toolbar{align-items:stretch}.resource-browser-search{max-width:none}.resource-browser-actions{margin-left:0}.resource-browser-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}}

.character-editor-asset-actions{display:grid;gap:12px;width:100%;padding:14px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-raised)}
.character-editor-asset-copy{display:grid;gap:4px}.character-editor-asset-copy b{color:var(--text-primary);font-size:14px;font-weight:600}.character-editor-asset-copy small{color:var(--text-muted);font-size:12px;line-height:1.5}.character-editor-asset-copy .character-editor-asset-status{color:var(--accent)}
.character-editor-asset-buttons{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.character-editor-asset-buttons .el-button{margin:0}
:global(.character-editor-dialog.el-dialog){display:flex;flex-direction:column;max-height:calc(100dvh - 32px);margin:16px auto!important;overflow:hidden}
:global(.character-editor-dialog .el-dialog__body){min-height:0;overflow-y:auto;overscroll-behavior:contain}
:global(.character-editor-dialog .el-dialog__footer){flex:0 0 auto}

.resource-browser-card.is-character,.character-card-actions .el-button{font-family:var(--font-sans);font-weight:500}
.resource-browser-card .resource-hosting-status{position:absolute;top:8px;right:8px;z-index:2;max-width:92px;padding:4px 8px;border:1px solid color-mix(in srgb,var(--border-color) 76%,transparent);border-radius:999px;background:color-mix(in srgb,var(--bg-page) 84%,transparent);box-shadow:0 2px 8px rgba(0,0,0,.18);color:var(--text-muted);font-size:11px;font-weight:500;line-height:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;backdrop-filter:blur(8px)}
.resource-hosting-status.is-active{border-color:color-mix(in srgb,#42c986 55%,transparent);color:#7de2ad}.resource-hosting-status.is-processing{border-color:color-mix(in srgb,var(--accent) 55%,transparent);color:#b7a6ff}.resource-hosting-status.is-error{border-color:color-mix(in srgb,var(--el-color-danger) 58%,transparent);color:#ff9c9c}
.character-card-actions .character-card-edit{border-color:color-mix(in srgb,var(--accent) 38%,var(--border-color));background:color-mix(in srgb,var(--accent) 13%,var(--bg-raised));color:var(--text-primary)}
.character-card-actions .character-card-edit:hover,.character-card-actions .character-card-edit:focus-visible{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 22%,var(--bg-raised));color:#fff}
.character-card-actions .character-card-delete{border-color:color-mix(in srgb,var(--el-color-danger) 52%,var(--border-color))!important;background:color-mix(in srgb,var(--el-color-danger) 12%,var(--bg-raised))!important;color:#ff8e8e!important}.character-card-actions .character-card-delete:hover,.character-card-actions .character-card-delete:focus-visible{border-color:var(--el-color-danger)!important;background:color-mix(in srgb,var(--el-color-danger) 22%,var(--bg-raised))!important;color:#ffd4d4!important}

.ref-image-box{position:relative}.ref-image-remove{position:absolute;top:6px;right:6px;display:grid;place-items:center;width:24px;height:24px;padding:0;border:1px solid rgba(255,255,255,.42);border-radius:999px;background:rgba(8,12,22,.78);color:#fff;font:600 17px/1 var(--font-sans);cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.28)}.ref-image-remove:hover,.ref-image-remove:focus-visible{background:var(--el-color-danger);outline:2px solid color-mix(in srgb,var(--el-color-danger) 45%,transparent);outline-offset:2px}
.ref-image-meta{display:flex;min-width:0;max-width:100%;flex:1 1 220px;flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:10px}.ref-image-meta .ref-upload-tip{margin:0;max-width:330px}
.character-field-stack{display:grid;width:100%;gap:8px}.character-field-help{display:block;color:var(--text-muted);font-size:12px;line-height:1.5}.character-field-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap}.character-field-actions .el-button{margin:0}
.character-inline-control{display:flex;width:100%;align-items:flex-end;justify-content:space-between;gap:12px}.character-inline-control .character-field-help{margin:0;padding-bottom:5px}.character-inline-control .character-field-actions{flex:0 0 auto;flex-wrap:nowrap}
.character-editor-footer{display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px}.character-editor-footer-main{display:flex;align-items:center;gap:10px}.character-editor-footer-main .el-button{margin:0}

.resource-batch-image-summary{display:grid;gap:5px;margin-bottom:18px;padding:14px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--bg-raised)}.resource-batch-image-summary b{color:var(--text-primary);font-size:15px}.resource-batch-image-summary span,.resource-batch-image-hint{color:var(--text-muted);font-size:12px;line-height:1.5}.resource-batch-image-quote{display:grid;gap:5px;min-height:72px;padding:14px;border:1px solid color-mix(in srgb,var(--accent) 38%,var(--border-color));border-radius:9px;background:color-mix(in srgb,var(--accent) 9%,var(--bg-raised));color:var(--text-regular)}.resource-batch-image-quote b{color:var(--text-primary);font-size:16px}.resource-batch-image-quote small{color:var(--text-muted);font-size:12px}.resource-batch-image-quote.error{border-color:color-mix(in srgb,var(--el-color-danger) 48%,var(--border-color));color:#ff9c9c}
:global(.resource-batch-image-dialog.el-dialog){max-height:calc(100dvh - 32px);margin:16px auto!important;overflow:hidden}
.workflow-next-action{border-color:var(--border-color);background:var(--bg-raised);color:var(--text-regular)}
.merge-readiness,.merge-readiness.ready{border-color:var(--border-color);background:var(--bg-hover);color:var(--text-regular)}

/* 项目主工作流与 AI 工具箱采用同一套深色单色基线，旧页面不再混入浅色卡片。 */
/* Desktop studio pass: make the production flow read as one directed creative surface. */
@media(min-width:961px){
  .film-create{background:var(--bg-page);background-image:radial-gradient(56% 46% at 18% -8%,color-mix(in srgb,var(--accent) 19%,transparent),transparent 72%),radial-gradient(32% 36% at 95% 15%,color-mix(in srgb,var(--accent-teal) 10%,transparent),transparent 70%),linear-gradient(180deg,color-mix(in srgb,var(--bg-page) 84%,#05070c),var(--bg-page) 42%)}

  .header{padding:12px 26px;background:color-mix(in srgb,var(--bg-surface) 88%,transparent)!important;border-bottom-color:var(--border-subtle)!important;box-shadow:var(--shadow-sm)!important}.header-inner{gap:12px;min-width:0}.logo{flex:0 0 165px;flex-direction:row;align-items:center;gap:8px;min-width:0}.richi-brand-copy{display:grid;min-width:0}.logo-main{overflow:visible;background:none;color:var(--text-primary);font-size:.88rem;line-height:1.15;white-space:nowrap;-webkit-text-fill-color:var(--text-primary)}.logo-sub{color:var(--text-muted);font-size:.62rem;letter-spacing:0;-webkit-text-fill-color:var(--text-muted)}.page-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-color:var(--border-subtle);border-radius:9px;background:color-mix(in srgb,var(--bg-raised) 80%,transparent);color:var(--text-regular)}
  .main{max-width:1680px;padding:34px 38px 64px}.workflow-shell{position:relative;overflow:hidden;margin-bottom:22px;padding:30px 32px;border-color:color-mix(in srgb,var(--accent) 36%,var(--border-color))!important;border-radius:20px;background:radial-gradient(circle at 92% 12%,color-mix(in srgb,var(--accent-teal) 19%,transparent),transparent 24%),linear-gradient(138deg,color-mix(in srgb,var(--accent) 13%,var(--bg-surface)),var(--bg-surface) 55%,color-mix(in srgb,var(--accent-teal) 7%,var(--bg-surface)))!important;box-shadow:var(--shadow-md)!important}.workflow-shell::after{content:'';position:absolute;right:-88px;bottom:-164px;width:390px;height:390px;border:1px solid color-mix(in srgb,var(--accent) 36%,transparent);border-radius:50%;box-shadow:0 0 0 38px color-mix(in srgb,var(--accent) 5%,transparent),0 0 0 78px color-mix(in srgb,var(--accent) 3%,transparent);pointer-events:none}.workflow-shell>*{position:relative;z-index:1}.workflow-kicker{color:var(--accent);font-size:10px;letter-spacing:.16em}.workflow-head h2{font-size:28px;letter-spacing:-.035em}.workflow-head p{max-width:58ch}.workflow-episode{border:1px solid color-mix(in srgb,var(--accent) 34%,var(--border-color));background:color-mix(in srgb,var(--bg-surface) 74%,transparent);color:var(--text-primary)}
  .workflow-steps{gap:10px;margin-top:27px}.workflow-step{min-height:54px;border-color:var(--border-subtle);border-radius:12px;background:color-mix(in srgb,var(--bg-page) 30%,transparent);font-weight:650;transition:transform .18s ease,border-color .18s ease,background .18s ease}.workflow-step:hover{transform:translateY(-2px);border-color:var(--border-strong);background:color-mix(in srgb,var(--bg-raised) 90%,transparent)}.workflow-step.active{border-color:transparent;background:linear-gradient(135deg,var(--accent),#6f61df);box-shadow:0 12px 26px color-mix(in srgb,var(--accent) 26%,transparent)}
  .section.card{position:relative;overflow:hidden;padding:28px 30px;border-color:var(--border-subtle);border-radius:18px;background:color-mix(in srgb,var(--bg-surface) 94%,transparent);box-shadow:var(--shadow-sm)}.section.card:hover{transform:none;border-color:color-mix(in srgb,var(--accent) 38%,var(--border-color));box-shadow:var(--shadow-md)}.script-workbench-unified::before{content:none}.section-title{color:var(--text-primary)!important;font-size:1.15rem!important;letter-spacing:-.02em}.section-desc{color:var(--text-muted)!important}.story-textarea :deep(.el-textarea__inner){background:color-mix(in srgb,var(--bg-page) 35%,transparent)!important;border-color:var(--border-subtle)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}.story-textarea :deep(.el-textarea__inner:focus){box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 68%,transparent)!important}.workflow-next-action{border-color:color-mix(in srgb,var(--accent) 30%,var(--border-color));border-radius:13px;background:color-mix(in srgb,var(--accent) 7%,var(--bg-raised));box-shadow:var(--shadow-sm)}

}

/* The production studio owns the viewport; only its active canvas scrolls. */
.film-create { height:100vh; height:100dvh; min-height:0; overflow:hidden; }
.film-create > .header { position:relative; height:3.75rem; box-sizing:border-box; }
.film-create > .main { height:calc(100vh - 3.75rem); height:calc(100dvh - 3.75rem); box-sizing:border-box; padding-bottom:2rem; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; }
@media(min-width:961px){
  .script-stage-active>.main{display:grid;grid-template-rows:auto minmax(0,1fr) auto auto;gap:14px;overflow:hidden;padding-top:18px;padding-bottom:18px}
  .script-stage-active .workflow-shell{margin:0;padding:15px 22px;border-radius:16px}
  .script-stage-active .workflow-head{align-items:center}.script-stage-active .workflow-head h2{margin-block:2px;font-size:22px}.script-stage-active .workflow-head p{font-size:12px}
  .script-stage-active .workflow-steps{margin-top:12px}.script-stage-active .workflow-step{min-height:38px}
  .script-stage-active .script-workbench-unified{min-height:0;padding:17px 22px;overflow:hidden}
  .script-stage-active .script-workbench-unified::before{margin-bottom:8px}
  .script-stage-active .script-workbench-tabs{height:calc(100% - 18px);min-height:0}
  .script-stage-active .script-workbench-tabs:deep(.el-tabs__content),.script-stage-active .script-workbench-tabs:deep(.el-tab-pane){height:calc(100% - 28px);min-height:0}
  .script-stage-active .script-pane-inner{display:grid;grid-template-columns:minmax(18rem,.72fr) minmax(0,1.55fr);gap:24px;height:100%;min-height:0;overflow:hidden}
  .script-stage-active .script-sub-block{min-width:0;min-height:0;overflow:auto;padding-right:5px;scrollbar-width:thin}
  .script-stage-active .script-sub-divider{width:1px;height:100%;margin:0;background:var(--border-subtle)}
  .script-stage-active .script-pane-inner{grid-template-columns:minmax(18rem,.72fr) 1px minmax(0,1.55fr)}
  .script-stage-active .script-sub-block .section-title{margin-top:0}
  .script-stage-active #anchor-script{display:flex;flex-direction:column}
  .script-stage-active #anchor-script>.story-textarea{flex:1;min-height:0}
  .script-stage-active #anchor-script>.story-textarea:deep(.el-textarea__inner){height:100%!important;min-height:10rem!important;resize:none}
  .script-stage-active .workflow-next-action{margin:0}
  .resources-stage-active>.main{display:block;overflow-y:auto;padding-top:18px;padding-bottom:18px}
  .resources-stage-active .workflow-shell{margin:0;padding:15px 22px;border-radius:16px}
  .resources-stage-active .workflow-head{align-items:center}.resources-stage-active .workflow-head h2{margin-block:2px;font-size:22px}.resources-stage-active .workflow-head p{font-size:12px}
  .resources-stage-active .workflow-steps{margin-top:12px}.resources-stage-active .workflow-step{min-height:38px}
  .resources-stage-active .resource-center{display:block;min-height:0;padding:18px 22px;overflow:visible}
  .resources-stage-active .resource-browser{margin-top:14px;overflow:visible}
  .resources-stage-active .resource-browser-grid{min-height:15rem;max-height:min(52dvh,34rem);overflow:auto}
  .resources-stage-active .resource-center-heading{margin:0}.resources-stage-active .resource-center-heading .section-title{margin-top:0}.resources-stage-active .resource-center-heading .section-desc{margin-bottom:0}
  .resources-stage-active .resource-center-grid{min-height:0}.resources-stage-active .resource-center-group{display:flex;flex-direction:column;min-height:0;overflow:hidden}
  .resources-stage-active .resource-center-list{flex:1;min-height:0;max-height:none;overflow:auto;scrollbar-width:thin}
  .resources-stage-active .resource-media-library{min-height:0;margin:0;padding:10px 12px;overflow:hidden}
  .resources-stage-active .resource-media-library>header{margin-bottom:7px}
  .resources-stage-active .resource-media-grid{display:flex;gap:9px;max-height:calc(14rem - 3.1rem);overflow-x:auto;overflow-y:auto;scrollbar-width:thin}
  .resources-stage-active .resource-media-card{flex:0 0 9.5rem;min-height:9.75rem}.resources-stage-active .resource-media-card img,.resources-stage-active .resource-media-card>span{height:72px}.resources-stage-active .resource-media-card small{padding-block:4px}
  .resources-stage-active .workflow-next-action{margin:0}
  .merge-stage-active>.main{display:grid;grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr);grid-template-rows:auto minmax(0,1fr);gap:16px;overflow:hidden;padding-top:18px;padding-bottom:18px}
  .merge-stage-active .workflow-shell{grid-column:1/-1;margin:0;padding:15px 22px;border-radius:16px}
  .merge-stage-active .workflow-head{align-items:center}.merge-stage-active .workflow-head h2{margin-block:2px;font-size:22px}.merge-stage-active .workflow-head p{font-size:12px}
  .merge-stage-active .workflow-steps{margin-top:12px}.merge-stage-active .workflow-step{min-height:38px}
  .merge-stage-active .main>:is(.merge-settings,.merge-output){display:flex;flex-direction:column;min-height:0;margin:0;padding:24px 26px}
  .merge-stage-active .main>:is(.merge-settings,.merge-output)>h2{font-size:1.45rem!important}
  .merge-stage-active #anchor-video{background:radial-gradient(circle at 88% 12%,color-mix(in srgb,var(--accent) 15%,transparent),transparent 28%),color-mix(in srgb,var(--bg-surface) 94%,transparent)}
  .merge-format-preview{display:grid;grid-template-columns:minmax(9rem,.8fr) 1fr;gap:1.4rem;align-items:center;flex:1;min-height:0;margin-top:1rem;padding-top:1.2rem;border-top:1px solid var(--border-subtle)}
  .merge-format-frame{display:grid;place-items:center;align-content:center;aspect-ratio:9/16;max-height:20rem;border:1px solid color-mix(in srgb,var(--accent) 52%,var(--border-color));border-radius:14px;background:radial-gradient(circle at 50% 32%,color-mix(in srgb,var(--accent) 28%,transparent),transparent 34%),linear-gradient(155deg,var(--bg-raised),var(--bg-page));box-shadow:inset 0 0 0 8px color-mix(in srgb,var(--bg-page) 55%,transparent)}
  .merge-format-frame.landscape{aspect-ratio:16/9;max-height:none}.merge-format-frame.square{aspect-ratio:1}
  .merge-format-frame span{color:var(--text-faint);font:700 .7rem/1 ui-monospace,monospace}.merge-format-frame b{margin-top:.65rem;font-size:1.6rem}
  .merge-format-preview dl{display:grid;gap:.8rem;margin:0}.merge-format-preview dl div{display:flex;justify-content:space-between;padding-bottom:.7rem;border-bottom:1px solid var(--border-subtle)}.merge-format-preview dt{color:var(--text-muted)}.merge-format-preview dd{margin:0;font-weight:700}
  .merge-shot-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(4.2rem,1fr));gap:8px;margin:1rem 0;overflow:auto;scrollbar-width:thin}
  .merge-shot-grid button{display:grid;gap:.5rem;min-height:4rem;padding:.65rem;border:1px solid var(--border-subtle);border-radius:9px;background:var(--bg-page);color:var(--text-faint);text-align:left}.merge-shot-grid button:hover{border-color:var(--accent)}.merge-shot-grid button span{font:700 .66rem/1 ui-monospace,monospace}.merge-shot-grid button i{height:4px;border-radius:99px;background:var(--status-danger)}.merge-shot-grid button.ready i{background:var(--accent-teal)}
  .script-stage-active .script-workbench-unified,.resources-stage-active .resource-center,.merge-stage-active .main>:is(.merge-settings,.merge-output){animation:stage-reveal var(--motion-standard) var(--motion-spring) both}
}
@keyframes stage-reveal{from{opacity:0;transform:translateY(7px) scale(.997)}to{opacity:1;transform:none}}
@media(max-width:960px){.film-create>.header{overflow-x:auto;scrollbar-width:thin}.header-inner{width:max-content}.logo{flex-shrink:0;flex-direction:row;align-items:center;gap:8px}.logo-main,.logo-sub{white-space:nowrap}.film-create>.main{height:calc(100vh - 3.75rem);height:calc(100dvh - 3.75rem);overflow-y:auto}.film-create>.header{position:relative}}
@media(prefers-reduced-motion:reduce){.script-stage-active .script-workbench-unified,.resources-stage-active .resource-center,.merge-stage-active .main>:is(.merge-settings,.merge-output){animation:none!important}}
/* A restrained sense of motion keeps the production flow visually alive without competing with the editor. */
@media(min-width:961px) and (prefers-reduced-motion:no-preference){
  .workflow-shell::after{animation:workflow-orbit 15s var(--motion-ease) infinite alternate}
  .workflow-shell::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 24% 116%,color-mix(in srgb,var(--accent-teal) 12%,transparent),transparent 23%);opacity:.8;transform:translate3d(0,0,0)}
  .workflow-step.active{animation:workflow-current 2.8s var(--motion-ease) infinite}
}
@keyframes workflow-orbit{to{transform:translate3d(-1.5rem,-1rem,0) rotate(8deg)}}
@keyframes workflow-current{50%{transform:translateY(-.12rem);box-shadow:0 .9rem 2rem color-mix(in srgb,var(--accent) 32%,transparent)}}
@media(prefers-reduced-motion:reduce){.workflow-shell::after,.workflow-step.active{animation:none!important}}
/* 左侧导航栏已移除，工作区占满整个视口宽度。 */
@media(min-width:961px){
  .film-create>.main{width:100%;max-width:none;min-width:0;padding-inline:clamp(.75rem,2vw,2rem)}
  .storyboard-stage-active .main{max-width:none;padding-inline:clamp(.5rem,1.5vw,1.5rem)}
}
/* 生产工作流布局修复：状态变化不能移动导航，长文本必须获得稳定编辑空间。 */
@media(min-width:961px){
  .workflow-step:hover,.workflow-step.active{transform:none!important}
  .workflow-step.active{animation:none!important}
  .script-stage-active .script-pane-inner{grid-template-columns:minmax(20rem,.9fr) 1px minmax(0,1.3fr)}
  .script-stage-active .script-sub-block{overflow:hidden;padding-right:0}
  .script-stage-active .script-story-block,.script-stage-active .script-content-block{display:flex;flex-direction:column}
  .script-stage-active .script-story-block>.story-textarea,.script-stage-active .script-content-block>.story-textarea{flex:1 1 auto;min-height:0}
  .script-stage-active .script-story-block>.story-textarea:deep(.el-textarea__inner),.script-stage-active .script-content-block>.story-textarea:deep(.el-textarea__inner){height:100%!important;min-height:8rem!important;resize:none}
  .merge-stage-active .config-grid{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}
  .merge-stage-active .config-grid>.el-form-item{min-width:0;align-items:flex-start}
  .merge-stage-active .video-option-row{display:grid;grid-template-columns:auto minmax(0,1fr);width:100%;min-width:0}
  .merge-stage-active .video-option-hint,.merge-stage-active .video-watermark-input{grid-column:1 / -1;width:100%;min-width:0;max-width:none}
  .merge-stage-active .merge-format-preview{flex:0 0 auto;align-items:start}
  .merge-stage-active .main>:is(.merge-settings,.merge-output){overflow-y:auto;overscroll-behavior-y:contain;scrollbar-width:thin}
}
@media(min-width:961px) and (max-width:1500px){.merge-stage-active .config-grid{grid-template-columns:minmax(0,1fr)}}
@media(min-width:961px) and (max-height:1100px){
  .script-stage-active>.main{display:block;overflow-y:auto}
  .script-stage-active .workflow-shell,.script-stage-active .script-workbench-unified,.script-stage-active .workflow-next-action{margin-bottom:14px}
  .script-stage-active .script-workbench-unified{min-height:30rem;overflow:visible}
  .script-stage-active .script-workbench-tabs{height:auto;min-height:26rem}
  .script-stage-active .script-workbench-tabs:deep(.el-tabs__content),.script-stage-active .script-workbench-tabs:deep(.el-tab-pane){height:auto;min-height:23rem}
  .script-stage-active .script-pane-inner{height:auto;min-height:20rem;overflow:visible}
  .script-stage-active .script-sub-block{min-height:20rem;overflow:visible}
}
.storyboard-stage-active .main{padding-top:8px;padding-bottom:2px}
.storyboard-stage-active .workflow-shell{margin-bottom:6px}
.storyboard-stage-active .workflow-next-action{margin-top:6px;margin-bottom:0;padding-block:7px}
</style>
