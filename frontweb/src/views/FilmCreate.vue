<template>
  <div class="film-create" :class="{ 'sidebar-collapsed': navCollapsed, 'script-stage-active': workflowStage === 'script', 'resources-stage-active': workflowStage === 'resources', 'storyboard-stage-active': workflowStage === 'storyboard', 'merge-stage-active': workflowStage === 'merge' }">
    <!-- 全能素材上传：上传素材 / 首尾帧参考图（共享隐藏 input） -->
    <input ref="sbOmniFileInput" hidden type="file" multiple accept="image/*,video/*,audio/*" @change="onSbOmniFileInputChange" />
    <input ref="sbOmniFrameFileInput" hidden type="file" accept="image/*" @change="onSbOmniFrameFileInputChange" />
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
          v-if="dramaId"
          v-model="selectedEpisodeId"
          class="header-episode-select"
          placeholder="选择集数"
          clearable
          size="small"
          style="width: 130px"
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
    <nav class="quick-nav" :class="{ collapsed: navCollapsed }" aria-label="快捷导航">
      <div class="nav-sidebar-header">
        <span v-if="!navCollapsed" class="nav-sidebar-title">导航</span>
        <div class="nav-toggle" :title="navCollapsed ? '展开导航' : '收起导航'" @click="toggleNav()">
          <el-icon><Expand v-if="navCollapsed" /><Fold v-else /></el-icon>
        </div>
      </div>

      <!-- 步骤列表 -->
      <div class="nav-steps">
        <div
          v-for="(step, idx) in navSteps"
          :key="step.key"
          class="nav-step"
          :class="['status-' + step.status]"
          @click="navigateWorkflowStep(step.key)"
        >
          <!-- 左侧连接线 -->
          <div class="step-connector-wrap">
            <div v-if="idx > 0" class="step-line step-line-top" :class="{ filled: navSteps[idx - 1].status === 'done' }" />
            <div
              class="step-dot"
              :class="['dot-' + step.status]"
            >
              <el-icon v-if="step.status === 'done'" class="dot-icon"><Check /></el-icon>
              <el-icon v-else-if="step.status === 'generating'" class="dot-icon spin"><Loading /></el-icon>
              <span v-else class="dot-num">{{ idx + 1 }}</span>
            </div>
            <div v-if="idx < navSteps.length - 1" class="step-line step-line-bottom" :class="{ filled: step.status === 'done' }" />
          </div>

          <!-- 右侧文字 + 状态徽章 -->
          <div class="step-body">
            <span class="step-label">{{ step.label }}</span>
            <span v-if="step.count > 0 && step.status !== 'done'" class="step-count">{{ step.count }}</span>
            <span v-if="step.status === 'partial'" class="step-badge partial-badge" title="部分完成">
              <el-icon><WarningFilled /></el-icon>
            </span>
            <span v-else-if="step.status === 'generating'" class="step-badge gen-badge" title="生成中">
              <el-icon class="spin"><Loading /></el-icon>
            </span>
          </div>
        </div>
      </div>

      <!-- 分镜子列表 -->
      <div v-if="!navCollapsed && storyboards.length > 0" class="nav-group">
        <div class="nav-sub-toggle" @click="storyboardMenuExpanded = !storyboardMenuExpanded">
          <el-icon><Minus v-if="storyboardMenuExpanded" /><Plus v-else /></el-icon>
          <span>分镜列表</span>
        </div>
        <div v-show="storyboardMenuExpanded" class="nav-sub-list">
          <template v-for="(sb, i) in storyboards" :key="sb.id">
            <!-- 段落标题行 -->
            <div
              v-if="sb.segment_title && (i === 0 || sb.segment_index !== storyboards[i - 1].segment_index)"
              class="nav-segment-label"
            >
              <span class="nav-segment-dot" />
              {{ sb.segment_title }}
            </div>
            <div
              class="nav-sub-item"
              :class="{ 'sb-nav-dragging': navDragSbId === sb.id, 'sb-nav-over': navDragOverSbId === sb.id }"
              :title="sb.title || '分镜 ' + (i + 1)"
              draggable="true"
              @dragstart="onSbNavDragStart(sb)"
              @dragend="onSbNavDragEnd"
              @dragover.prevent="onSbNavDragOver(sb)"
              @dragleave="navDragOverSbId = null"
              @drop.prevent="onSbNavDrop(sb)"
              @click="scrollToAnchor('sb-' + sb.id)"
            >
              <span class="nav-sb-title">{{ i + 1 }}. {{ sb.title || '分镜' }}</span>
              <span class="nav-sb-move">
                <el-button text size="small" :disabled="i === 0" @click.stop="moveSbOrder(sb, -1)">↑</el-button>
                <el-button text size="small" :disabled="i === storyboards.length - 1" @click.stop="moveSbOrder(sb, 1)">↓</el-button>
              </span>
            </div>
          </template>
        </div>
      </div>

      <!-- 当前任务面板 -->
      <div v-if="allActiveTaskItems.length > 0" class="atp-panel">
        <!-- 折叠态：只显示旋转点和数量 -->
        <div v-if="navCollapsed" class="atp-collapsed-badge" :title="allActiveTaskLabels.join('\n')">
          <span class="atp-spin-dot" />
          <span class="atp-collapsed-count">{{ allActiveTaskItems.length }}</span>
        </div>
        <!-- 展开态：标题 + 任务列表 -->
        <template v-else>
          <div class="atp-header">
            <span class="atp-spin-dot" />
            <span class="atp-title">进行中</span>
            <span class="atp-count-badge">{{ allActiveTaskItems.length }}</span>
          </div>
          <div class="atp-list">
            <div
              v-for="item in allActiveTaskItems.slice(0, 8)"
              :key="item.id"
              class="atp-item"
            >
              <span class="atp-item-dot" />
              <el-tooltip :content="item.label" placement="right" :show-after="300" :enterable="false">
                <span class="atp-item-label">{{ item.label }}</span>
              </el-tooltip>
              <button
                type="button"
                class="atp-item-close"
                title="取消任务"
                aria-label="取消任务"
                @click.stop="cancelActiveTask(item)"
              >
                <el-icon :size="12"><Close /></el-icon>
              </button>
            </div>
            <el-tooltip
              v-if="allActiveTaskItems.length > 8"
              :content="allActiveTaskItems.slice(8).map((t) => t.label).join('\n')"
              placement="right"
              :show-after="200"
            >
              <div class="atp-more">
                还有 {{ allActiveTaskItems.length - 8 }} 个任务...
              </div>
            </el-tooltip>
          </div>
        </template>
      </div>
    </nav>

    <main class="main">
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
      <!-- 分镜图上传图片用，单例放在外层避免 v-for 导致 ref 为数组 -->
      <input
        ref="sbImageFileInput"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style="display: none"
        @change="onSbImageFileChange"
      />
      <!-- 剧本工作台：单卡片 + 选项卡（创作 / 选择） -->
      <section v-show="workflowStage === 'script'" class="section card script-workbench-unified">
        <el-tabs v-model="scriptWorkbenchMode" class="script-workbench-tabs">
          <el-tab-pane label="创作剧本" name="create">
            <div class="script-pane-inner">
              <div class="script-sub-block">
                <h2 class="section-title">故事生成</h2>
                <p class="section-desc">输入一段故事梗概，AI 帮你扩写成完整剧本，或直接导入小说章节</p>
                <el-input
                  v-model="storyInput"
                  type="textarea"
                  :rows="4"
                  placeholder="例如：一个少女在森林里遇见会说话的狐狸，一起寻找失落的宝石..."
                  class="story-textarea"
                />
                <div class="row gap" style="margin-top: 10px; flex-wrap: wrap;">
                  <el-select v-model="storyStyle" placeholder="故事风格" clearable style="width: 120px" @change="() => saveProjectSettings(false)">
                    <el-option label="现代" value="modern" />
                    <el-option label="古风" value="ancient" />
                    <el-option label="奇幻" value="fantasy" />
                    <el-option label="日常" value="daily" />
                  </el-select>
                  <el-select v-model="storyType" placeholder="剧本类型" clearable style="width: 120px" @change="() => saveProjectSettings(false)">
                    <el-option label="剧情" value="drama" />
                    <el-option label="喜剧" value="comedy" />
                    <el-option label="冒险" value="adventure" />
                  </el-select>
                  <div style="display:flex;align-items:center;gap:6px;font-size:13px">
                    <span>集数</span>
                    <el-input-number
                      v-model="storyEpisodeCount"
                      :min="1"
                      :step="1"
                      :precision="0"
                      controls-position="right"
                      style="width: 100px"
                    />
                  </div>
                  <el-button type="primary" :loading="isStoryGenRunning" @click="onGenerateStory">
                    生成剧本
                  </el-button>
                  <el-button plain @click="showNovelImport = true">
                    <el-icon><DocumentAdd /></el-icon>
                    导入小说
                  </el-button>
                </div>
              </div>
              <div class="script-sub-divider" />
              <div id="anchor-script" class="script-sub-block">
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
                  <el-input v-model="scriptTitle" placeholder="集标题" style="width: 150px" />
                  <el-button v-if="dramaId" style="margin-left: auto" @click="onAddEpisode">
                    <el-icon><Plus /></el-icon>添加一集
                  </el-button>
                </div>
                <el-input
                  v-model="scriptContent"
                  type="textarea"
                  :rows="8"
                  placeholder="剧本内容将显示在这里，可直接编辑..."
                  class="story-textarea"
                />
                <div class="row gap" style="margin-top: 8px; flex-wrap: wrap;">
                  <el-button
                    :loading="scriptGenerating"
                    :disabled="!!dramaId && (store.drama?.episodes?.length > 0) && !currentEpisodeId"
                    @click="onGenerateScript"
                  >
                    保存当前集
                  </el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>
          <el-tab-pane label="选择剧本" name="select">
            <p class="section-desc script-mode-hint">
              从剧本库选择后，仅把「故事梗概」与「各集剧本正文」写入当前工程，不会导入角色、分镜、图片或视频。
            </p>
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

      <!-- 一键全流程生成 -->
      <section v-if="workflowStage === 'script' && showLegacyPipeline" class="section card pipeline-section">
        <div class="one-click-actions">
          <span class="one-click-label">🚀 一键全流程</span>
          <el-select v-if="false" v-model="projectAspectRatio" style="width: 130px" @change="() => saveProjectSettings(false)">
            <el-option label="16:9 横屏" value="16:9" />
            <el-option label="9:16 竖屏" value="9:16" />
            <el-option label="3:4 竖版" value="3:4" />
            <el-option label="1:1 方形" value="1:1" />
            <el-option label="4:3" value="4:3" />
            <el-option label="3:2" value="3:2" />
            <el-option label="2:3" value="2:3" />
            <el-option label="21:9 宽银幕" value="21:9" />
          </el-select>
          <el-select v-if="false" v-model="videoClipDuration" style="width: 105px" @change="() => saveProjectSettings(false)">
            <el-option label="4秒/段" :value="4" />
            <el-option label="5秒/段" :value="5" />
            <el-option label="8秒/段" :value="8" />
            <el-option label="10秒/段" :value="10" />
            <el-option label="12秒/段" :value="12" />
            <el-option label="15秒/段" :value="15" />
          </el-select>
          <GenerationSettings :model-value="projectGenerationSettings" :max-duration="15" @update:model-value="setProjectGenerationSettings" />
          <el-button size="small" plain @click="applyProjectGenerationSettingsToStoryboards">应用到全部分镜</el-button>
          <el-select v-model="scriptLanguage" placeholder="分镜语言" clearable style="width: 105px">
            <el-option label="中文" value="zh" />
            <el-option label="英文" value="en" />
          </el-select>
          <StylePickerButton
            v-model="generationStyle"
            :options="generationStyleOptions"
            @change="() => saveProjectSettings(true)"
          />
          <el-button
            type="primary"
            :loading="pipelineRunning && !pipelinePaused"
            :disabled="!currentEpisodeId || pipelineRunning"
            @click="startOneClickPipeline"
          >
            一键成片带图片视频
          </el-button>
          <el-button
            :loading="pipelineRunning && !pipelinePaused"
            :disabled="!currentEpisodeId || pipelineRunning"
            title="仅提取角色、场景、道具与生成分镜文本，不生成图片与视频"
            @click="startTextFrameworkPipeline"
          >
            生成文本框架
          </el-button>
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
            <p class="section-desc">先准备角色、场景、道具和上传媒体；分镜阶段只从这里选择并引用，不再重复建库。</p>
          </div>
          <el-button type="primary" plain :loading="resourceMediaUploading" @click="openResourceMediaUpload"><el-icon><Upload /></el-icon>上传媒体素材</el-button>
        </div>
        <div class="resource-center-grid">
          <article class="resource-center-group">
            <header><b>角色</b><span>{{ characters.length }}</span></header>
            <div class="resource-center-actions"><el-button size="small" :loading="charactersGenerating" :disabled="!dramaId" @click="onGenerateCharacters">从剧本提取</el-button><el-button size="small" @click="openAddCharacter">添加角色</el-button><el-button v-if="characters.length" size="small" type="primary" plain :loading="resourceBatchGenerating === 'character'" @click="onGenerateMissingResourceImages('character')">生成缺图</el-button></div>
            <div v-if="characters.length" class="resource-center-list"><div v-for="char in characters" :key="char.id" class="resource-center-item"><img v-if="hasAssetImage(char)" :src="assetImageUrl(char)" alt="" /><span v-else class="resource-center-placeholder">角色</span><div><b>{{ char.name }}</b><small>{{ char.appearance || char.description || '待补充描述' }}</small></div><div class="resource-center-item-actions"><el-button size="small" text @click="editCharacter(char)">编辑</el-button><el-button size="small" text @click="openResourceAssetPicker('character', char)">素材库</el-button><el-button size="small" text :loading="uploadingResourceId === `char-${char.id}`" @click="onUploadResourceClick('character', char.id)">上传图</el-button><el-button size="small" type="primary" text :loading="generatingCharIds.has(char.id)" @click="onGenerateCharacterImage(char)">生成图</el-button><el-button size="small" type="danger" text @click="onDeleteCharacter(char)">删除</el-button></div></div></div>
            <p v-else class="resource-center-empty">从剧本提取角色，或手动添加。</p>
          </article>
          <article class="resource-center-group">
            <header><b>场景</b><span>{{ scenes.length }}</span></header>
            <div class="resource-center-actions"><el-button size="small" :loading="scenesExtracting" :disabled="!currentEpisodeId" @click="onExtractScenes">从剧本提取</el-button><el-button size="small" @click="openAddScene">添加场景</el-button><el-button v-if="scenes.length" size="small" type="primary" plain :loading="resourceBatchGenerating === 'scene'" @click="onGenerateMissingResourceImages('scene')">生成缺图</el-button></div>
            <div v-if="scenes.length" class="resource-center-list"><div v-for="scene in scenes" :key="scene.id" class="resource-center-item"><img v-if="hasAssetImage(scene)" :src="assetImageUrl(scene)" alt="" /><span v-else class="resource-center-placeholder">场景</span><div><b>{{ scene.location }}</b><small>{{ scene.description || scene.prompt || '待补充描述' }}</small></div><div class="resource-center-item-actions"><el-button size="small" text @click="editScene(scene)">编辑</el-button><el-button size="small" text @click="openResourceAssetPicker('scene', scene)">素材库</el-button><el-button size="small" text :loading="uploadingResourceId === `scene-${scene.id}`" @click="onUploadResourceClick('scene', scene.id)">上传图</el-button><el-button size="small" type="primary" text :loading="generatingSceneIds.has(scene.id)" @click="onGenerateSceneImage(scene, sceneUseQuadGrid)">生成图</el-button><el-button size="small" type="danger" text @click="onDeleteScene(scene)">删除</el-button></div></div></div>
            <p v-else class="resource-center-empty">从当前剧本提取场景。</p>
          </article>
          <article class="resource-center-group">
            <header><b>道具</b><span>{{ props.length }}</span></header>
            <div class="resource-center-actions"><el-button size="small" :loading="propsExtracting" :disabled="!currentEpisodeId" @click="onExtractProps">从剧本提取</el-button><el-button size="small" @click="showAddProp = true">添加道具</el-button><el-button v-if="props.length" size="small" type="primary" plain :loading="resourceBatchGenerating === 'prop'" @click="onGenerateMissingResourceImages('prop')">生成缺图</el-button></div>
            <div v-if="props.length" class="resource-center-list"><div v-for="prop in props" :key="prop.id" class="resource-center-item"><img v-if="hasAssetImage(prop)" :src="assetImageUrl(prop)" alt="" /><span v-else class="resource-center-placeholder">道具</span><div><b>{{ prop.name }}</b><small>{{ prop.description || prop.prompt || '待补充描述' }}</small></div><div class="resource-center-item-actions"><el-button size="small" text @click="editProp(prop)">编辑</el-button><el-button size="small" text @click="openResourceAssetPicker('prop', prop)">素材库</el-button><el-button size="small" text :loading="uploadingResourceId === `prop-${prop.id}`" @click="onUploadResourceClick('prop', prop.id)">上传图</el-button><el-button size="small" type="primary" text :loading="generatingPropIds.has(prop.id)" @click="onGeneratePropImage(prop, propUseQuadGrid)">生成图</el-button><el-button size="small" type="danger" text @click="onDeleteProp(prop)">删除</el-button></div></div></div>
            <p v-else class="resource-center-empty">从当前剧本提取道具。</p>
          </article>
        </div>
        <div class="resource-media-library">
          <header><div><b>媒体素材库</b><small>上传的图片、视频、音频会在分镜引用区统一可用。</small></div><div class="resource-media-header-actions"><el-button size="small" @click="router.push('/media-library')">管理媒体库</el-button><span>{{ universalLibraryAssets.length }} 项</span></div></header>
          <div v-if="universalLibraryAssets.length" class="resource-media-grid"><article v-for="asset in universalLibraryAssets" :key="asset.id" class="resource-media-card"><img v-if="asset.type === 'image'" :src="sbOmniAssetUrl(asset)" alt="" /><span v-else>{{ asset.type === 'audio' ? '音频' : '视频' }}</span><small>{{ asset.name || `素材 ${asset.id}` }}</small><small>{{ asset.library_scope === 'global' ? '我的全局素材' : '当前项目素材' }}</small><div class="resource-media-card-actions"><el-button size="small" text @click="renameResourceMedia(asset)">重命名</el-button><el-button size="small" type="danger" text @click="deleteResourceMedia(asset)">{{ asset.source_type === 'project_resource' ? '解除素材' : '删除' }}</el-button></div><small v-if="asset.source_type === 'project_resource'">关联资源：解除后不会被自动重建</small></article></div>
          <div v-if="detachedResourceLinks.length" class="resource-media-grid"><article v-for="link in detachedResourceLinks" :key="`detached-${link.id}`" class="resource-media-card"><span>已解除</span><small>{{ link.asset_name || `${link.resource_type} #${link.resource_id}` }}</small><small>历史分镜引用仍保留</small><el-button size="small" type="primary" text @click="restoreResourceMedia(link)">恢复关联</el-button></article></div>
          <p v-else class="resource-center-empty">还没有上传媒体素材。</p>
        </div>
      </section>

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

      <FreeCreate v-if="workflowStage === 'storyboard' && currentEpisodeId" :project-episode-id="currentEpisodeId" :project-drama-id="dramaId" embedded @reordered="loadDrama" @changed="loadDrama" />

      <div v-if="false" class="storyboard-workspace">
      <section class="section card resource-panel storyboard-reference-panel">
        <div class="collapse-header" style="cursor:default">
          <h2 class="section-title">当前分镜引用</h2>
          <span class="sb-omni-left-hint">从统一资源库选择，拖入提示词形成 @ 引用</span>
        </div>
        <div class="resource-panel-body">
          <template v-if="activeSb">
            <div class="sb-omni-left-sb-title">
              <span class="sb-omni-left-sb-idx">#{{ storyboards.findIndex((s) => Number(s.id) === Number(activeSb.id)) + 1 }}</span>
              <span class="sb-omni-left-sb-name">{{ activeSb.title || '未命名分镜' }}</span>
            </div>
            <div class="sb-omni-material-panel">
              <div class="sb-omni-material-note">统一资源库：媒体素材 + 本镜关联的场景/角色/道具图；点击选用，拖到提示词框直接引用。</div>
              <div v-if="(sbOmniAssetIds[activeSb.id] || []).length" class="sb-omni-material-summary">
                已选 {{ (sbOmniAssetIds[activeSb.id] || []).length }}/{{ sbOmniShotLimits.total }}；图片 {{ sbOmniSelectedCounts(activeSb).image }}/{{ sbOmniShotLimits.image }}，视频 {{ sbOmniSelectedCounts(activeSb).video }}/{{ sbOmniShotLimits.video }}，音频 {{ sbOmniSelectedCounts(activeSb).audio }}/{{ sbOmniShotLimits.audio }}
              </div>
              <div class="sb-omni-material-label">素材库（点击选用）</div>
              <div class="sb-omni-material-pool">
                <div
                  v-for="item in sbOmniPoolItems(activeSb)"
                  :key="item.poolKey"
                  class="sb-omni-material-card"
                  :class="{ selected: sbOmniPoolItemSelected(activeSb, item) }"
                  :title="(item.name || '素材') + ': 点击选用；拖到提示词框直接引用'"
                  draggable="false"
                  @pointerdown="beginSbOmniPointerDrag($event, item)"
                  @click="onSbOmniPoolGuardedClick(activeSb, item)"
                >
                  <img v-if="item.type === 'image'" :src="item.thumbUrl || sbOmniAssetUrl(item)" alt="" />
                  <span v-else class="sb-omni-material-card-icon">{{ item.type === 'audio' ? '🎵' : '🎬' }}</span>
                  <small>{{ item.name }}</small>
                  <span v-if="sbOmniPoolItemSelected(activeSb, item)" class="sb-omni-material-card-check">✓</span>
                </div>
                <div v-if="!sbOmniPoolItems(activeSb).length" class="sb-omni-material-pool-empty">暂无素材，请返回「统一资源管理」上传或生成素材。</div>
              </div>
              <template v-if="getSelectedUniversalLibraryAssets(activeSb).length">
                <div class="sb-omni-material-label">已选素材（↑↓ 调整 @图片N 顺序）</div>
                <div class="sb-omni-material-selected-list">
                  <div v-for="(asset, index) in getSelectedUniversalLibraryAssets(activeSb)" :key="asset.id" class="sb-omni-material-selected-row">
                    <img v-if="asset.type === 'image'" :src="sbOmniAssetUrl(asset)" class="sb-universal-library-thumb" alt="" />
                    <span v-else class="sb-universal-library-type">{{ asset.type === 'audio' ? '🎵' : '🎬' }}</span>
                    <span class="sb-omni-material-selected-name">
                      <b :title="asset.name || `素材${asset.id}`">{{ asset.name || `素材${asset.id}` }}</b>
                      <em v-if="sbOmniEntryIndexByAssetId(activeSb)[asset.id]" class="sb-omni-material-at">@图片{{ sbOmniEntryIndexByAssetId(activeSb)[asset.id] }}</em>
                    </span>
                    <el-select
                      :model-value="sbOmniAssetUsage[activeSb.id]?.[asset.id] || omniDefaultUsage(asset)"
                      size="small"
                      class="sb-universal-library-usage"
                      @click.stop
                      @change="(value) => onSbOmniAssetUsageChange(activeSb, asset, value)"
                    >
                      <el-option v-for="opt in omniUsageOptions(asset)" :key="opt.value" :label="opt.label" :value="opt.value" />
                    </el-select>
                    <el-button text size="small" class="sb-universal-library-move" :disabled="index <= 0" @click="moveSbOmniAsset(activeSb, asset.id, -1)">↑</el-button>
                    <el-button text size="small" class="sb-universal-library-move" :disabled="index >= (sbOmniAssetIds[activeSb.id] || []).length - 1" @click="moveSbOmniAsset(activeSb, asset.id, 1)">↓</el-button>
                    <span v-if="asset.type === 'image' && asset.requires_sd2_identity" class="sb-universal-library-sd2">{{ sbOmniSd2StatusLabel(asset) }} · 自动准备</span>
                    <el-button text size="small" type="danger" @click="removeSbOmniAsset(activeSb, asset.id)">移除</el-button>
                  </div>
                </div>
              </template>
              <div v-for="asset in sbOmniIdentityAssets(activeSb)" :key="`human-${asset.id}`" class="sb-universal-identity-row">
                <el-checkbox :model-value="!!asset.requires_sd2_identity" @change="(value) => onSbOmniAssetRealPersonToggle(activeSb, asset, value)">含真人</el-checkbox>
                <span class="sb-universal-identity-status">系统自动准备真人素材</span>
              </div>
              <div v-if="(sbOmniCreationMode[activeSb.id] || 'multi_reference') === 'first_last_frame'" class="sb-universal-frame-actions">
                <el-button v-for="asset in sbOmniFrameCandidates(activeSb)" :key="`f-${asset.id}`" size="small" plain @click="setSbOmniFrameAsset(activeSb, 'first', asset.id)">设为首帧：{{ asset.name || `素材${asset.id}` }}</el-button>
                <el-button v-for="asset in sbOmniFrameCandidates(activeSb)" :key="`l-${asset.id}`" size="small" plain @click="setSbOmniFrameAsset(activeSb, 'last', asset.id)">设为尾帧：{{ asset.name || `素材${asset.id}` }}</el-button>
              </div>
            </div>
          </template>
          <div v-else class="empty-tip">暂无分镜，先生成分镜后即可编排素材</div>
        </div>
      </section>

      <!-- 6. 分镜生成 -->
      <section id="anchor-storyboard" class="section card storyboard-editor-panel">
        <h2 class="section-title">
          <span>5. 分镜生成</span>
          <span class="step-desc">根据剧本、角色、场景自动生成分镜头脚本</span>
        </h2>
        <div class="sb-config-row">
          <label class="sb-config-item">
            <span class="sb-config-label">分镜数量</span>
            <el-input-number v-model="storyboardCount" :min="1" :max="200" :step="5" placeholder="自动" class="sb-config-input" />
            <span class="sb-config-hint sb-config-hint--estimate" :title="scriptEstimateStoryboardTitle">留空由 AI 决定{{ scriptEstimateStoryboardHint }}</span>
          </label>
          <span class="sb-config-divider">｜</span>
          <label class="sb-config-item">
            <span class="sb-config-label">视频总时长(秒)</span>
            <el-input-number v-model="videoDuration" :min="10" :max="600" :step="5" placeholder="自动" class="sb-config-input" />
            <span class="sb-config-hint sb-config-hint--estimate" :title="scriptEstimateVideoDurationTitle">留空由 AI 决定{{ scriptEstimateVideoDurationHint }}</span>
          </label>
          <span class="sb-config-divider">｜</span>
          <label class="sb-config-item">
            <span class="sb-config-label">序列图模式</span>
            <el-select v-model="gridMode" size="small" style="width:110px" :disabled="storyboardUseFirstLastFrame">
              <el-option label="单张" value="single" />
              <el-option label="四宫格" value="quad_grid" />
              <el-option label="九宫格" value="nine_grid" />
            </el-select>
            <span class="sb-config-hint">四/九宫格自动按视角拆分</span>
          </label>
        </div>
        <div class="sb-config-row sb-narration-export-row" style="margin-top:10px;flex-wrap:wrap;align-items:center;gap:12px">
          <el-checkbox v-model="storyboardUseFirstLastFrame" @change="onStoryboardUseFirstLastFrameChange">
            首尾帧参考图（经典模式双槽；图生前先走专业帧提示词模块 first/last，再生图；视频绑定 first/last_frame_url）
          </el-checkbox>
          <el-checkbox v-model="storyboardUniversalOmni" @change="() => saveProjectSettings(false)">
            全能分镜模式（每镜输出多子分镜段落式 universal_segment_text，与「生成/润色全能提示词」同版式）
          </el-checkbox>
          <el-checkbox v-model="storyboardIncludeNarration" @change="() => saveProjectSettings(false)">
            生成分镜时生成解说旁白（narration，与对白分开，便于后期 TTS）
          </el-checkbox>
          <el-button
            v-if="storyboards.length > 0"
            class="sb-export-srt-btn"
            size="small"
            plain
            type="primary"
            :disabled="!currentEpisodeId"
            :loading="exportingStoryboardSheet"
            @click="onExportStoryboardSheet"
          >
            导出分镜表excel
          </el-button>
          <el-button
            v-if="storyboards.length > 0"
            class="sb-export-srt-btn"
            size="small"
            plain
            type="primary"
            :disabled="!currentEpisodeId"
            @click="onExportNarrationSrt"
          >
            导出解说 SRT
          </el-button>
        </div>
        <div class="asset-actions sb-batch-actions">
          <div class="flex">
            <el-button
              type="primary"
              size="large"
              :loading="storyboardGenerating || universalOmniPolishRunning"
              :disabled="!currentEpisodeId || storyboardGenerating || universalOmniPolishRunning"
              @click="onGenerateStoryboard"
            >
              {{ storyboards.length > 0 ? '重新生成分镜' : 'AI 生成分镜' }}
            </el-button>
            <ElButton type="info" plain size="large" @click="onAddSingleStoryboard">
            添加一个分镜
            </ElButton>
          </div>
          <template v-if="storyboards.length > 0">
            <div class="sb-batch-right">
              <el-button
                type="success"
                plain
                size="large"
                :loading="batchImageRunning"
                :disabled="!currentEpisodeId || batchImageRunning || batchVideoRunning || pipelineRunning || storyboardGenerating || universalOmniPolishRunning"
                @click="startBatchImageGeneration"
              >
                批量生成分镜图
              </el-button>
              <el-button
                type="warning"
                plain
                size="large"
                :loading="batchVideoRunning"
                :disabled="!currentEpisodeId || batchImageRunning || batchVideoRunning || pipelineRunning || storyboardGenerating || universalOmniPolishRunning"
                @click="startBatchVideoGeneration"
              >
                批量生成分镜视频
              </el-button>
              <el-button v-if="batchImageRunning" size="large" type="danger" plain @click="batchImageStopping = true">停止图片</el-button>
              <el-button v-if="batchVideoRunning" size="large" type="danger" plain @click="batchVideoStopping = true">停止视频</el-button>
            </div>
            <!-- 连贯帧模式 UI 暂时隐藏（保留变量与批量生成逻辑，后续可快速恢复） -->
            <div v-if="false" class="batch-video-options" style="margin-top:8px;display:flex;align-items:center;gap:8px;font-size:13px;">
              <el-checkbox v-model="videoFrameContiguity" size="small">
                连贯帧模式（自动衔接相邻视频帧）
              </el-checkbox>
              <el-tooltip placement="top" :show-after="100">
                <template #content>
                  <div style="max-width:320px;line-height:1.7">
                    <div style="font-weight:600;margin-bottom:4px">连贯帧模式说明</div>
                    <div>启用后批量视频顺序生成，每条视频的<b>末帧</b>自动截取并作为下一条视频的<b>首帧参考图</b>，减少镜头切换的跳跃感。</div>
                    <div style="margin-top:8px;font-weight:600">⚠️ 需要模型支持图生视频（i2v）</div>
                    <div style="margin-top:4px">
                      ✅ 支持：kling-video、kling-omni-video、wan2.2-kf2v-flash、wan2.6-i2v-flash<br/>
                      ❌ 不支持（末帧将被忽略）：wan2.6-t2v、wan2.6-r2v-flash、wanx2.1-vace-plus 等纯文生视频模型
                    </div>
                    <div style="margin-top:8px;color:#faad14">如当前视频模型不支持 i2v，启用此选项不会报错，但末帧衔接不会生效。</div>
                  </div>
                </template>
                <el-icon style="color:#9ca3af;cursor:help"><QuestionFilled /></el-icon>
              </el-tooltip>
            </div>
          </template>
        </div>
        <!-- 批量生成进度 -->
        <div v-if="batchImageRunning || batchVideoRunning || batchImageErrors.length || batchVideoErrors.length" class="batch-status">
          <div v-if="batchImageRunning" class="batch-progress">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>批量生成分镜图：{{ batchImageProgress.current }}/{{ batchImageProgress.total }}</span>
            <span v-if="batchImageProgress.failed > 0" class="batch-failed">{{ batchImageProgress.failed }} 条失败</span>
            <span v-if="batchImageStopping" class="batch-stopping">（正在停止...）</span>
          </div>
          <div v-if="batchVideoRunning" class="batch-progress">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>批量生成分镜视频：{{ batchVideoProgress.current }}/{{ batchVideoProgress.total }}</span>
            <span v-if="batchVideoProgress.failed > 0" class="batch-failed">{{ batchVideoProgress.failed }} 条失败</span>
            <span v-if="batchVideoStopping" class="batch-stopping">（正在停止...）</span>
          </div>
          <div v-if="batchImageErrors.length > 0" class="batch-error-log">
            <div class="batch-error-title">分镜图生成失败记录：</div>
            <div v-for="(e, i) in batchImageErrors" :key="i" class="batch-error-line">{{ e }}</div>
          </div>
          <div v-if="batchVideoErrors.length > 0" class="batch-error-log">
            <div class="batch-error-title">分镜视频生成失败记录：</div>
            <div v-for="(e, i) in batchVideoErrors" :key="i" class="batch-error-line">{{ e }}</div>
          </div>
        </div>
        <div v-if="storyboardGenerating || universalOmniPolishRunning" class="storyboard-generating-tip">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span v-if="universalOmniPolishRunning">
            正在润色全能提示词：第 {{ universalOmniPolishProgress.current }} / {{ universalOmniPolishProgress.total }} 镜
            <template v-if="universalOmniPolishProgress.label">（{{ universalOmniPolishProgress.label }}）</template>
            …
          </span>
          <span v-else>正在分析剧本并拆解分镜，请稍候...</span>
        </div>
        <div v-if="sbTruncatedWarning && !sbTruncatedDismissed && storyboards.length > 0" class="sb-truncated-warning">
          <el-icon><WarningFilled /></el-icon>
          <span>检测到分镜可能不完整（AI 输出被截断），请确认分镜数量是否符合预期，必要时可重新生成。</span>
          <el-button size="small" text @click="sbTruncatedDismissed = true">关闭</el-button>
        </div>
        <template v-if="storyboards.length > 0">
          <template v-for="(sb, i) in storyboards" :key="sb.id">
            <!-- 段落分隔标头：segment_title 存在且是新段落的第一个镜头时显示 -->
            <div
              v-if="sb.segment_title && (i === 0 || sb.segment_index !== storyboards[i - 1].segment_index)"
              class="segment-header"
            >
              <div class="segment-header-inner">
                <span class="segment-index-badge">第 {{ (sb.segment_index ?? 0) + 1 }} 幕</span>
                <span class="segment-title-text">{{ sb.segment_title }}</span>
                <span class="segment-shot-range">
                  镜头 {{ i + 1 }}–{{ (() => {
                    let end = i
                    while (end + 1 < storyboards.length && storyboards[end + 1].segment_index === sb.segment_index) end++
                    return end + 1
                  })() }}
                </span>
              </div>
            </div>
          <!-- 分镜控制栏（卡片外，缩进表示属于当前幕） -->
          <div
            class="sb-ctrl-bar"
            :class="{ 'sb-ctrl-bar--active': Number(activeSbId) === Number(sb.id), 'sb-ctrl-bar--dragging': Number(navDragSbId) === Number(sb.id), 'sb-ctrl-bar--dragover': Number(navDragOverSbId) === Number(sb.id) }"
            draggable="true"
            @dragstart="onSbNavDragStart(sb)"
            @dragend="onSbNavDragEnd"
            @dragover.prevent="onSbNavDragOver(sb)"
            @dragleave="navDragOverSbId = null"
            @drop.prevent="onSbNavDrop(sb)"
            @click="setActiveSbId(sb.id)"
          >
            <span class="sb-ctrl-num">{{ i + 1 }}</span>
            <span class="sb-ctrl-title">{{ sb.title || '未命名分镜' }}</span>
            <el-tag v-if="sb.movement" size="small" effect="plain" type="info" class="sb-movement-tag">{{ getMovementLabel(sb.movement) }}</el-tag>
            <el-button size="small" plain class="sb-ctrl-btn sb-ctrl-config-btn" @click="onOpenVideoParamsDialog(sb)">⚙ 分镜配置</el-button>
            <el-button
              size="small"
              plain
              class="sb-ctrl-btn sb-ctrl-mode-btn"
              :title="isSbUniversalMode(sb.id) ? '切换为经典分镜（中间显示参考图）' : '切换为全能模式（中间为片段描述，经典字段保留）'"
              @click="onToggleSbUniversalMode(sb)"
            >
              {{ isSbUniversalMode(sb.id) ? '经典分镜' : '全能模式' }}
            </el-button>
            <el-button size="small" plain class="sb-ctrl-btn" title="在本镜头前增加一个分镜" @click="onInsertStoryboardBefore(sb)">＋ 新增</el-button>
            <el-button
              class="sb-ctrl-delete"
              type="danger"
              plain
              size="small"
              aria-label="删除当前分镜"
              :title="`删除分镜${i + 1}`"
              @click.stop="onDeleteSingleStoryboard(sb.id)"
            >
              <el-icon><Delete /></el-icon><span>删除</span>
            </el-button>
          </div>
          <div class="sb-inline-generation-settings">
            <span class="sb-inline-generation-label">分镜参数</span>
            <el-tag size="small" :type="sbGenerationModes[sb.id] === 'custom' ? 'warning' : 'info'">
              {{ sbGenerationModes[sb.id] === 'master' ? '首镜母版' : sbGenerationModes[sb.id] === 'custom' ? '当前镜头覆盖' : '跟随首镜' }}
            </el-tag>
            <GenerationSettings
              :model-value="sbGenerationSettings[sb.id] || {}"
              :show-text-model="true"
              :max-duration="15"
              @update:model-value="onInlineSbGenerationSettingsChange(sb, $event)"
            />
            <el-button v-if="sbGenerationModes[sb.id] === 'custom'" text size="small" @click="restoreSbGenerationDefaults(sb)">恢复跟随首镜</el-button>
            <span class="sb-inline-generation-hint">{{ sbGenerationModes[sb.id] === 'master' ? '修改后同步所有跟随镜头' : '默认采用首镜参数，可单独覆盖' }}</span>
          </div>
          <div :id="'sb-' + sb.id" class="storyboard-row">
            <!-- 左：分镜脚本 -->
            <div class="sb-panel sb-script">
              <div class="sb-script-row sb-script-selects">
                <el-select
                  :model-value="getSbCharacterIds(sb.id)"
                  placeholder="选择角色"
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  size="small"
                  class="sb-select"
                  @update:model-value="(v) => setSbCharacterIds(sb.id, v)"
                >
                  <el-option
                    v-for="c in (characters || [])"
                    :key="String(c.id)"
                    :label="c.name || '未命名'"
                    :value="c.id"
                  />
                  <template v-if="!(characters || []).length" #empty>
                    <span class="sb-select-empty">请先在「角色生成」中添加角色</span>
                  </template>
                </el-select>
                <el-select
                  v-model="sbSceneId[sb.id]"
                  placeholder="选择场景"
                  clearable
                  size="small"
                  class="sb-select"
                  @change="() => onStoryboardSceneChange(sb.id)"
                >
                  <el-option
                    v-for="s in (scenes || [])"
                    :key="s.id"
                    :label="s.location"
                    :value="s.id"
                  />
                </el-select>
                <el-select
                  :model-value="getSbPropIds(sb.id)"
                  placeholder="选择物品"
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  size="small"
                  class="sb-select"
                  @update:model-value="(v) => setSbPropIds(sb.id, v)"
                >
                  <el-option
                    v-for="p in (props || [])"
                    :key="String(p.id)"
                    :label="p.name || '未命名'"
                    :value="p.id"
                  />
                  <template v-if="!(props || []).length" #empty>
                    <span class="sb-select-empty">请先在「道具生成」中添加物品</span>
                  </template>
                </el-select>
              </div>
              <!-- 当前选中：场景 / 角色 / 物品缩略图 -->
              <div v-if="getSbSelectedScene(sb.id) || getSbSelectedCharacters(sb.id).length || getSbSelectedProps(sb.id).length || (characters || []).length" class="sb-selected-thumbs">
                <div v-if="getSbSelectedScene(sb.id)" class="sb-thumb-row">
                  <span class="sb-thumb-label">场景</span>
                  <div class="sb-thumb-list">
                    <div
                      v-for="s in [getSbSelectedScene(sb.id)]"
                      :key="s.id"
                      class="sb-thumb-item sb-thumb-scene"
                      :class="{ 'sb-thumb-clickable': hasAssetImage(s) }"
                      :title="s.location"
                      role="button"
                      @click="hasAssetImage(s) && openImagePreview(assetImageUrl(s))"
                    >
                      <img v-if="hasAssetImage(s)" :src="assetImageUrl(s)" alt="" />
                      <span v-else class="sb-thumb-placeholder">{{ (s.location || '')[0] }}</span>
                    </div>
                  </div>
                </div>
                <div v-if="(characters || []).length" class="sb-thumb-row">
                  <span class="sb-thumb-label">角色</span>
                  <div class="sb-thumb-list">
                    <div
                      v-for="c in getSbSelectedCharacters(sb.id)"
                      :key="c.id"
                      class="sb-thumb-item sb-thumb-avatar"
                      :class="{ 'sb-thumb-clickable': hasAssetImage(c) }"
                      :title="c.name"
                      role="button"
                      @click="hasAssetImage(c) && openImagePreview(assetImageUrl(c))"
                    >
                      <img v-if="hasAssetImage(c)" :src="assetImageUrl(c)" alt="" />
                      <span v-else class="sb-thumb-placeholder">{{ (c.name || '')[0] }}</span>
                    </div>
                    <el-dropdown trigger="click" @command="(cmd) => onSbAddCharacterCommand(sb.id, cmd)">
                      <div
                        class="sb-thumb-item sb-thumb-avatar sb-thumb-add-char"
                        title="添加角色"
                        role="button"
                        @click.stop
                      >
                        <el-icon><Plus /></el-icon>
                      </div>
                      <template #dropdown>
                        <el-dropdown-menu class="sb-char-add-dropdown">
                          <el-dropdown-item
                            v-for="c in charactersAvailableToAddToSb(sb.id)"
                            :key="c.id"
                            :command="c.id"
                          >
                            {{ c.name || '未命名' }}
                          </el-dropdown-item>
                          <el-dropdown-item v-if="!charactersAvailableToAddToSb(sb.id).length" disabled>
                            已全部添加或无角色
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </div>
                <div v-if="getSbSelectedProps(sb.id).length" class="sb-thumb-row">
                  <span class="sb-thumb-label">物品</span>
                  <div class="sb-thumb-list">
                    <div
                      v-for="p in getSbSelectedProps(sb.id)"
                      :key="p.id"
                      class="sb-thumb-item sb-thumb-prop"
                      :class="{ 'sb-thumb-clickable': hasAssetImage(p) }"
                      :title="p.name"
                      role="button"
                      @click="hasAssetImage(p) && openImagePreview(assetImageUrl(p))"
                    >
                      <img v-if="hasAssetImage(p)" :src="assetImageUrl(p)" alt="" />
                      <span v-else class="sb-thumb-placeholder">{{ (p.name || '')[0] }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <!-- 首尾帧模式下隐藏“图片提示词”入口，统一收敛到首/尾帧槽位的“查看提示词” -->
              <div v-if="!storyboardUseFirstLastFrame" class="sb-prompt-label">
                <span class="sb-dot"></span>
                <span>图片提示词</span>
              </div>
              <div v-if="!storyboardUseFirstLastFrame" class="sb-prompt-row">
                <span class="sb-prompt-text">{{ sb.image_prompt || '暂无图片提示词' }}</span>
                <el-button size="small" link type="primary" @click="onOpenSbPromptDialog(sb)">编辑</el-button>
              </div>
              <template v-if="storyboardIncludeNarration || (sbNarration[sb.id] || '').trim() || (sb.narration || '').trim()">
                <div class="sb-prompt-label">
                  <span class="sb-dot"></span>
                  <span>解说旁白</span>
                </div>
                <el-input
                  v-model="sbNarration[sb.id]"
                  type="textarea"
                  :rows="2"
                  placeholder="本镜解说文案（画外音 / 纪录片式旁白，供 TTS 或导出 SRT）"
                  class="sb-narration-input"
                  @blur="() => onSaveSbNarrationField(sb)"
                />
                <div v-if="(sbNarration[sb.id] || sb.narration || '').toString().trim()" class="sb-narration-actions">
                  <el-tooltip content="解说旁白配音（TTS）" placement="top">
                    <el-button size="small" :loading="ttsSbNarrationIds.has(sb.id)" @click="onTtsSbNarration(sb)">
                      解说配音
                    </el-button>
                  </el-tooltip>
                  <el-tooltip v-if="sbNarrationAudioRelPath(sb)" content="播放解说旁白配音" placement="top">
                    <el-button size="small" @click="playSbNarrationTts(sb)">
                      <el-icon><VideoPlay /></el-icon>
                    </el-button>
                  </el-tooltip>
                </div>
              </template>
            </div>
            <!-- 中：经典模式=分镜参考图；全能模式=片段描述（独立字段，与参考图并存） -->
            <div class="sb-panel sb-image" :class="{ 'sb-image--universal': isSbUniversalMode(sb.id) }">
              <template v-if="isSbUniversalMode(sb.id)">
                <div class="sb-prompt-label sb-universal-label-row">
                  <div class="sb-universal-label-left">
                    <span class="sb-dot"></span>
                    <span>片段描述</span>
                    <el-tooltip placement="top" :show-after="280" :show-arrow="false" popper-class="sb-universal-tooltip-popper">
                      <template #content>
                        <div class="sb-universal-tooltip">
                          全能生视频链路（<strong>AI 配置 · 视频</strong> 中选接口规范：<code>kling_omni</code> 可灵 Omni，或 <code>volcengine_omni</code> 火山即梦 Seedance 2.0 多图参考；模型如 <code>kling-video-o1</code>、<code>doubao-seedance-2-0-260128</code> 等以控制台为准）：此处为提交主提示词；只要本框有内容，生视频时<strong>只</strong>发送这段，不会拼接下方「视频提示词」里的动作/对话/旁白。参考图来自「素材库」勾选的素材（点上方「素材编排」打开：上传/媒体素材 + 本镜场景/角色/道具图统一在一个资源库，点击选用、↑↓ 调整顺序、拖到本框直接引用）；请用 <strong>@图片1</strong>、<strong>@图片2</strong>…（<strong>@图片N 后建议加半角空格</strong>）对应素材顺序，勿用 @姓名 指图。人物一致性素材请勾选「含真人」并完成 SD2 认证。若参考图是<strong>四宫格/多视角拼图</strong>，仅借空间与氛围，须在文案中写明<strong>单镜头完整画幅、禁止分屏宫格</strong>，避免成片模仿拼图布局。全能提示词下拉中「生成」会按<strong>本条分镜总时长</strong>与本集剧本、镜序、邻镜信息，自动决定子分镜数 M（第2行「由以下M个分镜…」），第4行起为「分镜1：T1秒:」…多行，且各段秒数之和等于本镜时长；第3行仍为环境/参考图约束；「生成」与「润色」均为<strong>流式输出</strong>到本框；「润色」在此基础上增强。若本框留空，则退回仅用「视频提示词」。
                        </div>
                      </template>
                      <el-icon class="sb-universal-hint-icon" tabindex="0" role="img" aria-label="片段说明">
                        <QuestionFilled />
                      </el-icon>
                    </el-tooltip>
                  </div>
                    <el-dropdown
                    trigger="click"
                    class="sb-universal-prompt-dd"
                    @command="(cmd) => onUniversalSegmentPromptMenu(sb, cmd)"
                  >
                    <el-button
                      type="primary"
                      link
                      size="small"
                      class="sb-universal-gen-btn"
                      :loading="generatingUniversalSegmentIds.has(sb.id)"
                    >
                      全能提示词
                      <el-icon class="sb-universal-dd-caret"><ArrowDown /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="generate">生成全能提示词</el-dropdown-item>
                        <el-dropdown-item command="generate-force">不查图片强制生成</el-dropdown-item>
                        <el-dropdown-item command="polish" :disabled="!sbUniversalSegmentTrimmed(sb)">
                          润色全能提示词
                        </el-dropdown-item>
                        <el-dropdown-item command="polish-force" :disabled="!sbUniversalSegmentTrimmed(sb)">
                          不查图片强制润色
                        </el-dropdown-item>
                        <el-dropdown-item
                          command="to-grok-video-tags"
                          divided
                          :disabled="!sbUniversalSegmentTrimmed(sb)"
                        >
                          改为 grok视频格式
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                    </el-dropdown>
                    <span v-if="(sbOmniAssetIds[sb.id] || []).length" class="sb-universal-library-btn sb-universal-library-btn--static">素材 · {{ (sbOmniAssetIds[sb.id] || []).length }}</span>
                  </div>
                <UniversalSegmentOmniAtEditor
                  v-if="!generatingUniversalSegmentIds.has(sb.id)"
                  v-model="sbUniversalSegmentText[sb.id]"
                  :slots="getSbUniversalOmniRefSlots(sb)"
                  class="sb-universal-textarea"
                  @update:model-value="(value) => onUniversalPromptInput(sb.id, value)"
                  @blur="() => onSaveUniversalSegmentField(sb)"
                  @pick="(slot) => onUniversalSegmentPickAsset(sb, slot)"
                  @drop-asset="(payload) => onUniversalSegmentDropAsset(sb, payload)"
                />
                <div v-if="getSelectedUniversalLibraryAssets(sb).length" class="sb-omni-selected-strip">
                  <span class="sb-omni-selected-strip-label">参考</span>
                  <div v-for="asset in getSelectedUniversalLibraryAssets(sb)" :key="asset.id" class="sb-omni-selected-strip-item" :title="(asset.name || `素材${asset.id}`) + '：在左侧素材编排中调整'">
                    <img v-if="asset.type === 'image'" :src="sbOmniAssetUrl(asset)" alt="" />
                    <span v-else>{{ asset.type === 'audio' ? '🎵' : '🎬' }}</span>
                    <em v-if="sbOmniEntryIndexByAssetId(sb)[asset.id]">@图片{{ sbOmniEntryIndexByAssetId(sb)[asset.id] }}</em>
                  </div>
                </div>
                <div class="sb-omni-controls">
                  <div class="sb-omni-control-row">
                    <span class="sb-omni-control-label">创作模式</span>
                    <el-radio-group
                      :model-value="sbOmniCreationMode[sb.id] || 'multi_reference'"
                      size="small"
                      @change="(value) => onSbOmniModeChange(sb, value)"
                    >
                      <el-radio-button value="multi_reference">多参考</el-radio-button>
                      <el-radio-button value="first_last_frame">首尾帧</el-radio-button>
                    </el-radio-group>
                    <span class="sb-omni-control-hint">
                      {{ (sbOmniCreationMode[sb.id] || 'multi_reference') === 'first_last_frame' ? '仅提交一张首帧和一张尾帧' : '图片、视频、音频按模型能力路由' }}
                    </span>
                  </div>
                  <div v-if="(sbOmniCreationMode[sb.id] || 'multi_reference') === 'first_last_frame'" class="sb-omni-frame-row">
                    <span class="sb-omni-frame-slot">
                      <span class="sb-omni-frame-slot-label">首帧</span>
                      <img v-if="sbOmniFrameAsset(sb, 'first')" :src="sbOmniAssetUrl(sbOmniFrameAsset(sb, 'first'))" class="sb-omni-frame-thumb" alt="" />
                      <el-button link size="small" class="sb-omni-frame-pick" @click="openSbOmniFramePicker(sb, 'first')">{{ sbOmniFrameAssetName(sb, 'first') }}</el-button>
                      <el-button link size="small" class="sb-omni-frame-upload" :loading="sbOmniFrameUploading === 'first'" @click="onSbOmniFrameUpload(sb, 'first')">上传</el-button>
                    </span>
                    <span class="sb-omni-frame-slot">
                      <span class="sb-omni-frame-slot-label">尾帧</span>
                      <img v-if="sbOmniFrameAsset(sb, 'last')" :src="sbOmniAssetUrl(sbOmniFrameAsset(sb, 'last'))" class="sb-omni-frame-thumb" alt="" />
                      <el-button link size="small" class="sb-omni-frame-pick" @click="openSbOmniFramePicker(sb, 'last')">{{ sbOmniFrameAssetName(sb, 'last') }}</el-button>
                      <el-button link size="small" class="sb-omni-frame-upload" :loading="sbOmniFrameUploading === 'last'" @click="onSbOmniFrameUpload(sb, 'last')">上传</el-button>
                    </span>
                  </div>
                  <div class="sb-omni-control-row sb-omni-audio-row">
                    <span class="sb-omni-control-label">音频</span>
                    <el-select
                      :model-value="sbAudioStrategy[sb.id] || 'reference_only'"
                      size="small"
                      style="width: 132px"
                      @change="(value) => onSbAudioSettingsChange(sb, { audio_strategy: value })"
                    >
                      <el-option label="原生参考" value="reference_only" />
                      <el-option label="成片后混音" value="post_mix" />
                    </el-select>
                    <el-checkbox
                      :model-value="!!sbKeepOriginalAudio[sb.id]"
                      @change="(value) => onSbAudioSettingsChange(sb, { keep_original_audio: value })"
                    >保留原声</el-checkbox>
                    <el-input-number
                      v-if="sbAudioStrategy[sb.id] === 'post_mix'"
                      :model-value="Number(sbAudioVolume[sb.id] ?? 1)"
                      :min="0"
                      :max="2"
                      :step="0.1"
                      size="small"
                      controls-position="right"
                      @change="(value) => onSbAudioSettingsChange(sb, { audio_volume: value })"
                    />
                  </div>
                  <div v-if="(sbOmniCreationMode[sb.id] || 'multi_reference') === 'first_last_frame'" class="sb-omni-frame-actions">
                    <el-button
                      v-for="asset in sbOmniFrameCandidates(sb)"
                      :key="asset.id"
                      size="small"
                      plain
                      @click="setSbOmniFrameAsset(sb, 'first', asset.id)"
                    >设为首帧：{{ asset.name || `素材${asset.id}` }}</el-button>
                    <el-button
                      v-for="asset in sbOmniFrameCandidates(sb)"
                      :key="`last-${asset.id}`"
                      size="small"
                      plain
                      @click="setSbOmniFrameAsset(sb, 'last', asset.id)"
                    >设为尾帧：{{ asset.name || `素材${asset.id}` }}</el-button>
                  </div>
                </div>
                <el-input
                  v-if="generatingUniversalSegmentIds.has(sb.id)"
                  v-model="sbUniversalSegmentText[sb.id]"
                  type="textarea"
                  :rows="10"
                  :autosize="{ minRows: 10, maxRows: 22 }"
                  placeholder="例如：@图片1 为夜景街道，@图片2 从餐厅冲出停在光斑里，低头操作手机…"
                  class="sb-universal-textarea"
                  @update:model-value="(value) => onUniversalPromptInput(sb.id, value)"
                  @blur="() => onSaveUniversalSegmentField(sb)"
                />
              </template>
              <template v-else>
              <div
                class="sb-image-area"
                :class="{
                  'sb-image-area--dragover': dragOverSbId === sb.id,
                  'sb-image-area--has-quad': !storyboardUseFirstLastFrame && getStripItems(sb.id).length > 0,
                  'sb-image-area--first-last': storyboardUseFirstLastFrame,
                }"
                @dragover="onSbImageDragOver($event, sb.id)"
                @dragleave="onSbImageDragLeave($event, sb.id)"
                @drop="onSbImageDrop($event, sb)"
              >
                <!-- 首尾帧双槽 -->
                <template v-if="storyboardUseFirstLastFrame">
                  <div class="sb-fl-dual">
                    <div class="sb-fl-slot">
                      <div class="sb-fl-slot-label">首帧</div>
                      <div class="sb-fl-slot-body">
                        <template v-if="getSbFirstImage(sb.id)">
                          <img
                            :src="assetImageUrl(getSbFirstImage(sb.id))"
                            class="sb-generated-img"
                            alt=""
                            @click="openImagePreview(assetImageUrl(getSbFirstImage(sb.id)))"
                          />
                        </template>
                        <template v-else-if="sb.image_url || sb.composed_image">
                          <img
                            :src="imageUrl(sb.composed_image || sb.image_url)"
                            class="sb-generated-img"
                            alt=""
                            @click="openImagePreview(imageUrl(sb.composed_image || sb.image_url))"
                          />
                        </template>
                        <template v-else>
                          <span class="sb-fl-empty">动作前静止</span>
                        </template>
                      </div>
                      <div v-if="getSbFirstImage(sb.id)?.prompt" class="sb-fl-slot-prompt" :title="getSbFirstImage(sb.id).prompt">
                        {{ getSbFirstImage(sb.id).prompt }}
                      </div>
                      <div class="sb-fl-slot-actions">
                        <el-button type="primary" size="small" :loading="generatingSbFirstImageIds.has(sb.id)" @click="onGenerateSbFrameImage(sb, 'first')">生成</el-button>
                        <el-tooltip v-if="canUsePrevTailAsFirst(sb)" content="直接使用上一分镜的尾帧图片（高清原图）替换本首帧，画面更清晰" placement="top">
                          <el-button size="small" :loading="usingPrevTailAsFirstIds.has(sb.id)" @click="onUsePrevTailAsFirst(sb)">上镜尾帧</el-button>
                        </el-tooltip>
                        <el-button size="small" :loading="uploadingSbImageSlot(sb.id) === 'first'" @click="onUploadSbImageClick(sb, 'first')">上传</el-button>
                        <el-button type="primary" link size="small" @click="showSbFramePromptPreview(sb, 'first')">查看提示词</el-button>
                      </div>
                    </div>
                    <div class="sb-fl-arrow" aria-hidden="true">→</div>
                    <div class="sb-fl-slot">
                      <div class="sb-fl-slot-label">尾帧</div>
                      <div class="sb-fl-slot-body">
                        <template v-if="getSbLastImage(sb.id)">
                          <img
                            :src="assetImageUrl(getSbLastImage(sb.id))"
                            class="sb-generated-img"
                            alt=""
                            :title="getSbLastImage(sb.id).prompt || ''"
                            @click="openImagePreview(assetImageUrl(getSbLastImage(sb.id)))"
                          />
                        </template>
                        <template v-else>
                          <span class="sb-fl-empty">动作后结果</span>
                        </template>
                      </div>
                      <div v-if="getSbLastImage(sb.id)?.prompt" class="sb-fl-slot-prompt" :title="getSbLastImage(sb.id).prompt">
                        {{ getSbLastImage(sb.id).prompt }}
                      </div>
                      <div class="sb-fl-slot-actions">
                        <el-button type="primary" size="small" :loading="generatingSbLastImageIds.has(sb.id)" @click="onGenerateSbFrameImage(sb, 'last')">生成</el-button>
                        <el-checkbox
                          v-model="lastFrameUseFirstLayoutLock"
                          class="sb-fl-first-lock-opt"
                          title="勾选时尾帧生成会附带首帧图作构图与左右站位参考；取消后仅使用场景/角色/道具参考，便于调整出场人物"
                          @change="onLastFrameLayoutLockChange"
                        >
                          首帧站位
                        </el-checkbox>
                        <el-button size="small" :loading="uploadingSbImageSlot(sb.id) === 'last'" @click="onUploadSbImageClick(sb, 'last')">上传</el-button>
                        <el-button type="primary" link size="small" @click="showSbFramePromptPreview(sb, 'last')">查看提示词</el-button>
                      </div>
                    </div>
                  </div>
                  <div v-if="getStripItems(sb.id).length" class="sb-imgs-strip">
                    <el-tooltip content="历史图：点击设为首帧或尾帧，左上角放大预览，右上角删除" placement="top" :show-arrow="false">
                      <el-icon class="sb-strip-hint-icon"><InfoFilled /></el-icon>
                    </el-tooltip>
                    <div
                      v-for="item in getStripItems(sb.id)"
                      :key="item.key"
                      class="sb-img-thumb"
                      :title="stripItemTitle(sb.id, item)"
                      @click="onStripItemClick(sb, item)"
                    >
                      <img :src="item.src" alt="" />
                      <span v-if="item.frameBadge" class="sb-img-thumb-label">{{ item.frameBadge }}</span>
                      <span v-else-if="item.label" class="sb-img-thumb-label">{{ item.label }}</span>
                      <button class="thumb-preview-btn" title="放大预览" @click.stop="openImagePreview(item.src)">
                        <el-icon :size="10"><ZoomIn /></el-icon>
                      </button>
                      <button v-if="item.img?.id" class="extra-thumb-remove" title="删除历史图" @click.stop="onRemoveSbHistoryImage(sb.id, item.img.id)">×</button>
                    </div>
                  </div>
                </template>
                <!-- 单主图（未勾选首尾帧） -->
                <template v-else>
                <div class="sb-main-image-wrap">
                  <template v-if="getSbImage(sb.id)">
                    <img
                      :src="assetImageUrl(getSbImage(sb.id))"
                      class="sb-generated-img"
                      alt=""
                      :title="getSbImage(sb.id).prompt || ''"
                      @click="openImagePreview(assetImageUrl(getSbImage(sb.id)))"
                    />
                    <div v-if="getSbImage(sb.id).prompt" class="sb-main-img-prompt">{{ getSbImage(sb.id).prompt }}</div>
                  </template>
                  <template v-else-if="sb.composed_image || sb.image_url">
                    <img
                      :src="imageUrl(sb.composed_image || sb.image_url)"
                      class="sb-generated-img"
                      alt=""
                      @click="openImagePreview(imageUrl(sb.composed_image || sb.image_url))"
                    />
                  </template>
                  <template v-else-if="sb.error_msg || sb.errorMsg">
                    <div class="sb-image-error" :title="sb.error_msg || sb.errorMsg">{{ sb.error_msg || sb.errorMsg }}</div>
                    <el-button type="primary" size="small" class="sb-gen-btn" :loading="generatingSbImageIds.has(sb.id)" @click="onGenerateSbImage(sb)">
                      <el-icon><Refresh /></el-icon>
                      重试
                    </el-button>
                    <el-button size="small" :loading="uploadingSbImageId === sb.id" @click="onUploadSbImageClick(sb)">上传</el-button>
                  </template>
                  <template v-else>
                    <el-button type="primary" size="small" class="sb-gen-btn" :loading="generatingSbImageIds.has(sb.id)" @click="onGenerateSbImage(sb)">
                      <el-icon><MagicStick /></el-icon>
                      生成分镜参考图
                    </el-button>
                    <el-button size="small" :loading="uploadingSbImageId === sb.id" @click="onUploadSbImageClick(sb)">上传</el-button>
                  </template>
                </div>
                <div v-if="getStripItems(sb.id).length" class="sb-imgs-strip">
                  <el-tooltip content="历史图：点击设为主图，左上角放大预览，右上角删除" placement="top" :show-arrow="false">
                    <el-icon class="sb-strip-hint-icon"><InfoFilled /></el-icon>
                  </el-tooltip>
                  <div
                    v-for="item in getStripItems(sb.id)"
                    :key="item.key"
                    class="sb-img-thumb"
                    :title="[item.label, item.prompt].filter(Boolean).join('\n\n') || '点击设为主图'"
                    @click="onSelectStripItem(sb, item)"
                  >
                    <img :src="item.src" alt="" />
                    <span v-if="item.label" class="sb-img-thumb-label">{{ item.label }}</span>
                    <button class="thumb-preview-btn" title="放大预览" @click.stop="openImagePreview(item.src)">
                      <el-icon :size="10"><ZoomIn /></el-icon>
                    </button>
                    <button v-if="item.img?.id" class="extra-thumb-remove" title="删除历史图" @click.stop="onRemoveSbHistoryImage(sb.id, item.img.id)">×</button>
                  </div>
                </div>
                </template>
                <div v-if="dragOverSbId === sb.id" class="sb-image-area-drop-hint">松开上传到首帧</div>
              </div>
              <div v-if="hasSbImage(sb) || storyboardUseFirstLastFrame" class="sb-image-actions">
                <template v-if="storyboardUseFirstLastFrame">
                  <el-button size="small" :loading="generatingSbFirstImageIds.has(sb.id) || generatingSbLastImageIds.has(sb.id)" @click="onGenerateSbFramePair(sb)">{{ hasSbFirstLastPair(sb) ? '重新生成首尾帧' : '一键生成首尾帧' }}</el-button>
                  <el-tooltip content="高清放大仅作用于首帧" placement="top">
                    <el-button size="small" :loading="upscalingSbIds.has(sb.id)" :disabled="!getSbLocalImage(sb)" @click="onUpscaleSbImage(sb)">
                      <el-icon><ZoomIn /></el-icon>超分(首帧)
                    </el-button>
                  </el-tooltip>
                </template>
                <template v-else>
                <el-button size="small" :loading="generatingSbImageIds.has(sb.id)" @click="onGenerateSbImage(sb)">重新生成</el-button>
                <el-button size="small" :loading="uploadingSbImageId === sb.id" @click="onUploadSbImageClick(sb)">上传</el-button>
                <el-tooltip content="高清放大（2x超分辨率）" placement="top">
                  <el-button
                    size="small"
                    :loading="upscalingSbIds.has(sb.id)"
                    :disabled="!getSbLocalImage(sb)"
                    @click="onUpscaleSbImage(sb)"
                  >
                    <el-icon><ZoomIn /></el-icon>超分
                  </el-button>
                </el-tooltip>
                </template>
              </div>
              </template>
            </div>
            <!-- 右：分镜视频（由 /videos?storyboard_id 拉取）；有视频时仍显示提示词与生成按钮便于调整后重新生成 -->
            <div class="sb-panel sb-video">
              <div v-if="getSbVideo(sb.id)" class="sb-video-area">
                <video
                  v-if="assetVideoUrl(getSbVideo(sb.id)) && Number(activeSbId) === Number(sb.id)"
                  :key="sbMainVideoPlayerKey(sb.id)"
                  :src="assetVideoUrl(getSbVideo(sb.id))"
                  controls
                  class="sb-video-player"
                  preload="metadata"
                  :autoplay="Number(sbAutoPlayId) === Number(sb.id)"
                />
                <button
                  v-else-if="assetVideoUrl(getSbVideo(sb.id))"
                  type="button"
                  class="sb-video-lazy-placeholder"
                  @click.stop="setActiveSbId(sb.id)"
                >
                  <img :src="sbVideoPoster(sb, getSbVideo(sb.id))" alt="" />
                  <el-icon class="sb-video-poster-play"><VideoCamera /></el-icon>
                </button>
                <div
                  v-else
                  class="sb-video-error"
                  :title="getSbVideoError(sb.id) || '视频地址无效'"
                >
                  {{ getSbVideoError(sb.id) || '视频地址无效，请重新生成' }}
                </div>
                <span v-if="isSbVideoGenerating(sb.id)" class="sb-video-regenerating-overlay">
                  <el-icon class="is-loading"><Loading /></el-icon>
                  正在重新生成...
                </span>
              </div>
              <div v-else class="sb-video-area sb-video-placeholder">
                <span v-if="isSbVideoGenerating(sb.id)" class="sb-video-generating-text">
                  <el-icon class="is-loading"><Loading /></el-icon>
                  正在生成视频...
                </span>
                <template v-else>
                  <div v-if="getSbVideoError(sb.id)" class="sb-video-error">
                    {{ getSbVideoError(sb.id) }}
                  </div>
                  <el-button
                    type="primary"
                    size="small"
                    class="sb-generate-video-btn"
                    :loading="isSbVideoGenerating(sb.id)"
                    :disabled="!sbCanSubmitVideo(sb) || isSbVideoGenerating(sb.id)"
                    @click="onGenerateSbVideo(sb)"
                  >
                    生成分镜视频
                  </el-button>
                </template>
              </div>
              <!-- 视频历史条：有多条历史时显示，点击可切换 -->
              <div v-if="getVideoStripItems(sb.id).length" class="sb-videos-strip">
                <el-tooltip content="历史视频：点击可切换为当前视频" placement="top" :show-arrow="false">
                  <el-icon class="sb-strip-hint-icon"><InfoFilled /></el-icon>
                </el-tooltip>
                <div
                  v-for="item in getVideoStripItems(sb.id)"
                  :key="item.key"
                  class="sb-video-thumb"
                  :title="`${item.label}（点击切换）`"
                  @click="onSelectSbMainVideo(sb, item.video)"
                >
                  <span class="sb-video-thumb-player sb-video-thumb-placeholder"><img :src="sbVideoPoster(sb, item.video)" alt="" /></span>
                  <span class="sb-video-thumb-label">{{ item.label }}</span>
                </div>
              </div>
              <div v-if="getSbVideo(sb.id)" class="sb-video-actions">
                <el-button size="small" :loading="isSbVideoGenerating(sb.id)" :disabled="!sbCanSubmitVideo(sb) || isSbVideoGenerating(sb.id)" @click="onGenerateSbVideo(sb)">重新生成</el-button>
                <el-tooltip v-if="getNextStoryboard(sb.id)" content="提取本视频尾帧，设为下一个分镜的首帧" placement="top">
                  <el-button size="small" :loading="linkingTailFrameIds.has(sb.id)" @click="onLinkTailFrameToNext(sb)">尾帧衔接</el-button>
                </el-tooltip>
                <el-tooltip v-if="sb.dialogue" content="对白配音（TTS）" placement="top">
                  <el-button size="small" :loading="ttsSbIds.has(sb.id)" @click="onTtsSbDialogue(sb)">
                    对白配音
                  </el-button>
                </el-tooltip>
                <el-tooltip v-if="sb.dialogue && sbDialogueAudioRelPath(sb)" content="播放对白配音" placement="top">
                  <el-button size="small" @click="playSbDialogueTts(sb)">
                    <el-icon><VideoPlay /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>
              <div class="sb-video-prompt-label">
                <span class="sb-dot"></span>
                <span>视频提示词</span>
              </div>
              <div class="sb-video-params-bar">
                <span class="sb-video-prompt-text sb-video-prompt-text--preview">{{ sb.video_prompt || '暂无视频提示词（在「视频配置」保存后自动生成）' }}</span>
                <el-button size="small" link type="primary" @click="onOpenSbPromptDialog(sb)">手工编辑</el-button>
              </div>
            </div>
          </div>
          </template>
        </template>
        <!-- 分镜生成中提示条 -->
        <div v-if="storyboardGenerating || universalOmniPolishRunning" class="sb-generating-tip">
          <span class="sb-gen-dot" /><span class="sb-gen-dot" /><span class="sb-gen-dot" />
          <span v-if="universalOmniPolishRunning" class="sb-gen-text">
            全能片段润色中 {{ universalOmniPolishProgress.current }}/{{ universalOmniPolishProgress.total }}
            <template v-if="universalOmniPolishProgress.label"> · {{ universalOmniPolishProgress.label }}</template>
          </span>
          <span v-else class="sb-gen-text">分镜持续生成中，客官稍等片刻…</span>
        </div>
        <div v-else-if="storyboards.length === 0" class="empty-tip">请先生成分镜</div>
      </section>
      </div>

      <div v-show="workflowStage === 'storyboard'" class="workflow-next-action">
        <span>{{ storyboards.length ? `已有 ${storyboards.length} 个分镜；生成完成后即可检查并合成。` : '请先生成至少一个分镜。' }}</span>
        <el-button type="primary" :disabled="!storyboards.length" @click="setWorkflowStage('merge')">进入视频合成</el-button>
      </div>

      <!-- 7. 视频配置 + AI 模型配置 -->
      <section v-show="workflowStage === 'merge'" class="section card merge-settings">
        <h2 class="section-title">视频配置</h2>
        <div class="config-grid">
          <el-form-item label="分辨率">
            <el-select v-model="videoResolution" style="width: 160px">
              <el-option label="480p" value="480p" />
              <el-option label="720p" value="720p" />
              <el-option label="1080p" value="1080p" />
            </el-select>
          </el-form-item>
          <!--
          <el-form-item label="配乐">
            <el-select v-model="videoMusic" placeholder="无" clearable style="width: 160px">
              <el-option label="无" value="" />
            </el-select>
          </el-form-item>
          <el-form-item label="音效">
            <el-select v-model="videoSfx" placeholder="无" clearable style="width: 160px">
              <el-option label="无" value="" />
            </el-select>
          </el-form-item>
          <el-form-item label="画质">
            <el-select v-model="videoQuality" style="width: 120px">
              <el-option label="高" value="high" />
              <el-option label="中" value="medium" />
            </el-select>
          </el-form-item>
          -->
          <el-form-item label="字幕">
            <div class="video-option-row">
              <el-switch v-model="videoSubtitle" />
              <span v-if="videoSubtitle" class="video-option-hint">开启后，合成整集时会检测解说旁白：若有文案则自动生成 SRT、按分镜时长合成旁白语音（过长加速 / 过短补静音）、与成片对齐后烧录字幕并混音。</span>
            </div>
          </el-form-item>
          <el-form-item label="对白烧录">
            <div class="video-option-row">
              <el-switch v-model="videoBurnDialogue" />
              <span v-if="videoBurnDialogue" class="video-option-hint">开启后，将把各镜「配音」生成的对白 TTS 按分镜时长对齐并混入整集成片（无对白音频的分镜为静音）。可与「字幕」旁白同时开启，两条音轨会叠混。</span>
            </div>
          </el-form-item>
          <el-form-item label="水印">
            <div class="video-option-row">
              <el-switch v-model="videoWatermark" />
              <el-input
                v-if="videoWatermark"
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
          <dl><div><dt>字幕</dt><dd>{{ videoSubtitle ? '开启' : '关闭' }}</dd></div><div><dt>对白</dt><dd>{{ videoBurnDialogue ? '开启' : '关闭' }}</dd></div><div><dt>水印</dt><dd>{{ videoWatermark ? '开启' : '关闭' }}</dd></div></dl>
        </div>
      </section>

      <!-- 8. 合成视频 -->
      <section v-show="workflowStage === 'merge'" id="anchor-video" class="section card merge-output">
        <h2 class="section-title">合成视频</h2>
        <div class="merge-readiness" :class="{ ready: mergeReadiness.total > 0 && mergeReadiness.missing === 0 }">
          <b>镜头就绪：{{ mergeReadiness.ready }} / {{ mergeReadiness.total }}</b>
          <span v-if="mergeReadiness.missing">还有 {{ mergeReadiness.missing }} 个分镜没有可用于合成的视频。</span>
          <span v-else-if="mergeReadiness.total">全部分镜视频已就绪，可以合成当前集。</span>
          <span v-else>请先在分镜管理中生成镜头视频。</span>
        </div>
        <div v-if="storyboards.length" class="merge-shot-grid" aria-label="分镜视频就绪状态">
          <button v-for="(shot, index) in storyboards" :key="shot.id" type="button" :class="{ ready: getSbAllVideos(shot.id).length > 0 }" :title="`镜头 ${index + 1}：${getSbAllVideos(shot.id).length > 0 ? '已就绪' : '缺少视频'}`" @click="getSbAllVideos(shot.id).length === 0 && setWorkflowStage('storyboard')"><span>{{ String(index + 1).padStart(2, '0') }}</span><i></i></button>
        </div>
        <el-button v-if="mergeReadiness.missing" plain @click="setWorkflowStage('storyboard')">返回分镜补齐视频</el-button>
        <el-button
          type="primary"
          size="large"
          :loading="videoStatus === 'generating'"
          :disabled="!currentEpisodeId || mergeReadiness.total === 0 || mergeReadiness.missing > 0 || videoStatus === 'generating'"
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
      <el-form label-width="90px">
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <div class="ref-image-box" @click="addPropAddRefFileInput?.click()" @drop.prevent="onRefImageDrop2('addProp', $event)" @dragover.prevent>
              <img v-if="addPropAddRefImage" :src="addPropAddRefImage.dataUrl" class="ref-preview-img" />
              <div v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></div>
            </div>
            <div v-if="addPropAddRefImage" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingPropAddDesc" @click="doExtractFromRef2('addProp')">提取特征描述</el-button>
              <el-button size="small" @click="addPropAddRefImage = null">移除</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="addPropForm.name" placeholder="道具名称" />
        </el-form-item>
        <el-form-item label="类型">
          <el-input v-model="addPropForm.type" placeholder="如：物品、建筑" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="addPropForm.description" type="textarea" :rows="3" placeholder="描述" />
        </el-form-item>
        <el-form-item label="图生提示词">
          <el-input v-model="addPropForm.prompt" type="textarea" :rows="2" placeholder="用于 AI 生成图片的提示词" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddProp = false">取消</el-button>
        <el-button type="primary" :loading="addPropSaving" :disabled="!addPropForm.name.trim()" @click="submitAddProp">确定</el-button>
      </template>
    </el-dialog>

    <!-- 隐藏的文件输入框（放在弹窗外层，避免 el-form-item 干扰） -->
    <input ref="addCharRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange('character', $event)" />
    <input ref="addSceneRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange('scene', $event)" />
    <input ref="addPropRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange('prop', $event)" />
    <input ref="addPropAddRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange2('addProp', $event)" />

    <!-- 添加/编辑角色弹窗 -->
    <el-dialog v-model="showEditCharacter" :title="editCharacterForm?.id ? '编辑角色' : '添加角色'" width="75%" @close="onCloseCharDialog">
      <el-form v-if="editCharacterForm" label-width="90px">
        <!-- 参考图上传区（新增/编辑均显示） -->
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <div class="ref-image-box" @click="addCharRefFileInput?.click()" @drop.prevent="onRefImageDrop('character', $event)" @dragover.prevent>
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
            </div>
            <div v-if="addCharRefImage" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingCharAppearance" @click="doExtractFromRef('character')">提取特征描述</el-button>
              <el-button size="small" @click="addCharRefImage = null">移除</el-button>
            </div>
            <div v-else-if="editCharacterForm.ref_image" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingCharAppearance" @click="doExtractCharFromImage">从参考图提取描述</el-button>
              <el-button size="small" @click="clearCharRefImage">移除参考图</el-button>
            </div>
            <div v-else-if="editCharacterForm.id && (editCharacterForm.image_url || editCharacterForm.local_path) && !editCharacterForm.appearance" class="ref-actions">
              <el-button size="small" :loading="extractingCharAppearance" @click="doExtractCharFromImage">从主图提取描述</el-button>
            </div>
            <div class="ref-upload-tip">支持 jpg/png/gif/webp，单张不超过 {{ MAX_IMAGE_SIZE_MB }}MB</div>
          </div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="editCharacterForm.name" placeholder="角色名称" />
        </el-form-item>
        <el-form-item label="身份/定位">
          <el-select v-model="editCharacterForm.role" placeholder="请选择角色类型" style="width:200px">
            <el-option value="main" label="主角" />
            <el-option value="supporting" label="配角" />
            <el-option value="minor" label="次要角色" />
          </el-select>
        </el-form-item>
        <el-form-item label="外貌描述">
          <el-input v-model="editCharacterForm.appearance" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" placeholder="用于 AI 生成图像的外貌描述，尽量详细" />
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model="editCharacterForm.description" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="角色背景简介，供剧本生成参考" />
        </el-form-item>
        <el-form-item v-if="editCharacterForm.id">
          <template #label>
            <span style="font-size:12px;line-height:1.4;white-space:normal;word-break:break-all;display:inline-block;width:90px">图生提示词</span>
          </template>
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">AI 润色后的最终提示词，生成四视图图片时直接使用；可手动修改</span>
              <el-button
                size="small"
                :loading="editCharacterPromptGenerating"
                @click="doGenerateCharacterPrompt"
              >重新生成提示词</el-button>
            </div>
            <el-input
              v-model="editCharacterForm.polished_prompt"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 16 }"
              :placeholder="editCharacterPromptGenerating ? 'AI 正在生成提示词，请稍候…' : '点击「重新生成提示词」由 AI 自动生成，或直接在此输入'"
              :disabled="editCharacterPromptGenerating"
              style="font-size:12px"
            />
          </div>
        </el-form-item>
        <!-- P0-2: 视觉锚点（identity_anchors） -->
        <el-form-item v-if="editCharacterForm.id" label="视觉锚点">
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">AI 从外貌描述提炼的6层视觉特征，用于保持生成图片角色一致性</span>
              <el-button
                size="small"
                :loading="extractingAnchors"
                :disabled="!editCharacterForm.appearance"
                @click="extractIdentityAnchors"
              >提炼视觉锚点</el-button>
            </div>
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
          </div>
        </el-form-item>
        <!-- P1-3: 多阶段造型（stages） -->
        <el-form-item v-if="editCharacterForm.id" label="多阶段造型">
          <div style="width:100%">
            <div style="font-size:12px;color:#909399;margin-bottom:6px">
              不同集次的角色造型变化，格式：JSON 数组 [{"episode_range":[1,3],"appearance":"..."}]
            </div>
            <el-input
              v-model="editCharacterForm.stages"
              type="textarea"
              :rows="4"
              placeholder='例：[{"episode_range":[1,5],"appearance":"白衣少年"},{"episode_range":[6,10],"appearance":"黑衣武者"}]'
              style="font-size:12px;font-family:monospace"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditCharacter = false">取消</el-button>
        <el-button type="primary" :loading="editCharacterSaving" :disabled="!editCharacterForm?.name?.trim()" @click="submitEditCharacter">{{ editCharacterForm?.id ? '保存' : '添加' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showCharSd2Cert"
      title="SD2 认证详情"
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
          <el-descriptions-item label="注册图片 URL">
            <span class="sd2-cert-value">{{ charSd2CertPayload.source_image_url || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item v-if="charSd2CertPayload.sd2_provider" label="认证提供方">
            <span class="sd2-cert-value">{{ charSd2CertPayload.sd2_provider }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </template>
      <template #footer>
        <el-button @click="showCharSd2Cert = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 编辑道具弹窗 -->
    <el-dialog v-model="showEditProp" :title="editPropForm?.id ? '编辑道具' : '添加道具'" width="75%" @close="onClosePropDialog">
      <el-form v-if="editPropForm" label-width="90px">
        <!-- 参考图上传区（新增/编辑均显示） -->
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <div class="ref-image-box" @click="addPropRefFileInput?.click()" @drop.prevent="onRefImageDrop('prop', $event)" @dragover.prevent>
              <img v-if="addPropRefImage" :src="addPropRefImage.dataUrl" class="ref-preview-img" />
              <img v-else-if="editPropForm.ref_image"
                :src="editPropForm.ref_image.startsWith('http') ? editPropForm.ref_image : '/static/' + editPropForm.ref_image"
                class="ref-preview-img" />
              <img v-else-if="editPropForm.id && (editPropForm.image_url || editPropForm.local_path)"
                :src="assetImageUrl(editPropForm)" class="ref-preview-img" style="opacity:0.5" />
              <div v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></div>
            </div>
            <div v-if="addPropRefImage" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingPropDesc" @click="doExtractFromRef('prop')">提取特征描述</el-button>
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
          <el-input v-model="editPropForm.name" placeholder="道具名称" />
        </el-form-item>
        <el-form-item label="类型">
          <el-input v-model="editPropForm.type" placeholder="如：物品、建筑" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editPropForm.description" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="道具描述" />
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
              :disabled="editPropPromptGenerating"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditProp = false">取消</el-button>
        <el-button type="primary" :loading="editPropSaving" :disabled="!editPropForm?.name?.trim()" @click="submitEditProp">保存</el-button>
      </template>
    </el-dialog>

    <!-- 添加/编辑场景弹窗 -->
    <el-dialog v-model="showEditScene" :title="editSceneForm?.id ? '编辑场景' : '添加场景'" width="75%" @close="onCloseSceneDialog">
      <el-form v-if="editSceneForm" label-width="90px">
        <!-- 参考图上传区（新增/编辑均显示） -->
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <div class="ref-image-box" @click="addSceneRefFileInput?.click()" @drop.prevent="onRefImageDrop('scene', $event)" @dragover.prevent>
              <img v-if="addSceneRefImage" :src="addSceneRefImage.dataUrl" class="ref-preview-img" />
              <img v-else-if="editSceneForm.ref_image"
                :src="editSceneForm.ref_image.startsWith('http') ? editSceneForm.ref_image : '/static/' + editSceneForm.ref_image"
                class="ref-preview-img" />
              <img v-else-if="editSceneForm.id && (editSceneForm.image_url || editSceneForm.local_path)"
                :src="assetImageUrl(editSceneForm)" class="ref-preview-img" style="opacity:0.5" />
              <div v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></div>
            </div>
            <div v-if="addSceneRefImage" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingSceneDesc" @click="doExtractFromRef('scene')">提取特征描述</el-button>
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
          <el-input v-model="editSceneForm.location" placeholder="如：森林、教室" />
        </el-form-item>
        <el-form-item label="时间">
          <el-input v-model="editSceneForm.time" placeholder="如：白天、傍晚" />
        </el-form-item>
        <el-form-item label="场景描述">
          <el-input v-model="editSceneForm.prompt" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="场景的简要描述，供 AI 生成四视图时参考" />
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
              v-model="editSceneForm.polished_prompt_single"
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
              :disabled="editScenePromptGenerating"
              style="font-size:12px"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditScene = false">取消</el-button>
        <el-button type="primary" :loading="editSceneSaving" :disabled="!editSceneForm?.location?.trim()" @click="submitEditScene">{{ editSceneForm?.id ? '保存' : '添加' }}</el-button>
      </template>
    </el-dialog>

    <!-- 角色资源库（本剧库 / 本剧全部角色 / 团队库） -->
    <el-dialog v-model="showCharLibrary" title="角色资源库" width="720px" destroy-on-close class="library-dialog" @open="onCharLibraryDialogOpen">
      <el-tabs v-model="charLibraryTab" class="char-library-tabs" @tab-change="onCharLibraryTabChange">
        <el-tab-pane label="本剧角色库" name="library">
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
                  <el-button size="small" type="danger" plain @click="onDeleteCharLibrary(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!charLibraryLoading && charLibraryList.length === 0" class="library-empty">暂无本剧角色库记录，可将本剧角色「加入本剧库」后在此查看</div>
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
      <el-form v-if="editCharLibraryForm" label-width="80px">
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
    <el-dialog v-model="showPropLibrary" title="道具资源库" width="720px" destroy-on-close class="library-dialog" @open="onPropLibraryDialogOpen">
      <el-tabs v-model="propLibraryTab" class="char-library-tabs" @tab-change="onPropLibraryTabChange">
        <el-tab-pane label="本剧道具库" name="library">
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
                  <el-button size="small" type="danger" plain @click="onDeletePropLibrary(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!propLibraryLoading && propLibraryList.length === 0" class="library-empty">暂无本剧道具库记录，可将本剧道具「加入本剧库」后在此查看</div>
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
      <el-form v-if="editPropLibraryForm" label-width="80px">
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
    <el-dialog v-model="showSceneLibrary" title="场景资源库" width="720px" destroy-on-close class="library-dialog" @open="onSceneLibraryDialogOpen">
      <el-tabs v-model="sceneLibraryTab" class="char-library-tabs" @tab-change="onSceneLibraryTabChange">
        <el-tab-pane label="本剧场景库" name="library">
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
                  <el-button size="small" type="danger" plain @click="onDeleteSceneLibrary(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!sceneLibraryLoading && sceneLibraryList.length === 0" class="library-empty">暂无本剧场景库记录，可将本剧场景「加入本剧库」后在此查看</div>
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
      <el-form v-if="editSceneLibraryForm" label-width="80px">
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

    <!-- 分镜提示词编辑弹窗 -->
    <el-dialog
      v-model="showSbPromptDialog"
      :title="`分镜 ${sbPromptTarget?.storyboard_number ?? ''} · 编辑提示词`"
      width="700px"
      @close="sbPromptTarget = null"
    >
      <el-form v-if="sbPromptTarget" label-width="0" class="sb-prompt-dialog-form">
        <!-- 图片区 -->
        <div class="sb-prompt-section-title">🖼 图片提示词</div>
        <el-form-item label="">
          <div style="width:100%">
            <div style="font-size:12px; color:#6b7280; margin-bottom:4px;">原始提示词（分镜生成时写入，仅供参考）</div>
            <el-input
              v-model="sbPromptImageText"
              type="textarea"
              :rows="4"
              placeholder="分镜生成时由 AI 写入的原始描述"
            />
          </div>
        </el-form-item>
        <el-form-item label="">
          <div style="width:100%">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <span style="font-size:12px; color:#6b7280;">通用优化提示词（仅更新本字段，不影响首尾帧/关键帧专用提示词）</span>
              <el-button
                size="small"
                type="warning"
                plain
                :loading="sbPromptPolishing"
                @click="onPolishSbPrompt"
              >{{ sbPromptPolishedText ? '重新生成' : '立即生成' }}</el-button>
            </div>
            <el-input
              v-model="sbPromptPolishedText"
              type="textarea"
              :rows="5"
              placeholder="点击「立即生成」润色通用优化提示词（仅更新本字段，不影响首尾帧专用提示词）"
            />
          </div>
        </el-form-item>
        <!-- 视频区 -->
        <div class="sb-prompt-section-title" style="margin-top:12px;">🎬 视频提示词</div>
        <el-form-item label="">
          <el-input
            v-model="sbPromptVideoText"
            type="textarea"
            :rows="12"
            placeholder="视频生成提示词（可选，留空则由系统自动生成）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showSbPromptDialog = false">取消</el-button>
        <el-button type="primary" :loading="sbPromptSaving" @click="onSaveSbPromptDialog">保存</el-button>
      </template>
    </el-dialog>

    <!-- 首尾帧提示词编辑器（显示最终发给AI的完整提示词，支持编辑保存） -->
    <el-dialog
      v-model="showFramePromptEditor"
      :title="`${editingFramePromptSlot === 'last' ? '尾帧' : '首帧'}图生提示词 · 编辑`"
      width="720px"
      destroy-on-close
    >
      <div class="frame-prompt-editor-body">
        <div class="frame-prompt-editor-hint">
          此提示词将直接发给AI生成首/尾帧图片。支持编辑后保存，保存后点击「生成」即可使用新提示词。
        </div>

        <!-- 空间布局锚点（生成分镜时 AI 输出的最高优先级站位合同） -->
        <div v-if="editingFramePromptSb?.layout_description" class="frame-layout-anchor">
          <div class="frame-layout-anchor-label">本分镜空间布局锚点（首尾帧强制一致合同，最高优先级）</div>
          <div class="frame-layout-anchor-text">{{ editingFramePromptSb.layout_description }}</div>
          <div class="frame-layout-anchor-note">首帧必须严格按此生成初始站位；尾帧必须在完全相同的左右位置、距离、构图下仅演化姿态/表情/结果。</div>
        </div>

        <el-input
          v-model="editingFramePromptText"
          type="textarea"
          :rows="14"
          placeholder="在此编辑最终发给AI生图的完整提示词..."
          class="frame-prompt-editor-textarea"
        />
      </div>
      <template #footer>
        <el-button @click="showFramePromptEditor = false">关闭</el-button>
        <el-button :loading="editingFramePromptRegenerating" @click="regenerateEditingFramePrompt">重新生成</el-button>
        <el-button type="primary" :loading="editingFramePromptSaving" @click="saveEditingFramePrompt">保存</el-button>
      </template>
    </el-dialog>

    <!-- 分镜视频参数编辑弹窗 -->
    <el-dialog
      v-model="showVideoParamsDialog"
      :title="`分镜 ${videoParamsTarget?.storyboard_number ?? ''} · 视频参数`"
      width="860px"
      destroy-on-close
      @close="onVideoParamsDialogClosed"
    >
      <el-form v-if="videoParamsTarget" label-width="115px" size="small" class="vp-dialog-form">
        <el-form-item label="创作模式">
          <el-radio-group
            :model-value="sbCreationMode[videoParamsTarget.id] === 'universal' ? 'universal' : 'classic'"
            size="small"
            @change="(v) => setSbCreationModeId(videoParamsTarget.id, v)"
          >
            <el-radio-button value="classic">经典分镜</el-radio-button>
            <el-radio-button value="universal">全能模式</el-radio-button>
          </el-radio-group>
          <div class="vp-mode-hint">全能模式：中间为片段描述；生视频时使用 <strong>AI 配置里当前启用的视频</strong>（接口规范 <code>kling_omni</code> 或 <code>volcengine_omni</code>，模型如 <code>kling-video-o1</code>、<code>doubao-seedance-2-0-260128</code> 等）并合并场景/角色/道具等参考图（不含经典分镜主图）。经典字段保留，可随时切回。</div>
        </el-form-item>
        <el-form-item label="生成参数">
          <GenerationSettings :model-value="sbGenerationSettings[videoParamsTarget.id] || {}" :show-text-model="true" @update:model-value="setSbGenerationSettings(videoParamsTarget.id, $event)" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="标题">
              <el-input v-model="sbTitle[videoParamsTarget.id]" placeholder="镜头标题" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="地点">
              <el-input v-model="sbLocation[videoParamsTarget.id]" placeholder="场景地点" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="时间">
              <el-input v-model="sbTime[videoParamsTarget.id]" placeholder="清晨/午后" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="6">
            <el-form-item label="景别">
              <el-select v-model="sbShotType[videoParamsTarget.id]" placeholder="景别" style="width:100%">
                <el-option label="大远景" value="大远景" />
                <el-option label="远景" value="远景" />
                <el-option label="中景" value="中景" />
                <el-option label="近景" value="近景" />
                <el-option label="特写" value="特写" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="运镜">
              <el-select v-model="sbMovement[videoParamsTarget.id]" placeholder="运镜（推荐动态）" style="width:100%" clearable filterable>
                <el-option-group label="基础运镜">
                  <el-option label="固定（少用）" value="static" />
                  <el-option label="推镜" value="push" />
                  <el-option label="拉镜" value="pull" />
                  <el-option label="横摇（左/右）" value="pan" />
                  <el-option label="纵摇（上/下）" value="tilt" />
                  <el-option label="跟镜/跟踪" value="tracking" />
                  <el-option label="升镜（吊臂上升）" value="crane_up" />
                  <el-option label="降镜（吊臂下降）" value="crane_dn" />
                  <el-option label="环绕/轨道" value="orbit" />
                  <el-option label="手持/晃动" value="handheld" />
                </el-option-group>
                <el-option-group label="进阶运镜">
                  <el-option label="变焦（zoom in/out）" value="zoom" />
                  <el-option label="旋转/滚镜（roll）" value="roll" />
                  <el-option label="甩镜/急摇" value="whip_pan" />
                  <el-option label="螺旋上升/下降" value="spiral" />
                </el-option-group>
                <el-option-group label="电影化组合镜头">
                  <el-option label="希区柯克镜头（推+变焦）" value="hitchcock_zoom" />
                  <el-option label="子弹时间（环绕+升格）" value="bullet_time" />
                  <el-option label="荷兰角+运镜" value="dutch_angle_move" />
                  <el-option label="推轨复合（dolly+track）" value="dolly_track" />
                  <el-option label="升格环绕（slow-mo orbit）" value="slowmo_orbit" />
                </el-option-group>
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="氛围">
              <el-input v-model="sbAtmosphere[videoParamsTarget.id]" placeholder="氛围/情绪" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="镜头视角">
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                <el-select v-model="sbAngleS[videoParamsTarget.id]" placeholder="景别" style="width:76px">
                  <el-option label="特写" value="close_up" />
                  <el-option label="中景" value="medium" />
                  <el-option label="远景" value="wide" />
                </el-select>
                <el-select v-model="sbAngleV[videoParamsTarget.id]" placeholder="俯仰" style="width:86px">
                  <el-option label="平视" value="eye_level" />
                  <el-option label="低角仰拍" value="low" />
                  <el-option label="高角俯拍" value="high" />
                  <el-option label="虫眼仰视" value="worm" />
                </el-select>
                <el-select v-model="sbAngleH[videoParamsTarget.id]" placeholder="方向" style="width:80px">
                  <el-option label="正面" value="front" />
                  <el-option label="前左45°" value="front_left" />
                  <el-option label="左侧" value="left" />
                  <el-option label="后左135°" value="back_left" />
                  <el-option label="背面" value="back" />
                  <el-option label="后右135°" value="back_right" />
                  <el-option label="右侧" value="right" />
                  <el-option label="前右45°" value="front_right" />
                </el-select>
                <span v-if="sbAngleS[videoParamsTarget.id] && sbAngleV[videoParamsTarget.id] && sbAngleH[videoParamsTarget.id]"
                      style="font-size:11px;color:#6b7280;background:#f3f4f6;padding:2px 6px;border-radius:4px;white-space:nowrap">
                  {{ angleToPromptFragment(sbAngleH[videoParamsTarget.id], sbAngleV[videoParamsTarget.id], sbAngleS[videoParamsTarget.id]).label }}
                </span>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="灯光">
              <el-select v-model="sbLighting[videoParamsTarget.id]" placeholder="灯光风格" style="width:100%" clearable>
                <el-option label="自然光" value="natural" />
                <el-option label="顺光" value="front" />
                <el-option label="侧光" value="side" />
                <el-option label="逆光" value="backlit" />
                <el-option label="顶光" value="top" />
                <el-option label="底光" value="under" />
                <el-option label="柔光" value="soft" />
                <el-option label="戏剧光" value="dramatic" />
                <el-option label="黄金时段" value="golden_hour" />
                <el-option label="蓝调时刻" value="blue_hour" />
                <el-option label="夜景" value="night" />
                <el-option label="霓虹" value="neon" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="景深">
              <el-select v-model="sbDof[videoParamsTarget.id]" placeholder="景深" style="width:100%" clearable>
                <el-option label="极浅景深" value="extreme_shallow" />
                <el-option label="浅景深" value="shallow" />
                <el-option label="中景深" value="medium" />
                <el-option label="深景深（全焦）" value="deep" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 空间布局锚点：生成分镜时 AI 输出的最高优先级人物站位合同（首尾帧强制一致核心） -->
        <el-form-item label="空间布局锚点（首尾帧人物站位合同）">
          <div style="display:flex; gap:8px; align-items:flex-start; width:100%">
            <el-input
              v-model="sbLayoutDescription[videoParamsTarget.id]"
              type="textarea"
              :rows="3"
              placeholder="例如：女主站画面左三分之一正对镜头，男主站右后侧侧身看向女主，中景，双人构图，平衡稳定"
              style="flex:1"
            />
            <el-button
              size="small"
              :loading="regeneratingLayoutSbIds.has(videoParamsTarget.id)"
              @click="onRegenerateLayoutDescription(videoParamsTarget)"
              style="margin-top:4px; white-space:nowrap"
            >
              AI 重新生成/优化
            </el-button>
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;line-height:1.35">
            最高优先级空间合同（用于首尾帧站位锁定）。AI 可参考上下分镜一键重新生成/优化，点击右侧按钮触发。
          </div>
        </el-form-item>

        <el-form-item label="动作">
          <el-input v-model="sbAction[videoParamsTarget.id]" type="textarea" :rows="2" placeholder="动作描述" />
        </el-form-item>
        <el-form-item label="对白">
          <el-input v-model="sbDialogue[videoParamsTarget.id]" type="textarea" :rows="2" placeholder="角色对白" />
        </el-form-item>
        <el-form-item label="解说旁白">
          <el-input v-model="sbNarration[videoParamsTarget.id]" type="textarea" :rows="2" class="sb-narration-input" placeholder="画外解说 / 纪录片式旁白（与对白分开）" />
        </el-form-item>
        <el-form-item v-if="canSplitSbByAudio(videoParamsTarget)" label="多角色对白">
          <div class="sb-split-audio-row">
            <p class="sb-split-audio-tip">
              本镜含多句对白或「对白+旁白」，Seedance 同镜易串音。可拆成多条分镜（每条仅一人说话或仅旁白），再分别生视频。
            </p>
            <el-button
              type="warning"
              plain
              :loading="splitByAudioLoading"
              @click="onSplitSbByAudio(videoParamsTarget)"
            >
              按对白拆镜
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="画面结果">
          <el-input v-model="sbResult[videoParamsTarget.id]" type="textarea" :rows="2" placeholder="动作完成后的画面结果" />
        </el-form-item>
        <el-form-item label="视频提示词">
          <div class="vp-video-prompt-hint">保存后将根据上方字段，由系统按最新规则自动生成（含角色音色锚点）。</div>
          <el-input
            v-if="videoParamsTarget?.video_prompt"
            :model-value="videoParamsTarget.video_prompt"
            type="textarea"
            :rows="3"
            readonly
            style="color:#6b7280;margin-top:8px"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showVideoParamsDialog = false">取消</el-button>
        <el-button type="primary" :loading="videoParamsSaving" @click="onSaveVideoParams">保存并更新</el-button>
      </template>
    </el-dialog>

    <!-- P1-2: 导入小说弹窗 -->
    <el-dialog v-model="showNovelImport" title="导入小说/长文" width="600px" @close="novelImportReset">
      <div class="novel-import-dialog">
        <p style="color:#6b7280;font-size:13px;margin-bottom:12px">支持粘贴小说文本或上传 txt 文件，AI 自动识别章节并转换为剧本集数</p>
        <el-tabs v-model="novelImportMode">
          <el-tab-pane label="粘贴文本" name="text">
            <el-input
              v-model="novelText"
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
            <el-input-number v-model="novelMaxChapters" :min="1" :max="20" size="small" style="width:100px" />
          </div>
          <el-checkbox v-model="novelAiSummarize" size="small">AI 转换为剧本格式（会消耗 Token）</el-checkbox>
        </div>
      </div>
      <template #footer>
        <el-button @click="showNovelImport = false">取消</el-button>
        <el-button type="primary" :loading="novelImporting" @click="onImportNovel">开始导入</el-button>
      </template>
    </el-dialog>

    <!-- 全能首尾帧参考图选择 -->
    <el-dialog v-model="sbOmniFramePicker.open" :title="(sbOmniFramePicker.target === 'first' ? '选择首帧' : '选择尾帧') + '（全能模式）'" width="560px" destroy-on-close>
      <div class="sb-omni-frame-picker-grid">
        <article
          v-for="asset in sbOmniFramePickerImages"
          :key="asset.id"
          class="sb-omni-frame-picker-card"
          :class="{ active: sbOmniFramePickerActive(sbOmniFramePicker.sbId, sbOmniFramePicker.target, asset.id) }"
          @click="confirmSbOmniFrameAsset(asset)"
        >
          <img :src="sbOmniAssetUrl(asset)" alt="" />
          <small>{{ asset.name || `素材${asset.id}` }}</small>
        </article>
      </div>
      <div v-if="!sbOmniFramePickerImages.length" class="sb-omni-frame-picker-empty">暂无图片素材，请先点击分镜里的「上传」添加参考图</div>
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
import { ref, computed, onMounted, onBeforeUnmount, watch, reactive, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Setting, Plus, Minus, Sunny, Moon, MagicStick, Upload, Delete, Check, Loading, WarningFilled, User, Box, Picture, Film, VideoCamera, Document, InfoFilled, Refresh, ZoomIn, QuestionFilled, DocumentAdd, Expand, Fold, VideoPlay, Grid, Close } from '@element-plus/icons-vue'
import { useTheme } from '@/composables/useTheme'
import { beginAssetPointerDrag, shouldSuppressAssetClick } from '@/utils/assetPointerDrag'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'
import GenerationSettings from '@/components/GenerationSettings.vue'
import { useFilmStore } from '@/stores/film'
import { useGenerationTaskStore, GEN_RESOURCE } from '@/stores/generationTaskStore'
import { syncGeneratingSetsFromStore, buildEpisodeContext, buildExtractTaskMeta, isEpisodeExtractRunning } from '@/composables/useGenerationTaskSync'
import { dramaAPI } from '@/api/drama'
import { generationAPI } from '@/api/generation'
import { aiAPI } from '@/api/ai'
import { characterAPI } from '@/api/characters'
import { propAPI } from '@/api/props'
import { sceneAPI } from '@/api/scenes'
import { taskAPI } from '@/api/task'
import { imagesAPI } from '@/api/images'
import { videosAPI } from '@/api/videos'
import { omniVideoAPI } from '@/api/omniVideo'
import { storyboardsAPI } from '@/api/storyboards'
import { uploadAPI } from '@/api/upload'
import { characterLibraryAPI } from '@/api/characterLibrary'
import { sceneLibraryAPI } from '@/api/sceneLibrary'
import { propLibraryAPI } from '@/api/propLibrary'
import { generationSettingsAPI } from '@/api/prompts'
import { parseScriptIntoEpisodes, episodesListToPlainScript } from '@/utils/scriptEpisodes'
import { exportStoryboardSheet } from '@/utils/exportStoryboardSheet'
import { formatChinaTime } from '@/utils/time'
import { insertTokenAtOffset } from '@/utils/promptInsertion'
import { setTransparentDragPreview } from '@/utils/dragPreview'
import StylePickerButton from '@/components/StylePickerButton.vue'
import AIConfigContent from '@/components/AIConfigContent.vue'
import UniversalSegmentOmniAtEditor from '@/components/UniversalSegmentOmniAtEditor.vue'
import FreeCreate from '@/views/FreeCreate.vue'
import { clearPromptDraft, currentDraftUserId, readPromptDraft, shouldRestorePromptDraft, writePromptDraft } from '@/utils/promptDraft'
import {
  generationStyleOptions,
  getStylePromptEn,
  getStylePromptZh,
  stylePromptMetadataForSave,
  backfillDramaStylePromptMetadataIfNeeded,
} from '@/constants/styleOptions'
import { MAX_IMAGE_SIZE_MB, checkImageFile } from '@/constants/uploadLimits'
import { useNavigation } from '@/composables/filmCreate/useNavigation'
import { runGenerateStoryFromPremise } from '@/composables/useStoryGeneration'
import { useCharacters } from '@/composables/filmCreate/useCharacters'
import { useProps as usePropsComposable } from '@/composables/filmCreate/useProps'
import { useScenes } from '@/composables/filmCreate/useScenes'

const route = useRoute()
const router = useRouter()
const store = useFilmStore()
const genStore = useGenerationTaskStore()
const { isDark, toggle: toggleTheme } = useTheme()
const { videoResolution: storeVideoResolution } = storeToRefs(store)
const isAdmin = computed(() => JSON.parse(localStorage.getItem('lmd_auth_user') || 'null')?.console_access === true)

// ── Composable: Navigation ─────────────────────────────
const { navCollapsed, storyboardMenuExpanded, toggleNav, scrollToTop, scrollToAnchor } = useNavigation()

function goList() {
  router.push('/')
}

function goCanvasMode() {
  if (!dramaId.value) return
  const query = selectedEpisodeId.value ? { episode: String(selectedEpisodeId.value) } : {}
  router.push({ path: `/film/${dramaId.value}/canvas`, query })
}


const showAiConfigDialog = ref(false)
watch(showAiConfigDialog, (open) => {
  if (!open) invalidateActiveVideoAiConfigCache()
})
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
/** 全能素材库：上传 / 拖拽 / 首尾帧上传 共享状态 */
const sbOmniFileInput = ref(null)
const sbOmniFrameFileInput = ref(null)
const sbOmniUploadTargetId = ref(null)
const sbOmniUploadingIds = ref(new Set())
const sbOmniFrameUploadTarget = ref(null)
const sbOmniFrameUploading = ref('')
const sbOmniCertifyingIds = ref(new Set())
const sbOmniLibDragging = ref(false)
const sbUniversalUploadLimits = ref(null)
const sbOmniFramePicker = ref({ open: false, sbId: null, target: 'first' })
const sbOmniShotLimits = computed(() => {
  const shot = sbUniversalUploadLimits.value?.shot
  return { total: shot?.total ?? 12, image: shot?.image ?? 9, video: shot?.video ?? 3, audio: shot?.audio ?? 3 }
})
const sbUniversalUploadLimitNote = computed(() => {
  const files = sbUniversalUploadLimits.value?.files
  if (!files) return '上传后自动加入本镜，可在素材库面板调整用途与顺序'
  return `单文件：图片 ${files.image?.max_mb || 30}MB、视频 ${files.video?.max_mb || 50}MB、音频 ${files.audio?.max_mb || 15}MB；本镜最多 ${sbOmniShotLimits.value.total} 个素材。`
})
const sbOmniFramePickerImages = computed(() => universalLibraryAssets.value.filter((a) => a.type === 'image'))
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
const videoMusic = ref('')
const videoSfx = ref('')
const videoQuality = ref('high')
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
const WORKFLOW_STAGE_KEYS = ['script', 'resources', 'storyboard', 'merge']
function normalizeWorkflowStage(value) {
  const stage = Array.isArray(value) ? value[0] : value
  return WORKFLOW_STAGE_KEYS.includes(stage) ? stage : 'script'
}
const workflowStage = ref(normalizeWorkflowStage(route.query.stage))
const showLegacyPipeline = ref(false)
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
function navigateWorkflowStep(step) {
  setWorkflowStage(step)
  nextTick(() => {
    const anchor = step === 'script' ? 'anchor-script' : step === 'storyboard' ? 'anchor-storyboard' : step === 'merge' ? 'anchor-video' : null
    if (anchor) scrollToAnchor(anchor)
    else window.scrollTo({ top: 0, behavior: 'smooth' })
  })
}
/** 当前操作分镜（左侧素材编排面板作用目标）：默认第一个分镜，点击分镜卡片切换 */
const activeSbId = ref(null)
const sbAutoPlayId = ref(null)
const activeSb = computed(() => {
  const list = storyboards.value || []
  const found = list.find((s) => Number(s.id) === Number(activeSbId.value))
  return found || list[0] || null
})
function setActiveSbId(id) {
  activeSbId.value = id != null ? Number(id) : null
  sbAutoPlayId.value = id != null ? Number(id) : null
}
watch(
  () => storyboards.value?.length,
  () => {
    if (activeSbId.value == null || !(storyboards.value || []).some((s) => Number(s.id) === Number(activeSbId.value))) {
      activeSbId.value = (storyboards.value || [])[0]?.id ?? null
    }
  },
  { immediate: true }
)
const currentEpisode = computed(() => store.currentEpisode)
const currentEpisodeId = computed(() => store.currentEpisode?.id ?? null)
const videoProgress = computed(() => store.videoProgress)
const videoStatus = computed(() => store.videoStatus)
const mergeReadiness = computed(() => {
  const total = storyboards.value.length
  const ready = storyboards.value.filter((sb) => getSbAllVideos(sb.id).length > 0).length
  return { total, ready, missing: Math.max(0, total - ready) }
})

function trackFilmCreateAction(_action, _payload = {}) {
  // 单机版：无埋点上报
}
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
  charRoleLabel, onGenerateCharacters: onGenerateCharactersRaw, openAddCharacter, stopCharacterPromptPoll, editCharacter,
  saveCharRefImageIfAny, submitEditCharacter, doGenerateCharacterPrompt, doExtractCharFromImage,
  extractIdentityAnchors, clearCharRefImage, onCloseCharDialog, onDeleteCharacter, onGenerateCharacterImage, onSd2CertifyCharacter, onSd2CertifyRefresh, sd2ActionLabel, onSd2PrimaryAction, openCharSd2CertDialog,
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
  onExtractProps: onExtractPropsRaw, stopPropPromptPoll, editProp, doGeneratePropPrompt, savePropRefImageIfAny,
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
  onExtractScenes: onExtractScenesRaw, openAddScene, stopScenePromptPoll, editScene, doGenerateScenePrompt, doGenerateSceneSinglePrompt,
  saveSceneRefImageIfAny, clearSceneRefImage, doExtractSceneFromImage, submitEditScene,
  onCloseSceneDialog, onDeleteScene, onGenerateSceneImage,
  loadSceneLibraryList, debouncedLoadSceneLibrary, loadDramaAllSceneList, debouncedLoadDramaAllSceneList,
  onSceneLibraryDialogOpen, onSceneLibraryTabChange, isSceneAddToEpisodeLoading,
  openEditSceneLibrary, submitEditSceneLibrary,
  onDeleteSceneLibrary, onAddSceneToLibrary, onAddSceneToMaterialLibrary,
  onAddSceneFromLibrary, onAddDramaSceneToEpisode,
} = useScenes({ store, dramaId, currentEpisodeId, getSelectedStyle, scriptLanguage, loadDrama, pollTask, pollUntilResourceHasImage, hasAssetImage, dramaAPI })

async function onGenerateCharacters() {
  trackFilmCreateAction('generate_characters_click')
  const beforeCount = (store.currentEpisode?.characters || []).length
  try {
    await onGenerateCharactersRaw()
    const afterCount = (store.currentEpisode?.characters || []).length
    trackFilmCreateAction('generate_characters_complete', {
      extra: { before_count: beforeCount, after_count: afterCount },
    })
  } catch (e) {
    trackFilmCreateAction('generate_characters_failed', {
      extra: { message: String(e?.message || 'failed').slice(0, 120) },
    })
    throw e
  }
}

async function onExtractProps() {
  trackFilmCreateAction('extract_props_click')
  const beforeCount = (store.props || []).length
  try {
    await onExtractPropsRaw()
    const afterCount = (store.props || []).length
    trackFilmCreateAction('extract_props_complete', {
      extra: { before_count: beforeCount, after_count: afterCount },
    })
  } catch (e) {
    trackFilmCreateAction('extract_props_failed', {
      extra: { message: String(e?.message || 'failed').slice(0, 120) },
    })
    throw e
  }
}

async function onExtractScenes() {
  trackFilmCreateAction('extract_scenes_click')
  const beforeCount = (store.currentEpisode?.scenes || []).length
  try {
    await onExtractScenesRaw()
    const afterCount = (store.currentEpisode?.scenes || []).length
    trackFilmCreateAction('extract_scenes_complete', {
      extra: { before_count: beforeCount, after_count: afterCount },
    })
  } catch (e) {
    trackFilmCreateAction('extract_scenes_failed', {
      extra: { message: String(e?.message || 'failed').slice(0, 120) },
    })
    throw e
  }
}



// 资源管理大面板及子区块折叠状态
const resourcePanelCollapsed = ref(false)
const charactersBlockCollapsed = ref(false)
const propsBlockCollapsed = ref(false)
const scenesBlockCollapsed = ref(false)
const sceneUseQuadGrid = ref(false)
const propUseQuadGrid = ref(false)  // 道具四视图（与场景四宫格同级选项）

// 分镜行内编辑状态（按 storyboard id 存储）
// navCollapsed/storyboardMenuExpanded/toggleNav → 已移至 useNavigation composable

/** 左侧导航各步骤状态 */
const navSteps = computed(() => {
  const epRunning = genStore.getRunningForEpisode(dramaId.value, currentEpisodeId.value)
  // 剧本
  const hasScript = !!(scriptContent?.value?.trim())
  const scriptStatus = isStoryGenRunning.value
    ? 'generating'
    : hasScript ? 'done' : 'pending'

  // 角色
  const charList = characters.value || []
  const charDone = charList.length > 0 && charList.every(c => hasAssetImage(c))
  const charGen = charactersGenerating.value || generatingCharIds.size > 0
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.CHAR_IMAGE || t.resourceType === GEN_RESOURCE.EXTRACT_CHARACTERS)
  const charStatus = charGen ? 'generating' : charDone ? 'done' : charList.length > 0 ? 'partial' : 'pending'

  // 道具
  const propList = props.value || []
  const propDone = propList.length > 0 && propList.every(p => hasAssetImage(p))
  const propGen = propsExtracting.value || generatingPropIds.size > 0
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.PROP_IMAGE || t.resourceType === GEN_RESOURCE.EXTRACT_PROPS)
  const propStatus = propGen ? 'generating' : propDone ? 'done' : propList.length > 0 ? 'partial' : 'pending'

  // 场景
  const sceneList = scenes.value || []
  const sceneDone = sceneList.length > 0 && sceneList.every(s => hasAssetImage(s))
  const sceneGen = scenesExtracting.value || generatingSceneIds.size > 0
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.SCENE_IMAGE || t.resourceType === GEN_RESOURCE.EXTRACT_SCENES)
  const sceneStatus = sceneGen ? 'generating' : sceneDone ? 'done' : sceneList.length > 0 ? 'partial' : 'pending'

  // 分镜脚本
  const sbList = storyboards.value || []
  const sbScriptDone = sbList.length > 0
  const sbScriptGen = storyboardGenerating.value || universalOmniPolishRunning.value
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.GENERATE_STORYBOARD)
  const sbScriptStatus = sbScriptGen ? 'generating' : sbScriptDone ? 'done' : 'pending'

  // 分镜图
  const sbImgDone = sbList.length > 0 && sbList.every(sb => hasSbImage(sb))
  const sbImgGen = generatingSbImageIds.size > 0 || batchImageRunning.value || epRunning.some((t) =>
    t.resourceType === GEN_RESOURCE.SB_IMAGE
    || t.resourceType === GEN_RESOURCE.SB_FIRST_IMAGE
    || t.resourceType === GEN_RESOURCE.SB_LAST_IMAGE
  )
  const sbImgStatus = sbImgGen ? 'generating' : sbImgDone ? 'done' : sbList.length > 0 ? 'partial' : 'pending'

  // 视频
  const sbVideoAllDone = sbList.length > 0 && sbList.every(sb => getSbAllVideos(sb.id).length > 0)
  const sbVideoSome = sbList.some(sb => getSbAllVideos(sb.id).length > 0)
  const sbVideoGen = batchVideoRunning.value || generatingSbVideoIds.size > 0
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.SB_VIDEO)
  const videoStatus = sbVideoGen ? 'generating' : sbVideoAllDone ? 'done' : sbVideoSome ? 'partial' : 'pending'

  const resourcesGenerating = charGen || propGen || sceneGen
  const resourceCount = charList.length + propList.length + sceneList.length + universalLibraryAssets.value.length
  const resourcesReady = charStatus === 'done' && propStatus === 'done' && sceneStatus === 'done'
  return [
    { key: 'script', label: '剧本管理', status: scriptStatus, count: hasScript ? 1 : 0 },
    { key: 'resources', label: '统一资源', status: resourcesGenerating ? 'generating' : resourcesReady ? 'done' : resourceCount ? 'partial' : 'pending', count: resourceCount },
    { key: 'storyboard', label: '分镜管理', status: sbScriptGen || sbImgGen || sbVideoGen ? 'generating' : sbVideoAllDone ? 'done' : (sbList.length ? 'partial' : 'pending'), count: sbList.length },
    { key: 'merge', label: '视频合成', status: videoStatus === 'generating' ? 'generating' : currentEpisodeVideoUrl.value ? 'done' : sbVideoSome ? 'partial' : 'pending', count: 0 },
  ]
})

/** 聚合所有当前正在运行的任务，用于悬浮任务面板（含跨剧跨集） */
const allActiveTaskItems = computed(() => {
  const items = []
  const seen = new Set()
  function addItem(item) {
    const id = item.id || item.label
    if (!id || seen.has(id)) return
    seen.add(id)
    items.push(item)
  }
  for (const t of genStore.getAllRunningTasks()) {
    addItem({
      id: `gen:${t.key || t.taskId || t.label}`,
      label: t.label || '任务进行中...',
      kind: 'genStore',
      task: t,
    })
  }
  if (pipelineRunning.value) {
    const step = pipelineCurrentStep.value
    addItem({
      id: 'pipeline',
      label: step ? step.replace(/^\[步骤 \d+\/\d+\] /, '') : '一键全流程运行中...',
      kind: 'pipeline',
    })
  }
  if (isStoryGenRunning.value && !genStore.getAllRunningTasks().some((t) => t.resourceType === GEN_RESOURCE.GENERATE_STORY)) {
    addItem({ id: 'story-gen-local', label: '生成剧本...', kind: 'storyGenLocal' })
  }
  if (universalOmniPolishRunning.value) {
    const p = universalOmniPolishProgress.value
    addItem({
      id: 'universal-omni-polish',
      label: `润色全能分镜 ${p.current}/${p.total}${p.label ? ' ' + p.label : ''}`,
      kind: 'universalOmniPolish',
    })
  }
  if (batchImageRunning.value) {
    addItem({ id: 'batch-image', label: '批量生成分镜图...', kind: 'batchImage' })
  }
  if (batchVideoRunning.value) {
    const p = batchVideoProgress.value
    const suffix = p?.total ? ` ${p.current}/${p.total}` : ''
    addItem({ id: 'batch-video', label: `批量生成分镜视频${suffix}...`, kind: 'batchVideo' })
  }
  return items
})

const allActiveTaskLabels = computed(() => allActiveTaskItems.value.map((t) => t.label))

async function cancelActiveTask(item) {
  if (!item) return
  try {
    if (item.kind === 'genStore' && item.task) {
      await genStore.cancelTask(item.task)
      ElMessage.success('任务已取消')
      return
    }
    if (item.kind === 'pipeline') {
      pipelineAbortRequested.value = true
      pipelineRunning.value = false
      pipelinePaused.value = false
      for (const t of genStore.getAllRunningTasks()) {
        if (t.taskId) await genStore.cancelTask(t)
      }
      ElMessage.success('已停止全流程')
      return
    }
    if (item.kind === 'storyGenLocal') {
      storyGenerating.value = false
      scriptGenerating.value = false
      const storyTask = genStore.getAllRunningTasks().find((t) => t.resourceType === GEN_RESOURCE.GENERATE_STORY)
      if (storyTask) await genStore.cancelTask(storyTask)
      ElMessage.success('已取消剧本生成')
      return
    }
    if (item.kind === 'universalOmniPolish') {
      universalOmniPolishAbort.value = true
      ElMessage.success('正在停止润色...')
      return
    }
    if (item.kind === 'batchImage') {
      batchImageStopping.value = true
      ElMessage.info('正在停止批量生图...')
      return
    }
    if (item.kind === 'batchVideo') {
      batchVideoStopping.value = true
      ElMessage.info('正在停止批量生视频...')
      return
    }
  } catch (e) {
    ElMessage.error(e?.message || '取消失败')
  }
}
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
const regeneratingLayoutSbIds = reactive(new Set())  // 正在 AI 重新生成布局描述的分镜 id 集合
/** 分镜创作模式：classic | universal（默认 classic，存库 storyboards.creation_mode） */
const sbCreationMode = ref({})
const sbGenerationSettings = ref({})
const sbGenerationModes = ref({})
const sd2ResourceCertifying = ref(null)
/** 全能模式片段描述（存库 universal_segment_text，与经典参考图字段独立） */
const sbUniversalSegmentText = ref({})
const universalPromptSaveTimers = new Map()
const universalPromptRevisions = new Map()
let restoringUniversalPromptMaps = false
let restoredUniversalDraftNoticeShown = false

function universalPromptDraftIdentity(storyboardId) {
  return {
    userId: currentDraftUserId(), workspace: 'film-create-universal', dramaId: dramaId.value,
    episodeId: currentEpisodeId.value, shotId: storyboardId,
  }
}

function persistUniversalPromptDraft(storyboardId, text) {
  const revision = (universalPromptRevisions.get(storyboardId) || 0) + 1
  universalPromptRevisions.set(storyboardId, revision)
  writePromptDraft(localStorage, universalPromptDraftIdentity(storyboardId), { prompt: text == null ? '' : String(text) })
  return revision
}

function scheduleUniversalPromptSave(storyboardId) {
  const sb = (storyboards.value || []).find((item) => Number(item.id) === Number(storyboardId))
  if (!sb) return
  clearTimeout(universalPromptSaveTimers.get(storyboardId))
  universalPromptSaveTimers.set(storyboardId, setTimeout(() => onSaveUniversalSegmentField(sb), 650))
}

function onUniversalPromptInput(storyboardId, value) {
  if (restoringUniversalPromptMaps || storyboardId == null) return
  persistUniversalPromptDraft(storyboardId, value)
  scheduleUniversalPromptSave(storyboardId)
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
const sbVideoErrors = ref({})
const generatingSbImageIds = reactive(new Set())
const generatingSbVideoIds = reactive(new Set())
const generatingUniversalSegmentIds = reactive(new Set())
// 重新生成角色/场景/道具关联分镜图的 loading set，key: 'char-{id}' | 'scene-{id}' | 'prop-{id}'
const regenSbImagesForAsset = reactive(new Set())
const regenSbImagesProgress = ref({})
// 批量生成分镜图
const batchImageRunning = ref(false)
const batchImageStopping = ref(false)
const batchImageProgress = ref({ current: 0, total: 0, failed: 0 })
const inferringParams = ref(false)
const showVideoParamsDialog = ref(false)
const videoParamsTarget = ref(null)
const videoParamsSaving = ref(false)
const splitByAudioLoading = ref(false)
const batchImageErrors = ref([])
// 批量生成分镜视频
const batchVideoRunning = ref(false)
const batchVideoStopping = ref(false)
const batchVideoProgress = ref({ current: 0, total: 0, failed: 0 })
const batchVideoErrors = ref([])
// P0-1: 连贯帧模式
const videoFrameContiguity = ref(false)
// P0-3: 分镜超分辨率 loading set
const upscalingSbIds = reactive(new Set())
// P2-4: TTS 状态
const ttsSbIds = reactive(new Set())
const ttsSbNarrationIds = reactive(new Set())
// 尾帧衔接 loading 状态
const linkingTailFrameIds = reactive(new Set())
// “上镜尾帧”（将上一分镜尾帧图片直接设为当前首帧）loading 状态
const usingPrevTailAsFirstIds = reactive(new Set())
/** 对白 TTS 路径缓存（与 storyboards.audio_local_path 一致） */
const sbDialogueAudioPaths = ref({})
/** 解说旁白 TTS 路径缓存（与 storyboards.narration_audio_local_path 一致） */
const sbNarrationAudioPaths = ref({})
/** 分镜 TTS 试听：避免多条同时播放 */
let sbTtsPreviewAudio = null
/** 正在编辑视频提示词的分镜 id；编辑中显示文本框与保存/取消 */
const editingSbVideoPromptId = ref(null)
const editingSbVideoPromptText = ref('')
/** 正在编辑图片提示词的分镜 id（行内编辑，保留供内部 onSaveSbImagePrompt 使用） */
const editingSbImagePromptId = ref(null)
const editingSbImagePromptText = ref('')
/** 分镜提示词弹窗 */
const showSbPromptDialog = ref(false)
const sbPromptTarget = ref(null)
const sbPromptImageText = ref('')       // 原始 image_prompt
const sbPromptPolishedText = ref('')    // AI 优化后 polished_prompt
const sbPromptVideoText = ref('')       // video_prompt
const sbPromptSaving = ref(false)
const sbPromptPolishing = ref(false)
/** 首尾帧提示词编辑器 */
const showFramePromptEditor = ref(false)
const editingFramePromptSb = ref(null)
const editingFramePromptSlot = ref('first') // 'first' | 'last'
const editingFramePromptText = ref('')
const editingFramePromptSaving = ref(false)
const editingFramePromptRegenerating = ref(false)
const uploadingSbImageId = ref(null)
const sbImageFileInput = ref(null)
const sbImageUploadForId = ref(null)
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
const dragOverResourceKey = ref(null) // 'char-1' | 'prop-2' | 'scene-3'
const dragOverSbId = ref(null)
// 公共库弹窗状态已移至各 composable
const storyboardCount = ref(null) // 分镜数量
const videoDuration = ref(null) // 视频总长度
/** 分镜生成时是否要求 AI 输出 narration（解说旁白） */
const storyboardIncludeNarration = ref(false)
/** 分镜生成是否使用全能模式（universal_segment_text，对接 Seedance / 可灵 Omni） */
const storyboardUniversalOmni = ref(false)
const storyboardUseFirstLastFrame = ref(false)
const exportingStoryboardSheet = ref(false)
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

/** 当前剧本下的估算：总秒数、镜数中枢、镜数区间、采用的每段秒数 */
const scriptStoryboardEstimate = computed(() => {
  const script = (scriptContent.value || '').toString().trim()
  const len = script.length
  if (!len) return null
  const sec = estimateVideoDurationSecFromCharLen(len)
  if (sec == null) return null
  const { locked, range, clip } = shotCountEstimateFromDurationSec(sec)
  return { sec, locked, range, clip, len }
})

const scriptEstimateVideoDurationHint = computed(() => {
  const e = scriptStoryboardEstimate.value
  if (!e) return ''
  return `（约 ${e.sec}s）`
})

const scriptEstimateVideoDurationTitle = computed(() => {
  const e = scriptStoryboardEstimate.value
  if (!e) return ''
  return `按当前剧本文本约 ${e.len} 个字符（含标点；常见汉字在浏览器里一字一算，并非按 UTF-8 字节翻倍）、短剧公式 round(10+(字符/600)×60) 粗估总时长约 ${e.sec} 秒；未填输入框时该值会作为约束传给生成接口。仅供参考`
})

const scriptEstimateStoryboardHint = computed(() => {
  const e = scriptStoryboardEstimate.value
  if (!e) return ''
  if (e.range && e.range.min !== e.range.max) {
    return `（约 ${e.locked} 镜，参考 ${e.range.min}–${e.range.max}）`
  }
  return `（约 ${e.locked} 镜）`
})

const scriptEstimateStoryboardTitle = computed(() => {
  const e = scriptStoryboardEstimate.value
  if (!e) return ''
  return `按估算时长 ${e.sec}s ÷ 项目「每段 ${e.clip} 秒」四舍五入粗估约 ${e.locked} 镜；旁注区间为 ±1 镜供参考。切换「X秒/段」会同步改变本估算。`
})

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

function onResourceDragOver(e, type, id) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  const key = type === 'character' ? 'char-' : type === 'prop' ? 'prop-' : 'scene-'
  dragOverResourceKey.value = key + id
}
function onResourceDragLeave(e, key) {
  e.preventDefault()
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return
  if (key && dragOverResourceKey.value !== key) return
  dragOverResourceKey.value = null
}
function onResourceDrop(e, type, id) {
  e.preventDefault()
  e.stopPropagation()
  dragOverResourceKey.value = null
  const file = getFirstImageFile(e.dataTransfer)
  if (file) doUploadResourceImage(type, id, file)
}
function onSbImageDragOver(e, sbId) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragOverSbId.value = sbId
}
function onSbImageDragLeave(e, sbId) {
  e.preventDefault()
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return
  if (sbId != null && dragOverSbId.value !== sbId) return
  dragOverSbId.value = null
}
function onSbImageDrop(e, sb) {
  e.preventDefault()
  e.stopPropagation()
  dragOverSbId.value = null
  const file = getFirstImageFile(e.dataTransfer)
  if (file && sb?.id) doUploadSbImage(sb.id, file)
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
/** 视频地址：优先 local_path（/static/），否则 video_url */
function assetVideoUrl(item) {
  if (!item) return ''
  const localPath = item.local_path && String(item.local_path).trim()
  if (localPath) {
    // 本地视频曾经可能被浏览器缓存为无 CORS/Range 响应；用记录更新时间
    // 让重新部署后的播放器强制重新请求文件，同时不改变数据库中的真实路径。
    const src = '/static/' + localPath.replace(/^\//, '')
    const version = item.updated_at || item.completed_at || item.created_at
    return version ? `${src}?v=${encodeURIComponent(version)}` : src
  }
  if (item.video_url) return imageUrl(item.video_url)
  return ''
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
/** 主播放器强制随记录/地址重建，避免重新生成后 <video> 仍缓存旧 src */
function sbMainVideoPlayerKey(sbId) {
  const v = getSbVideo(sbId)
  if (!v) return ''
  const src = assetVideoUrl(v)
  return `${v.id}:${v.updated_at || ''}:${src.slice(0, 160)}`
}
function onStoryboardUseFirstLastFrameChange() {
  if (storyboardUseFirstLastFrame.value && gridMode.value !== 'single') {
    gridMode.value = 'single'
    ElMessage.info('首尾帧模式已开启，序列图已切换为单张')
  }
  saveProjectSettings(false)
}

function uploadingSbImageSlot(sbId) {
  return sbImageUploadSlotById.value[sbId] || null
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

function hasSbFirstLastPair(sb) {
  return !!(getSbFirstImage(sb.id) && getSbLastImage(sb.id))
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
/** 取该分镜下的四宫格整图记录 */
/** 取该分镜下的四宫格整图记录 */
function getQuadGridImage(storyboardId) {
  const list = sbImages.value[storyboardId]
  if (!Array.isArray(list)) return null
  return list.find((i) => i.status === 'completed' && (i.frame_type === 'quad_grid' || i.frame_type === 'nine_grid') && (i.image_url || i.local_path)) || null
}
/** 取该分镜所有已完成的视频记录 */
function getSbAllVideos(storyboardId) {
  const list = sbVideos.value[storyboardId]
  if (!Array.isArray(list)) return []
  return list.filter((i) => i.status === 'completed' && recordHasPlayableVideoUrl(i))
}
/** 取该分镜当前选中的视频（尊重 sbSelectedVideoId，否则默认第一条） */
function getSbVideo(storyboardId) {
  const all = getSbAllVideos(storyboardId)
  if (all.length === 0) return null
  const selectedId = sbSelectedVideoId.value[storyboardId]
  if (selectedId != null) {
    const found = all.find((v) => v.id === selectedId)
    if (found) return found
  }
  return all[0]
}
/** 取下一个分镜（按 storyboard_number 顺序） */
function getNextStoryboard(storyboardId) {
  const list = store.storyboards || []
  const idx = list.findIndex((s) => s.id === storyboardId)
  if (idx === -1 || idx === list.length - 1) return null
  return list[idx + 1]
}

/** 取上一个分镜（按 storyboard_number 顺序，用于“上镜尾帧”快速衔接） */
function getPrevStoryboard(storyboardId) {
  const list = store.storyboards || []
  const idx = list.findIndex((s) => s.id === storyboardId)
  if (idx === -1 || idx === 0) return null
  return list[idx - 1]
}

/** 辅助判断：当前分镜是否有“上一镜尾帧”可用于快速替换首帧 */
function canUsePrevTailAsFirst(sb) {
  const p = getPrevStoryboard(sb?.id)
  return !!(p && getSbLastImage(p.id))
}

/** 视频历史条：返回非当前选中的已完成视频列表 */
function getVideoStripItems(storyboardId) {
  const all = getSbAllVideos(storyboardId)
  const current = getSbVideo(storyboardId)
  return all
    .filter((v) => !current || v.id !== current.id)
    .map((v, idx) => ({
      key: `vid-${v.id}`,
      video: v,
      src: assetVideoUrl(v),
      label: `历史${idx + 2}`,
    }))
}
function sbVideoPoster(sb, video) {
  const poster = String(video?.poster_local_path || '').trim()
  if (poster) return poster.startsWith('/static/') || /^https?:/i.test(poster) ? poster : `/static/${poster.replace(/^\/+/, '')}`
  return getSbLocalImage(sb) || '/images/video-poster-placeholder.svg'
}
/** 选中某条历史视频为当前视频，并持久化到分镜记录供合成视频使用 */
function onSelectSbMainVideo(sb, video) {
  setActiveSbId(sb.id)
  sbSelectedVideoId.value = { ...sbSelectedVideoId.value, [sb.id]: video.id }
  storyboardsAPI.update(sb.id, {
    video_url: video.video_url || null,
    local_path: video.local_path || undefined,
  }).catch(e => console.warn('[主视频] 保存后端失败', e))
}
/** 取该分镜最近一次视频生成的错误信息（从 API 返回的记录或本地即时错误） */
function getSbVideoError(storyboardId) {
  if (sbVideoErrors.value[storyboardId]) return sbVideoErrors.value[storyboardId]
  const list = sbVideos.value[storyboardId]
  if (!Array.isArray(list) || list.length === 0) return ''
  const hasCompleted = list.some((i) => i.status === 'completed' && recordHasPlayableVideoUrl(i))
  if (hasCompleted) return ''
  const bogusCompleted = list.find(
    (i) => i.status === 'completed' && i.video_url && !recordHasPlayableVideoUrl(i)
  )
  if (bogusCompleted) {
    const u = String(bogusCompleted.video_url || '').trim()
    if (u) return u
    if (bogusCompleted.error_msg) return bogusCompleted.error_msg
  }
  const failed = list.filter((i) => i.status === 'failed' && i.error_msg)
  if (failed.length === 0) return ''
  return failed[0].error_msg
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

/** 分镜视频是否正在生成（单条点击、批量、一键成片、任务恢复均覆盖） */
function isSbVideoGenerating(sbId) {
  if (generatingSbVideoIds.has(sbId)) return true
  if (sbId == null || dramaId.value == null || currentEpisodeId.value == null) return false
  return genStore.isRunning({
    dramaId: dramaId.value,
    episodeId: currentEpisodeId.value,
    resourceType: GEN_RESOURCE.SB_VIDEO,
    resourceId: sbId,
  })
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
/** sbId → 'first' | 'last'，上传目标槽位 */
const sbImageUploadSlotById = ref({})

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
  }
}

/** 获取缩略图条数据：已绑定首尾帧以外的历史图 */
function getStripItems(storyboardId) {
  const allImgs = getSbAllImages(storyboardId)
  const firstImg = storyboardUseFirstLastFrame.value ? getSbFirstImage(storyboardId) : getSbImage(storyboardId)
  const lastImg = storyboardUseFirstLastFrame.value ? getSbLastImage(storyboardId) : null
  const boundIds = new Set([firstImg?.id, lastImg?.id].filter((x) => x != null))
  return allImgs
    .filter((img) => !boundIds.has(img.id))
    .map((img) => ({
      key: `img-${img.id}`,
      src: assetImageUrl(img),
      type: 'img',
      img,
      label: quadPanelLabel(img.frame_type),
      frameBadge: img.frame_type === 'storyboard_first' ? '首' : img.frame_type === 'storyboard_last' ? '尾' : null,
      prompt: img.prompt || '',
    }))
}

function stripItemTitle(sbId, item) {
  const lines = [item.label, item.prompt].filter(Boolean)
  if (storyboardUseFirstLastFrame.value) {
    lines.unshift('点击：设为首帧或尾帧')
  } else {
    lines.unshift('点击设为主图')
  }
  return lines.join('\n\n')
}

async function onStripItemClick(sb, item) {
  if (!storyboardUseFirstLastFrame.value) {
    onSelectStripItem(sb, item)
    return
  }
  try {
    await ElMessageBox.confirm('将此图绑定到哪个槽位？', '设置参考帧', {
      confirmButtonText: '设为首帧',
      cancelButtonText: '设为尾帧',
      distinguishCancelAndClose: true,
      type: 'info',
    })
    onSelectSbFrameImage(sb, item.img, 'first')
    ElMessage.success('已设为首帧')
  } catch (action) {
    if (action === 'cancel') {
      onSelectSbFrameImage(sb, item.img, 'last')
      ElMessage.success('已设为尾帧')
    }
  }
}

/** 宫格子图位置标签 */
function quadPanelLabel(frameType) {
  const map = {
    quad_panel_0: '左上', quad_panel_1: '右上', quad_panel_2: '左下', quad_panel_3: '右下',
    nine_panel_0: '左上', nine_panel_1: '中上', nine_panel_2: '右上',
    nine_panel_3: '左中', nine_panel_4: '中间', nine_panel_5: '右中',
    nine_panel_6: '左下', nine_panel_7: '中下', nine_panel_8: '右下',
  }
  return map[frameType] || null
}

/** 点击缩略图条中的图片切换为主图 */
function onSelectStripItem(sb, item) {
  onSelectSbMainImage(sb, item.img)
}

/** 选定首帧或尾帧参考图（持久化到后端） */
function onSelectSbFrameImage(sb, img, slot) {
  if (!sb?.id || !img) return
  const isLast = slot === 'last'

  // 本地选中状态（用于部分回退逻辑）
  if (isLast) {
    sbSelectedLastImgId.value = { ...sbSelectedLastImgId.value, [sb.id]: img.id }
  } else {
    sbSelectedImgId.value = { ...sbSelectedImgId.value, [sb.id]: img.id }
  }

  // 关键：乐观更新 store 里分镜的权威绑定字段（storyboards 数组是 getSbFirst/LastImage 的主要数据源）
  // 这样点击后立即生效，无需刷新页面；getStripItems 也会立即把这张图从历史条里过滤掉
  const list = store.currentEpisode?.storyboards
  if (Array.isArray(list)) {
    const row = list.find((x) => Number(x.id) === Number(sb.id))
    if (row) {
      const now = new Date().toISOString()
      if (isLast) {
        row.last_frame_image_id = img.id
        row.last_frame_image_url = img.image_url || null
        row.last_frame_local_path = img.local_path || null
      } else {
        row.first_frame_image_id = img.id
        row.image_url = img.image_url || null
        row.local_path = img.local_path || null
      }
      row.updated_at = now
    }
  }

  // 发送到后端持久化（静默，调用方按需提示）
  const patch = { updated_at: new Date().toISOString() }
  if (isLast) {
    patch.last_frame_image_id = img.id
    patch.last_frame_image_url = img.image_url || null
    patch.last_frame_local_path = img.local_path || undefined
  } else {
    patch.image_url = img.image_url || null
    patch.local_path = img.local_path || undefined
    patch.first_frame_image_id = img.id
  }

  storyboardsAPI.update(sb.id, patch).catch((e) => console.warn('[参考帧] 保存失败', e))
}

/** 选定某张 API 图为主图（持久化到后端） */
function onSelectSbMainImage(sb, img) {
  onSelectSbFrameImage(sb, img, 'first')
}

/** 删除分镜历史参考图（strip 中的未绑定历史图，类似资源 extra 图的移除） */
async function onRemoveSbHistoryImage(storyboardId, imageGenId) {
  if (!storyboardId || !imageGenId) return
  try {
    await ElMessageBox.confirm('确定删除这张历史参考图？此操作不可恢复。', '删除历史图', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
      distinguishCancelAndClose: true,
    })
    await imagesAPI.delete(imageGenId)
    await loadSingleStoryboardMedia(storyboardId)
    ElMessage.success('历史图已删除')
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(err?.message || '删除失败')
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

/** 打开首尾帧提示词编辑器（显示最终发给AI生图的完整提示词，支持编辑保存） */
async function openFramePromptEditor(sb, slot) {
  if (!sb?.id) return
  editingFramePromptSb.value = sb
  editingFramePromptSlot.value = slot
  editingFramePromptText.value = ''
  showFramePromptEditor.value = true
  // 异步加载最终发给AI的真实提示词
  try {
    const pro = await ensureProfessionalFramePrompt(sb, slot)
    editingFramePromptText.value = pro || ''
  } catch (e) {
    editingFramePromptText.value = slot === 'last' ? buildLastFrameImagePrompt(sb.id) : buildFirstFrameImagePrompt(sb.id)
  }
}

/** 保存编辑后的帧提示词到 frame_prompts 表 */
async function saveEditingFramePrompt() {
  const sb = editingFramePromptSb.value
  const slot = editingFramePromptSlot.value
  if (!sb?.id || !slot) return
  const text = (editingFramePromptText.value || '').trim()
  if (!text) {
    ElMessage.warning('提示词不能为空')
    return
  }
  editingFramePromptSaving.value = true
  try {
    const frameType = slot === 'last' ? 'last' : 'first'
    await storyboardsAPI.saveFramePrompt(sb.id, frameType, { prompt: text })
    ElMessage.success('提示词已保存，后续生成将使用此版本')
    showFramePromptEditor.value = false
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    editingFramePromptSaving.value = false
  }
}

/** 重新生成专业帧提示词 */
async function regenerateEditingFramePrompt() {
  const sb = editingFramePromptSb.value
  const slot = editingFramePromptSlot.value
  if (!sb?.id || !slot) return
  editingFramePromptRegenerating.value = true
  try {
    ElMessage.info('正在重新生成专业帧提示词…')
    const fresh = await ensureProfessionalFramePrompt(sb, slot, { forceRegenerate: true })
    editingFramePromptText.value = fresh || ''
    ElMessage.success('已重新生成，可编辑后保存')
  } catch (e) {
    ElMessage.error(e.message || '生成失败')
  } finally {
    editingFramePromptRegenerating.value = false
  }
}

// 兼容旧调用
const showSbFramePromptPreview = openFramePromptEditor

async function onGenerateSbFrameImage(sb, slot) {
  if (!dramaId.value || !sb?.id) return
  const isLast = slot === 'last'
  const loadingSet = isLast ? generatingSbLastImageIds : generatingSbFirstImageIds
  const meta = buildSbGenMeta(
    sb,
    isLast ? GEN_RESOURCE.SB_LAST_IMAGE : GEN_RESOURCE.SB_FIRST_IMAGE,
    isLast ? '尾帧' : '首帧'
  )
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

async function onGenerateSbFramePair(sb) {
  const hasFirst = !!(getSbFirstImage(sb.id) || (sb.image_url || sb.composed_image))
  if (!hasFirst) {
    await onGenerateSbFrameImage(sb, 'first')
    if (!getSbFirstImage(sb.id) && !(sb.image_url || sb.composed_image)) return
  }
  await onGenerateSbFrameImage(sb, 'last')
}

// ──────────────────────────────────────────────────────────────────────

async function onGenerateSbImage(sb) {
  if (!dramaId.value || !sb?.id) return
  sb.errorMsg = ''
  sb.error_msg = ''
  const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_IMAGE, '分镜图')
  generatingSbImageIds.add(sb.id)
  genStore.markRunning(meta)
  try {
    let idsToSave = sbCharacterIds.value[sb.id]
    if (idsToSave === undefined) {
      const charList = Array.isArray(sb.characters) ? sb.characters : []
      idsToSave = charList
        .map((c) => Number(typeof c === 'object' && c != null ? c.id : c))
        .filter((n) => Number.isFinite(n))
    }
    try {
      await storyboardsAPI.update(sb.id, { character_ids: Array.isArray(idsToSave) ? idsToSave : [] })
    } catch (e) {
      console.warn('[分镜图] 保存角色勾选失败', e)
      ElMessage.warning('保存分镜角色失败，请稍后重试')
      return
    }
    const res = await imagesAPI.create({
      storyboard_id: sb.id,
      drama_id: dramaId.value,
      prompt: sb.polished_prompt || sb.image_prompt || sb.description || '',
      model: undefined,
      style: getSelectedStyle(),
      frame_type: gridMode.value !== 'single' ? gridMode.value : undefined,
      aspect_ratio: projectAspectRatio.value || '16:9',
    })
    ElMessage.success('分镜图生成任务已提交')
    if (res?.task_id) {
      const pollRes = await pollTask(res.task_id, () => loadSingleStoryboardMedia(sb.id), meta)
      if (pollRes?.status === 'failed') {
        sb.errorMsg = pollRes.error || '生成失败'
      } else {
        ElMessage.success('分镜图生成完成')
      }
    } else {
      await loadSingleStoryboardMedia(sb.id)
    }
  } catch (e) {
    console.error(e)
    sb.errorMsg = e.message || '生成失败'
    ElMessage.error(e.message || '生成失败')
  } finally {
    generatingSbImageIds.delete(sb.id)
    genStore.markDone(meta)
  }
}

function onUploadSbImageClick(sb, slot = 'first') {
  if (!sb?.id) return
  sbImageUploadForId.value = sb.id
  sbImageUploadSlotById.value = { ...sbImageUploadSlotById.value, [sb.id]: slot }
  if (!storyboardUseFirstLastFrame.value) {
    uploadingSbImageId.value = sb.id
  }
  if (sbImageFileInput.value) {
    sbImageFileInput.value.value = ''
    sbImageFileInput.value.click()
  }
}

async function doUploadSbImage(sbId, file, slot = 'first') {
  if (!file || !sbId || !dramaId.value) return
  const useSlot = storyboardUseFirstLastFrame.value ? slot : 'first'
  if (storyboardUseFirstLastFrame.value) {
    sbImageUploadSlotById.value = { ...sbImageUploadSlotById.value, [sbId]: useSlot }
  } else {
    uploadingSbImageId.value = sbId
  }
  try {
    const res = await uploadAPI.uploadImage(file, { dramaId: dramaId.value })
    const url = res?.url || res?.path
    const localPath = res?.local_path
    if (!url && !localPath) {
      ElMessage.error('上传未返回地址')
      return
    }
    const uploaded = await imagesAPI.upload({
      storyboard_id: sbId,
      drama_id: dramaId.value,
      image_url: url || '',
      local_path: localPath || undefined,
      frame_type: storyboardUseFirstLastFrame.value ? frameTypeForSlot(useSlot) : undefined,
    })
    ElMessage.success(useSlot === 'last' ? '尾帧上传成功' : '首帧上传成功')
    if (uploaded?.id) {
      const sb = (store.storyboards || []).find((b) => b.id === sbId)
      if (sb) onSelectSbFrameImage(sb, uploaded, useSlot)
    } else if (!storyboardUseFirstLastFrame.value) {
      const { [sbId]: _r, ...rest } = sbSelectedImgId.value
      sbSelectedImgId.value = rest
    }
    await loadSingleStoryboardMedia(sbId)
    restoreSelectionsFromBackend()
  } catch (e) {
    ElMessage.error(e.message || '上传失败')
  } finally {
    uploadingSbImageId.value = null
    const next = { ...sbImageUploadSlotById.value }
    delete next[sbId]
    sbImageUploadSlotById.value = next
  }
}

function onSbImageFileChange(ev) {
  const file = ev.target?.files?.[0]
  const sid = sbImageUploadForId.value
  if (!file || !sid) {
    ev.target.value = ''
    return
  }
  const slot = sbImageUploadSlotById.value[sid] || 'first'
  doUploadSbImage(sid, file, slot).finally(() => {
    sbImageUploadForId.value = null
    ev.target.value = ''
  })
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
  restoringUniversalPromptMaps = true
  sbUniversalSegmentText.value = nextUniversalSegment
  queueMicrotask(() => { restoringUniversalPromptMaps = false })
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
    d = await backfillDramaStylePromptMetadataIfNeeded(dramaAPI, store.dramaId, d)
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

const EMPTY_ARR = []
/** 当前分镜已选角色 id 列表（供 el-select 绑定） */
function getSbCharacterIds(sbId) {
  const arr = sbCharacterIds.value[sbId]
  return Array.isArray(arr) && arr.length > 0 ? arr : EMPTY_ARR
}

/** 运镜值的简短中文标签（用于分镜控制栏显示） */
function getMovementLabel(m) {
  if (!m) return ''
  const map = {
    static: '固定',
    push: '推镜',
    pull: '拉镜',
    pan: '横摇',
    tilt: '纵摇',
    tracking: '跟镜',
    crane_up: '升镜',
    crane_dn: '降镜',
    orbit: '环绕',
    handheld: '手持',
    zoom: '变焦',
    roll: '旋转',
    whip_pan: '甩镜',
    spiral: '螺旋',
    hitchcock_zoom: '希区柯克',
    bullet_time: '子弹时间',
    dutch_angle_move: '荷兰角',
    dolly_track: '推轨',
    slowmo_orbit: '升格环绕'
  }
  return map[m] || m
}

function setSbCharacterIds(sbId, v) {
  const next = Array.isArray(v) ? v : []
  sbCharacterIds.value = { ...sbCharacterIds.value, [sbId]: next }
  onStoryboardCharacterChange(sbId)
}

/** 当前分镜尚未勾选的角色（供缩略图旁「+」下拉添加） */
function charactersAvailableToAddToSb(sbId) {
  const all = characters.value ?? []
  const cur = new Set((getSbCharacterIds(sbId) || []).map((x) => Number(x)))
  return all.filter((c) => c && !cur.has(Number(c.id)))
}

function onSbAddCharacterCommand(sbId, charId) {
  const id = Number(charId)
  if (!Number.isFinite(id)) return
  const cur = [...(getSbCharacterIds(sbId) || [])]
  if (cur.some((x) => Number(x) === id)) return
  cur.push(id)
  setSbCharacterIds(sbId, cur)
}

/** 当前分镜已选物品 id 列表 */
function getSbPropIds(sbId) {
  const arr = sbPropIds.value[sbId]
  return Array.isArray(arr) && arr.length > 0 ? arr : EMPTY_ARR
}

function setSbPropIds(sbId, v) {
  sbPropIds.value = { ...sbPropIds.value, [sbId]: Array.isArray(v) ? v : [] }
  onStoryboardPropChange(sbId)
}

function onStoryboardPropChange(sbId) {
  const ids = sbPropIds.value[sbId] || []
  storyboardsAPI.update(sbId, { prop_ids: ids }).catch(() => {})
}

/** 当前分镜选中的场景对象（用于下方缩略图） */
function getSbSelectedScene(sbId) {
  const sceneId = sbSceneId.value[sbId]
  if (sceneId == null) return null
  const list = scenes.value ?? []
  return list.find((s) => Number(s.id) === Number(sceneId)) || null
}

/** 当前分镜选中的角色对象列表（用于下方缩略图） */
function getSbSelectedCharacters(sbId) {
  const ids = getSbCharacterIds(sbId)
  if (!ids.length) return []
  const list = characters.value ?? []
  return ids.map((id) => list.find((c) => Number(c.id) === Number(id))).filter(Boolean)
}

/** 当前分镜选中的物品对象列表（用于下方缩略图） */
function getSbSelectedProps(sbId) {
  const ids = getSbPropIds(sbId)
  if (!ids.length) return []
  const list = props.value ?? []
  return ids.map((id) => list.find((p) => Number(p.id) === Number(id))).filter(Boolean)
}

async function onStoryboardCharacterChange(sbId) {
  const ids = sbCharacterIds.value[sbId] || []
  try {
    await storyboardsAPI.update(sbId, { character_ids: ids })
    // 首/尾帧提示词保留（含用户手动保存版）；图生时后端会按当前勾选做 sanitize
  } catch (e) {
    console.warn('[分镜] 保存角色失败', e)
  }
}

function onLastFrameLayoutLockChange() {
  saveProjectSettings()
}

function onStoryboardSceneChange(sbId) {
  const sceneId = sbSceneId.value[sbId] ?? null
  storyboardsAPI.update(sbId, { scene_id: sceneId }).catch(() => {})
}

/** 同镜号多行时只保留 id 最大的一条（与后端 dedupe 一致，避免「影响的分镜」重复 #N） */
function dedupeStoryboardsForAssetLink(list) {
  const byNum = new Map()
  const extras = []
  for (const sb of list || []) {
    const n = Number(sb?.storyboard_number)
    if (Number.isFinite(n) && n > 0) {
      const prev = byNum.get(n)
      if (!prev || Number(sb.id) > Number(prev.id)) byNum.set(n, sb)
    } else {
      extras.push(sb)
    }
  }
  return [...byNum.values(), ...extras].sort(
    (a, b) => (Number(a.storyboard_number) || 0) - (Number(b.storyboard_number) || 0)
  )
}

/** 返回包含指定角色的所有分镜（已排序） */
function getCharAffectedStoryboards(charId) {
  const matched = (storyboards.value || []).filter((sb) => {
    if (!sb.characters) return false
    const chars = Array.isArray(sb.characters) ? sb.characters : []
    return chars.some((c) => Number(typeof c === 'object' && c != null ? c.id : c) === Number(charId))
  })
  return dedupeStoryboardsForAssetLink(matched)
}

/** 返回指定场景关联的所有分镜 */
function getSceneAffectedStoryboards(sceneId) {
  const matched = (storyboards.value || []).filter(
    (sb) => sb.scene_id != null && Number(sb.scene_id) === Number(sceneId)
  )
  return dedupeStoryboardsForAssetLink(matched)
}

/** 返回包含指定道具的所有分镜（已排序） */
function getPropAffectedStoryboards(propId) {
  const matched = (storyboards.value || []).filter((sb) => {
    if (!sb.prop_ids) return false
    const pids = Array.isArray(sb.prop_ids) ? sb.prop_ids : []
    return pids.some((pid) => Number(pid) === Number(propId))
  })
  return dedupeStoryboardsForAssetLink(matched)
}

/** 点击分镜 chip → 滚动到对应分镜行 */
function scrollToStoryboard(sbId) {
  const el = document.getElementById('sb-' + sbId)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** 对关联分镜批量重新生成图片 */
async function onRegenAffectedSbImages(assetKey, affectedBoards) {
  if (!affectedBoards.length || regenSbImagesForAsset.has(assetKey)) return
  try {
    await ElMessageBox.confirm(
      `将为 ${affectedBoards.length} 个关联分镜重新生成图片（#${affectedBoards.map((s) => s.storyboard_number).join('、#')}），原有图片将被覆盖，是否继续？`,
      '重新生成关联分镜图',
      { confirmButtonText: '确认生成', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  regenSbImagesForAsset.add(assetKey)
  // 用 Map 存进度以便响应式更新
  if (!regenSbImagesProgress.value) regenSbImagesProgress.value = {}
  regenSbImagesProgress.value[assetKey] = { current: 0, total: affectedBoards.length }
  let failed = 0
  try {
    for (let i = 0; i < affectedBoards.length; i++) {
      regenSbImagesProgress.value[assetKey] = { current: i + 1, total: affectedBoards.length }
      const sb = affectedBoards[i]
      try {
        const useFirstLast = storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)
        let prompt = sb.polished_prompt || sb.image_prompt || sb.description || ''
        let frameTypeForCreate = undefined
        if (useFirstLast) {
          // 首尾帧模式下，关联资源触发的批量重新生成也必须走专业首帧提示词
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
          const pollRes = await new Promise((resolve) => {
            const maxAttempts = 180
            let attempts = 0
            const tick = async () => {
              attempts++
              try {
                const t = await taskAPI.get(res.task_id)
                if (t.status === 'completed') { await loadSingleStoryboardMedia(sb.id); return resolve({ status: 'completed' }) }
                if (t.status === 'failed') return resolve({ status: 'failed', error: t.error || '任务失败' })
              } catch (_) {}
              if (attempts < maxAttempts) setTimeout(tick, 2000)
              else resolve({ status: 'timeout' })
            }
            setTimeout(tick, 2000)
          })
          if (pollRes?.status !== 'completed') failed++
        } else {
          await loadSingleStoryboardMedia(sb.id)
        }
        if (useFirstLast) {
          delete sbSelectedImgId.value[sb.id]
        }
      } catch (_) {
        failed++
      }
      if (i < affectedBoards.length - 1) await new Promise((r) => setTimeout(r, 500))
    }
    if (failed === 0) ElMessage.success(`已重新生成 ${affectedBoards.length} 张关联分镜图`)
    else ElMessage.warning(`完成，${failed}/${affectedBoards.length} 条失败`)
  } finally {
    regenSbImagesForAsset.delete(assetKey)
    if (regenSbImagesProgress.value) delete regenSbImagesProgress.value[assetKey]
  }
}

function updateStoryboardDialogue(sbId) {
  // 可在此防抖后调用后端更新 dialogue
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
  if (!store.dramaId) return
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
  trackFilmCreateAction('generate_script_click')
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
    onComplete: ({ episodeCount }) => {
      trackFilmCreateAction('generate_script_complete', {
        extra: { episode_count: episodeCount },
      })
    },
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
  trackFilmCreateAction('save_script_click')
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
    trackFilmCreateAction('save_script_complete', {
      extra: { created_project: !!result?.created },
    })
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

async function onGenerateMissingResourceImages(type) {
  const items = type === 'character' ? characters.value : type === 'scene' ? scenes.value : props.value
  const missing = items.filter((item) => !hasAssetImage(item))
  if (!missing.length) return ElMessage.info('当前资源都已有图片')
  resourceBatchGenerating.value = type
  try {
    for (const item of missing) {
      if (type === 'character') await onGenerateCharacterImage(item)
      else if (type === 'scene') await onGenerateSceneImage(item, sceneUseQuadGrid.value)
      else await onGeneratePropImage(item, propUseQuadGrid.value)
    }
  } finally {
    resourceBatchGenerating.value = null
  }
}

// 解析 extra_images JSON，返回 local_path 数组
function parseExtraImages(item) {
  if (!item?.extra_images) return []
  try {
    const arr = typeof item.extra_images === 'string' ? JSON.parse(item.extra_images) : item.extra_images
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch { return [] }
}

// 将 local_path 转成可访问的 URL
function localPathToUrl(p) {
  if (!p) return ''
  if (p.startsWith('http')) return p
  return '/static/' + p.replace(/^\//, '')
}

// 查找角色/道具/场景在 store 中的当前对象
function findResource(type, id) {
  const list = type === 'character' ? (store.characters ?? [])
    : type === 'prop' ? (store.props ?? [])
    : (store.scenes ?? [])
  return list.find((x) => Number(x.id) === Number(id)) || null
}

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

// 将某张额外图片设为主图（主图降级到 extra_images 第一位）
async function onSetPrimaryImage(type, item, extraPath) {
  const extras = parseExtraImages(item)
  const oldPrimary = item.local_path || ''
  const newExtras = extras.filter((p) => p !== extraPath)
  if (oldPrimary) newExtras.unshift(oldPrimary)
  const extraJson = JSON.stringify(newExtras)
  try {
    if (type === 'character') {
      await characterAPI.putImage(item.id, { local_path: extraPath, image_url: '', extra_images: extraJson })
    } else if (type === 'prop') {
      await propAPI.update(item.id, { local_path: extraPath, image_url: '', extra_images: extraJson })
    } else if (type === 'scene') {
      await sceneAPI.update(item.id, { local_path: extraPath, image_url: '', extra_images: extraJson })
    }
    await loadDrama()
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  }
}

// 删除某张额外图片
async function onRemoveExtraImage(type, item, extraPath) {
  const extras = parseExtraImages(item).filter((p) => p !== extraPath)
  const extraJson = extras.length ? JSON.stringify(extras) : null
  try {
    if (type === 'character') {
      await characterAPI.putImage(item.id, { extra_images: extraJson })
    } else if (type === 'prop') {
      await propAPI.update(item.id, { extra_images: extraJson })
    } else if (type === 'scene') {
      await sceneAPI.update(item.id, { extra_images: extraJson })
    }
    await loadDrama()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
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

/** 获取分镜主图的本地路径（用于超分辨率判断） */
function getSbLocalImage(sb) {
  const img = getSbImage(sb.id)
  return img?.local_path || sb.local_path || null
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

/** P0-3: 对分镜图执行超分辨率（2x） */
async function onUpscaleSbImage(sb) {
  if (!sb?.id || upscalingSbIds.has(sb.id)) return
  upscalingSbIds.add(sb.id)
  try {
    await storyboardsAPI.upscale(sb.id)
    ElMessage.success('超分完成，图片已更新为高清版本')
    await loadSingleStoryboardMedia(sb.id)
  } catch (e) {
    ElMessage.error(e.message || '超分辨率失败')
  } finally {
    upscalingSbIds.delete(sb.id)
  }
}

function normalizeAudioRelPath(raw) {
  const s = String(raw != null ? raw : '').trim().replace(/^\//, '')
  return s
}

/** 对白 TTS 相对路径 */
function sbDialogueAudioRelPath(sb) {
  if (!sb?.id) return ''
  const fromCache = sbDialogueAudioPaths.value[sb.id]
  const fromRow = sb.audio_local_path
  const raw = (fromCache != null && String(fromCache).trim() !== '') ? fromCache : (fromRow != null ? fromRow : '')
  return normalizeAudioRelPath(raw)
}

/** 解说旁白 TTS 相对路径 */
function sbNarrationAudioRelPath(sb) {
  if (!sb?.id) return ''
  const fromCache = sbNarrationAudioPaths.value[sb.id]
  const fromRow = sb.narration_audio_local_path
  const raw = (fromCache != null && String(fromCache).trim() !== '') ? fromCache : (fromRow != null ? fromRow : '')
  return normalizeAudioRelPath(raw)
}

function playSbTtsFromRel(rel) {
  if (!rel) return
  const url = `/static/${rel}`
  try {
    if (sbTtsPreviewAudio) {
      sbTtsPreviewAudio.pause()
      sbTtsPreviewAudio = null
    }
    const a = new Audio(url)
    sbTtsPreviewAudio = a
    a.addEventListener('ended', () => {
      if (sbTtsPreviewAudio === a) sbTtsPreviewAudio = null
    })
    a.play().catch(() => {
      ElMessage.warning('无法播放音频，请检查文件是否存在')
      if (sbTtsPreviewAudio === a) sbTtsPreviewAudio = null
    })
  } catch (_) {
    ElMessage.warning('无法播放音频')
  }
}

function playSbDialogueTts(sb) {
  playSbTtsFromRel(sbDialogueAudioRelPath(sb))
}

function playSbNarrationTts(sb) {
  playSbTtsFromRel(sbNarrationAudioRelPath(sb))
}

/** P2-4: 为分镜对白生成 TTS 配音 */
async function onTtsSbDialogue(sb) {
  if (!sb?.id || ttsSbIds.has(sb.id)) return
  if (!sb.dialogue?.trim()) {
    ElMessage.warning('该分镜没有对白内容')
    return
  }
  ttsSbIds.add(sb.id)
  try {
    const res = await fetch('/api/v1/audio/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyboard_id: sb.id, text: sb.dialogue, tts_kind: 'dialogue' }),
    })
    const data = await res.json()
    const businessOk = data.success === true || Number(data.code) === 200
    if (!res.ok || !businessOk) {
      throw new Error(data.error?.message || data.message || '配音失败')
    }
    if (data.data?.local_path) {
      sbDialogueAudioPaths.value = { ...sbDialogueAudioPaths.value, [sb.id]: data.data.local_path }
      sb.audio_local_path = data.data.local_path
      ElMessage.success('配音已生成')
    }
  } catch (e) {
    ElMessage.error(e.message || 'TTS 配音失败')
  } finally {
    ttsSbIds.delete(sb.id)
  }
}

/** 为分镜解说旁白生成 TTS（与对白共用接口，文本不同） */
async function onTtsSbNarration(sb) {
  if (!sb?.id || ttsSbNarrationIds.has(sb.id)) return
  const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
  if (!text) {
    ElMessage.warning('该分镜没有解说旁白内容')
    return
  }
  ttsSbNarrationIds.add(sb.id)
  try {
    const res = await fetch('/api/v1/audio/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyboard_id: sb.id, text, tts_kind: 'narration' }),
    })
    const data = await res.json()
    const businessOk = data.success === true || Number(data.code) === 200
    if (!res.ok || !businessOk) {
      throw new Error(data.error?.message || data.message || '解说配音失败')
    }
    if (data.data?.local_path) {
      sbNarrationAudioPaths.value = { ...sbNarrationAudioPaths.value, [sb.id]: data.data.local_path }
      sb.narration_audio_local_path = data.data.local_path
      ElMessage.success('解说配音已生成')
    }
  } catch (e) {
    ElMessage.error(e.message || '解说 TTS 失败')
  } finally {
    ttsSbNarrationIds.delete(sb.id)
  }
}

function formatSrtTimestamp(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const z = Math.floor(ms % 1000)
  const p2 = (n) => String(n).padStart(2, '0')
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(z).padStart(3, '0')}`
}

/** 导出当前集分镜表（每镜一行；首尾帧模式含首/尾帧专用提示词） */
async function onExportStoryboardSheet() {
  const boards = storyboards.value || []
  if (!boards.length) {
    ElMessage.warning('暂无分镜')
    return
  }
  const epNum = store.currentEpisode?.episode_number
  const dramaTitle = (store.drama?.title || 'project').replace(/[\\/:*?"<>|]/g, '_')
  const epLabel = epNum != null ? `第${epNum}集` : `ep${currentEpisodeId.value || '1'}`
  const filenameBase = `${dramaTitle}-${epLabel}-分镜表`
  const useFirstLast = !!storyboardUseFirstLastFrame.value

  exportingStoryboardSheet.value = true
  const framePromptBySbId = {}
  try {
    await Promise.all(
      boards.map(async (sb) => {
        try {
          const res = await storyboardsAPI.getFramePrompts(sb.id)
          const fps = res?.frame_prompts || []
          framePromptBySbId[sb.id] = {
            first: fps.find((r) => r.frame_type === 'first')?.prompt?.trim() || '',
            last: fps.find((r) => r.frame_type === 'last')?.prompt?.trim() || '',
          }
        } catch (_) {
          framePromptBySbId[sb.id] = { first: '', last: '' }
        }
      })
    )
  } finally {
    exportingStoryboardSheet.value = false
  }

  function resolveFirstFramePrompt(sbId) {
    const cached = framePromptBySbId[sbId]?.first
    if (cached) return cached
    const imgPrompt = getSbFirstImage(sbId)?.prompt?.trim()
    if (imgPrompt) return imgPrompt
    if (useFirstLast) return buildFirstFrameImagePrompt(sbId)
    return ''
  }

  function resolveLastFramePrompt(sbId) {
    const cached = framePromptBySbId[sbId]?.last
    if (cached) return cached
    const imgPrompt = getSbLastImage(sbId)?.prompt?.trim()
    if (imgPrompt) return imgPrompt
    if (useFirstLast) return buildLastFrameImagePrompt(sbId)
    return ''
  }

  const result = exportStoryboardSheet(
    {
      storyboards: boards,
      getScene: (sbId) => getSbSelectedScene(sbId),
      getCharacters: (sbId) => getSbSelectedCharacters(sbId),
      getProps: (sbId) => getSbSelectedProps(sbId),
      getMovementLabel,
      getFirstFramePrompt: resolveFirstFramePrompt,
      getLastFramePrompt: resolveLastFramePrompt,
      getField(sb, key) {
        const id = sb.id
        const map = {
          title: sbTitle.value[id],
          location: sbLocation.value[id],
          time: sbTime.value[id],
          duration: sbDuration.value[id] ?? sb.duration,
          dialogue: sbDialogue.value[id],
          narration: sbNarration.value[id],
          action: sbAction.value[id],
          result: sbResult.value[id],
          atmosphere: sbAtmosphere.value[id],
          shot_type: sbShotType.value[id],
          movement: sbMovement.value[id],
          layout_description: sbLayoutDescription.value[id],
          universal_segment_text: sbUniversalSegmentText.value[id],
        }
        if (Object.prototype.hasOwnProperty.call(map, key)) {
          const v = map[key]
          return v != null && v !== '' ? v : sb[key]
        }
        return sb[key]
      },
    },
    filenameBase
  )

  if (!result.ok) {
    ElMessage.warning('当前分镜没有可导出的内容')
    return
  }
  ElMessage.success(`已导出分镜表（${result.count} 个镜头）`)
}

function onExportNarrationSrt() {
  const boards = storyboards.value || []
  if (!boards.length) {
    ElMessage.warning('暂无分镜')
    return
  }
  let tMs = 0
  const lines = []
  let idx = 1
  for (const sb of boards) {
    const durSec = Number(sbDuration.value[sb.id] ?? sb.duration)
    const sec = Number.isFinite(durSec) && durSec > 0 ? durSec : 5
    const durMs = Math.round(sec * 1000)
    const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
    if (text) {
      const start = formatSrtTimestamp(tMs)
      const end = formatSrtTimestamp(tMs + durMs)
      lines.push(String(idx++), `${start} --> ${end}`, text, '')
    }
    tMs += durMs
  }
  if (!lines.length) {
    ElMessage.warning('当前分镜没有可导出的解说文案')
    return
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `narration-${currentEpisodeId.value || 'episode'}.srt`
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('已下载解说 SRT')
}

async function onSaveSbNarrationField(sb) {
  if (!sb?.id) return
  const next = (sbNarration.value[sb.id] || '').toString().trim()
  const prev = (sb.narration || '').toString().trim()
  if (next === prev) return
  try {
    await storyboardsAPI.update(sb.id, { narration: next || null })
    const list = store.currentEpisode?.storyboards
    if (Array.isArray(list)) {
      const row = list.find((x) => Number(x.id) === Number(sb.id))
      if (row) row.narration = next || null
    }
  } catch (_) { /* 静默失败，避免打断输入 */ }
}

function isSbUniversalMode(sbId) {
  return sbCreationMode.value[sbId] === 'universal'
}

function setSbCreationModeId(sbId, mode) {
  if (sbId == null) return
  const m = mode === 'universal' ? 'universal' : 'classic'
  sbCreationMode.value = { ...sbCreationMode.value, [sbId]: m }
}

async function onToggleSbUniversalMode(sb) {
  if (!sb?.id) return
  const cur = isSbUniversalMode(sb.id) ? 'universal' : 'classic'
  const next = cur === 'universal' ? 'classic' : 'universal'
  sbCreationMode.value = { ...sbCreationMode.value, [sb.id]: next }
  try {
    await storyboardsAPI.update(sb.id, { creation_mode: next })
    const list = store.currentEpisode?.storyboards
    if (Array.isArray(list)) {
      const row = list.find((x) => Number(x.id) === Number(sb.id))
      if (row) row.creation_mode = next
    }
  } catch (e) {
    sbCreationMode.value = { ...sbCreationMode.value, [sb.id]: cur }
    ElMessage.error(e.message || '保存失败')
  }
}

async function onSaveUniversalSegmentField(sb) {
  if (!sb?.id) return
  clearTimeout(universalPromptSaveTimers.get(sb.id))
  universalPromptSaveTimers.delete(sb.id)
  const next = (sbUniversalSegmentText.value[sb.id] || '').toString()
  const prev = (sb.universal_segment_text || '').toString()
  const savingRevision = universalPromptRevisions.get(sb.id) || 0
  if (next === prev) {
    clearPromptDraft(localStorage, universalPromptDraftIdentity(sb.id))
    return
  }
  try {
    const updated = await storyboardsAPI.update(sb.id, { universal_segment_text: next.trim() || null })
    const list = store.currentEpisode?.storyboards
    if (Array.isArray(list)) {
      const row = list.find((x) => Number(x.id) === Number(sb.id))
      if (row) {
        row.universal_segment_text = next.trim() || null
        if (updated?.updated_at) row.updated_at = updated.updated_at
      }
    }
    if ((universalPromptRevisions.get(sb.id) || 0) === savingRevision) {
      clearPromptDraft(localStorage, universalPromptDraftIdentity(sb.id))
    }
  } catch (_) { /* 草稿已落本地，网络恢复后或下次编辑会再次保存 */ }
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

async function setSbOmniAssetSelected(sb, assetId, checked) {
  if (!sb?.id) return
  const current = new Set((sbOmniAssetIds.value[sb.id] || []).map(Number))
  const id = Number(assetId)
  if (checked) current.add(id); else current.delete(id)
  const ids = [...current]
  sbOmniAssetIds.value = { ...sbOmniAssetIds.value, [sb.id]: ids }
  const patch = { omni_asset_ids: ids }
  // 取消勾选时同步清除首尾帧绑定，避免提交校验失败
  if (!checked) {
    if (Number(sbOmniFirstFrameAssetId.value[sb.id]) === id) patch.omni_first_frame_asset_id = null
    if (Number(sbOmniLastFrameAssetId.value[sb.id]) === id) patch.omni_last_frame_asset_id = null
  }
  try {
    await storyboardsAPI.update(sb.id, patch)
    const row = (storyboards.value || []).find((item) => Number(item.id) === Number(sb.id))
    if (row) Object.assign(row, patch)
    if (!checked) {
      if (Number(sbOmniFirstFrameAssetId.value[sb.id]) === id) sbOmniFirstFrameAssetId.value = { ...sbOmniFirstFrameAssetId.value, [sb.id]: null }
      if (Number(sbOmniLastFrameAssetId.value[sb.id]) === id) sbOmniLastFrameAssetId.value = { ...sbOmniLastFrameAssetId.value, [sb.id]: null }
    }
  } catch (err) {
    ElMessage.error(err?.message || '素材引用保存失败')
  }
}

async function onSbOmniAssetUsageChange(sb, asset, usage) {
  if (!sb?.id) return
  const assetId = Number(asset?.id ?? asset)
  const assetObj = asset && typeof asset === 'object' ? asset : (universalLibraryAssets.value.find((a) => Number(a.id) === assetId) || null)
  // “含真人”仅是素材声明，不限制用户对参考图的编排用途。
  const current = { ...(sbOmniAssetUsage.value[sb.id] || {}) }
  if (usage) current[assetId] = usage
  else delete current[assetId]
  sbOmniAssetUsage.value = { ...sbOmniAssetUsage.value, [sb.id]: current }
  try {
    await storyboardsAPI.update(sb.id, { omni_asset_usage_json: current })
    const row = (storyboards.value || []).find((item) => Number(item.id) === Number(sb.id))
    if (row) row.omni_asset_usage = current
    // 人物一致性用途自动触发 SD2 认证
    if (usage === 'identity' && assetObj?.type === 'image' && sbOmniSd2Status(assetObj) !== 'active') {
      onSbOmniAssetCertify(sb, assetObj).catch(() => {})
    }
  } catch (err) {
    ElMessage.error(err?.message || '素材用途保存失败')
  }
}

/** 本镜已选素材：严格按用户勾选顺序返回（@图片N 与提交顺序一致） */
function getSelectedUniversalLibraryAssets(sb) {
  const ids = (sbOmniAssetIds.value[sb?.id] || []).map(Number)
  const byId = new Map(validRows(universalLibraryAssets.value).map((asset) => [Number(asset.id), asset]))
  return ids.map((id) => byId.get(id)).filter(Boolean)
}

function sbOmniAssetSelected(sb, id) {
  return (sbOmniAssetIds.value[sb?.id] || []).map(Number).includes(Number(id))
}

function sbOmniSelectedIndex(sb, id) {
  return (sbOmniAssetIds.value[sb?.id] || []).map(Number).indexOf(Number(id))
}

function sbOmniSelectedCounts(sb) {
  const counts = { image: 0, video: 0, audio: 0 }
  for (const asset of getSelectedUniversalLibraryAssets(sb)) {
    if (Object.prototype.hasOwnProperty.call(counts, asset.type)) counts[asset.type] += 1
  }
  return counts
}

/** 已选图片且用途为人物一致（identity）的素材，用于 SD2 认证区 */
function sbOmniIdentityAssets(sb) {
  if (!sb?.id) return []
  const usageMap = sbOmniAssetUsage.value[sb.id] || {}
  return getSelectedUniversalLibraryAssets(sb).filter((asset) => asset.type === 'image' && usageMap[Number(asset.id)] === 'identity')
}

/** 首尾帧模式的候选项：已选图片素材 */
function sbOmniFrameCandidates(sb) {
  return getSelectedUniversalLibraryAssets(sb).filter((asset) => asset.type === 'image')
}

function sbOmniAssetUrl(asset) {
  if (!asset) return ''
  return asset.local_path ? '/static/' + String(asset.local_path).replace(/^\/+/, '') : (asset.url || '')
}

function sbOmniFrameAsset(sb, position) {
  const id = position === 'first' ? sbOmniFirstFrameAssetId.value[sb?.id] : sbOmniLastFrameAssetId.value[sb?.id]
  if (id == null) return null
  return universalLibraryAssets.value.find((a) => Number(a.id) === Number(id)) || null
}

function sbOmniFrameAssetName(sb, position) {
  return sbOmniFrameAsset(sb, position)?.name || '未选择'
}

function sbOmniFramePickerActive(sbId, position, id) {
  const current = position === 'first' ? sbOmniFirstFrameAssetId.value[sbId] : sbOmniLastFrameAssetId.value[sbId]
  return current != null && Number(current) === Number(id)
}

function sbOmniSd2Status(asset) { return String(asset?.seedance2_asset?.status || 'none').toLowerCase() }
function sbOmniSd2StatusLabel(asset) {
  return ({ none: '未认证', processing: '认证中', active: '可用', invalid: '已失效', failed: '认证失败' })[sbOmniSd2Status(asset)] || '状态未知'
}
const OMNI_USAGE_OPTIONS = {
  image: [
    { label: '普通参考', value: 'reference' },
    { label: '人物一致', value: 'identity' },
    { label: '主视觉', value: 'primary' },
    { label: '场景', value: 'environment' },
    { label: '道具', value: 'prop' },
    { label: '风格', value: 'style' },
    { label: '首帧', value: 'first_frame' },
    { label: '尾帧', value: 'last_frame' },
  ],
  video: [
    { label: '动作/镜头参考', value: 'motion' },
    { label: '关键帧提取', value: 'keyframes' },
    { label: '普通参考', value: 'reference' },
    { label: '仅后期', value: 'post_process' },
  ],
  audio: [
    { label: '音色/氛围参考', value: 'ambience' },
    { label: '普通参考', value: 'reference' },
    { label: '成片混音', value: 'post_mix' },
  ],
}
function omniUsageOptions(asset) { return OMNI_USAGE_OPTIONS[asset?.type] || OMNI_USAGE_OPTIONS.image }
function omniDefaultUsage(asset) { return asset?.type === 'video' ? 'motion' : asset?.type === 'audio' ? 'ambience' : 'reference' }
function omniUsageLabel(usage) {
  return (Object.values(OMNI_USAGE_OPTIONS).flat().find((opt) => opt.value === usage)?.label) || usage
}

async function moveSbOmniAsset(sb, assetId, dir) {
  if (!sb?.id) return
  const ids = [...(sbOmniAssetIds.value[sb.id] || [])].map(Number)
  const from = ids.indexOf(Number(assetId))
  const to = from + dir
  if (from < 0 || to < 0 || to >= ids.length) return
  const [moved] = ids.splice(from, 1)
  ids.splice(to, 0, moved)
  sbOmniAssetIds.value = { ...sbOmniAssetIds.value, [sb.id]: ids }
  try {
    await storyboardsAPI.update(sb.id, { omni_asset_ids: ids })
    const row = (storyboards.value || []).find((item) => Number(item.id) === Number(sb.id))
    if (row) row.omni_asset_ids = ids
  } catch (err) {
    ElMessage.error(err?.message || '素材排序保存失败')
  }
}

function removeSbOmniAsset(sb, id) {
  return setSbOmniAssetSelected(sb, id, false)
}

/** 上传素材 → 自动加入本镜并设置默认用途 */
async function uploadSbOmniFiles(sb, files) {
  const list = Array.from(files || [])
  if (!list.length || !sb?.id) return
  sbOmniUploadingIds.value.add(sb.id)
  try {
    for (const file of list) {
      try {
        const out = await omniVideoAPI.upload(file, { name: file.name, drama_id: dramaId.value })
        if (!out?.asset) throw new Error('上传未返回素材')
        const asset = { ...out.asset }
        if (!universalLibraryAssets.value.some((a) => Number(a.id) === Number(asset.id))) {
          universalLibraryAssets.value = [asset, ...universalLibraryAssets.value]
        }
        await setSbOmniAssetSelected(sb, asset.id, true)
        await onSbOmniAssetUsageChange(sb, asset, omniDefaultUsage(asset))
        ElMessage.success(`已上传「${asset.name || file.name}」并加入本镜`)
      } catch (err) {
        ElMessage.error(`${file.name}：${err?.message || '上传失败'}`)
      }
    }
  } finally {
    sbOmniUploadingIds.value.delete(sb.id)
  }
}

function onSbOmniUploadClick(sb) {
  sbOmniUploadTargetId.value = sb?.id || null
  sbOmniFileInput.value?.click()
}

function openResourceMediaUpload() {
  resourceMediaFileInput.value?.click()
}

async function onResourceMediaFileChange(e) {
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

async function deleteResourceMedia(asset) {
  try {
    const linked = asset.source_type === 'project_resource'
    await ElMessageBox.confirm(linked
      ? `确定解除“${asset.name || `素材 ${asset.id}`}”的媒体库关联？历史分镜不会被删除。`
      : `确定删除“${asset.name || `素材 ${asset.id}`}”？`, linked ? '解除素材关联' : '删除素材', { type: 'warning' })
    await omniVideoAPI.deleteAsset(asset.id)
    universalLibraryAssets.value = universalLibraryAssets.value.filter((item) => Number(item.id) !== Number(asset.id))
    if (linked) await loadDetachedResourceLinks()
    ElMessage.success(linked ? '已解除素材关联，历史引用保持不变' : '素材已删除')
  } catch (err) {
    if (err !== 'cancel' && err?.action !== 'cancel') ElMessage.error(err?.message || '删除素材失败')
  }
}

async function onSbOmniFileInputChange(e) {
  const files = e.target?.files
  const target = sbOmniUploadTargetId.value
  e.target.value = ''
  sbOmniUploadTargetId.value = null
  if (!target || !files || !files.length) return
  const sb = (storyboards.value || []).find((item) => Number(item.id) === Number(target))
  if (sb) await uploadSbOmniFiles(sb, files)
}

async function onSbOmniLibDrop(e, sb) {
  sbOmniLibDragging.value = false
  await uploadSbOmniFiles(sb, e.dataTransfer?.files || [])
}

/** 首尾帧模式：直接上传一张图并设为对应帧 */
function onSbOmniFrameUpload(sb, position) {
  sbOmniFrameUploadTarget.value = { sbId: sb?.id || null, position }
  sbOmniFrameFileInput.value?.click()
}

async function onSbOmniFrameFileInputChange(e) {
  const files = e.target?.files
  const target = sbOmniFrameUploadTarget.value
  e.target.value = ''
  sbOmniFrameUploadTarget.value = null
  if (!target?.sbId || !files || !files.length) return
  const file = files[0]
  sbOmniFrameUploading.value = target.position
  try {
    const out = await omniVideoAPI.upload(file, { name: file.name, drama_id: dramaId.value })
    if (!out?.asset) throw new Error('上传未返回素材')
    const asset = { ...out.asset }
    if (!universalLibraryAssets.value.some((a) => Number(a.id) === Number(asset.id))) {
      universalLibraryAssets.value = [asset, ...universalLibraryAssets.value]
    }
    const usage = target.position === 'first' ? 'first_frame' : 'last_frame'
    await setSbOmniAssetSelected(target.sbId, asset.id, true)
    await onSbOmniAssetUsageChange(target.sbId, asset, usage)
    await setSbOmniFrameAsset(target.sbId, target.position, asset.id)
    ElMessage.success(`已上传并设为${target.position === 'first' ? '首帧' : '尾帧'}`)
  } catch (err) {
    ElMessage.error(err?.message || '首尾帧参考图上传失败')
  } finally {
    sbOmniFrameUploading.value = ''
  }
}

function openSbOmniFramePicker(sb, position) {
  sbOmniFramePicker.value = { open: true, sbId: sb?.id || null, target: position }
}

function confirmSbOmniFrameAsset(asset) {
  const { sbId, target } = sbOmniFramePicker.value
  sbOmniFramePicker.value = { ...sbOmniFramePicker.value, open: false }
  if (!sbId || !asset) return
  setSbOmniFrameAsset(sbId, target, asset.id)
}

async function onSbOmniAssetRealPersonToggle(sb, asset, value) {
  if (!asset) return
  const prev = !!asset.requires_sd2_identity
  asset.requires_sd2_identity = !!value
  try {
    const updated = await omniVideoAPI.updateAsset(asset.id, { requires_sd2_identity: !!value })
    Object.assign(asset, updated || {})
    if (value && sbOmniSd2Status(asset) !== 'active') await onSbOmniAssetCertify(sb, asset)
    else if (!value && sbOmniAssetUsage.value[sb?.id]?.[asset.id] === 'identity') await onSbOmniAssetUsageChange(sb, asset, 'reference')
  } catch (err) {
    asset.requires_sd2_identity = prev
    if (err?.response?.status === 404) {
      // The card was rendered from a stale in-memory library response. Remove
      // it immediately and repair every storyboard that still points at it.
      universalLibraryAssets.value = universalLibraryAssets.value.filter((item) => Number(item.id) !== Number(asset.id))
      await reconcileUnavailableStoryboardAssets()
      ElMessage.warning('该素材当前不可用；历史分镜引用已保留，请恢复、替换或显式移除')
      return
    }
    ElMessage.error(err?.message || '真人声明保存失败')
  }
}

async function onSbOmniAssetCertify(sb, asset) {
  if (!asset || asset.type !== 'image') return
  sbOmniCertifyingIds.value.add(asset.id)
  try {
    const out = ['processing', 'active'].includes(sbOmniSd2Status(asset))
      ? await omniVideoAPI.refreshAssetCertification(asset.id)
      : await omniVideoAPI.certifyAsset(asset.id)
    if (out?.seedance2_asset) asset.seedance2_asset = out.seedance2_asset
    ElMessage.success(`「${asset.name || asset.id}」SD2 认证状态：${sbOmniSd2StatusLabel(asset)}`)
  } catch (err) {
    ElMessage.error(err?.message || 'SD2 认证失败，请检查素材库配置后重试')
  } finally {
    sbOmniCertifyingIds.value.delete(asset.id)
  }
}

/** @ 编辑器选择素材槽位时自动加入本镜（素材库素材） */
async function onUniversalSegmentPickAsset(sb, slot) {
  if (!sb?.id || !slot || slot.kind !== 'asset' || !slot.assetId) return
  if (sbOmniAssetSelected(sb, slot.assetId)) return
  await setSbOmniAssetSelected(sb, slot.assetId, true)
}

/** 素材库卡片拖拽：携带素材信息供提示词编辑区接收（实体候选需先勾选导入素材库） */
// 与 FreeCreate 工作台统一的 pointer 拖拽: 载荷字段对齐 OmniAssetPromptEditor
// 期望的 {id, name, alias, type}; entity 类素材(角色/场景/道具)保留 entity 透传。
function sbOmniPointerPayload(item) {
  if (!item) return null
  if (item.poolType === 'entity') return { alias: item.name || '资源', entity: item.entity || null }
  return { id: Number(item.id), name: item.name, alias: item.name || `素材${item.id}`, type: item.type || 'image' }
}
function beginSbOmniPointerDrag(event, item) {
  beginAssetPointerDrag(event, sbOmniPointerPayload(item))
}
// 拖拽结束后抑制紧随的 click, 防止误触发选用
function onSbOmniPoolGuardedClick(activeSb, item) {
  if (shouldSuppressAssetClick()) return
  onSbOmniPoolToggle(activeSb, item)
}

function onSbOmniAssetDragStart(e, item) {
  if (!e?.dataTransfer || !item) return
  const payload = JSON.stringify(item.poolType === 'entity'
    ? { alias: item.name || '资源', entity: item.entity || null }
    : { assetId: Number(item.id), alias: item.name || `素材${item.id}` })
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.setData('application/json', payload)
  e.dataTransfer.setData('text/plain', payload)
  setTransparentDragPreview(e)
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

/** 素材拖入提示词编辑区：加入本镜已选，并在实际拖放位置插入 @图片N 引用。 */
async function onUniversalSegmentDropAsset(sb, payload) {
  if (!sb?.id || !payload) return
  let assetId = Number(payload.assetId)
  if (!Number.isFinite(assetId) && payload.entity) {
    assetId = await ensureEntityAsset(sb, { entity: payload.entity, name: payload.alias })
  }
  if (!Number.isFinite(assetId)) return
  if (!sbOmniAssetSelected(sb, assetId)) {
    await setSbOmniAssetSelected(sb, assetId, true)
  }
  const n = sbOmniEntryIndexByAssetId(sb)[assetId] || ((sbOmniAssetIds.value[sb.id] || []).length + sbOmniAutoRefCount(sb))
  const token = `@图片${n}`
  const current = (sbUniversalSegmentText.value[sb.id] ?? sb.universal_segment_text ?? '').toString()
  const inserted = insertTokenAtOffset(current, token, payload.offset)
  sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: inserted.text }
  onSaveUniversalSegmentField(sb)
  ElMessage.success(`已引用「${payload.alias || `素材${assetId}`}」为 @图片${n}`)
}

async function loadUniversalLibraryAssets() {
  // 素材池加载全部媒体素材（不按当前剧集过滤）：媒体素材库上传的图片/视频/音频
  // 未绑定 drama_id，按剧集过滤会导致本地上传的素材（如音频）永远看不到、参考不了。
  // 与媒体素材库页 /media-library、全能创作台 /free-create 的加载口径保持一致。
  try {
    const [result, limits] = await Promise.all([
      loadAllUniversalLibraryAssets(),
      omniVideoAPI.uploadLimits().catch(() => null),
      loadDetachedResourceLinks(),
    ])
    universalLibraryAssets.value = (result?.items || []).filter((asset) => asset && Number.isFinite(Number(asset.id)) && ['image', 'video', 'audio'].includes(asset.type) && asset.processing_status !== 'processing')
    sbUniversalUploadLimits.value = limits || null
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

async function setSbOmniFrameAsset(sb, position, assetId) {
  if (!sb?.id) return
  const id = assetId == null ? null : Number(assetId)
  const field = position === 'first' ? 'omni_first_frame_asset_id' : 'omni_last_frame_asset_id'
  const next = position === 'first' ? { ...sbOmniFirstFrameAssetId.value, [sb.id]: id } : { ...sbOmniLastFrameAssetId.value, [sb.id]: id }
  if (position === 'first') sbOmniFirstFrameAssetId.value = next
  else sbOmniLastFrameAssetId.value = next
  const selected = new Set((sbOmniAssetIds.value[sb.id] || []).map(Number))
  if (id != null) selected.add(id)
  const ids = [...selected]
  sbOmniAssetIds.value = { ...sbOmniAssetIds.value, [sb.id]: ids }
  try {
    await storyboardsAPI.update(sb.id, { [field]: id, omni_asset_ids: ids })
    const row = (storyboards.value || []).find((item) => Number(item.id) === Number(sb.id))
    if (row) Object.assign(row, { [field]: id, omni_asset_ids: ids })
  } catch (err) {
    ElMessage.error(err?.message || '首尾帧设置保存失败')
  }
}

async function onSbOmniModeChange(sb, mode) {
  if (!sb?.id) return
  const value = mode === 'first_last_frame' ? 'first_last_frame' : 'multi_reference'
  sbOmniCreationMode.value = { ...sbOmniCreationMode.value, [sb.id]: value }
  try {
    await storyboardsAPI.update(sb.id, { omni_creation_mode: value })
    const row = (storyboards.value || []).find((item) => Number(item.id) === Number(sb.id))
    if (row) row.omni_creation_mode = value
  } catch (err) {
    ElMessage.error(err?.message || '创作模式保存失败')
  }
}

async function onSbAudioSettingsChange(sb, patch = {}) {
  if (!sb?.id) return
  const next = {
    audio_strategy: patch.audio_strategy ?? sbAudioStrategy.value[sb.id] ?? 'reference_only',
    keep_original_audio: patch.keep_original_audio ?? sbKeepOriginalAudio.value[sb.id] ?? false,
    audio_volume: Number(patch.audio_volume ?? sbAudioVolume.value[sb.id] ?? 1),
    audio_fade_seconds: Number(patch.audio_fade_seconds ?? sbAudioFadeSeconds.value[sb.id] ?? 0),
  }
  sbAudioStrategy.value = { ...sbAudioStrategy.value, [sb.id]: next.audio_strategy }
  sbKeepOriginalAudio.value = { ...sbKeepOriginalAudio.value, [sb.id]: !!next.keep_original_audio }
  sbAudioVolume.value = { ...sbAudioVolume.value, [sb.id]: next.audio_volume }
  sbAudioFadeSeconds.value = { ...sbAudioFadeSeconds.value, [sb.id]: next.audio_fade_seconds }
  try {
    await storyboardsAPI.update(sb.id, next)
  } catch (err) {
    ElMessage.error(err?.message || '音频策略保存失败')
  }
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

function setSbGenerationSettings(id, settings) {
  sbGenerationSettings.value = { ...sbGenerationSettings.value, [id]: settings }
  sbDuration.value = { ...sbDuration.value, [id]: settings.duration }
}

function applyGenerationSettingsContract(result) {
  if (!result) return
  const nextSettings = { ...sbGenerationSettings.value }
  const nextModes = { ...sbGenerationModes.value }
  const durationMap = { ...sbDuration.value }
  const rows = Array.isArray(result.storyboards) ? result.storyboards : [result]
  for (const item of rows) {
    if (!item?.id || !item.effective) continue
    nextSettings[item.id] = { ...item.effective }
    nextModes[item.id] = item.mode || 'inherited'
    durationMap[item.id] = item.effective.duration
  }
  sbGenerationSettings.value = nextSettings
  sbGenerationModes.value = nextModes
  sbDuration.value = durationMap
  if (result.defaults) setProjectGenerationSettings(result.defaults)
}

async function loadEpisodeGenerationSettings(episodeId = currentEpisodeId.value) {
  if (!episodeId) return
  try { applyGenerationSettingsContract(await storyboardsAPI.getEpisodeGenerationSettings(episodeId)) } catch (_) {}
}

async function restoreSbGenerationDefaults(sb) {
  try {
    applyGenerationSettingsContract(await storyboardsAPI.clearGenerationSettingsOverrides(sb.id))
    ElMessage.success('当前镜头已恢复跟随首镜参数')
  } catch (err) { ElMessage.error(err?.message || '恢复本集默认失败') }
}

const inlineSbSettingsSaveTimers = new Map()
function onInlineSbGenerationSettingsChange(sb, settings = {}) {
  if (!sb?.id) return
  setSbGenerationSettings(sb.id, settings)
  clearTimeout(inlineSbSettingsSaveTimers.get(sb.id))
  inlineSbSettingsSaveTimers.set(sb.id, setTimeout(async () => {
    try {
      const contract = await storyboardsAPI.updateGenerationSettings(sb.id, { scope: 'current', settings })
      applyGenerationSettingsContract(contract)
      const row = (storyboards.value || []).find((item) => Number(item.id) === Number(sb.id))
      if (row) Object.assign(row, {
        duration: Number(settings.duration) || 15,
        text_model: settings.text_model && settings.text_model !== 'auto' ? settings.text_model : null,
        video_model: settings.video_model && settings.video_model !== 'auto' ? settings.video_model : null,
        video_resolution: settings.resolution || '720p',
        video_aspect_ratio: settings.aspect_ratio || '16:9',
        video_upscale_resolution: settings.upscale_resolution || null,
        video_target_fps: settings.target_fps || null,
      })
    } catch (err) {
      ElMessage.error(err?.message || '分镜参数保存失败')
    }
  }, 350))
}

function sd2ResourceStatus(item) {
  return String(item?.seedance2_asset?.status || 'none').toLowerCase()
}
function sd2ResourceActionLabel(item) {
  const status = sd2ResourceStatus(item)
  if (status === 'active') return '已认证'
  if (status === 'processing' || status === 'pending') return '刷新认证'
  if (status === 'stale' || status === 'failed' || status === 'invalid') return '重新认证'
  return 'SD2认证'
}
async function onSd2ResourceAction(kind, item) {
  if (!item?.id || !hasAssetImage(item)) return ElMessage.warning('请先上传图片再进行 SD2 认证')
  const status = sd2ResourceStatus(item)
  if (status === 'active') {
    return ElMessage.info(`该${kind === 'scene' ? '场景' : '道具'}已认证，可直接用于人物一致性参考`)
  }
  sd2ResourceCertifying.value = `${kind}-${item.id}`
  try {
    const api = kind === 'scene' ? sceneAPI : propAPI
    const res = (status === 'processing' || status === 'pending') ? await api.refreshSd2(item.id) : await api.certifySd2(item.id)
    const cert = res?.seedance2_asset || res?.data?.seedance2_asset
    if (cert) item.seedance2_asset = cert
    ElMessage.success(cert?.status === 'active' ? 'SD2 认证已完成' : '认证任务已提交，可稍后刷新状态')
  } catch (err) {
    ElMessage.error(err?.message || 'SD2 认证失败')
  } finally {
    sd2ResourceCertifying.value = null
  }
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

/** 全能片段：@图片N 转 Grok 占位符 <IMAGE_N> */
function universalSegmentAtImageToGrokTags(text) {
  return (text || '').replace(/@图片(\d+)/g, '<IMAGE_$1>')
}

function onUniversalSegmentToGrokVideoTags(sb) {
  if (!sb?.id) return
  const raw = (sbUniversalSegmentText.value[sb.id] ?? '').toString()
  if (!raw.trim()) {
    ElMessage.warning('请先填写或生成片段描述')
    return
  }
  const next = universalSegmentAtImageToGrokTags(raw)
  if (next === raw) {
    ElMessage.info('未找到 @图片N 标记，无需转换')
    return
  }
  sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: next }
  void onSaveUniversalSegmentField(sb)
  ElMessage.success('已改为 Grok 视频占位符格式（<IMAGE_N>）')
}

function onUniversalSegmentPromptMenu(sb, cmd) {
  if (cmd === 'generate') onGenerateUniversalSegmentPrompt(sb, {})
  else if (cmd === 'generate-force') onGenerateUniversalSegmentPrompt(sb, { forceWithoutReferenceImages: true })
  else if (cmd === 'polish') onPolishUniversalSegmentPromptStream(sb, {})
  else if (cmd === 'polish-force') onPolishUniversalSegmentPromptStream(sb, { forceWithoutReferenceImages: true })
  else if (cmd === 'to-grok-video-tags') onUniversalSegmentToGrokVideoTags(sb)
}

/** 全能模式：根据当前分镜结构化字段流式生成片段描述（NDJSON） */
async function onGenerateUniversalSegmentPrompt(sb, opts = {}) {
  if (!sb?.id || generatingUniversalSegmentIds.has(sb.id)) return
  const force = !!opts.forceWithoutReferenceImages
  generatingUniversalSegmentIds.add(sb.id)
  let live = ''
  try {
    const durationSec = universalSegmentDurationSecForSb(sb)
    const data = await storyboardsAPI.generateUniversalSegmentPromptStream(
      sb.id,
      {
        duration: durationSec,
        model: getSbTextModel(sb),
        field_overrides: buildUniversalSegmentFieldOverrides(sb),
        ...(force ? { force_without_reference_images: true } : {}),
      },
      (delta) => {
        live += delta
        sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: live }
      }
    )
    const text = (data?.universal_segment_text ?? '').toString().trim()
    if (!text) {
      ElMessage.warning('未收到完整生成结果，请重试')
      return
    }
    sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: text }
    const list = store.currentEpisode?.storyboards
    if (Array.isArray(list)) {
      const row = list.find((x) => Number(x.id) === Number(sb.id))
      if (row) row.universal_segment_text = text
    }
    ElMessage.success(force ? '已强制生成全能片段提示词（无图模式）' : '已根据分镜生成全能片段提示词')
  } catch (e) {
    ElMessage.error(e.message || '生成失败，请检查文本模型配置')
  } finally {
    generatingUniversalSegmentIds.delete(sb.id)
  }
}

/** 全能模式：结合剧本与邻镜流式润色片段描述（服务端 NDJSON） */
async function onPolishUniversalSegmentPromptStream(sb, opts = {}) {
  if (!sb?.id || generatingUniversalSegmentIds.has(sb.id)) return
  const force = !!opts.forceWithoutReferenceImages
  const draft = sbUniversalSegmentTrimmed(sb)
  if (!draft) {
    ElMessage.warning('请先填写或生成片段描述后再润色')
    return
  }
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
        ...(force ? { force_without_reference_images: true } : {}),
      },
      (delta) => {
        live += delta
        sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: live }
      }
    )
    const text = (data?.universal_segment_text ?? '').toString().trim()
    if (!text) {
      ElMessage.warning('未收到完整润色结果，请重试')
      return
    }
    sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: text }
    const list = store.currentEpisode?.storyboards
    if (Array.isArray(list)) {
      const row = list.find((x) => Number(x.id) === Number(sb.id))
      if (row) row.universal_segment_text = text
    }
    ElMessage.success(force ? '全能片段已强制润色并保存（无图模式）' : '全能片段提示词已润色并保存')
  } catch (e) {
    ElMessage.error(e.message || '润色失败，请检查文本模型配置')
  } finally {
    generatingUniversalSegmentIds.delete(sb.id)
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

/** 场景/角色/道具实体 → 图片引用（优先本地相对路径，回退 image_url） */
function entityImageRef(item) {
  const localPath = item?.local_path && String(item.local_path).trim()
  return { local_path: localPath || null, url: localPath ? '' : (item?.image_url || '') }
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

/** 实体图不再自动占位（统一走素材池勾选），固定返回 0 */
function sbOmniAutoRefCount() {
  return 0
}

/** 已选素材 assetId → @图片N 序号 */
function sbOmniEntryIndexByAssetId(sb) {
  const map = {}
  sbOmniReferenceEntries(sb).forEach((entry, idx) => {
    if (entry.asset_id != null) map[Number(entry.asset_id)] = idx + 1
  })
  return map
}

/**
 * 统一资源库候选：媒体素材（assets）+ 本镜场景/角色/道具图（虚拟候选）。
 * 一个分镜只用一个资源库自由勾选，实体图勾选时自动导入素材库（assets）。
 */
function sbOmniPoolItems(sb) {
  const pool = validRows(universalLibraryAssets.value).map((a) => ({ ...a, poolKey: `asset-${a.id}`, poolType: 'asset' }))
  if (!sb?.id) return pool
  const existingPaths = new Set(pool.map((a) => String(a.local_path || '').trim()).filter(Boolean))
  const pushEntity = (kind, entity) => {
    if (!entity || !hasAssetImage(entity)) return
    const lp = entity.local_path && String(entity.local_path).trim()
    if (lp && existingPaths.has(lp)) return // 与媒体素材同一张图时不重复展示
    const ref = entityImageRef(entity)
    pool.push({
      id: `${kind}-${entity.id}`,
      assetId: null,
      poolKey: `${kind}-${entity.id}`,
      poolType: 'entity',
      kind,
      entity,
      name: (entity.name || ({ scene: '场景', character: '角色', prop: '道具' }[kind] || '未命名')).toString(),
      thumbUrl: assetImageUrl(entity),
      local_path: ref.local_path,
      url: ref.local_path ? '' : ref.url,
      type: 'image',
    })
  }
  pushEntity('scene', getSbSelectedScene(sb.id))
  for (const c of getSbSelectedCharacters(sb.id)) pushEntity('character', c)
  for (const p of getSbSelectedProps(sb.id)) pushEntity('prop', p)
  return pool
}

/** 实体图 → 素材库 asset（已存在则复用），返回 assetId */
async function ensureEntityAsset(sb, item) {
  const entity = item?.entity
  if (!entity) return null
  // Entity images must use the canonical project-resource mapping. Creating
  // an anonymous copy here used to bypass a deleted mapping tombstone, making
  // a user-deleted material reappear as soon as a storyboard selected it.
  const linked = await omniVideoAPI.linkProjectResource({
    drama_id: dramaId.value,
    resource_type: item.kind,
    resource_id: entity.id,
  })
  const assetId = linked?.id
  if (assetId && !universalLibraryAssets.value.some((asset) => Number(asset.id) === Number(assetId))) {
    universalLibraryAssets.value = [linked, ...universalLibraryAssets.value]
  }
  return assetId
}

/** 资源库统一勾选：media 素材直接勾选；实体图自动导入素材库后勾选 */
async function onSbOmniPoolToggle(sb, item) {
  if (!sb?.id || !item) return
  if (item.poolType === 'entity') {
    try {
      const assetId = await ensureEntityAsset(sb, item)
      if (!assetId) throw new Error('导入素材库失败')
      await setSbOmniAssetSelected(sb, assetId, true)
      ElMessage.success(`「${item.name}」已加入本镜参考`)
    } catch (err) {
      ElMessage.error(err?.message || '加入素材库失败')
    }
    return
  }
  await setSbOmniAssetSelected(sb, item.id, !sbOmniAssetSelected(sb, item.id))
}

/** 资源库候选是否已勾选：实体项按对应素材是否已在已选中判断 */
function sbOmniPoolItemSelected(sb, item) {
  if (!sb?.id || !item) return false
  if (item.poolType === 'asset') return sbOmniAssetSelected(sb, item.id)
  const entity = item.entity
  const localPath = entity?.local_path && String(entity.local_path).trim()
  const imageUrl = entity?.image_url || ''
  return universalLibraryAssets.value.some((a) => {
    if (!sbOmniAssetSelected(sb, a.id)) return false
    const p = String(a.local_path || '').trim()
    return localPath ? p === localPath : (a.url || '') === imageUrl
  })
}

/** 全能模式：参考槽位（@ 选择器），顺序与提交 payload 一一对应 */
function getSbUniversalOmniRefSlots(sb) {
  const slots = sbOmniReferenceEntries(sb).map((entry, idx) => ({
    index: idx + 1,
    kind: entry.kind || 'asset',
    name: entry.name,
    thumbUrl: entry.thumbUrl || '',
    assetId: entry.asset_id != null ? Number(entry.asset_id) : null,
    asset: entry.asset || null,
  }))
  // 多参考模式：追加「可追加素材」——素材池里未选的素材，点击后自动加入本镜并引用
  if (!sb?.id) return slots
  if ((sbOmniCreationMode.value[sb.id] || 'multi_reference') === 'first_last_frame') return slots
  const selectedIds = new Set((sbOmniAssetIds.value[sb.id] || []).map(Number))
  let idx = slots.length
  for (const asset of universalLibraryAssets.value) {
    if (selectedIds.has(Number(asset.id))) continue
    idx += 1
    slots.push({
      index: idx,
      kind: 'asset',
      name: (asset.name || `素材${asset.id}`).toString(),
      thumbUrl: asset.type === 'image' ? sbOmniAssetUrl(asset) : '',
      assetId: Number(asset.id),
      asset,
      addable: true,
    })
    if (idx - slots.length >= 12) break // 限制未选素材菜单数量，避免过长
  }
  return slots
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

function buildSbOmniAssetsPayload(sb) {
  return sbOmniReferenceEntries(sb).map((entry, index) => ({
    asset_id: entry.asset_id,
    ordinal: index + 1,
    alias: entry.alias,
    role: entry.role,
    usage: entry.usage,
    send_to_model: true,
    // 外部引用条目（场景/角色/道具等非素材库图片）：后端按 url/local_path 重建虚拟素材
    ...(entry.asset_id == null ? { url: entry.url || null, local_path: entry.local_path || null, type: entry.type || 'image' } : {}),
  }))
}

/** 非 Seedance2 全能降级：仅场景参考图（若有） */
function collectSbSceneOnlyReferenceAbsoluteUrls(sb) {
  if (!sb?.id) return []
  const scene = getSbSelectedScene(sb.id)
  if (scene && hasAssetImage(scene)) {
    const abs = toAbsoluteImageUrl(assetImageUrl(scene))
    return abs ? [abs] : []
  }
  return []
}

let activeVideoAiConfigCache = null
let activeVideoAiConfigCacheAt = 0
const ACTIVE_VIDEO_AI_CONFIG_TTL_MS = 15000

function invalidateActiveVideoAiConfigCache() {
  activeVideoAiConfigCache = null
  activeVideoAiConfigCacheAt = 0
}

async function getActiveVideoAiConfig() {
  const now = Date.now()
  if (activeVideoAiConfigCache && now - activeVideoAiConfigCacheAt < ACTIVE_VIDEO_AI_CONFIG_TTL_MS) {
    return activeVideoAiConfigCache
  }
  try {
    const rows = await aiAPI.list('video')
    const list = Array.isArray(rows) ? rows : []
    const active = list.filter((c) => c.is_active !== false)
    activeVideoAiConfigCache = active.find((c) => c.is_default) || active[0] || null
  } catch {
    activeVideoAiConfigCache = null
  }
  activeVideoAiConfigCacheAt = now
  return activeVideoAiConfigCache
}

function videoModelNameFromAiConfig(cfg) {
  if (!cfg) return ''
  const dm = (cfg.default_model || '').toString().trim()
  if (dm) return dm
  const m = cfg.model
  if (Array.isArray(m) && m.length) return String(m[0]).trim()
  return String(m || '').trim()
}

/**
 * Seedance 2.x 家族模型名判定（与后端 videoClient.isSeedance2FamilyModel 对齐）。
 * 含官方 doubao-seedance-2-0-* / jimeng-video-seedance-2.0，以及中转别名 mingiz-sd2、*-sd2 等。
 */
function isSeedance2VideoModel(modelName) {
  const m = String(modelName || '').toLowerCase().trim()
  if (!m) return false
  if (/seedance[-_]?2|seedance2/.test(m)) return true
  if (/2[-_]0[-_]/.test(m)) return true
  // 网关别名：mingiz-sd2、foo_sd2、sd2-bar
  if (/(^|[-_./])sd2($|[-_./])/.test(m)) return true
  return false
}

/** 全能分镜 + 当前视频配置是否可走多图参考（火山 Seedance 2.0、可灵 Omni、Agnes Video 等） */
function canUseUniversalOmniVideoApi(cfg) {
  if (!cfg) return false
  const proto = String(cfg.api_protocol || '').toLowerCase()
  const provider = String(cfg.provider || '').toLowerCase()
  const model = videoModelNameFromAiConfig(cfg).toLowerCase()
  if (proto === 'kling_omni') return true
  // 选了 volcengine_omni 即表示走多图参考；模型名可能是 996 等网关别名（如 mingiz-sd2），勿再按 seedance 字样拦截
  if (proto === 'volcengine_omni') return true
  if (proto === 'agnes' || provider === 'agnes' || /agnes-video/.test(model)) {
    return true
  }
  // 即使接口规范未选 volcengine_omni，只要模型名属于 Seedance 2.x 家族也走多图参考
  // （与后端 videoClient.isSeedance2FamilyModel 对齐，避免误判降级）
  if (isSeedance2VideoModel(model)) return true
  return false
}

async function confirmUniversalNonSeedance2Video() {
  await ElMessageBox.confirm(
    '你当前视频模型不支持多图参考，全能模式将降级：优先用分镜主图，否则仅传场景参考图。是否继续？',
    '全能模式与模型不匹配',
    { confirmButtonText: '继续', cancelButtonText: '取消', type: 'warning' }
  )
}

function onEditSbImagePrompt(sb) {
  if (!sb?.id) return
  editingSbImagePromptId.value = sb.id
  editingSbImagePromptText.value = (sb.image_prompt || '').toString()
}

function promptDialogDraftIdentity(storyboardId = sbPromptTarget.value?.id) {
  return { userId: currentDraftUserId(), workspace: 'film-create-prompt-dialog', dramaId: dramaId.value, episodeId: currentEpisodeId.value, shotId: storyboardId }
}

function persistPromptDialogDraft() {
  if (!showSbPromptDialog.value || !sbPromptTarget.value?.id) return
  writePromptDraft(localStorage, promptDialogDraftIdentity(), {
    image_prompt: sbPromptImageText.value, polished_prompt: sbPromptPolishedText.value, video_prompt: sbPromptVideoText.value,
  })
}

let promptDialogSaveTimer = null
let promptDialogRevision = 0
function schedulePromptDialogSave() {
  if (!showSbPromptDialog.value || !sbPromptTarget.value?.id) return
  persistPromptDialogDraft()
  promptDialogRevision += 1
  const revision = promptDialogRevision
  const storyboardId = sbPromptTarget.value.id
  clearTimeout(promptDialogSaveTimer)
  promptDialogSaveTimer = setTimeout(async () => {
    try {
      await storyboardsAPI.update(storyboardId, {
        image_prompt: sbPromptImageText.value.trim() || null,
        polished_prompt: sbPromptPolishedText.value.trim() || null,
        video_prompt: sbPromptVideoText.value.replace(/\s+/g, ' ').trim() || null,
      })
      if (revision === promptDialogRevision && Number(sbPromptTarget.value?.id) === Number(storyboardId)) {
        clearPromptDraft(localStorage, promptDialogDraftIdentity(storyboardId))
      }
    } catch (_) {}
  }, 650)
}

function restorePromptDialogDraft(sb) {
  const draft = readPromptDraft(localStorage, promptDialogDraftIdentity(sb.id))
  if (!draft || !shouldRestorePromptDraft(draft, sb.updated_at)) return
  const payload = draft.payload || {}
  sbPromptImageText.value = payload.image_prompt == null ? '' : String(payload.image_prompt)
  sbPromptPolishedText.value = payload.polished_prompt == null ? '' : String(payload.polished_prompt)
  sbPromptVideoText.value = payload.video_prompt == null ? '' : String(payload.video_prompt)
  ElMessage.info('已恢复刷新前尚未保存的经典提示词草稿')
}

async function onOpenSbPromptDialog(sb) {
  if (!sb?.id) return
  sbPromptTarget.value = sb
  sbPromptImageText.value = (sb.image_prompt || '').toString()
  sbPromptPolishedText.value = (sb.polished_prompt || '').toString()
  const rawVideo = (sb.video_prompt || '').toString()
  sbPromptVideoText.value = formatVideoPromptForEdit(rawVideo)
  showSbPromptDialog.value = true
  try {
    const fresh = await storyboardsAPI.get(sb.id)
    if (fresh?.id) {
      sbPromptTarget.value = fresh
      sbPromptImageText.value = (fresh.image_prompt || '').toString()
      sbPromptPolishedText.value = (fresh.polished_prompt || '').toString()
      sbPromptVideoText.value = formatVideoPromptForEdit((fresh.video_prompt || '').toString())
      restorePromptDialogDraft(fresh)
    }
  } catch (_) { restorePromptDialogDraft(sb) }
}

function formatVideoPromptForEdit(text) {
  if (!text) return ''
  // 按「主体：」「运动：」等分段做换行，方便阅读
  return text
    .replace(/([。；])\s*(主体|运动|环境|运镜|美学|声音|时长)：/g, '$1\n$2：')
    .replace(/^\s+|\s+$/g, '')
}

async function onPolishSbPrompt() {
  const sb = sbPromptTarget.value
  if (!sb?.id) return
  sbPromptPolishing.value = true
  try {
    const res = await storyboardsAPI.polishPrompt(sb.id)
    if (res?.polished_prompt) {
      sbPromptPolishedText.value = res.polished_prompt
      ElMessage.success('通用优化提示词已生成')
    }
  } catch (e) {
    ElMessage.error(e.message || '生成失败，请检查文本模型配置')
  } finally {
    sbPromptPolishing.value = false
  }
}

async function onSaveSbPromptDialog() {
  const sb = sbPromptTarget.value
  if (!sb?.id) return
  sbPromptSaving.value = true
  try {
    const normalizedVideo = (sbPromptVideoText.value || '').replace(/\s+/g, ' ').trim()
    await storyboardsAPI.update(sb.id, {
      image_prompt: sbPromptImageText.value.trim() || null,
      polished_prompt: sbPromptPolishedText.value.trim() || null,
      video_prompt: normalizedVideo || null,
    })
    await loadDrama()
    clearPromptDraft(localStorage, promptDialogDraftIdentity(sb.id))
    showSbPromptDialog.value = false
    ElMessage.success('提示词已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    sbPromptSaving.value = false
  }
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

function onEditSbVideoPrompt(sb) {
  if (!sb?.id) return
  editingSbVideoPromptId.value = sb.id
  editingSbVideoPromptText.value = (sb.video_prompt || '').toString()
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

async function onSaveSbVideoFields(sb) {
  if (!sb?.id) return
  try {
    await storyboardsAPI.update(sb.id, {
      title: (sbTitle.value[sb.id] || '').toString().trim() || null,
      location: (sbLocation.value[sb.id] || '').toString().trim() || null,
      time: (sbTime.value[sb.id] || '').toString().trim() || null,
      duration: Number(sbDuration.value[sb.id]) || 5,
      text_model: getSbTextModel(sb) || null,
      video_model: sbGenerationSettings.value[sb.id]?.video_model || null,
      video_resolution: sbGenerationSettings.value[sb.id]?.resolution || null,
      video_aspect_ratio: sbGenerationSettings.value[sb.id]?.aspect_ratio || null,
      video_upscale_resolution: sbGenerationSettings.value[sb.id]?.upscale_resolution || null,
      video_target_fps: sbGenerationSettings.value[sb.id]?.target_fps || null,
      action: (sbAction.value[sb.id] || '').toString().trim() || null,
      dialogue: (sbDialogue.value[sb.id] || '').toString().trim() || null,
      narration: (sbNarration.value[sb.id] || '').toString().trim() || null,
      atmosphere: (sbAtmosphere.value[sb.id] || '').toString().trim() || null,
      result: (sbResult.value[sb.id] || '').toString().trim() || null,
      angle: (sbAngle.value[sb.id] || '').toString().trim() || null,
      angle_h: sbAngleH.value[sb.id] || null,
      angle_v: sbAngleV.value[sb.id] || null,
      angle_s: sbAngleS.value[sb.id] || null,
      movement: (sbMovement.value[sb.id] || '').toString().trim() || null,
      lighting_style: sbLighting.value[sb.id] || null,
      depth_of_field: sbDof.value[sb.id] || null,
      shot_type: (sbShotType.value[sb.id] || '').toString().trim() || null,
      layout_description: (sbLayoutDescription.value[sb.id] || '').toString().trim() || null,
      creation_mode: sbCreationMode.value[sb.id] === 'universal' ? 'universal' : 'classic',
      universal_segment_text: (sbUniversalSegmentText.value[sb.id] || '').toString().trim() || null,
    })
    const rebuilt = await storyboardsAPI.rebuildVideoPrompt(sb.id)
    const newVp = (rebuilt?.video_prompt && String(rebuilt.video_prompt).trim()) || ''
    if (newVp) {
      videoParamsTarget.value = { ...sb, video_prompt: newVp }
    }
    await loadDrama()
    ElMessage.success('已保存，视频提示词已按最新规则自动生成')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  }
}

async function onSaveSbVideoPrompt(sb) {
  if (!sb?.id) return
  try {
    await storyboardsAPI.update(sb.id, { video_prompt: (editingSbVideoPromptText.value || '').toString().trim() || null })
    await loadDrama()
    editingSbVideoPromptId.value = null
    ElMessage.success('视频提示词已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  }
}

function onOpenVideoParamsDialog(sb) {
  videoParamsTarget.value = sb
  showVideoParamsDialog.value = true
}

/** 取消关闭弹窗时，将创作模式与片段描述与服务器状态对齐（避免仅改单选未保存导致本地漂移） */
function onVideoParamsDialogClosed() {
  const sb = videoParamsTarget.value
  if (!sb?.id) return
  const row = (storyboards.value || []).find((x) => Number(x.id) === Number(sb.id))
  if (!row) return
  sbCreationMode.value = { ...sbCreationMode.value, [sb.id]: row.creation_mode === 'universal' ? 'universal' : 'classic' }
  sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: (row.universal_segment_text ?? '').toString() }
}

function countDialogueLinesInSb(sb) {
  const raw = ((sbDialogue.value[sb.id] ?? sb.dialogue) || '').toString().trim()
  if (!raw) return 0
  const matches = raw.match(/[\u4e00-\u9fa5A-Za-z0-9·]{1,16}[：:]/g)
  return matches?.length || (raw ? 1 : 0)
}

function canSplitSbByAudio(sb) {
  if (!sb?.id) return false
  const dialogueCount = countDialogueLinesInSb(sb)
  const hasNarration = !!((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
  return dialogueCount + (hasNarration ? 1 : 0) >= 2
}

async function onSplitSbByAudio(sb) {
  if (!sb?.id) return
  try {
    await ElMessageBox.confirm(
      '将把本镜按「每句对白一条 + 旁白单独一条」拆成多个分镜，原镜变为第一条。已生成的视频不会保留。是否继续？',
      '按对白拆镜',
      { type: 'warning', confirmButtonText: '拆镜', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  splitByAudioLoading.value = true
  try {
    if (showVideoParamsDialog.value && videoParamsTarget.value?.id === sb.id) {
      await onSaveSbVideoFields(sb)
    }
    const res = await storyboardsAPI.splitByAudio(sb.id)
    const n = res?.storyboard_ids?.length ?? 0
    const summary = res?.plans_summary || ''
    showVideoParamsDialog.value = false
    await loadDrama()
    ElMessage.success(summary ? `已拆成 ${n} 条：${summary}` : `已拆成 ${n} 条分镜`)
  } catch (e) {
    ElMessage.error(e.message || '拆镜失败')
  } finally {
    splitByAudioLoading.value = false
  }
}

async function onSaveVideoParams() {
  const sb = videoParamsTarget.value
  if (!sb?.id) return
  videoParamsSaving.value = true
  try {
    await onSaveSbVideoFields(sb)
    showVideoParamsDialog.value = false
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    videoParamsSaving.value = false
  }
}

async function onBatchInferParams() {
  if (!currentEpisodeId.value) return
  inferringParams.value = true
  try {
    const res = await storyboardsAPI.batchInferParams(currentEpisodeId.value, false)
    await loadDrama()
    ElMessage.success(`摄影参数推断完成，更新了 ${res?.updated ?? 0} 条分镜`)
  } catch (e) {
    ElMessage.error(e.message || '推断失败')
  } finally {
    inferringParams.value = false
  }
}

/** 一键用 AI 重新生成/优化本分镜的布局描述（自动参考上下分镜保证前后连贯） */
async function onRegenerateLayoutDescription(sb) {
  if (sb && typeof sb === 'object' && sb.__v_isRef) sb = sb.value
  if (!sb?.id) return
  regeneratingLayoutSbIds.add(sb.id)
  try {
    const res = await storyboardsAPI.regenerateLayoutDescription(sb.id, { model: getSbTextModel(sb) })
    const newText = res?.layout_description || res?.data?.layout_description
    if (newText) {
      // 直接用本次 AI 返回的结果更新本地编辑状态（响应里已包含新文本）
      sbLayoutDescription.value = { ...sbLayoutDescription.value, [sb.id]: newText }

      // 轻量刷新分镜列表（只更新 store 里的原始 storyboards，不触发 syncStoryboardStateFromEpisode，
      // 避免覆盖我们刚刚写入的 sbLayoutDescription 等本地字段）
      try { await refreshStoryboardsOnly() } catch (_) {}

      ElMessage.success('布局描述已由 AI 重新优化并保存（已参考上下分镜连贯性）')
      // 注意：不再调用 loadDrama()，因为它会全量重建所有 sbXxx 映射，可能用服务端旧数据覆盖本次结果。
      // 等后端 rowToStoryboard 补全 layout_description 字段后，关闭再打开对话框即可看到持久化值。
    } else {
      ElMessage.warning('AI 未返回有效的布局描述')
    }
  } catch (e) {
    ElMessage.error(e.message || '重新生成布局描述失败')
  } finally {
    regeneratingLayoutSbIds.delete(sb.id)
  }
}

async function onGenerateSbVideo(sb) {
  if (!dramaId.value || !sb?.id || !sbCanSubmitVideo(sb)) return
  const universal = isSbUniversalMode(sb.id)
  let universalOmniApi = universal
  if (universal) {
    const videoCfg = await getActiveVideoAiConfig()
    if (!canUseUniversalOmniVideoApi(videoCfg)) {
      try {
        await confirmUniversalNonSeedance2Video()
      } catch {
        return
      }
      universalOmniApi = false
    }
  }
  const omniRefs = universalOmniApi ? collectSbOmniReferenceAbsoluteUrls(sb) : []
  const selectedOmniAssets = universalOmniApi ? getSelectedUniversalLibraryAssets(sb) : []
  const omniAssetsPayload = universalOmniApi ? buildSbOmniAssetsPayload(sb) : []
  const omniCreationMode = sbOmniCreationMode.value[sb.id] || 'multi_reference'
  if (universalOmniApi && omniCreationMode === 'first_last_frame' && omniAssetsPayload.length !== 2) {
    ElMessage.warning('首尾帧模式必须选择不同的首帧和尾帧素材')
    return
  }
  const sceneOnlyRefs = universal && !universalOmniApi ? collectSbSceneOnlyReferenceAbsoluteUrls(sb) : []
  const hasClassicFrame = !!getSbFirstFrameUrl(sb)
  let hasAnyImage = false
  if (universalOmniApi) {
    hasAnyImage = omniRefs.length > 0 || selectedOmniAssets.length > 0
  } else if (universal) {
    hasAnyImage = hasClassicFrame || sceneOnlyRefs.length > 0
  } else {
    hasAnyImage = hasClassicFrame
  }
  if (!hasAnyImage) {
    if (!universal) {
      await ElMessageBox.alert(
        '当前为传统模式，生视频需要分镜参考图。请先生成或上传分镜图片后再试。',
        '传统模式缺少分镜图',
        { confirmButtonText: '知道了', type: 'warning' }
      )
      return
    }
    try {
      await ElMessageBox.confirm(
        universalOmniApi
          ? '当前没有已选的素材库素材（图片/视频/音频），将按纯文案提交 Omni-Video（模型以 AI 配置为准），效果可能不稳定。确认继续？'
          : '当前没有分镜主图且无场景参考图，将仅按文字提示词生成视频，效果可能不稳定。确认继续？',
        universalOmniApi ? '全能模式无参考图' : '全能降级无参考图',
        { confirmButtonText: '继续生成', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
  }
  generatingSbVideoIds.add(sb.id)
  const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_VIDEO, '分镜视频')
  genStore.markRunning(meta)
  sbVideoErrors.value[sb.id] = ''
  // 清除前端选中状态 + 清除后端手动指定的 video_url，让合成时自动取最新生成的视频
  if (sbSelectedVideoId.value[sb.id] != null) {
    const next = { ...sbSelectedVideoId.value }
    delete next[sb.id]
    sbSelectedVideoId.value = next
  }
  storyboardsAPI.update(sb.id, { video_url: null }).catch(() => {})
  try {
    let absoluteUrl = ''
    let referenceUrls = undefined
    if (universalOmniApi) {
      referenceUrls = omniRefs.length ? omniRefs : undefined
      absoluteUrl = omniRefs[0] || ''
    } else if (universal) {
      const firstFrameUrl = await getMainImageUrlForVideo(sb)
      absoluteUrl = toAbsoluteImageUrl(firstFrameUrl)
      if (absoluteUrl) {
        referenceUrls = sceneOnlyRefs.length ? sceneOnlyRefs : [absoluteUrl]
      } else {
        referenceUrls = sceneOnlyRefs.length ? sceneOnlyRefs : undefined
        absoluteUrl = sceneOnlyRefs[0] || ''
      }
    } else {
      const firstFrameUrl = await getMainImageUrlForVideo(sb)
      absoluteUrl = toAbsoluteImageUrl(firstFrameUrl)
      referenceUrls = absoluteUrl ? [absoluteUrl] : undefined
    }
    const { first: vFirst, last: vLast } = sbVideoFirstLastUrls(sb, universalOmniApi, null)
    if (!universalOmniApi && vLast && referenceUrls && !referenceUrls.includes(vLast)) {
      referenceUrls = [...referenceUrls, vLast]
    }
    const preferClassicPrompt = universal && !universalOmniApi
    const requestSettings = getSbVideoRequestSettings(sb)
    const res = universalOmniApi && omniAssetsPayload.length
      ? await omniVideoAPI.create({
          drama_id: dramaId.value,
          storyboard_id: sb.id,
          prompt: buildSbVideoPromptForApi(sb, { preferClassicPrompt: false }),
          prompt_document: {
            text: buildSbVideoPromptForApi(sb, { preferClassicPrompt: false }),
            refs: omniAssetsPayload.map((asset) => ({ asset_id: asset.asset_id == null ? null : Number(asset.asset_id), alias: asset.alias, usage: asset.usage, ordinal: asset.ordinal })),
          },
          creation_mode: omniCreationMode,
          model: requestSettings.model || 'auto',
          aspect_ratio: requestSettings.aspect_ratio,
          duration: requestSettings.duration,
          resolution: requestSettings.resolution,
          upscale_resolution: requestSettings.upscale_resolution,
          target_fps: requestSettings.target_fps,
          audio_strategy: sbAudioStrategy.value[sb.id] || 'reference_only',
          keep_original_audio: !!sbKeepOriginalAudio.value[sb.id],
          audio_volume: Number(sbAudioVolume.value[sb.id] ?? 1),
          audio_fade_seconds: Number(sbAudioFadeSeconds.value[sb.id] ?? 0),
          assets: omniAssetsPayload,
        })
      : await videosAPI.create({
          drama_id: dramaId.value,
          storyboard_id: sb.id,
          prompt: buildSbVideoPromptForApi(sb, { preferClassicPrompt }),
          image_url: universalOmniApi ? undefined : ((vFirst || absoluteUrl) || undefined),
          first_frame_url: universalOmniApi ? undefined : (vFirst || absoluteUrl || undefined),
          last_frame_url: universalOmniApi ? undefined : vLast,
          reference_image_urls: referenceUrls,
          style: getSelectedStyle(),
          ...requestSettings,
        })
    if (res?.task_id) {
      const pollRes = await pollTask(res.task_id, () => loadSingleStoryboardMedia(sb.id), meta)
      if (pollRes?.status === 'failed') {
        sbVideoErrors.value[sb.id] = pollRes.error || '视频生成失败'
      } else if (pollRes?.status === 'completed') {
        sbVideoErrors.value[sb.id] = ''
        ElMessage.success('视频生成完成')
      }
    } else {
      await loadSingleStoryboardMedia(sb.id)
      ElMessage.success('视频生成已提交，请稍后查看')
    }
  } catch (e) {
    sbVideoErrors.value[sb.id] = e.message || '提交失败'
    ElMessage.error(e.message || '提交失败')
  } finally {
    generatingSbVideoIds.delete(sb.id)
    genStore.markDone(meta)
    await loadSingleStoryboardMedia(sb.id)
  }
}

/** 尾帧衔接：提取当前视频最后一帧，设为下一个分镜的首帧 */
async function onLinkTailFrameToNext(sb) {
  if (!dramaId.value || !sb?.id) return
  const nextSb = getNextStoryboard(sb.id)
  if (!nextSb) {
    ElMessage.warning('已是最后一个分镜，没有下一个分镜可衔接')
    return
  }
  const video = getSbVideo(sb.id)
  if (!video) {
    ElMessage.warning('当前分镜没有视频')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定将 #${sb.storyboard_number ?? sb.id} 视频的尾帧设为 #${nextSb.storyboard_number ?? nextSb.id} 的首帧？\n原首帧将自动进入历史。`,
      '尾帧衔接',
      { confirmButtonText: '确认执行', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  linkingTailFrameIds.add(sb.id)
  try {
    const data = await storyboardsAPI.linkTailFrame(sb.id, { drama_id: dramaId.value })
    if (data?.error) {
      throw new Error(data.error)
    }
    ElMessage.success(`已将尾帧设为 #${nextSb.storyboard_number ?? nextSb.id} 的首帧`)
    // 刷新两个分镜的媒体
    await Promise.all([
      loadSingleStoryboardMedia(sb.id),
      loadSingleStoryboardMedia(nextSb.id)
    ])
  } catch (e) {
    ElMessage.error(e.message || '尾帧衔接失败')
  } finally {
    linkingTailFrameIds.delete(sb.id)
  }
}

/** 上镜尾帧：直接把上一分镜的尾帧图片（高清原图）设为当前分镜的首帧，无需 ffmpeg 提取视频帧，画面更清晰 */
async function onUsePrevTailAsFirst(sb) {
  if (!dramaId.value || !sb?.id) return
  const prevSb = getPrevStoryboard(sb.id)
  if (!prevSb) {
    ElMessage.warning('已是第一个分镜，没有上一分镜可取尾帧')
    return
  }
  const prevLastImg = getSbLastImage(prevSb.id)
  if (!prevLastImg) {
    ElMessage.warning(`上一分镜 #${prevSb.storyboard_number ?? prevSb.id} 尚无尾帧图片`)
    return
  }

  // 直接执行，不再弹确认框（用户已通过按钮 + tooltip 明确意图）
  usingPrevTailAsFirstIds.add(sb.id)
  try {
    // 通过 upload 接口在“当前分镜”下创建一个 image 记录（复用上一镜尾帧的物理文件路径/URL），frame_type 触发后端自动 bind
    const uploaded = await imagesAPI.upload({
      storyboard_id: sb.id,
      drama_id: dramaId.value,
      image_url: prevLastImg.image_url || '',
      local_path: prevLastImg.local_path || undefined,
      prompt: `上镜尾帧（直接复用 #${prevSb.storyboard_number ?? prevSb.id} 尾帧高清原图）`,
      frame_type: 'storyboard_first'
    })
    if (uploaded?.id) {
      // 手动设置本地选中，确保显示立即切换；同时调用 onSelect 做一次 server patch（与 upload 里的 bind 互补）
      onSelectSbFrameImage(sb, uploaded, 'first')
    }
    ElMessage.success(`已将 #${prevSb.storyboard_number ?? prevSb.id} 尾帧设为本分镜首帧（高清原图）`)

    // 刷新分镜元数据（拿回服务器最新的 first_frame_image_id）+ 媒体列表
    await Promise.all([
      refreshStoryboardsOnly(),
      loadSingleStoryboardMedia(sb.id)
    ])
    // 清除可能残留的手动选中（让服务器权威绑定 id 生效）
    delete sbSelectedImgId.value[sb.id]
  } catch (e) {
    ElMessage.error(e.message || '上镜尾帧设置失败')
  } finally {
    usingPrevTailAsFirstIds.delete(sb.id)
  }
}

/** 生成期间轻量刷新分镜列表（只更新指定集 storyboards，不重载整个 drama） */
/** 分镜拖拽排序状态 */
const navDragSbId = ref(null)
const navDragOverSbId = ref(null)
const sbReorderSaving = ref(false)

function onSbNavDragStart(sb) {
  navDragSbId.value = sb?.id ?? null
}
function onSbNavDragEnd() {
  navDragSbId.value = null
  navDragOverSbId.value = null
}
function onSbNavDragOver(sb) {
  navDragOverSbId.value = sb?.id ?? null
}

/** 提交新顺序到后端（重写 sort_order），随后刷新分镜列表 */
async function persistSbOrder(ids) {
  const epId = currentEpisodeId.value
  if (!epId || !Array.isArray(ids) || ids.length < 2) return
  sbReorderSaving.value = true
  try {
    await storyboardsAPI.reorder({ episode_id: epId, ids })
    await refreshStoryboardsForEpisode(epId)
  } catch (err) {
    ElMessage.error(err?.message || '分镜排序保存失败')
  } finally {
    sbReorderSaving.value = false
  }
}

async function moveSbOrder(sb, dir) {
  const list = storyboards.value || []
  const from = list.findIndex((s) => Number(s.id) === Number(sb.id))
  const to = from + dir
  if (from < 0 || to < 0 || to >= list.length) return
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  await persistSbOrder(next.map((s) => s.id))
}

async function onSbNavDrop(target) {
  const fromId = navDragSbId.value
  const toId = target?.id ?? null
  navDragSbId.value = null
  navDragOverSbId.value = null
  if (!fromId || !toId || fromId === toId) return
  const list = storyboards.value || []
  const from = list.findIndex((s) => Number(s.id) === Number(fromId))
  const to = list.findIndex((s) => Number(s.id) === Number(toId))
  if (from < 0 || to < 0 || from === to) return
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  await persistSbOrder(next.map((s) => s.id))
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
  trackFilmCreateAction('generate_storyboard_click')
  const epId = currentEpisodeId.value
  if (!epId) return
  const meta = buildExtractTaskMeta(store, dramaId.value, epId, GEN_RESOURCE.GENERATE_STORYBOARD, 'AI生成分镜')
  genStore.markRunning(meta)
  // 生成期间每 2 秒刷新该集分镜列表，让已解析的分镜逐步出现（切集后仍更新原集缓存）
  const refreshTimer = setInterval(() => refreshStoryboardsForEpisode(epId), 2000)
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
    trackFilmCreateAction('generate_storyboard_complete', {
      extra: { storyboard_count: (store.storyboards || []).length },
    })
  } catch (e) {
    // HTTP 错误由 request 拦截器统一展示，此处仅处理拦截器未覆盖的异常
    if (!e.response) ElMessage.error(e.message || '生成失败')
  } finally {
    clearInterval(refreshTimer)
    genStore.markDone(meta)
  }
}

async function onAddSingleStoryboard(){
  if (!currentEpisodeId.value) {
    ElMessage.warning('请先选择集')
    return
  }
  try {
    // 获取当前最大序号（仅计算当前集的分镜）
    const maxNum = (store.storyboards || [])
      .filter(sb => sb.episode_id === currentEpisodeId.value)
      .reduce((max, sb) => Math.max(max, sb.storyboard_number || 0), 0)
    await storyboardsAPI.create({
      episode_id: currentEpisodeId.value,
      storyboard_number: maxNum + 1,
      title: `镜头 ${maxNum + 1}`,
      description: '',
    })
    ElMessage.success('添加成功')
    await loadDrama() // 刷新列表
  } catch (e) {
    ElMessage.error(e.message || '添加失败')
  }
}

async function onDeleteSingleStoryboard(id){
  try {
    await ElMessageBox.confirm('确定要删除这个分镜吗？', '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await storyboardsAPI.delete(id)
    ElMessage.success('删除成功')
    await loadDrama() // 刷新列表
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e.message || '删除失败')
    }
  }
}

async function onInsertStoryboardBefore(sb) {
  try {
    await storyboardsAPI.insertBefore(sb.id)
    ElMessage.success('已在此位置前新增空白分镜')
    await loadDrama()
  } catch (e) {
    ElMessage.error(e.message || '新增失败')
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
    const todo = boards.filter((sb) => !hasSbImage(sb))
    if (todo.length === 0) {
      ElMessage.info('所有分镜均已有图片，无需重新生成')
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
    // 只处理：有参考图（经典=分镜主图；全能=场景/角色/道具，不含经典主图）且 还没有已完成视频 的分镜
    const todo = boards.filter((sb) => {
      const vidList = sbVideos.value[sb.id] || []
      if (vidList.some((v) => v.status === 'completed' && recordHasPlayableVideoUrl(v))) return false
      if (isSbUniversalMode(sb.id)) {
        if (!sbCanSubmitVideo(sb)) return false
        return collectSbOmniReferenceAbsoluteUrls(sb).length > 0
      }
      return !!getSbFirstFrameUrl(sb)
    })
    if (todo.length === 0) {
      ElMessage.info('没有需要生成视频的分镜（分镜缺少图片，或视频已全部生成）')
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
          storyboardsAPI.update(sb.id, { video_url: null }).catch(() => {})
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
  trackFilmCreateAction('one_click_generate_start')
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
    trackFilmCreateAction('one_click_generate_complete', {
      extra: { error_count: pipelineErrorLog.value.length },
    })
  } catch (e) {
    addPipelineError('流程', e.message || String(e))
    trackFilmCreateAction('one_click_generate_failed', {
      extra: { message: String(e?.message || 'failed').slice(0, 120) },
    })
  }
}

async function startRepairPipeline() {
  if (!currentEpisodeId.value || pipelineRunning.value) return
  pipelineErrorLog.value = []
  pipelineCurrentStep.value = ''
  pipelineActiveTasks.clear()
  pipelineRunning.value = true
  pipelinePaused.value = false
  try {
    await runRepairPipeline()
  } finally {
    pipelineRunning.value = false
    pipelineActiveTasks.clear()
  }
}

/** 修复缺失：哪一步没有就生成哪一步，有图/有内容就跳过 */
async function runRepairPipeline() {
  const episodeId = currentEpisodeId.value
  const dramaIdVal = dramaId.value
  if (!episodeId || !dramaIdVal) return
  const style = getSelectedStyle()

  try {
    pipelineCurrentStep.value = '正在加载数据...'
    await loadDrama()

    // 1. 角色：没有则生成角色；再为每个无图角色生成图
    let chars = store.currentEpisode?.characters ?? []
    if (chars.length === 0) {
      await checkPause()
      pipelineCurrentStep.value = '正在生成角色列表...'
      try {
        const outline = (store.scriptContent || '').toString().trim() || (storyInput.value || '').toString().trim() || undefined
        const res = await generationAPI.generateCharacters(dramaIdVal, { episode_id: store.currentEpisode?.id ?? undefined, outline: outline || undefined })
        const taskId = res?.task_id
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('生成角色', result.error); return }
        } else await loadDrama()
        await pipelineRest()
      } catch (e) {
        addPipelineError('生成角色', e.message || String(e))
        return
      }
      chars = store.currentEpisode?.characters ?? []
    }
    const charsWithoutImage = chars.filter((c) => !hasAssetImage(c))
    {
      const concurrency = pipelineConcurrency.value
      pipelineCurrentStep.value = `正在生成角色图（并发${concurrency}）...`
      const { paused } = await runConcurrently(charsWithoutImage, concurrency, async (char) => {
        await checkPause()
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
      }, { getLabel: (char) => '角色图 ' + (char.name || char.id) })
      if (paused) { await waitForResume() }
    }

    // 2. 场景：没有则提取；再为每个无图场景生成图
    let sceneList = store.currentEpisode?.scenes ?? []
    if (sceneList.length === 0) {
      await checkPause()
      pipelineCurrentStep.value = '正在提取场景...'
      try {
        const res = await dramaAPI.extractBackgrounds(episodeId, { model: undefined, style, language: scriptLanguage.value })
        const taskId = res?.task_id
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('提取场景', result.error); return }
        } else await loadDrama()
        await pipelineRest()
      } catch (e) {
        addPipelineError('提取场景', e.message || String(e))
        return
      }
      sceneList = store.currentEpisode?.scenes ?? []
    }
    const scenesWithoutImage = sceneList.filter((s) => !hasAssetImage(s))
    {
      const concurrency = pipelineConcurrency.value
      pipelineCurrentStep.value = `正在生成场景图（并发${concurrency}）...`
      const { paused } = await runConcurrently(scenesWithoutImage, concurrency, async (scene) => {
        await checkPause()
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
      }, { getLabel: (scene) => '场景图 ' + (scene.location || scene.id) })
      if (paused) { await waitForResume() }
    }

    // 2.5 道具：没有则提取；再为每个无图道具生成图
    let propList2 = store.props ?? []
    if (propList2.length === 0) {
      await checkPause()
      pipelineCurrentStep.value = '正在提取道具...'
      try {
        const res = await propAPI.extractFromScript(episodeId)
        const taskId = res?.task_id
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('提取道具', result.error); /* 不中断 */ }
        } else await loadDrama()
        await pipelineRest()
      } catch (e) {
        addPipelineError('提取道具', e.message || String(e))
      }
      propList2 = store.props ?? []
    }
    const propsWithoutImage2 = propList2.filter((p) => !hasAssetImage(p))
    {
      const concurrency = pipelineConcurrency.value
      pipelineCurrentStep.value = `正在生成道具图（并发${concurrency}）...`
      await checkPause()
      const { paused } = await runConcurrently(propsWithoutImage2, concurrency, async (prop) => {
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

    // 3. 分镜：没有则生成分镜；再逐个检查分镜图，没有则生成；再逐个检查分镜视频，没有则生成
    let boards = store.storyboards || []
    const hadBoardsBeforeRepairSb = boards.length > 0
    if (boards.length === 0) {
      await checkPause()
      pipelineCurrentStep.value = '正在生成分镜...'
      try {
        const res = await dramaAPI.generateStoryboard(episodeId, {
          aspect_ratio: projectAspectRatio.value || '16:9',
          storyboard_count: getStoryboardCountForApi(),
          video_duration: getVideoDurationForApi(),
          include_narration: !!storyboardIncludeNarration.value,
          universal_omni_storyboard: !!storyboardUniversalOmni.value,
        })
        const taskId = res?.task_id ?? (typeof res === 'string' ? res : null)
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('分镜生成', result.error); return }
        }
        await loadDrama()
        await pipelineRest()
      } catch (e) {
        addPipelineError('分镜生成', e.message || String(e))
        return
      }
      boards = store.storyboards || []
    }
    if (!hadBoardsBeforeRepairSb && storyboardUniversalOmni.value) {
      await checkPause()
      await polishUniversalSegmentsAfterGeneration({
        checkPause,
        onShotProgress: (cur, total, sb) => {
          pipelineCurrentStep.value = `润色全能分镜(${cur}/${total}) #${sb.storyboard_number ?? cur} ${(sb.title || '').slice(0, 16)}`
        },
        onShotError: (sb, msg) =>
          addPipelineError('润色全能分镜', `镜#${sb.storyboard_number ?? sb.id}: ${msg}`),
      })
      await loadDrama()
    }
    // 先拉取分镜图片/视频列表，再批量生成分镜图（并发）
    await loadStoryboardMedia()
    const boardsWithoutImg = boards.filter((sb) => !hasSbImage(sb))
    {
      const concurrency = pipelineConcurrency.value
      pipelineCurrentStep.value = `正在生成分镜图（并发${concurrency}）...`
      const { paused } = await runConcurrently(boardsWithoutImg, concurrency, async (sb) => {
        await checkPause()
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
      }, { getLabel: (sb) => '分镜图 #' + (sb.storyboard_number ?? sb.id) })
      if (paused) { await waitForResume() }
    }
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
    {
      const concurrency = pipelineVideoConcurrency.value
      pipelineCurrentStep.value = `正在生成分镜视频（并发${concurrency}）...`
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

    // 4. 生成整集视频（合成整个视频）
    await checkPause()
    pipelineCurrentStep.value = '正在生成整集视频...'
    try {
      const result = await dramaAPI.finalizeEpisode(episodeId, getFinalizeMergeOptions())
      if (result?.task_id != null) {
        const pollResult = await pollTaskWithPause(result.task_id, () => loadDrama())
        if (pollResult?.paused) { await waitForResume(); return }
        if (pollResult?.error) addPipelineError('生成整集视频', pollResult.error)
        else await pipelineRest()
      } else {
        addPipelineError('生成整集视频', result?.message || '本集没有可合成的视频片段')
      }
    } catch (e) {
      addPipelineError('生成整集视频', e.message || String(e))
    }

    pipelineCurrentStep.value = '补全并生成流程已执行完成'
    ElMessage.success('修复缺失流程已执行完成')
  } catch (e) {
    addPipelineError('流程', e.message || String(e))
  }
}


function flushUniversalPromptDrafts() {
  persistPromptDialogDraft()
  for (const [storyboardId, timer] of universalPromptSaveTimers.entries()) {
    clearTimeout(timer)
    const sb = (storyboards.value || []).find((item) => Number(item.id) === Number(storyboardId))
    if (sb) onSaveUniversalSegmentField(sb)
  }
}

watch([sbPromptImageText, sbPromptPolishedText, sbPromptVideoText], schedulePromptDialogSave)

function onFilmVisibilityChange() {
  if (document.visibilityState === 'hidden') flushUniversalPromptDrafts()
}

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', flushUniversalPromptDrafts)
  document.removeEventListener('visibilitychange', onFilmVisibilityChange)
  flushUniversalPromptDrafts()
})

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
  window.addEventListener('pagehide', flushUniversalPromptDrafts)
  document.addEventListener('visibilitychange', onFilmVisibilityChange)
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
  margin-left: 180px;
  transition: margin-left 0.25s cubic-bezier(.4,0,.2,1);
}
.sidebar-collapsed .header {
  margin-left: 48px;
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
/* ===== 左侧固定侧边栏 ===== */
.quick-nav {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 210;
  display: flex;
  flex-direction: column;
  padding: 14px 0 10px;
  background: linear-gradient(180deg, #131318 0%, #111116 50%, #0f0f14 100%);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 1px 0 0 rgba(255,255,255,0.02), 4px 0 24px rgba(0, 0, 0, 0.4);
  width: 180px;
  overflow-y: auto;
  overflow-x: hidden;
  transition: width 0.25s cubic-bezier(.4,0,.2,1), padding 0.25s cubic-bezier(.4,0,.2,1);
}
html.light .quick-nav {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 247, 255, 0.99) 100%);
  border-right-color: rgba(139, 92, 246, 0.1);
  box-shadow: 1px 0 0 rgba(139,92,246,0.06), 4px 0 20px rgba(139, 92, 246, 0.04);
}
.quick-nav::-webkit-scrollbar { width: 4px; }
.quick-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
.quick-nav::-webkit-scrollbar-track { background: transparent; }
.quick-nav.collapsed {
  width: 48px;
  padding: 12px 0;
}
.quick-nav.collapsed .nav-steps,
.quick-nav.collapsed .nav-group {
  display: none;
}
@media (max-width: 768px) {
  .quick-nav { width: 48px; padding: 12px 0; }
  .quick-nav .nav-steps, .quick-nav .nav-group { display: none; }
  .quick-nav .nav-sidebar-title { display: none; }
  .quick-nav .nav-sidebar-header { justify-content: center; padding: 0 4px 8px; }
  .header, .main { margin-left: 48px !important; }
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
.quick-nav.collapsed .nav-sidebar-header {
  justify-content: center;
  padding: 0 4px 8px;
}
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
.nav-sub-item.sb-nav-dragging { opacity: 0.4; }
.nav-sub-item.sb-nav-over { background: rgba(99,102,241,0.14); box-shadow: inset 2px 0 0 #6366f1; }
html.light .nav-sub-item.sb-nav-over { background: rgba(99,102,241,0.10); }

.main {
  margin-left: 180px;
  margin-right: 0;
  padding: 24px 32px 48px;
  transition: margin-left 0.25s cubic-bezier(.4,0,.2,1);
}
.storyboard-stage-active{height:100dvh;overflow:hidden}
.storyboard-stage-active .main{height:calc(100dvh - 58px);box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;padding:10px 32px}
.storyboard-stage-active .workflow-shell{flex:none;margin:0 0 8px;padding:8px 14px}
.storyboard-stage-active .workflow-head{display:none}
.storyboard-stage-active .workflow-steps{margin-top:0}
.storyboard-stage-active .omni-page.embedded.project-storyboard-page{position:static!important;top:auto;height:auto!important;min-height:0!important;overflow:hidden!important;flex:1;z-index:auto}
.storyboard-stage-active .omni-page.embedded.project-storyboard-page .workbench{height:100%!important;min-height:0!important}
.storyboard-stage-active .workflow-next-action{flex:none;margin:8px 0 0;padding:8px 12px}
@media(max-width:960px){.storyboard-stage-active{height:auto;overflow:visible}.storyboard-stage-active .main{height:auto;overflow:visible;display:block;padding:16px 12px}.storyboard-stage-active .workflow-head{display:flex}.storyboard-stage-active .omni-page.embedded.project-storyboard-page{overflow:visible!important}}
.sidebar-collapsed .main {
  margin-left: 48px;
}
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
.sb-batch-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}
.sb-batch-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
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
.sb-image-error {
  width: 100%;
  flex: 1;
  background: #450a0a;
  color: #f87171;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  text-align: center;
  font-size: 0.85rem;
  overflow: hidden;
  margin-bottom: 8px;
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
.sb-img-thumb:hover .extra-thumb-remove,
.sb-img-thumb:hover .thumb-preview-btn { opacity: 1; }
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

.storyboard-row {
  display: flex;
  align-items: flex-start;
  gap: 0;
  margin-bottom: 16px;
  background: #1e1f28;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
  position: relative;
  transition: border-color 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease;
  animation: sb-fade-in 0.35s ease both;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}
.storyboard-row:hover {
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.25);
  transform: translateY(-1px);
}
html.light .storyboard-row {
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(139, 92, 246, 0.06);
  box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset, 0 2px 12px rgba(99, 102, 241, 0.04);
}
html.light .storyboard-row:hover {
  border-color: rgba(139, 92, 246, 0.18);
  box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset, 0 6px 24px rgba(99, 102, 241, 0.08);
  transform: translateY(-1px);
}
.storyboard-row:last-child { margin-bottom: 0; }
/* ── 分镜控制栏（卡片外，缩进） ── */
.sb-ctrl-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 32px;
  margin-bottom: 4px;
  height: 26px;
  cursor: pointer;
  border-radius: 4px;
}
.sb-ctrl-bar:hover { background: rgba(99, 102, 241, 0.05); }
.sb-ctrl-bar--active { box-shadow: inset 2px 0 0 #6366f1; background: rgba(99, 102, 241, 0.08); }
html.light .sb-ctrl-bar--active { background: rgba(99, 102, 241, 0.08); }
.sb-ctrl-num {
  background: var(--el-color-primary);
  color: #fff;
  border-radius: 5px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.sb-ctrl-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: #e4e4e7;
  max-width: 12em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
html.light .sb-ctrl-title {
  color: #000;
}
.sb-movement-tag.el-tag {
  height: 18px;
  line-height: 18px;
  padding: 0 6px;
  font-size: 11px;
  margin-left: 6px;
  flex-shrink: 0;
}
.sb-ctrl-btn.el-button {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
}
.sb-ctrl-config-btn.el-button {
  border-color: rgba(139,92,246,0.45);
  color: #a78bfa;
  background: rgba(139,92,246,0.08);
}
.sb-ctrl-config-btn.el-button:hover {
  border-color: #4b91c8;
  color: #fff;
  background: rgba(139,92,246,0.6);
}
html.light .sb-ctrl-config-btn.el-button {
  border-color: rgba(124,58,237,0.35);
  color: #3479ae;
  background: rgba(124,58,237,0.06);
}
html.light .sb-ctrl-config-btn.el-button:hover {
  border-color: #3479ae;
  color: #fff;
  background: #3479ae;
}
.sb-ctrl-delete {
  margin-left: auto;
  height: 22px;
  min-width: 52px;
  padding: 0 7px;
  color: #f09b9b !important;
  border-color: rgba(214,107,107,.5) !important;
  background: rgba(214,107,107,.08) !important;
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
.sb-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  color: #e4e4e7;
  margin-bottom: 10px;
}
.sb-panel-title .el-icon { font-size: 1rem; color: #a1a1aa; }
.sb-panel-title-name {
  margin-left: 4px;
  color: #a1a1aa;
  font-weight: 500;
  max-width: 12em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sb-script { padding-top: 10px; }
.sb-script-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.sb-select { flex: 1; min-width: 0; }
.sb-select-empty { font-size: 0.8rem; color: #71717a; padding: 8px; }
.sb-selected-thumbs {
  margin: 10px 0;
  padding: 8px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.sb-thumb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.sb-thumb-row:last-child { margin-bottom: 0; }
.sb-thumb-label {
  font-size: 0.8rem;
  color: #71717a;
  flex-shrink: 0;
  width: 36px;
}
.sb-thumb-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.sb-thumb-item {
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  background: #22232d;
}
.sb-thumb-item.sb-thumb-clickable {
  cursor: pointer;
}
.sb-thumb-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
}
.sb-thumb-add-char {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1.5px dashed #52525b;
  background: transparent;
  color: #a1a1aa;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.sb-thumb-add-char:hover {
  color: #e4e4e7;
  border-color: #71717a;
  background: rgba(63, 63, 70, 0.5);
}
html.light .sb-thumb-add-char {
  border-color: #d4d4d8;
  color: #71717a;
}
html.light .sb-thumb-add-char:hover {
  color: #18181b;
  border-color: #a1a1aa;
  background: #f4f4f5;
}
.sb-thumb-prop,
.sb-thumb-scene {
  width: 36px;
  height: 36px;
}
.sb-script-row.sb-script-selects {
  gap: 6px;
}
.sb-script-row.sb-script-selects .sb-select {
  min-width: 0;
}
.sb-script-row.sb-script-selects .el-select { flex: 1; min-width: 0; }
.sb-thumb-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sb-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: #7a7a88;
  background: #2a2b36;
}
.sb-script-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #71717a;
  margin-bottom: 6px;
}
.sb-script-label .el-icon { font-size: 0.9rem; }
.sb-upload-icon { margin-left: auto; cursor: pointer; color: #a1a1aa; }
.sb-meta {
  font-size: 0.75rem;
  color: #71717a;
  display: flex;
  gap: 12px;
}
.sb-image-area {
  flex: 1;
  min-height: 200px;
  max-height: 320px;
  background: linear-gradient(145deg, #1a1b24 0%, #1e1f28 60%, #1c1d26 100%);
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  overflow: hidden;
  position: relative;
  transition: border-color 0.2s, background 0.2s;
}
.sb-image-area:hover {
  border-color: rgba(255, 255, 255, 0.15);
}
html.light .sb-image-area {
  background: linear-gradient(145deg, #f5f3ff 0%, #ede9fe 100%);
  border-color: rgba(124,58,237,0.2);
}
html.light .sb-image-area:hover {
  border-color: rgba(124,58,237,0.45);
}
.sb-image-area--dragover {
  outline: 2px dashed var(--el-color-primary);
  outline-offset: -2px;
  background: rgba(64, 158, 255, 0.1);
}
.sb-image-area-drop-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.9rem;
  border-radius: 8px;
  pointer-events: none;
}
.sb-generated-img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
}
.sb-image-file-input { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
.sb-gen-btn { margin-top: 4px; }
.sb-image-area img.sb-generated-img { cursor: pointer; }
.sb-panel.sb-image.sb-image--universal {
  min-height: 300px;
  justify-content: flex-start;
}
.sb-universal-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
.sb-universal-label-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.sb-universal-hint-icon {
  cursor: help;
  color: #9ca3af;
  font-size: 16px;
  flex-shrink: 0;
}
.sb-universal-hint-icon:hover {
  color: #a78bfa;
}
.sb-universal-gen-btn {
  flex-shrink: 0;
}
.sb-universal-prompt-dd {
  flex-shrink: 0;
}
.sb-universal-dd-caret {
  margin-left: 2px;
  font-size: 12px;
  vertical-align: middle;
}
:global(.sb-universal-tooltip-popper.el-popper) {
  padding: 0 !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}
.sb-universal-tooltip {
  max-width: 360px;
  font-size: 12px;
  line-height: 1.55;
  padding: 10px 12px;
  border-radius: 8px;
  color: #f1f5f9;
  background: #0f172a;
  border: 1px solid rgba(248, 250, 252, 0.22);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.sb-universal-tooltip strong {
  font-weight: 600;
  color: #ffffff;
}
html.light .sb-universal-tooltip {
  color: #0f172a;
  background: #ffffff;
  border-color: #cbd5e1;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
}
html.light .sb-universal-tooltip strong {
  color: #020617;
}
.sb-universal-textarea {
  flex: 1;
  min-height: 0;
}
.sb-universal-textarea :deep(.el-textarea__inner) {
  min-height: 220px !important;
  font-size: 13px;
  line-height: 1.55;
}
/* 分镜管理与自由创作保持同一优先级：全能提示词是 T0 输入，不再随
   左侧素材编排或右侧镜头列表被压缩成一行。 */
.sb-image--universal .sb-universal-textarea {
  display: block;
  width: 100%;
  min-height: clamp(420px, 58vh, 680px);
}
.sb-image--universal .sb-universal-textarea :deep(.omni-at-wrap),
.sb-image--universal .sb-universal-textarea :deep(.omni-at-editor) {
  min-height: clamp(390px, 54vh, 640px);
}
.vp-mode-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.45;
  margin-top: 8px;
  max-width: 520px;
}
.sb-ctrl-mode-btn.el-button {
  border-color: rgba(34, 197, 94, 0.35);
  color: #86efac;
  background: rgba(34, 197, 94, 0.08);
}
.sb-ctrl-mode-btn.el-button:hover {
  border-color: #22c55e;
  color: #fff;
  background: rgba(34, 197, 94, 0.45);
}
html.light .sb-ctrl-mode-btn.el-button {
  border-color: rgba(22, 163, 74, 0.35);
  color: #15803d;
  background: rgba(22, 163, 74, 0.06);
}
html.light .sb-ctrl-mode-btn.el-button:hover {
  border-color: #16a34a;
  color: #fff;
  background: #16a34a;
}
/* 有四宫格或多图时，image-area 改为纵向滚动布局 */
.sb-image-area--first-last {
  min-height: 220px;
  max-height: none;
  padding: 8px;
  align-items: stretch;
  justify-content: flex-start;
}
.sb-fl-dual {
  display: flex;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  flex: 1;
  min-height: 180px;
}
.sb-fl-slot {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sb-fl-slot-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: #a78bfa;
  text-align: center;
}
.sb-fl-slot-body {
  flex: 1;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  overflow: hidden;
}
.sb-fl-slot-body .sb-generated-img {
  max-height: 160px;
}
.sb-fl-empty {
  font-size: 0.75rem;
  color: #71717a;
}
.sb-fl-arrow {
  flex-shrink: 0;
  align-self: center;
  font-size: 1.25rem;
  color: #a78bfa;
  opacity: 0.85;
}
.sb-fl-slot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  align-items: center;
}
.sb-fl-first-lock-opt {
  margin: 0 2px;
  height: auto;
}
.sb-fl-first-lock-opt :deep(.el-checkbox__label) {
  font-size: 12px;
  padding-left: 4px;
}
.sb-fl-slot-prompt {
  font-size: 0.68rem;
  line-height: 1.35;
  color: #9ca3af;
  max-height: 2.7em;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  padding: 0 4px;
  word-break: break-all;
}
.sb-image-area--has-quad {
  flex-direction: column;
  align-items: stretch;
  overflow-y: auto;
  max-height: 340px;
}
/* 普通多图缩略图条 */
.sb-imgs-strip {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 8px 4px;
  overflow-x: auto;
  border-top: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}
.sb-strip-hint-icon {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  cursor: default;
  transition: color 0.15s;
}
.sb-strip-hint-icon:hover {
  color: var(--el-color-primary);
}
.sb-img-thumb {
  position: relative;
  cursor: pointer;
  border-radius: 4px;
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.2s;
  flex-shrink: 0;
  width: 52px;
  height: 52px;
}
.sb-img-thumb:hover { border-color: var(--el-color-primary); }
.sb-img-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sb-img-thumb-label {
  position: absolute;
  bottom: 1px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 10px;
  color: #fff;
  background: rgba(0,0,0,0.45);
  pointer-events: none;
}
/* 主图容器 */
.sb-main-image-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 80px;
}
/* 主图下方提示词预览 */
.sb-main-img-prompt {
  width: 100%;
  font-size: 10px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  border-top: 1px solid var(--el-border-color-lighter);
  padding: 4px 6px;
  line-height: 1.4;
  max-height: 48px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  word-break: break-all;
  cursor: default;
}
/* 四宫格整图作为上方预览时稍微缩小 */
.sb-quad-preview { max-height: 160px; }
/* 四宫格拆分中占位 */
.quad-splitting-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 8px;
}
.sb-image-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-shrink: 0;
  padding-top: 6px;
}
.sb-video-area {
  flex: 1;
  min-height: 200px;
  background: linear-gradient(145deg, #1a1b24 0%, #1e1f28 60%, #1c1d26 100%);
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.2s;
}
html.light .sb-video-area {
  background: linear-gradient(145deg, #f5f3ff 0%, #ede9fe 100%);
  border-color: rgba(124,58,237,0.2);
}
.sb-video-placeholder {
  color: #71717a;
  font-size: 0.9rem;
  flex-direction: column;
  gap: 10px;
  text-align: center;
  padding: 16px;
}
html.light .sb-video-placeholder {
  color: #3479ae;
}
.sb-video-generating-text {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #409eff;
  font-size: 0.85rem;
}
.sb-video-error {
  color: #f56c6c;
  font-size: 0.75rem;
  line-height: 1.4;
  word-break: break-word;
  max-height: 80px;
  overflow-y: auto;
  padding: 4px 8px;
  background: rgba(245, 108, 108, 0.08);
  border-radius: 4px;
  text-align: left;
  width: 100%;
}
.sb-video-player {
  width: 100%;
  max-height: 240px;
  border-radius: 8px;
}
.sb-video-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-shrink: 0;
  padding-top: 6px;
}
.sb-video-regenerating-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 0.82rem;
  color: #a78bfa;
}
.sb-videos-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.sb-video-thumb {
  position: relative;
  width: 72px;
  height: 48px;
  border-radius: 5px;
  overflow: hidden;
  cursor: pointer;
  border: 1.5px solid transparent;
  flex-shrink: 0;
  transition: border-color 0.15s;
}
.sb-video-thumb:hover {
  border-color: #4b91c8;
}
.sb-video-thumb-player {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.sb-video-lazy-placeholder {
  position: relative;
  overflow: hidden;
  width: 100%;
  min-height: 198px;
  border: 0;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: var(--text-muted);
  background: var(--bg-inner);
  cursor: pointer;
  font: inherit;
}
.sb-video-lazy-placeholder img,.sb-video-thumb-placeholder img { width:100%; height:100%; object-fit:cover; display:block; }
.sb-video-poster-play { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:46px; height:46px; border-radius:50%; display:grid; place-items:center; color:#fff; background:rgba(15,23,42,.56); backdrop-filter:blur(4px); }
.sb-video-lazy-placeholder:hover,
.sb-video-lazy-placeholder:focus-visible { color: var(--text-primary); background: var(--bg-hover); }
.sb-video-lazy-placeholder .el-icon { font-size: 24px; }
.sb-video-thumb-placeholder {
  display: grid;
  place-items: center;
  color: var(--text-muted);
  background: var(--bg-inner);
  font-size: 20px;
}
.sb-video-thumb-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0,0,0,0.55);
  color: #e4e4e7;
  font-size: 0.65rem;
  text-align: center;
  padding: 1px 0;
  pointer-events: none;
}
.sb-video-prompt-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.sb-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4b91c8;
  flex-shrink: 0;
}
.sb-video-prompt-label > span:not(.sb-dot) { font-size: 0.85rem; color: #e4e4e7; }
.sb-video-params-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 4px 0;
}
.sb-video-params-bar .sb-video-prompt-text {
  flex: 1;
  min-width: 0;
}
.sb-video-prompt-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 4px;
}
.sb-video-prompt-row .sb-video-prompt-text {
  flex: 1;
  min-width: 0;
}
.vp-dialog-form .el-form-item {
  margin-bottom: 12px;
}
.sb-video-prompt-text {
  font-size: 0.85rem;
  color: #a1a1aa;
  line-height: 1.5;
  padding: 8px 0;
}
.sb-video-prompt-text--preview {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}
.sb-video-prompt-edit {
  margin-bottom: 8px;
}
.sb-video-prompt-edit .el-textarea { margin-bottom: 8px; }
.sb-video-prompt-edit-actions { display: flex; gap: 8px; }
.sb-generate-video-btn { margin-top: 8px; }
.sb-prompt-label { display: flex; align-items: center; gap: 8px; margin: 10px 0 6px; }
.sb-prompt-label .sb-dot { flex-shrink: 0; }
.sb-prompt-label > span:not(.sb-dot) { font-size: 0.85rem; color: #e4e4e7; }
.sb-prompt-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; }
.sb-prompt-row .sb-prompt-text { flex: 1; min-width: 0; font-size: 0.85rem; color: #a1a1aa; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sb-image-prompt-edit .el-textarea { margin-bottom: 6px; }
.sb-prompt-edit-actions { display: flex; gap: 8px; }
.sb-video-fields-collapse { margin: 8px 0; }
.sb-video-fields-collapse .el-collapse-item__header { font-size: 0.9rem; }
.sb-prompt-section-title { font-size: 0.9rem; font-weight: 600; color: #e4e4e7; margin-bottom: 8px; }
.sb-prompt-section-title--row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.vp-video-prompt-hint { font-size: 12px; color: #909399; line-height: 1.5; }
.sb-split-audio-tip { font-size: 12px; color: #64748b; line-height: 1.45; margin: 0 0 8px; }
.sb-split-audio-row { display: flex; flex-direction: column; align-items: flex-start; }
.sb-prompt-dialog-form .el-form-item { margin-bottom: 10px; }
.sb-collapse-title { color: #a1a1aa; }
.sb-video-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; padding: 8px 0; }
.sb-field { display: flex; flex-direction: column; gap: 4px; }
.sb-field-full { grid-column: 1 / -1; }
.sb-field-label { font-size: 0.8rem; color: #a1a1aa; }
.sb-field-select { width: 100%; }
.sb-video-fields-actions { grid-column: 1 / -1; margin-top: 8px; }
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
.sb-truncated-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 14px;
  background: rgba(234, 179, 8, 0.12);
  border: 1px solid rgba(234, 179, 8, 0.4);
  border-radius: 8px;
  color: #fbbf24;
  font-size: 0.875rem;
  line-height: 1.5;
}
.sb-truncated-warning .el-icon {
  flex-shrink: 0;
  font-size: 1rem;
  color: #fbbf24;
}
.sb-truncated-warning span {
  flex: 1;
}
/* 分镜生成中提示条 */
.sb-generating-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 18px;
  margin-top: 10px;
  background: rgba(139, 92, 246, 0.08);
  border: 1px dashed rgba(139, 92, 246, 0.35);
  border-radius: 10px;
  color: #a78bfa;
  font-size: 0.9rem;
}
.sb-gen-text {
  flex: 1;
  letter-spacing: 0.03em;
}
.sb-gen-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a78bfa;
  animation: sb-dot-bounce 1.2s infinite ease-in-out both;
}
.sb-gen-dot:nth-child(1) { animation-delay: 0s; }
.sb-gen-dot:nth-child(2) { animation-delay: 0.2s; }
.sb-gen-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes sb-dot-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40%            { transform: scale(1);   opacity: 1;   }
}
.sb-config-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.sb-config-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sb-config-label {
  font-size: 0.85rem;
  color: #a1a1aa;
  white-space: nowrap;
}
.sb-config-input {
  width: 110px;
}
.sb-config-hint {
  font-size: 0.78rem;
  color: #52525b;
  white-space: nowrap;
}
.sb-config-hint--estimate {
  white-space: normal;
  max-width: 220px;
  line-height: 1.35;
}
.sb-config-divider {
  color: #3a3a44;
  font-size: 0.85rem;
  margin: 0 4px;
}
/* 解说导出行：避免浅色主题下勾选文案与卡片背景对比度不足 */
.sb-narration-export-row :deep(.el-checkbox__label) {
  color: #e4e4e7;
  font-size: 0.875rem;
  line-height: 1.45;
}
html.light .sb-narration-export-row :deep(.el-checkbox__label) {
  color: #374151;
}
.sb-export-srt-btn.el-button--primary.is-plain {
  --el-button-bg-color: rgba(124, 58, 237, 0.75);
  --el-button-border-color: #a78bfa;
  --el-button-text-color: #fff;
  --el-button-hover-text-color: #fff;
  --el-button-hover-bg-color: #4b91c8;
  --el-button-hover-border-color: #c4b5fd;
}
html.light .sb-export-srt-btn.el-button--primary.is-plain {
  --el-button-bg-color: #3479ae;
  --el-button-border-color: #6d28d9;
  --el-button-text-color: #fff;
  --el-button-hover-text-color: #fff;
  --el-button-hover-bg-color: #6d28d9;
  --el-button-hover-border-color: #5b21b6;
}
.sb-narration-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
/* 分镜内解说旁白输入框：强制字/底对比，避免主题变量与页面继承冲突导致「看不见字」 */
.sb-narration-input :deep(.el-textarea__inner) {
  color: #e4e4e7 !important;
  background-color: rgba(24, 24, 27, 0.85) !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
  box-shadow: none;
}
.sb-narration-input :deep(.el-textarea__inner::placeholder) {
  color: #71717a !important;
}
html.light .sb-narration-input :deep(.el-textarea__inner) {
  color: #1e1b4b !important;
  background-color: #ffffff !important;
  border-color: rgba(139, 92, 246, 0.22) !important;
}
html.light .sb-narration-input :deep(.el-textarea__inner::placeholder) {
  color: #9ca3af !important;
}
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
.library-item-actions { display: flex; gap: 8px; }
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
.sb-frame-prompt-clean .el-message-box__content {
  padding: 16px 20px 8px;
}
.sb-prompt-clean-body {
  max-width: 680px;
  min-width: 480px;
}
.sb-prompt-pre {
  margin: 0 0 12px 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  line-height: 1.65;
  color: #e2e8f0;
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 8px;
  padding: 14px 16px;
  max-height: 420px;
  overflow-y: auto;
}
html.light .sb-prompt-pre {
  color: #1e2937;
  background: #f8fafc;
  border-color: #cbd5e1;
}
.sb-prompt-meta-line {
  font-size: 11px;
  color: #64748b;
  padding: 0 4px 8px;
  line-height: 1.4;
}
html.light .sb-prompt-meta-line {
  color: #64748b;
}

/* 首尾帧提示词编辑器 */
.frame-prompt-editor-body {
  padding: 4px 0;
}
.frame-prompt-editor-hint {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 10px;
  line-height: 1.5;
}
html.light .frame-prompt-editor-hint {
  color: #475569;
}
.frame-prompt-editor-textarea :deep(.el-textarea__inner) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  line-height: 1.65;
}

/* 空间布局锚点展示（首尾帧一致性合同） */
.frame-layout-anchor {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 10px;
}
html.light .frame-layout-anchor {
  background: #f1f5f9;
  border-color: #cbd5e1;
}
.frame-layout-anchor-label {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 4px;
}
.frame-layout-anchor-text {
  font-size: 12.5px;
  line-height: 1.5;
  color: #1e293b;
  background: #fff;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
}
.frame-layout-anchor-note {
  font-size: 11px;
  color: #64748b;
  margin-top: 4px;
  line-height: 1.4;
}
.main-generation-controls{display:flex;align-items:center;gap:10px;flex:1;min-width:420px;padding:6px 10px;border:1px solid var(--el-border-color);border-radius:8px;background:var(--el-fill-color-light)}.main-generation-controls .generation-settings{flex:1;min-width:0;padding:0;border:0;background:transparent}.main-generation-label{font-size:12px;font-weight:600;color:var(--el-text-color-primary);white-space:nowrap}.sd2-resource-control{font-weight:600}.asset-btns{display:flex;flex-wrap:wrap;gap:6px}.asset-btns .sd2-resource-control{margin-left:0}@media(max-width:900px){.main-generation-controls{min-width:0;flex-wrap:wrap}.main-generation-controls .generation-settings{flex-basis:100%}}
.sb-inline-generation-settings{display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:8px 12px;border:1px solid var(--el-border-color);border-radius:8px;background:var(--el-fill-color-light)}.sb-inline-generation-settings .generation-settings{flex:1;min-width:0;padding:0;border:0;background:transparent}.sb-inline-generation-label{font-size:12px;font-weight:600;color:var(--el-text-color-primary);white-space:nowrap}.sb-inline-generation-hint{font-size:11px;color:var(--el-text-color-secondary);white-space:nowrap}@media(max-width:900px){.sb-inline-generation-settings{align-items:stretch;flex-wrap:wrap}.sb-inline-generation-settings .generation-settings{flex-basis:100%}.sb-inline-generation-hint{width:100%}}
.sb-omni-controls{display:flex;flex-direction:column;gap:8px;margin-top:10px;padding:9px 10px;border:1px solid var(--el-border-color-lighter);border-radius:8px;background:var(--el-fill-color-blank)}.sb-omni-control-row,.sb-omni-frame-row,.sb-omni-frame-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sb-omni-control-label{font-size:12px;font-weight:600;color:var(--el-text-color-primary);min-width:48px}.sb-omni-control-hint{font-size:12px;color:var(--el-text-color-secondary)}.sb-omni-frame-slot{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--el-text-color-secondary);padding:4px 7px;background:var(--el-fill-color-light);border-radius:4px;max-width:100%;min-width:0}.sb-omni-frame-slot-label{font-weight:600;color:var(--el-text-color-primary);white-space:nowrap}.sb-omni-frame-thumb{width:34px;height:24px;object-fit:cover;border-radius:3px;flex:none}.sb-omni-frame-pick,.sb-omni-frame-upload{padding:0 4px;white-space:nowrap}.sb-universal-library-caret{margin-left:2px}.sb-universal-library-btn--static{font-size:12px;color:var(--el-text-color-secondary);padding:2px 8px;border:1px solid var(--el-border-color-lighter);border-radius:4px;white-space:nowrap}.sb-omni-left-sb-title{display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:6px 8px;border:1px solid var(--el-border-color-lighter);border-radius:6px;background:var(--el-fill-color-light)}.sb-omni-left-sb-idx{font-size:11px;font-weight:700;color:#fff;background:#6366f1;border-radius:4px;padding:1px 5px;flex:none}.sb-omni-left-sb-name{font-size:13px;font-weight:600;color:var(--el-text-color-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.sb-omni-left-hint{font-size:11px;color:var(--el-text-color-secondary)}.sb-omni-selected-strip{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:8px;padding:5px 8px;border:1px dashed var(--el-border-color);border-radius:6px;background:var(--el-fill-color-light)}.sb-omni-selected-strip-label{font-size:11px;font-weight:600;color:var(--el-text-color-secondary);flex:none}.sb-omni-selected-strip-item{display:inline-flex;align-items:center;gap:3px;border:1px solid var(--el-border-color-lighter);border-radius:4px;padding:1px 4px;background:var(--el-fill-color-blank)}.sb-omni-selected-strip-item img{width:20px;height:16px;object-fit:cover;border-radius:2px}.sb-omni-selected-strip-item em{font-size:10px;font-style:normal;color:var(--el-color-primary)}.sb-omni-material-panel{display:flex;flex-direction:column;gap:8px;margin-top:0;padding:10px;border:1px solid var(--el-border-color-lighter);border-radius:8px;background:var(--el-fill-color-blank);min-width:0}.sb-omni-material-dropzone{height:44px;display:flex;align-items:center;justify-content:center;gap:7px;border:1px dashed var(--el-color-primary);border-radius:7px;color:var(--el-color-primary);background:var(--el-color-primary-light-9);font-size:12px;text-align:center}.sb-omni-material-auto-refs{font-size:11px;line-height:1.5;color:var(--el-color-primary);padding:5px 8px;background:var(--el-color-primary-light-9);border-radius:5px}.sb-omni-material-upload-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sb-omni-material-drop-hint{font-size:11px;color:var(--el-text-color-secondary)}.sb-omni-material-note{font-size:11px;line-height:1.5;color:var(--el-text-color-secondary)}.sb-omni-material-summary{font-size:12px;line-height:1.5;color:var(--el-text-color-primary);padding:5px 8px;background:var(--el-fill-color-light);border-radius:5px}.sb-omni-material-label{font-size:12px;font-weight:600;color:var(--el-text-color-primary);margin-top:2px}.sb-omni-material-pool{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;max-height:240px;overflow:auto;padding-right:2px}.sb-omni-material-card{position:relative;border:1px solid var(--el-border-color);border-radius:6px;padding:3px;cursor:pointer;background:var(--el-fill-color-blank);overflow:hidden}.sb-omni-material-card:hover{border-color:var(--el-color-primary)}.sb-omni-material-card.selected{border-color:var(--el-color-primary);box-shadow:0 0 0 1px var(--el-color-primary)}.sb-omni-material-card img{width:100%;height:52px;object-fit:cover;border-radius:4px;display:block}.sb-omni-material-card-icon{display:flex;height:52px;align-items:center;justify-content:center;font-size:20px;background:var(--el-fill-color-light);border-radius:4px}.sb-omni-material-card small{display:block;margin-top:3px;font-size:10px;line-height:1.3;color:var(--el-text-color-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sb-omni-material-card-check{position:absolute;right:4px;top:4px;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--el-color-primary);color:#fff;font-size:12px;font-weight:700}.sb-omni-material-pool-empty{grid-column:1/-1;font-size:12px;color:var(--el-text-color-secondary);padding:12px 0;text-align:center}.sb-omni-material-selected-list{display:flex;flex-direction:column;gap:5px;max-height:280px;overflow:auto;padding-right:2px}.sb-omni-material-selected-row{display:grid;grid-template-columns:34px minmax(0,1fr) 118px auto auto auto auto auto;align-items:center;gap:6px;padding:4px 6px;border:1px solid var(--el-border-color-lighter);border-radius:6px;background:var(--el-fill-color-light)}.sb-omni-material-selected-name{display:flex;align-items:center;gap:6px;min-width:0}.sb-omni-material-selected-name b{font-size:12px;color:var(--el-text-color-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sb-omni-material-at{font-size:10px;font-style:normal;color:var(--el-color-primary);background:var(--el-color-primary-light-9);padding:1px 5px;border-radius:3px;white-space:nowrap}.sb-universal-library-thumb{width:34px;height:24px;object-fit:cover;border-radius:3px}.sb-universal-library-type{display:inline-flex;width:34px;height:24px;align-items:center;justify-content:center;font-size:12px;color:var(--el-text-color-secondary);background:var(--el-fill-color-light);border-radius:3px;flex:none}.sb-universal-library-usage{width:118px;flex:none}.sb-universal-library-move{padding:0 4px}.sb-universal-library-sd2{padding:0 5px;font-size:10px;color:var(--el-text-color-secondary);white-space:nowrap;border-radius:4px}.sb-universal-library-sd2:hover{color:var(--el-color-primary)}.sb-universal-identity-row{display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:8px;border:1px solid var(--el-border-color-lighter);border-radius:7px;background:var(--el-fill-color-light)}.sb-universal-identity-status{display:flex;align-items:center;flex-wrap:wrap;gap:4px;font-size:11px;color:var(--el-text-color-secondary);line-height:1.4}.sb-universal-identity-status.is-active{color:var(--el-color-success)}.sb-universal-identity-status.is-processing{color:var(--el-color-warning)}.sb-universal-identity-status.is-failed,.sb-universal-identity-status.is-invalid{color:var(--el-color-danger)}.sb-universal-frame-actions{display:flex;flex-wrap:wrap;gap:6px}.sb-universal-frame-actions .el-button{margin:0}.sb-omni-frame-picker-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;max-height:420px;overflow:auto}.sb-omni-frame-picker-card{border:1px solid var(--el-border-color);border-radius:7px;padding:5px;cursor:pointer;background:var(--el-fill-color-blank)}.sb-omni-frame-picker-card:hover{border-color:var(--el-color-primary)}.sb-omni-frame-picker-card.active{border-color:var(--el-color-primary);box-shadow:0 0 0 1px var(--el-color-primary)}.sb-omni-frame-picker-card img{width:100%;height:64px;object-fit:cover;border-radius:4px}.sb-omni-frame-picker-card small{display:block;margin-top:4px;font-size:11px;color:var(--el-text-color-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sb-omni-frame-picker-empty{font-size:12px;color:var(--el-text-color-secondary);text-align:center;padding:18px 0}@media(max-width:900px){.sb-omni-control-row{align-items:flex-start}.sb-omni-audio-row{flex-direction:column}.sb-omni-control-hint{width:100%}.sb-omni-frame-row{flex-direction:column;align-items:stretch}.sb-omni-frame-slot{justify-content:flex-start}.sb-omni-material-selected-row{grid-template-columns:34px minmax(0,1fr) auto auto auto}.sb-omni-material-selected-row .sb-universal-library-usage{grid-column:2 / -1;width:100%}}
.workflow-shell{margin:0 0 18px;padding:22px 24px;border:1px solid #ded8ce;border-radius:14px;background:#fffdf9;box-shadow:0 8px 24px #372d2010}.workflow-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.workflow-head h2{margin:3px 0 4px;color:#28231d;font-size:22px}.workflow-head p{margin:0;color:#746c62;font-size:14px}.workflow-kicker{font-size:12px;font-weight:700;letter-spacing:.08em;color:#8c6a44}.workflow-episode{padding:6px 9px;border-radius:99px;background:#f5efe5;color:#6b5842;font-size:13px}.workflow-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:20px}.workflow-step{display:flex;align-items:center;justify-content:center;gap:8px;min-height:42px;border:1px solid #dfd8ce;border-radius:8px;background:#fff;color:#756c61;cursor:pointer;font:inherit;font-size:14px}.workflow-step span{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#eee9e1;color:#746b60;font-size:12px}.workflow-step:hover{border-color:#a68b68;color:#514333}.workflow-step.active{border-color:#755d43;background:#3d342a;color:#fff}.workflow-step.active span{background:#fff;color:#3d342a}.workflow-step.complete:not(.active) span{background:#d9e7da;color:#45624a}.resource-center{background:#fffdf9!important}.resource-center-heading,.resource-media-library>header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.resource-center-heading{margin-bottom:18px}.resource-center-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.resource-center-group,.resource-media-library{border:1px solid #e2ddd5;border-radius:10px;background:#fff;padding:14px}.resource-center-group>header,.resource-media-library>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.resource-center-group>header b,.resource-media-library b{color:#302a23}.resource-center-group>header span,.resource-media-library>header>span{display:grid;place-items:center;min-width:24px;height:24px;border-radius:99px;background:#f0ebe3;color:#735e46;font-size:12px}.resource-center-actions{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.resource-center-list{display:grid;gap:9px;max-height:400px;overflow:auto}.resource-center-item{display:grid;grid-template-columns:76px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px;border-radius:7px;background:#faf8f5}.resource-center-item img,.resource-center-placeholder{width:76px;height:58px;border-radius:5px;object-fit:cover}.resource-center-placeholder{display:grid;place-items:center;background:#ece6dc;color:#8a7e6d;font-size:12px}.resource-center-item b,.resource-center-item small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.resource-center-item b{font-size:14px;color:#3e372f}.resource-center-item small{margin-top:3px;color:#8a8176;font-size:13px}.resource-center-empty{margin:18px 0;color:#92877b;font-size:14px}.resource-media-library{margin-top:14px}.resource-media-library header small{display:block;margin-top:4px;color:#8c8378;font-size:14px}.resource-media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.resource-media-card{overflow:hidden;border:1px solid #e7e2da;border-radius:7px;background:#faf8f5}.resource-media-card img,.resource-media-card>span{display:grid;width:100%;height:100px;object-fit:cover;place-items:center;background:#efe9df;color:#857765;font-size:14px}.resource-media-card small{display:block;padding:7px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#5c5247;font-size:13px}.storyboard-reference-panel{border-color:#e0d6c8!important;background:#fffdf9!important}@media(max-width:900px){.workflow-head{flex-direction:column}.workflow-steps{grid-template-columns:repeat(2,minmax(0,1fr))}.resource-center-grid{grid-template-columns:1fr}}
.workflow-next-action{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:12px 0 22px;padding:14px 16px;border:1px solid #ded8ce;border-radius:10px;background:#f9f5ee;color:#665b4e;font-size:13px}.merge-readiness{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 0 14px;padding:11px 13px;border:1px solid #ead6b1;border-radius:8px;background:#fff7e8;color:#89622c;font-size:13px}.merge-readiness.ready{border-color:#c9dfca;background:#f0f8ef;color:#426c46}.merge-readiness b{color:inherit}@media(max-width:680px){.workflow-next-action{align-items:stretch;flex-direction:column}.workflow-next-action .el-button{width:100%}}
.storyboard-workspace{display:grid;grid-template-columns:minmax(260px,320px) minmax(0,1fr);align-items:start;gap:16px}.storyboard-workspace .storyboard-reference-panel{position:sticky;top:16px;margin:0;max-height:calc(100dvh - 32px);overflow:auto}.storyboard-workspace .storyboard-editor-panel{margin:0;min-width:0}.sb-ctrl-bar{cursor:grab}.sb-ctrl-bar:active{cursor:grabbing}.sb-ctrl-bar--dragging{opacity:.45}.sb-ctrl-bar--dragover{box-shadow:inset 0 3px 0 #7c6248!important;background:#f4eee4!important}@media(max-width:1100px){.storyboard-workspace{grid-template-columns:230px minmax(0,1fr)}}@media(max-width:820px){.storyboard-workspace{display:flex;flex-direction:column}.storyboard-workspace .storyboard-reference-panel{position:static;width:100%;max-height:none}.storyboard-workspace .storyboard-editor-panel{width:100%}}

/* Workflow and resource-center are used inside the primary storyboard flow.
   They must inherit the global workbench palette instead of their old warm light skin. */
.workflow-shell,.resource-center,.storyboard-reference-panel{background:var(--bg-surface)!important;border-color:var(--border-color)!important;box-shadow:var(--shadow-sm)}
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
.workflow-next-action{border-color:var(--border-color);background:var(--bg-raised);color:var(--text-regular)}
.merge-readiness,.merge-readiness.ready{border-color:var(--border-color);background:var(--bg-hover);color:var(--text-regular)}
.sb-ctrl-bar--dragover{box-shadow:inset 0 3px 0 var(--accent)!important;background:var(--bg-hover)!important}

/* 项目主工作流与 AI 工具箱采用同一套深色单色基线，旧页面不再混入浅色卡片。 */
/* Desktop studio pass: make the production flow read as one directed creative surface. */
@media(min-width:961px){
  .film-create{background:var(--bg-page);background-image:radial-gradient(56% 46% at 18% -8%,color-mix(in srgb,var(--accent) 19%,transparent),transparent 72%),radial-gradient(32% 36% at 95% 15%,color-mix(in srgb,var(--accent-teal) 10%,transparent),transparent 70%),linear-gradient(180deg,color-mix(in srgb,var(--bg-page) 84%,#05070c),var(--bg-page) 42%)}
  .quick-nav{width:214px;padding-top:18px;background:linear-gradient(180deg,color-mix(in srgb,var(--bg-surface) 97%,#070910),color-mix(in srgb,var(--bg-page) 94%,#03050a));border-right-color:var(--border-subtle);box-shadow:12px 0 38px rgba(0,0,0,.2)}.quick-nav::before{content:'创作流程';padding:0 14px 13px;color:var(--text-faint);font-size:10px;font-weight:800;letter-spacing:.18em}.quick-nav.collapsed{width:54px}.header,.main{margin-left:214px}.sidebar-collapsed .header,.sidebar-collapsed .main{margin-left:54px}
  .header{padding:12px 26px;background:color-mix(in srgb,var(--bg-surface) 88%,transparent)!important;border-bottom-color:var(--border-subtle)!important;box-shadow:var(--shadow-sm)!important}.header-inner{gap:12px;min-width:0}.logo{flex:0 0 165px;flex-direction:row;align-items:center;gap:8px;min-width:0}.richi-brand-copy{display:grid;min-width:0}.logo-main{overflow:visible;background:none;color:var(--text-primary);font-size:.88rem;line-height:1.15;white-space:nowrap;-webkit-text-fill-color:var(--text-primary)}.logo-sub{color:var(--text-muted);font-size:.62rem;letter-spacing:0;-webkit-text-fill-color:var(--text-muted)}.page-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-color:var(--border-subtle);border-radius:9px;background:color-mix(in srgb,var(--bg-raised) 80%,transparent);color:var(--text-regular)}
  .main{max-width:1680px;padding:34px 38px 64px}.workflow-shell{position:relative;overflow:hidden;margin-bottom:22px;padding:30px 32px;border-color:color-mix(in srgb,var(--accent) 36%,var(--border-color))!important;border-radius:20px;background:radial-gradient(circle at 92% 12%,color-mix(in srgb,var(--accent-teal) 19%,transparent),transparent 24%),linear-gradient(138deg,color-mix(in srgb,var(--accent) 13%,var(--bg-surface)),var(--bg-surface) 55%,color-mix(in srgb,var(--accent-teal) 7%,var(--bg-surface)))!important;box-shadow:var(--shadow-md)!important}.workflow-shell::after{content:'';position:absolute;right:-88px;bottom:-164px;width:390px;height:390px;border:1px solid color-mix(in srgb,var(--accent) 36%,transparent);border-radius:50%;box-shadow:0 0 0 38px color-mix(in srgb,var(--accent) 5%,transparent),0 0 0 78px color-mix(in srgb,var(--accent) 3%,transparent);pointer-events:none}.workflow-shell>*{position:relative;z-index:1}.workflow-kicker{color:var(--accent);font-size:10px;letter-spacing:.16em}.workflow-head h2{font-size:28px;letter-spacing:-.035em}.workflow-head p{max-width:58ch}.workflow-episode{border:1px solid color-mix(in srgb,var(--accent) 34%,var(--border-color));background:color-mix(in srgb,var(--bg-surface) 74%,transparent);color:var(--text-primary)}
  .workflow-steps{gap:10px;margin-top:27px}.workflow-step{min-height:54px;border-color:var(--border-subtle);border-radius:12px;background:color-mix(in srgb,var(--bg-page) 30%,transparent);font-weight:650;transition:transform .18s ease,border-color .18s ease,background .18s ease}.workflow-step:hover{transform:translateY(-2px);border-color:var(--border-strong);background:color-mix(in srgb,var(--bg-raised) 90%,transparent)}.workflow-step.active{border-color:transparent;background:linear-gradient(135deg,var(--accent),#6f61df);box-shadow:0 12px 26px color-mix(in srgb,var(--accent) 26%,transparent)}
  .section.card{position:relative;overflow:hidden;padding:28px 30px;border-color:var(--border-subtle);border-radius:18px;background:color-mix(in srgb,var(--bg-surface) 94%,transparent);box-shadow:var(--shadow-sm)}.section.card:hover{transform:none;border-color:color-mix(in srgb,var(--accent) 38%,var(--border-color));box-shadow:var(--shadow-md)}.script-workbench-unified::before{content:none}.section-title{color:var(--text-primary)!important;font-size:1.15rem!important;letter-spacing:-.02em}.section-desc{color:var(--text-muted)!important}.story-textarea :deep(.el-textarea__inner){background:color-mix(in srgb,var(--bg-page) 35%,transparent)!important;border-color:var(--border-subtle)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}.story-textarea :deep(.el-textarea__inner:focus){box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 68%,transparent)!important}.workflow-next-action{border-color:color-mix(in srgb,var(--accent) 30%,var(--border-color));border-radius:13px;background:color-mix(in srgb,var(--accent) 7%,var(--bg-raised));box-shadow:var(--shadow-sm)}
  .nav-sidebar-header{padding:0 14px 12px;border-bottom-color:var(--border-subtle)}.nav-sidebar-title{color:var(--text-faint);font-size:10px;font-weight:800;letter-spacing:.15em}.nav-steps{padding-inline:13px}.nav-step{padding:7px 8px;border-radius:10px}.nav-step:hover{background:color-mix(in srgb,var(--accent) 8%,transparent)}.step-label{color:var(--text-regular);font-size:13px}.step-dot{width:25px;height:25px}.status-generating .step-label{color:var(--accent)}.status-done .step-label{color:var(--accent-teal)}.nav-group{margin-top:11px}.nav-sub-toggle{padding:8px 14px;color:var(--text-faint);border-top-color:var(--border-subtle)}
}

/* The production studio owns the viewport; only its active canvas scrolls. */
.film-create { height:100vh; height:100dvh; min-height:0; overflow:hidden; }
.film-create > .header { position:relative; height:3.75rem; box-sizing:border-box; }
.film-create > .main { height:calc(100vh - 3.75rem); height:calc(100dvh - 3.75rem); box-sizing:border-box; padding-bottom:2rem; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; }
@media(min-width:961px){
  .script-stage-active>.main{display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:14px;overflow:hidden;padding-top:18px;padding-bottom:18px}
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
  .resources-stage-active>.main{display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:14px;overflow:hidden;padding-top:18px;padding-bottom:18px}
  .resources-stage-active .workflow-shell{margin:0;padding:15px 22px;border-radius:16px}
  .resources-stage-active .workflow-head{align-items:center}.resources-stage-active .workflow-head h2{margin-block:2px;font-size:22px}.resources-stage-active .workflow-head p{font-size:12px}
  .resources-stage-active .workflow-steps{margin-top:12px}.resources-stage-active .workflow-step{min-height:38px}
  .resources-stage-active .resource-center{display:grid;grid-template-rows:auto minmax(0,1fr) 9.5rem;gap:12px;min-height:0;padding:18px 22px;overflow:hidden}
  .resources-stage-active .resource-center-heading{margin:0}.resources-stage-active .resource-center-heading .section-title{margin-top:0}.resources-stage-active .resource-center-heading .section-desc{margin-bottom:0}
  .resources-stage-active .resource-center-grid{min-height:0}.resources-stage-active .resource-center-group{display:flex;flex-direction:column;min-height:0;overflow:hidden}
  .resources-stage-active .resource-center-list{flex:1;min-height:0;max-height:none;overflow:auto;scrollbar-width:thin}
  .resources-stage-active .resource-media-library{min-height:0;margin:0;padding:10px 12px;overflow:hidden}
  .resources-stage-active .resource-media-library>header{margin-bottom:7px}
  .resources-stage-active .resource-media-grid{display:flex;gap:9px;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
  .resources-stage-active .resource-media-card{flex:0 0 9.5rem}.resources-stage-active .resource-media-card img,.resources-stage-active .resource-media-card>span{height:54px}.resources-stage-active .resource-media-card small{padding-block:4px}
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
@media(max-width:960px){.film-create>.main{height:calc(100vh - 3.75rem);height:calc(100dvh - 3.75rem);overflow-y:auto}.film-create>.header{position:relative}}
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
/* The film shell consumes a navigation rail, so storyboard breakpoints are
   based on the remaining work area rather than the full browser width. */
@media(min-width:961px){
  .film-create>.main{width:calc(100% - 214px);max-width:none;min-width:0;padding-inline:clamp(.75rem,2vw,2rem)}
  .film-create.sidebar-collapsed>.main{width:calc(100% - 54px)}
  .storyboard-stage-active .main{padding-inline:clamp(.5rem,1.5vw,1.5rem)}
}
</style>
