<template>
  <section class="omni-page" :class="{ 'project-storyboard-page': isProjectMode, embedded: embedded }" @wheel.capture="containWorkbenchScroll">
    <header v-if="!embedded" class="topbar">
      <div class="topbar-left">
        <el-button text @click="backToProject"><el-icon><ArrowLeft /></el-icon>返回项目</el-button>
        <span class="divider"></span><span>{{ isProjectMode ? '项目剧集：' : '剧集：' }}</span><el-input v-if="sequence" v-model="sequence.name" size="small" class="sequence-name" :readonly="isProjectMode" @change="saveCurrentShot" />
      </div>
      <div class="topbar-actions"><AccountBalanceBadge /><el-button text @click="$router.push('/media-library')">素材库</el-button><el-button text size="small" :disabled="!currentShot" @click="copyCurrentShot">复制当前镜头</el-button><el-button type="primary" plain size="small" @click="saveCurrentShot">保存整集</el-button></div>
    </header>

    <nav class="mobile-workbench-tabs" aria-label="自由创作工作区">
      <button type="button" :class="{ active: mobileWorkspaceTab === 'shots' }" @click="mobileWorkspaceTab = 'shots'">镜头</button>
      <button type="button" :class="{ active: mobileWorkspaceTab === 'stage' }" @click="mobileWorkspaceTab = 'stage'">画面</button>
      <button type="button" :class="{ active: mobileWorkspaceTab === 'create' }" @click="mobileWorkspaceTab = 'create'">控制</button>
    </nav>

    <section class="workbench" :class="`mobile-${mobileWorkspaceTab}`">
      <aside class="panel shot-panel" aria-label="镜头导航">
        <div class="shot-heading"><b>镜头列表</b><small>{{ shots.length }} 个 · 滚轮切镜</small></div>
        <div class="shot-actions"><el-button size="small" type="primary" plain @click="addShot(false)">+ 尾部添加</el-button><el-button size="small" @click="addShot(true)">当前镜头后添加</el-button></div>
        <div ref="shotListRef" class="shot-list" tabindex="0" aria-label="镜头列表，可用上下方向键或滚轮切换镜头" @keydown.up.prevent="selectRelative(-1)" @keydown.down.prevent="selectRelative(1)" @wheel.prevent="onShotListWheel">
          <article v-for="(shot, index) in shots" :key="shot.id" class="shot-card" :class="{ active: shot.id === activeShotId, dragging: draggedShotId === shot.id }" :aria-current="shot.id === activeShotId ? 'true' : undefined" draggable="true" @dragstart="draggedShotId = shot.id" @dragend="draggedShotId = null" @dragover.prevent @drop="dropShot(shot.id)" @click="selectShot(shot)">
            <div class="shot-title"><span class="drag-handle">⠿</span><span class="shot-number">{{ index + 1 }}</span><b :title="shot.title || '未命名镜头'">{{ shot.title || '未命名镜头' }}</b><span class="shot-controls"><el-button text size="small" :disabled="index === 0" aria-label="上移镜头" @click.stop="moveShot(index, -1)">↑</el-button><el-button text size="small" :disabled="index === shots.length - 1" aria-label="下移镜头" @click.stop="moveShot(index, 1)">↓</el-button><el-button text size="small" aria-label="重命名镜头" @click.stop="renameShot(shot)"><el-icon><Edit /></el-icon></el-button></span><el-button class="shot-delete" type="danger" plain size="small" :disabled="shots.length <= 1" :title="shots.length <= 1 ? '至少保留一个镜头；请先新增镜头再删除当前镜头' : '删除镜头'" aria-label="删除镜头" @click.stop="removeShot(shot)"><el-icon><Delete /></el-icon><span>删除</span></el-button></div>
            <div class="shot-preview"><video v-if="shot.video_url" :src="shot.video_url" :poster="shot.poster_local_path ? `/static/${String(shot.poster_local_path).replace(/^\/+/, '')}` : undefined" muted playsinline preload="metadata" /><div v-else class="shot-video-placeholder" aria-label="尚未生成视频"><span class="shot-play">▶</span></div><span>{{ shot.settings?.duration || 15 }}s</span></div>
            <div class="shot-state" :class="shot.status"><i></i>{{ shotState(shot) }}</div>
          </article>
        </div>
      </aside>

      <section class="center-stage" aria-label="当前镜头播放与时间线">
        <div class="player-tools"><el-button text size="small" @click="selectRelative(-1)">上一镜</el-button><el-button text size="small" @click="selectRelative(1)">下一镜</el-button><span class="current-version">当前采用：{{ activeJob ? `版本 #${activeJob.video_generation_id || activeJob.id}` : '暂无版本' }}</span><el-tag :type="stageTagType" effect="dark">{{ stageLabel }}</el-tag></div>
        <div class="video-stage" :class="{ rendering: ['sd2_waiting','processing','upscale_pending','upscaling','interpolation_pending','interpolating','persisting'].includes(activeJob?.status), 'has-video': !!activeVideoUrl }">
          <template v-if="mediaLayers.length"><video v-for="layer in mediaLayers" :key="layer.id" :src="layer.url" :controls="layer.id === topMediaLayerId && layer.ready" playsinline preload="metadata" :autoplay="playOnSelection && layer.id === topMediaLayerId" class="main-video" :class="{ 'is-ready': layer.ready, 'is-current': layer.id === topMediaLayerId }" @canplay="promoteMediaLayer(layer.id)" @error="discardMediaLayer(layer.id)" /></template>
          <template v-else-if="['sd2_waiting','processing','upscale_pending','upscaling','interpolation_pending','interpolating','persisting'].includes(activeJob?.status)"><div class="render-ring ring-one"></div><div class="render-ring ring-two"></div><div class="render-play">▶</div><b>{{ activeJob?.status === 'sd2_waiting' ? '真人素材认证准备中，完成后将自动生成' : generationProgressLabel }}</b><div class="generation-progress" role="status" aria-live="polite"><span><i :style="{ width: `${generationProgress}%` }"></i></span><em>{{ generationProgress }}%</em><small>{{ generationProgressMessage }}</small></div><el-button v-if="canCancelJob(activeJob)" size="small" type="warning" plain @click="cancelJob(activeJob)">取消未提交任务</el-button></template>
          <template v-else-if="activeJob && ['failed','retryable','invalid','billing_reconciliation','unknown'].includes(activeJob.status)"><el-icon class="stage-warning"><WarningFilled /></el-icon><b>{{ stageLabel }}</b><small>{{ failureHint(activeJob) }}</small><div class="failure-actions"><el-button v-if="activeJob.status === 'unknown' || activeJob.status === 'billing_reconciliation'" type="primary" @click="refreshUnknownJob(activeJob)">手动刷新状态</el-button><el-button v-if="canAdoptSource(activeJob)" type="primary" @click="adoptSource(activeJob)">采用已生成原片</el-button><el-button v-if="canRetryPostprocess(activeJob)" :type="canAdoptSource(activeJob) ? 'default' : 'primary'" @click="retryPostprocess(activeJob)">仅重试{{ activeJob.upscale_status === 'failed' ? '超分' : '插帧' }}</el-button><el-button v-else-if="activeJob.status === 'retryable'" type="primary" @click="retry(activeJob)">重新生成</el-button></div></template>
          <template v-else><div class="empty-play">▶</div><b>尚未生成视频</b></template>
        </div>
        <div v-if="activeVideoUrl" class="frame-actions" aria-label="成片操作"><el-button size="small" @click="downloadCurrentVideo">下载成片</el-button><template v-if="activeJob"><el-button size="small" type="primary" :disabled="savedResultJobId === activeJob.id" @click="saveResultAsAsset">{{ savedResultJobId === activeJob.id ? '已加入素材' : '作为视频素材继续创作' }}</el-button><el-button v-if="isProjectMode && savedResultJobId === activeJob.id" size="small" @click="$router.push(`/film/${projectDramaId}/canvas`)">在项目画布中打开</el-button><template v-if="canExtractFrames"><el-button size="small" :loading="extractingPosition === 'first'" :disabled="!!extractingPosition" @click="extractFrame('first')">提取首帧</el-button><el-button size="small" :loading="extractingPosition === 'last'" :disabled="!!extractingPosition" @click="extractFrame('last')">提取尾帧</el-button></template></template></div>
        <div class="time-ruler" aria-label="镜头时长"><span>时长 {{ duration }} 秒</span><span>最多 {{ maxDuration }} 秒</span></div>
        <div class="shot-tabs"><span class="active">镜头提示词</span><span>输入或拖入 @ 素材</span><span>镜头 {{ activeShotIndex + 1 }} / {{ shots.length }}</span></div>
        <!-- 提示词渲染只读取当前镜头工作集。项目库素材必须先“加入本镜”，
             才能成为 @ 引用候选，绝不能借用其他镜头的同名素材。 -->
        <div class="shot-script"><OmniAssetPromptEditor ref="promptEditorRef" v-model="prompt" :assets="promptAssets" :chosen-ids="selected" :reference-document="promptDocument" @pick="onPickFromEditor" @references="setPromptReferences" /></div>
      </section>

      <aside class="panel creation-panel" aria-label="创作输入与生成设置">
        <div class="panel-title"><b>视频生成方式</b><el-tag size="small" type="info">{{ creationMode === 'first_last_frame' ? '首尾帧生视频' : '多参考生视频' }}</el-tag></div>
        <el-radio-group v-model="creationMode" size="small" class="mode-switch"><el-radio-button value="multi_reference">多参考生视频</el-radio-button><el-radio-button value="first_last_frame">首尾帧生视频</el-radio-button></el-radio-group>
        <section v-if="!isProjectMode" class="billing-project-field" aria-labelledby="billing-project-title">
          <div><b id="billing-project-title">计费归属项目</b><small>{{ sequence?.drama_id ? '本全能创作已锁定此项目，后续生成与积分均归属这里。' : '请选择本次全能创作的计费项目。首次生成后将锁定，避免跨项目混账。' }}</small></div>
          <el-select v-model="freeProjectId" filterable :disabled="!!sequence?.drama_id" placeholder="选择计费项目" aria-label="选择计费归属项目"><el-option v-for="project in projects" :key="project.id" :label="project.title" :value="project.id"/></el-select>
        </section>
        <small class="mode-note">{{ creationMode === 'first_last_frame' ? '必须设置一张首帧（必填），尾帧可选；模型不支持时不可提交。' : '图片、视频、音频可按用途自由编排，按模型能力自动路由。' }}</small>
        <el-alert v-if="!currentCapability" class="model-config-alert" type="warning" :closable="false" title="尚未配置可用的视频模型" description="请联系运营管理员为当前项目组绑定已验证的视频模型；配置后本工作台会自动读取它的素材能力与限制。" />
        <div class="creation-generate-dock" aria-label="当前镜头生成操作">
          <div class="creation-generate-summary"><b>生成镜头 {{ activeShotIndex + 1 }}</b><small>本次将发送 {{ requestAssets.length }} 个素材 · {{ duration }} 秒</small></div>
          <div class="creation-generate-actions"><el-button size="small" @click="requestPreviewOpen = true">预览请求</el-button><el-button class="generate-button" type="primary" :loading="creating" :disabled="!canCreate" @click="create">{{ creating ? '生成中…' : '生成当前镜头' }}</el-button></div>
        </div>
        <div v-if="creationMode === 'first_last_frame'" class="frame-slots">
          <div class="frame-slot" :class="{ filled: !!firstFrameAsset, required: true }" @click="openFramePicker('first_frame')">
            <img v-if="firstFrameAsset" :src="assetUrl(firstFrameAsset)" />
            <el-button v-if="firstFrameAsset" text size="small" class="frame-clear" @click.stop="clearFrame('first_frame')">清除</el-button>
            <span v-if="!firstFrameAsset" class="frame-tag req">必填</span>
            <div v-if="!firstFrameAsset" class="frame-empty"><el-icon><Picture /></el-icon><span class="frame-label">首帧 <em class="req">*</em></span><small>点击选择</small></div>
          </div>
          <div class="frame-slot" :class="{ filled: !!lastFrameAsset }" @click="openFramePicker('last_frame')">
            <img v-if="lastFrameAsset" :src="assetUrl(lastFrameAsset)" />
            <el-button v-if="lastFrameAsset" text size="small" class="frame-clear" @click.stop="clearFrame('last_frame')">清除</el-button>
            <span v-if="!lastFrameAsset" class="frame-tag">选填</span>
            <div v-if="!lastFrameAsset" class="frame-empty"><el-icon><Picture /></el-icon><span class="frame-label">尾帧</span><small>点击选择</small></div>
          </div>
        </div>
        <section class="t0-generation-settings" aria-label="生成参数">
          <div class="t0-settings-heading"><b>生成参数</b><div v-if="isProjectMode" class="template-status"><el-tag size="small" :type="currentGenerationMode === 'custom' ? 'warning' : 'info'">{{ currentGenerationMode === 'master' ? '首镜母版' : currentGenerationMode === 'custom' ? '当前镜头覆盖' : '跟随首镜' }}</el-tag><el-button v-if="currentGenerationMode === 'custom'" text size="small" @click="restoreCurrentShotMaster">恢复跟随首镜</el-button></div><small>{{ currentGenerationMode === 'master' ? '调整后同步所有跟随镜头' : currentGenerationMode === 'custom' ? '本镜独立，不受首镜变化影响' : '默认采用第一个镜头参数，可单独覆盖' }}</small></div>
          <GenerationSettings v-model="generationSettings" :max-duration="maxDuration" />
          <div class="parameters"><label>音频<el-select v-model="audioStrategy" size="small"><el-option label="音频参考" value="reference_only"/><el-option label="成片混音" value="post_mix"/></el-select></label></div>
        </section>

        <div class="materials-title"><div><b>当前镜头素材</b><small>仅显示本镜已加入的素材；上传后会自动加入本镜。</small></div><div><el-button text size="small" @click="projectLibraryOpen = true">从项目素材库加入</el-button><el-button text size="small" @click="$router.push('/media-library')">管理素材</el-button><el-button text size="small" @click="pickFiles">上传素材</el-button></div></div>
        <input ref="fileInput" hidden type="file" multiple accept="image/*,video/*,audio/*" @change="uploadFiles" />
        <div class="dropzone" @click="pickFiles" @dragover.prevent @drop.prevent="dropFiles"><el-icon><Upload /></el-icon>拖入图片、视频或音频</div>
        <small class="upload-limit-note">{{ limitSummary }}</small>
        <div class="material-pool current-shot-material-pool">
          <article v-for="asset in chosenAssets" :key="asset.id" class="material-card" :class="{ selected: selected.has(asset.id) }" draggable="false" :aria-pressed="selected.has(asset.id)" @dragstart.prevent @pointerdown="beginAssetPointerDrag($event, promptAssetFor(asset))" @click="onMaterialCardClick(promptAssetFor(asset))"><img v-if="asset.type === 'image'" :src="assetUrl(asset)" alt="" draggable="false"/><img v-else-if="asset.type === 'video' && assetThumbnailUrl(asset)" :src="assetThumbnailUrl(asset)" alt="" draggable="false"/><span v-else-if="asset.type === 'video'" class="material-video-placeholder"><el-icon><VideoCamera /></el-icon></span><span v-else>🎵</span><small>{{ assetDisplayName(asset) }}</small><button type="button" class="material-delete" :aria-label="`移出当前镜头 ${assetDisplayName(asset)}`" title="移出当前镜头" @pointerdown.stop @click.stop="remove(asset.id)">×</button><button type="button" class="insert-at-caret" :aria-label="`将 ${promptAssetFor(asset).alias} 插入光标处`" title="插入光标处" @click.stop="promptEditorRef?.insertAtCaret(promptAssetFor(asset))">插入此处</button><em v-if="asset.drama_id" class="asset-scope-label">项目</em><em v-else class="asset-scope-label">全局</em></article>
          <p v-if="!chosenAssets.length" class="current-shot-material-empty">本镜暂未加入素材。上传新素材，或从项目素材库搜索后加入。</p>
        </div>

        <div class="selected-assets">
          <article v-for="asset in referencedAssets" :key="asset.id" draggable="true" @dragstart="draggedAssetId = asset.id" @dragover.prevent @drop="dropSelectedAsset(asset.id)"><span class="drag-handle">⠿</span><span class="asset-name"><b>@{{ promptAssetFor(asset).alias }}</b><small class="asset-route-hint">{{ assetRouteHint(asset) }}</small></span><el-select v-model="asset.usage" size="small" @change="onUsageChange(asset)"><el-option v-for="usage in usages(asset.type)" :key="usage.value" :label="usage.label" :value="usage.value"/></el-select><el-button text size="small" @click="remove(asset.id)">移除</el-button></article>
        </div>
        <div class="selection-actions"><small class="selection-limit-note">{{ selectionSummary }} · 已引用的素材会随本次生成发送</small><el-button v-if="chosenAssets.length" text size="small" @click="clearSelectedAssets">清空本镜素材</el-button></div><small v-if="creationMode === 'first_last_frame'" class="selection-limit-note">首帧 {{ firstFrameCount }}/1，尾帧 {{ lastFrameCount }}/1</small>
        <div v-if="chosenImageAssets.length" class="identity-options">
          <div class="identity-heading"><b>素材声明</b><small>只需勾选含真人；未勾选即为不含真人，不再需要额外认证。</small></div>
          <div v-for="asset in chosenImageAssets" :key="asset.id" class="identity-row">
            <el-checkbox :model-value="asset.requires_sd2_identity" @change="setRealPerson(asset, $event)">{{ assetDisplayName(asset) }}</el-checkbox>
            <small v-if="asset.requires_sd2_identity" class="identity-help">系统将自动完成真人素材准备。</small>
            <small v-else class="identity-help">不含真人素材。</small>
          </div>
        </div>
        <div v-if="audioStrategy === 'post_mix'" class="audio-options"><el-checkbox v-model="keepOriginalAudio">保留原声</el-checkbox><el-slider v-model="audioVolume" :min="0" :max="2" :step="0.1"/><el-input-number v-model="audioFadeSeconds" :min="0" :max="10" size="small"/></div>
        <div v-if="expiredIdentityAssets.length" class="identity-expired-warn"><el-icon><WarningFilled /></el-icon><span>以下真人素材认证未成功：{{ expiredIdentityAssets.map((a) => a.alias || a.name).join('、') }}。请检查素材或认证配置后重新勾选“含真人”。</span></div>
        <section class="generation-history">
          <div class="generation-history-head"><b>本镜生成记录</b><small>{{ shotHistory.length }} 个版本</small></div>
          <div class="generation-history-grid">
            <article v-for="job in shotHistory" :key="job.id" class="generation-history-item" :class="{ active: String(selectedHistoryJobId) === String(job.id) }" role="button" tabindex="0" @click="selectHistoryJob(job)" @keydown.enter.prevent="selectHistoryJob(job)" @keydown.space.prevent="selectHistoryJob(job)">
              <img v-if="historyPoster(job)" :src="historyPoster(job)" alt="" class="history-poster"/><span v-else class="history-video-empty"><el-icon><VideoCamera /></el-icon>{{ job.videoUrl ? '点击切换成片' : (['sd2_waiting','processing','upscale_pending','upscaling','interpolation_pending','interpolating','persisting'].includes(job.status) ? '处理中' : '暂无预览') }}</span>
              <span class="history-card-meta"><b>{{ job.model_resolved || job.model || '视频版本' }}</b><small>{{ job.is_current ? '当前采用' : '未采用' }} · {{ historyStatus(job.status) }} · {{ job.duration || duration }}秒</small><small>{{ postprocessSummary(job) }}</small><small>实际扣费：{{ job.actual_points == null ? '待结算' : `${Number(job.actual_points).toFixed(2)} 积分` }}</small><el-button v-if="job.status === 'completed' && !job.is_current && isProjectMode" text size="small" @click.stop="adoptVersion(job)">设为当前成片</el-button><el-button v-if="canAdoptSource(job)" text type="primary" size="small" @click.stop="adoptSource(job)">采用已生成原片</el-button><el-button v-if="canRetryPostprocess(job)" text type="warning" size="small" @click.stop="retryPostprocess(job)">仅重试{{ job.upscale_status === 'failed' ? '超分' : '插帧' }}</el-button><el-button v-if="!activeGenerationStatuses.has(job.status)" text type="danger" size="small" @click.stop="hideHistoryJob(job)">隐藏记录</el-button></span>
              <span :class="['history-dot', job.status]"></span>
            </article>
          </div>
          <p v-if="!shotHistory.length" class="generation-history-empty">尚无生成记录。每次生成都会保留为独立版本。</p>
        </section>
      </aside>
    </section>

    <el-dialog v-model="framePicker.open" :title="framePicker.target === 'first_frame' ? '选择首帧' : '选择尾帧'" width="540px" append-to-body>
      <div class="frame-picker-grid">
        <article v-for="asset in pickerImageAssets" :key="asset.id" class="frame-picker-card" :class="{ active: framePickerValue && framePickerValue.id === asset.id }" @click="confirmFrame(asset)">
          <img :src="assetUrl(asset)" /><small>{{ assetDisplayName(asset) }}</small>
        </article>
      </div>
      <div v-if="!pickerImageAssets.length" class="frame-picker-empty">还没有图片素材，请先在上方上传图片</div>
    </el-dialog>
    <el-dialog v-model="projectLibraryOpen" title="从项目素材库加入本镜" width="760px" append-to-body>
      <div class="project-asset-library-toolbar">
        <el-input v-model="projectLibraryKeyword" clearable placeholder="搜索图片、视频或音频素材" aria-label="搜索项目素材" />
        <el-select v-model="assetScope" size="default" class="asset-scope" :aria-label="isProjectMode ? '筛选当前项目或全局素材' : '选择素材来源'"><template v-if="isProjectMode"><el-option label="全部素材（本项目 + 全局）" value="all"/><el-option label="本项目素材" value="project"/><el-option label="我的全局素材" value="global"/></template><template v-else><el-option label="我的全局素材" value="global"/><el-option label="项目素材" value="project"/></template></el-select>
      </div>
      <p class="project-asset-library-note">点击素材即可加入或移出当前镜头；加入后可拖到提示词中的具体位置形成 @ 引用。</p>
      <div class="project-asset-library-grid">
        <button v-for="asset in filteredProjectLibraryAssets" :key="asset.id" type="button" class="project-asset-library-card" :class="{ added: selectedOrder.includes(asset.id), selected: selected.has(asset.id) }" :aria-pressed="selected.has(asset.id)" @click="toggleProjectLibraryAsset(asset)">
          <img v-if="asset.type === 'image'" :src="assetUrl(asset)" :alt="assetDisplayName(asset) || '图片素材'" />
          <img v-else-if="asset.type === 'video' && assetThumbnailUrl(asset)" :src="assetThumbnailUrl(asset)" :alt="assetDisplayName(asset) || '视频素材'" />
          <span v-else>{{ asset.type === 'audio' ? '音频' : '视频' }}</span>
          <b>{{ assetDisplayName(asset) }}</b><small>{{ asset.drama_id ? '当前项目素材' : '我的全局素材' }}</small>
          <em>{{ selected.has(asset.id) ? '已引用' : selectedOrder.includes(asset.id) ? '已加入本镜' : '点击加入' }}</em>
        </button>
        <p v-if="!filteredProjectLibraryAssets.length" class="project-asset-library-empty">没有匹配的素材。可调整范围或搜索词，也可先上传新素材。</p>
      </div>
    </el-dialog>
    <el-dialog v-model="requestPreviewOpen" title="本次生成请求预览" width="620px" append-to-body @open="quoteCurrentRequest">
      <p class="request-preview-note">此处仅展示将要提交的内容，不会润色或改写你的原始提示词。</p>
      <p class="request-preview-note">预估冻结：{{ quotingEstimate ? '计算中…' : estimatedPoints == null ? '当前模型尚无可用报价' : `${Number(estimatedPoints).toFixed(2)} 积分` }}（最终按供应商真实用量结算）</p>
      <pre class="request-preview">{{ JSON.stringify(requestPreview, null, 2) }}</pre>
      <div class="request-preview-actions"><el-button :loading="polishingPrompt" @click="suggestPolish">AI 润色建议</el-button><el-button v-if="polishSuggestion" type="primary" plain @click="applyPolishSuggestion">应用建议</el-button></div>
      <div v-if="polishSuggestion" class="polish-suggestion"><b>润色建议（尚未应用）</b><pre>{{ polishSuggestion }}</pre></div>
    </el-dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Delete, Edit, Picture, Upload, VideoCamera, WarningFilled } from '@element-plus/icons-vue'
import { omniVideoAPI } from '@/api/omniVideo'
import { videosAPI } from '@/api/videos'
import { dramaAPI } from '@/api/drama'
import { storyboardsAPI } from '@/api/storyboards'
import OmniAssetPromptEditor from '@/components/OmniAssetPromptEditor.vue'
import GenerationSettings from '@/components/GenerationSettings.vue'
import { clearPromptDraft, currentDraftUserId, readPromptDraft, shouldRestorePromptDraft, writePromptDraft } from '@/utils/promptDraft'
import { formatChinaDateTime } from '@/utils/time'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'
import { beginAssetPointerDrag, shouldSuppressAssetClick } from '@/utils/assetPointerDrag'

const componentProps = defineProps({ projectEpisodeId: { type: [Number, String], default: null }, projectDramaId: { type: [Number, String], default: null }, embedded: { type: Boolean, default: false } })
const emit = defineEmits(['reordered', 'changed'])
const assets = ref([]), capabilities = ref([]), jobs = ref([]), sequence = ref(null), shots = ref([]), activeShotId = ref(null), projects = ref([]), freeProjectId = ref(null)
const mobileWorkspaceTab = ref('stage')
const route = useRoute()
const router = useRouter()
const embedded = computed(() => componentProps.embedded)
const projectEpisodeId = computed(() => Number(componentProps.projectEpisodeId || route.query.episode_id || 0))
const projectDramaId = computed(() => Number(componentProps.projectDramaId || route.query.drama_id || 0))
const isProjectMode = computed(() => Number.isInteger(projectEpisodeId.value) && projectEpisodeId.value > 0)
const selected = ref(new Set()), selectedOrder = ref([]), assetScope = ref('project'), projectLibraryOpen = ref(false), projectLibraryKeyword = ref(''), prompt = ref(''), model = ref(''), aspectRatio = ref('16:9'), duration = ref(15), resolution = ref('720p'), upscaleResolution = ref('1080p'), targetFps = ref(null), audioStrategy = ref('reference_only'), creationMode = ref('multi_reference')
const promptDocument = ref({ text: '', refs: [] })
const keepOriginalAudio = ref(false), audioVolume = ref(1), audioFadeSeconds = ref(0), creating = ref(false), certifyingId = ref(null), extractingPosition = ref(''), savedResultJobId = ref(null), requestPreviewOpen = ref(false), polishingPrompt = ref(false), polishSuggestion = ref(''), stagePhase = ref(''), fileInput = ref(null), uploadLimits = ref(null)
const draggedShotId = ref(null), draggedAssetId = ref(null), loadingShot = ref(false)
const generationModes = ref({}), masterShotId = ref(null), projectGenerationDirty = ref(false)
const playOnSelection = ref(false)
const mediaLayers = ref([])
let mediaLayerSequence = 0
let mediaLayerTransitionTimer = null
const generationClock = ref(Date.now())
const shotListRef = ref(null)
const promptEditorRef = ref(null)
let wheelShotLocked = false
let wheelShotTimer = null
const shotHistory = ref([]), selectedHistoryJobId = ref(null)
let saveTimer = null
let promptRevision = 0
let restoredDraftNoticeShown = false
let generationClockTimer = null
const pollingJobIds = new Set()
const activeGenerationStatuses = new Set(['sd2_waiting', 'processing', 'upscale_pending', 'upscaling', 'interpolation_pending', 'interpolating', 'persisting'])
let pollLifecycleStopped = false
const pendingPollVisibilityResumes = new Set()

function waitForVisiblePolling() {
  if (document.visibilityState === 'visible') return Promise.resolve()
  return new Promise((resolve) => {
    const resume = () => {
      document.removeEventListener('visibilitychange', onVisibility)
      pendingPollVisibilityResumes.delete(resume)
      resolve()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') resume()
    }
    pendingPollVisibilityResumes.add(resume)
    document.addEventListener('visibilitychange', onVisibility)
  })
}

function currentPromptDraftIdentity(shotId = currentShot.value?.id) {
  return {
    userId: currentDraftUserId(),
    workspace: isProjectMode.value ? 'project-free-create' : 'free-create',
    dramaId: projectDramaId.value || null,
    episodeId: projectEpisodeId.value || sequence.value?.id || null,
    shotId: shotId || null,
  }
}

function currentPromptDraftPayload() {
  return {
    prompt: prompt.value,
    promptDocument: { ...(promptDocument.value || {}), text: prompt.value },
    settings: {
      model: model.value, creationMode: creationMode.value, aspectRatio: aspectRatio.value,
      duration: duration.value, resolution: resolution.value, upscaleResolution: upscaleResolution.value, targetFps: targetFps.value, audioStrategy: audioStrategy.value,
      keepOriginalAudio: keepOriginalAudio.value, audioVolume: audioVolume.value,
      audioFadeSeconds: audioFadeSeconds.value,
    },
    selectedOrder: [...selectedOrder.value],
    selectedAssets: chosenAssets.value.map((asset) => ({ id: Number(asset.id), alias: assetDisplayName(asset), usage: asset.usage })),
  }
}

function persistCurrentPromptDraft() {
  if (loadingShot.value || !currentShot.value) return
  promptRevision += 1
  writePromptDraft(localStorage, currentPromptDraftIdentity(), currentPromptDraftPayload())
}

function restorePromptDraftForShot(shot) {
  const draft = readPromptDraft(localStorage, currentPromptDraftIdentity(shot?.id))
  if (!draft || !shouldRestorePromptDraft(draft, shot?.updated_at)) return false
  const saved = draft.payload || {}
  prompt.value = saved.prompt == null ? '' : String(saved.prompt)
  promptDocument.value = saved.promptDocument && typeof saved.promptDocument === 'object'
    ? { ...saved.promptDocument, text: prompt.value }
    : promptDocumentFor(prompt.value)
  const settings = saved.settings || {}
  if (settings.model != null) model.value = settings.model
  if (settings.creationMode) creationMode.value = settings.creationMode
  if (settings.aspectRatio) aspectRatio.value = settings.aspectRatio
  if (settings.duration != null) duration.value = normalizeDuration(settings.duration)
  if (settings.resolution) resolution.value = settings.resolution
  if (Object.prototype.hasOwnProperty.call(settings, 'upscaleResolution')) upscaleResolution.value = settings.upscaleResolution || null
  if (Object.prototype.hasOwnProperty.call(settings, 'targetFps')) targetFps.value = settings.targetFps || null
  if (settings.audioStrategy) audioStrategy.value = settings.audioStrategy
  if (settings.keepOriginalAudio != null) keepOriginalAudio.value = !!settings.keepOriginalAudio
  if (settings.audioVolume != null) audioVolume.value = settings.audioVolume
  if (settings.audioFadeSeconds != null) audioFadeSeconds.value = settings.audioFadeSeconds
  if (Array.isArray(saved.selectedOrder)) {
    selectedOrder.value = saved.selectedOrder.map(Number).filter((id) => assets.value.some((asset) => asset.id === id))
  }
  if (Array.isArray(saved.selectedAssets)) {
    saved.selectedAssets.forEach((savedAsset) => {
      const asset = assets.value.find((item) => Number(item.id) === Number(savedAsset.id))
      if (asset && savedAsset.usage) asset.usage = savedAsset.usage
    })
  }
  if (!restoredDraftNoticeShown) {
    restoredDraftNoticeShown = true
    ElMessage.info('已恢复刷新前尚未保存的提示词草稿')
  }
  return true
}

const currentShot = computed(() => shots.value.find((shot) => shot.id === activeShotId.value) || null)
const currentGenerationMode = computed(() => generationModes.value[currentShot.value?.id] || (Number(currentShot.value?.id) === Number(masterShotId.value) ? 'master' : 'inherited'))
const activeShotIndex = computed(() => Math.max(0, shots.value.findIndex((shot) => shot.id === activeShotId.value)))
const chosenAssets = computed(() => selectedOrder.value.map((id) => assets.value.find((asset) => asset.id === id)).filter(Boolean))
function assetDisplayName(asset) { return String(asset?.name || asset?.alias || asset?.reference_alias || '').trim() }
function assetLegacyAliases(asset) { return [...new Set([asset?.reference_alias, asset?.alias, asset?.name].map((value) => String(value || '').trim()).filter(Boolean))] }
function assetTypeLabel(type) { return type === 'video' ? '视频' : type === 'audio' ? '音频' : '图片' }
const promptAssets = computed(() => {
  const groups = new Map()
  chosenAssets.value.forEach((asset) => {
    const name = assetDisplayName(asset)
    groups.set(name, [...(groups.get(name) || []), asset])
  })
  return chosenAssets.value.map((asset) => {
    const name = assetDisplayName(asset)
    const siblings = groups.get(name) || []
    const index = siblings.findIndex((item) => Number(item.id) === Number(asset.id))
    const alias = siblings.length > 1 ? `${name}（${assetTypeLabel(asset.type)}${index + 1}）` : name
    return { ...asset, alias, legacy_aliases: assetLegacyAliases(asset) }
  })
})
function promptAssetFor(asset) { return promptAssets.value.find((item) => Number(item.id) === Number(asset?.id)) || asset }
const referencedAssets = computed(() => chosenAssets.value.filter((asset) => selected.value.has(asset.id)))
const chosenImageAssets = computed(() => chosenAssets.value.filter((asset) => asset.type === 'image'))
const promptReferencedIds = computed(() => new Set((promptDocument.value?.refs || []).map((entry) => Number(entry.asset_id)).filter(Number.isInteger)))
const requestAssets = computed(() => chosenAssets.value.filter((asset) => promptReferencedIds.value.has(Number(asset.id))))
const activeProjectAssetId = computed(() => isProjectMode.value ? projectDramaId.value : (assetScope.value === 'project' ? Number(freeProjectId.value) || null : null))
const visibleAssets = computed(() => assets.value.filter((asset) => {
  if (isProjectMode.value) return assetScope.value === 'all' || (assetScope.value === 'project' ? Number(asset.drama_id) === projectDramaId.value : !asset.drama_id)
  return assetScope.value === 'project' ? Number(asset.drama_id) === Number(freeProjectId.value) : !asset.drama_id
}))
const filteredProjectLibraryAssets = computed(() => {
  const keyword = projectLibraryKeyword.value.trim().toLowerCase()
  return visibleAssets.value.filter((asset) => !asset.archived_at && (!keyword || `${assetLegacyAliases(asset).join(' ')} ${asset.type || ''} ${typeName(asset.type)}`.toLowerCase().includes(keyword)))
})
const activeJob = computed(() => {
  const selected = shotHistory.value.find((job) => String(job.id) === String(selectedHistoryJobId.value))
  const adopted = shotHistory.value.find((job) => job.is_current)
  const bound = shotHistory.value.find((job) => String(job.id) === String(currentShot.value?.omni_job_id))
  // A history-card click is a preview action: play that version without
  // changing the storyboard's adopted version. The previous priority order
  // always returned `adopted`, so clicked records were highlighted but could
  // never replace the source of the central player.
  return selected || adopted || bound || shotHistory.value[0] || null
})
const activeVideoUrl = computed(() => activeJob.value?.videoUrl || currentShot.value?.video_url || '')
const topMediaLayerId = computed(() => mediaLayers.value.at(-1)?.id || null)
function discardMediaLayer(id) {
  const index = mediaLayers.value.findIndex((layer) => layer.id === id)
  if (index < 0) return
  // 加载失败时继续保留当前成片，避免切换时黑屏或回落到静态占位。
  mediaLayers.value.splice(index, 1)
}
function promoteMediaLayer(id) {
  const layer = mediaLayers.value.find((item) => item.id === id)
  if (!layer || layer.ready) return
  layer.ready = true
  window.clearTimeout(mediaLayerTransitionTimer)
  mediaLayerTransitionTimer = window.setTimeout(() => {
    const current = mediaLayers.value.find((item) => item.id === id)
    if (current) mediaLayers.value = [current]
  }, 180)
}
watch(activeVideoUrl, (url) => {
  const nextUrl = String(url || '')
  if (!nextUrl) {
    window.clearTimeout(mediaLayerTransitionTimer)
    mediaLayers.value = []
    return
  }
  const latest = mediaLayers.value.at(-1)
  if (latest?.url === nextUrl) return
  // 第一条没有旧画面可保持，后续地址则先静默预加载并在可播放后覆盖旧画面。
  mediaLayers.value.push({ id: ++mediaLayerSequence, url: nextUrl, ready: mediaLayers.value.length === 0 })
}, { immediate: true })
const canExtractFrames = computed(() => Number(activeJob.value?.video_generation_id) > 0 && activeJob.value?.status === 'completed')
const currentCapability = computed(() => capabilities.value.find((item) => item.model === model.value) || null)
const shotLimits = computed(() => {
  const base = uploadLimits.value?.shot || { total: 12, image: 9, video: 3, audio: 3 }
  const limits = currentCapability.value?.limits || {}
  if (!limits.total_reference?.max) return base
  return {
    total: Number(limits.total_reference.max), image: Number(limits.image_reference?.max || base.image),
    video: Number(limits.video_reference?.max || base.video), audio: Number(limits.audio_reference?.max || base.audio),
  }
})
const maxDuration = computed(() => Math.max(4, Number(currentCapability.value?.limits?.duration?.max || 15)))
const normalizeDuration = (value) => Math.min(maxDuration.value, Math.max(4, Math.round(Number(value) || 15)))
const generationSettings = computed({ get: () => ({ video_model: model.value, aspect_ratio: aspectRatio.value, duration: duration.value, resolution: resolution.value, upscale_resolution: upscaleResolution.value, target_fps: targetFps.value }), set: (next) => { model.value = next.video_model || ''; aspectRatio.value = next.aspect_ratio || '16:9'; duration.value = normalizeDuration(next.duration); resolution.value = next.resolution || '720p'; upscaleResolution.value = next.upscale_resolution || null; targetFps.value = next.target_fps || null } })
const selectionCounts = computed(() => chosenAssets.value.reduce((result, asset) => { if (Object.prototype.hasOwnProperty.call(result, asset.type)) result[asset.type] += 1; return result }, { image: 0, video: 0, audio: 0 }))
const firstFrameCount = computed(() => chosenAssets.value.filter((asset) => asset.usage === 'first_frame').length)
const lastFrameCount = computed(() => chosenAssets.value.filter((asset) => asset.usage === 'last_frame').length)
const firstFrameAsset = computed(() => chosenAssets.value.find((asset) => asset.usage === 'first_frame') || null)
const lastFrameAsset = computed(() => chosenAssets.value.find((asset) => asset.usage === 'last_frame') || null)
const pickerImageAssets = computed(() => assets.value.filter((asset) => asset.type === 'image'))
/** 认证中的素材会由服务端等待并自动续跑；仅终态失败才提示用户处理。 */
const expiredIdentityAssets = computed(() => chosenImageAssets.value.filter((asset) => asset.requires_sd2_identity && ['invalid', 'failed', 'stale'].includes(sd2Status(asset))))
const framePicker = ref({ open: false, target: 'first_frame' })
const canCreate = computed(() => !!model.value && !!currentCapability.value && prompt.value.trim() && (isProjectMode.value || Number(freeProjectId.value) > 0) && (creationMode.value !== 'first_last_frame' || (firstFrameCount.value === 1 && lastFrameCount.value <= 1 && currentCapability.value.supports?.first_last_frame)))
const nativeImageLimit = computed(() => Math.min(shotLimits.value.image, Number(currentCapability.value?.supports?.image_reference?.max || 0)))
const limitSummary = computed(() => `单文件：图片 ${uploadLimits.value?.files?.image?.max_mb || 30}MB、视频 ${uploadLimits.value?.files?.video?.max_mb || 50}MB、音频 ${uploadLimits.value?.files?.audio?.max_mb || 15}MB；单镜头最多 ${shotLimits.value.total} 个素材。`)
const selectionSummary = computed(() => `已加入本镜 ${chosenAssets.value.length}/${shotLimits.value.total}；图片 ${selectionCounts.value.image}/${shotLimits.value.image}，视频 ${selectionCounts.value.video}/${shotLimits.value.video}，音频 ${selectionCounts.value.audio}/${shotLimits.value.audio}${currentCapability.value ? `；当前模型原生图片参考 ${selectionCounts.value.image}/${nativeImageLimit.value}` : ''}`)
function failureLabel(job) {
  const detail = String(job?.error_msg || '')
  if (/PolicyViolation|policy|copyright|restriction|内容合规|版权限制/i.test(detail)) return '火山生成失败：内容合规/版权限制'
  if (/sensitive information/i.test(detail)) return '火山生成失败：内容合规限制'
  if (job?.upscale_status === 'failed') return '超分失败：原片已保留'
  if (job?.interpolation_status === 'failed') return '智能插帧失败（上一阶段成片已保留）'
  return '生成链路失败：请查看具体原因'
}
function failureHint(job) {
  const detail = String(job?.error_msg || '').trim()
  if (job?.upscale_status === 'failed') return detail || 'AI MediaKit 超分失败，原片已保留，可仅重试超分。'
  if (job?.interpolation_status === 'failed') return detail || 'AI MediaKit 插帧失败，上一阶段视频已保留，可仅重试插帧。'
  return detail || '请调整提示词或素材后重新生成。'
}
function canRetryPostprocess(job) { return job?.status === 'failed' && ((job.upscale_status === 'failed' && !!job.source_local_path) || (job.interpolation_status === 'failed' && !!(job.upscale_local_path || job.source_local_path))) }
function canAdoptSource(job) {
  if (job?.status !== 'failed' || !job.source_local_path) return false
  const failedStages = ['failed', 'cancelled', 'reconciliation_required']
  return failedStages.includes(String(job.upscale_status || '')) || failedStages.includes(String(job.interpolation_status || ''))
}
function canCancelJob(job) { return !!job && ['sd2_waiting', 'processing'].includes(job.status) && !String(job.provider_task_id || '').trim() }
async function cancelJob(job) {
  try {
    await ElMessageBox.confirm('仅取消尚未提交给厂商的任务；已提交任务将继续执行并按真实用量计费。', '取消生成', { type: 'warning' })
    const next = normalizeJob(await omniVideoAPI.cancel(job.id))
    replacePolledJob(job.id, next)
    if (String(currentShot.value?.omni_job_id) === String(job.id)) currentShot.value.status = next.status
    ElMessage.success('任务已取消，预授权已释放')
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error?.message || '取消任务失败') }
}
async function adoptSource(job) {
  try {
    const next = normalizeJob(await omniVideoAPI.adoptSource(job.id))
    const replace = (items) => {
      const index = items.findIndex((item) => String(item.id) === String(job.id))
      if (index >= 0) items[index] = next
    }
    replace(shotHistory.value); replace(jobs.value)
    selectedHistoryJobId.value = next.id
    if (String(currentShot.value?.omni_job_id) === String(next.id)) {
      currentShot.value.status = 'completed'
      currentShot.value.video_url = next.video_url || next.videoUrl || currentShot.value.video_url
      currentShot.value.local_path = next.local_path || currentShot.value.local_path
    }
    ElMessage.success('已采用已生成原片：不重发火山，不重试后处理')
  } catch (error) { ElMessage.error(error.message || '采用原片失败') }
}
async function retryPostprocess(job) {
  try {
    const stage = job.upscale_status === 'failed' ? 'upscale' : 'interpolation'
    const next = normalizeJob(await omniVideoAPI.retryPostprocess(job.id, stage))
    const replace = (items) => {
      const index = items.findIndex((item) => String(item.id) === String(job.id))
      if (index >= 0) items[index] = next
    }
    replace(shotHistory.value); replace(jobs.value)
    selectedHistoryJobId.value = next.id
    if (String(currentShot.value?.omni_job_id) === String(next.id)) currentShot.value.status = next.status
    ElMessage.success(stage === 'upscale' ? '已从超分阶段重新提交，未重发火山生成' : '已从插帧阶段重新提交，未重发火山生成')
    poll(next.id)
  } catch (error) { ElMessage.error(error.message || '阶段重试失败') }
}
async function adoptVersion(job) {
  try {
    const next = normalizeJob(await omniVideoAPI.adopt(job.id))
    shotHistory.value.forEach((item) => { item.is_current = String(item.id) === String(next.id) })
    const index = shotHistory.value.findIndex((item) => String(item.id) === String(next.id))
    if (index >= 0) shotHistory.value[index] = next
    currentShot.value.omni_job_id = next.id
    currentShot.value.status = 'completed'
    currentShot.value.video_url = next.videoUrl
    selectedHistoryJobId.value = next.id
    ElMessage.success('已设为当前成片')
  } catch (error) { ElMessage.error(error.message || '设置当前成片失败') }
}
const stageLabel = computed(() => ({ completed: '成片完成', sd2_waiting: '真人素材认证准备中', processing: '生成中', upscale_pending: '等待超分', upscaling: 'AI 超分中', interpolation_pending: '等待插帧', interpolating: '智能插帧中', persisting: '成片持久化中', billing_reconciliation: '等待计费对账', failed: failureLabel(activeJob.value), retryable: '可重试', invalid: '无效任务', unknown: '状态暂不可用' })[activeJob.value?.status] || '镜头草稿')
const stageTagType = computed(() => ({ completed: 'success', failed: 'danger', retryable: 'warning', invalid: 'info' })[activeJob.value?.status] || 'info')
const generationProgress = computed(() => Math.max(0, Math.min(100, Number(activeJob.value?.task_progress || 0))))
const generationProgressLabel = computed(() => ['upscale_pending','upscaling'].includes(activeJob.value?.status) ? '正在进行 AI 超分' : activeJob.value?.status === 'interpolating' ? '正在进行智能插帧' : activeJob.value?.status === 'persisting' ? '正在持久化最终成片' : (stagePhase.value || '正在生成当前镜头'))
const generationStallMinutes = computed(() => {
  const updatedAt = activeJob.value?.task_updated_at || activeJob.value?.updated_at || activeJob.value?.created_at
  const elapsed = generationClock.value - new Date(updatedAt || 0).getTime()
  return Number.isFinite(elapsed) && elapsed > 8 * 60 * 1000 ? Math.floor(elapsed / 60000) : 0
})
const generationProgressMessage = computed(() => generationStallMinutes.value ? `已 ${generationStallMinutes.value} 分钟未收到新状态，仍在持续查询；可继续编辑其他镜头。` : (activeJob.value?.task_message || '任务已提交，正在等待下一次状态更新'))
const estimatedPoints = ref(null), quotingEstimate = ref(false)
const requestPreview = computed(() => ({ prompt: prompt.value, asset_selection_policy: 'prompt_references', creation_mode: creationMode.value, model: currentCapability.value?.model || model.value, aspect_ratio: aspectRatio.value, duration_seconds: normalizeDuration(duration.value), resolution: resolution.value, upscale_resolution: upscaleResolution.value, target_fps: targetFps.value, audio_strategy: audioStrategy.value, assets: requestAssets.value.map((asset, index) => ({ ordinal: index + 1, name: promptAssetFor(asset).alias, type: asset.type, usage: asset.usage, routing: assetRouteHint(asset) })) }))
async function quoteCurrentRequest() { if (!currentCapability.value?.model) return; quotingEstimate.value = true; try { const quote = await omniVideoAPI.quoteBilling({ service_type: 'video', model: currentCapability.value.model, usage: { second: normalizeDuration(duration.value) }, pricing_context: { resolution: resolution.value || '720p', has_audio: chosenAssets.value.some((asset) => asset.type === 'audio') } }); estimatedPoints.value = quote.amount } catch (_) { estimatedPoints.value = null } finally { quotingEstimate.value = false } }

async function suggestPolish() {
  if (!prompt.value.trim() || polishingPrompt.value) return
  polishingPrompt.value = true
  try {
    const out = await omniVideoAPI.polishPrompt({ prompt: prompt.value, assets: chosenAssets.value.map((asset) => ({ name: assetDisplayName(asset), alias: promptAssetFor(asset).alias, type: asset.type, usage: asset.usage })) })
    polishSuggestion.value = String(out?.suggestion || '').trim()
    if (!polishSuggestion.value) ElMessage.warning('未得到可用的润色建议，请检查文本模型配置')
  } catch (error) { ElMessage.error(error.message || '提示词润色失败') } finally { polishingPrompt.value = false }
}
function applyPolishSuggestion() { if (!polishSuggestion.value) return; prompt.value = polishSuggestion.value; promptDocument.value = { text: prompt.value, refs: promptDocument.value.refs || [] }; polishSuggestion.value = ''; ElMessage.success('已应用润色建议') }
function assetUrl(asset) { return asset?.local_path ? `/static/${asset.local_path}` : asset?.url || '' }
function assetThumbnailUrl(asset) {
  const path = String(asset?.thumbnail_local_path || '').trim()
  if (!path) return ''
  return /^https?:\/\//i.test(path) || path.startsWith('data:') ? path : `/static/${path.replace(/^\/+/, '')}`
}
function typeName(type) { return ({ image: '图片', video: '视频', audio: '音频' })[type] || '素材' }
function usages(type) { return type === 'image' ? [{label:'主视觉',value:'primary'},{label:'人物一致性',value:'identity'},{label:'场景/风格',value:'environment'},{label:'普通参考',value:'reference'},{label:'首帧',value:'first_frame'},{label:'尾帧',value:'last_frame'}] : type === 'video' ? [{label:'动作/镜头参考',value:'motion'},{label:'关键帧提取',value:'keyframes'},{label:'仅后期',value:'post_process'}] : [{label:'音色/氛围参考',value:'ambience'},{label:'成片混音',value:'post_mix'}] }
function assetRouteHint(asset) {
  const supports = currentCapability.value?.supports
  if (!supports) return '等待模型能力加载'
  if (asset.type === 'image') {
    const ordinal = chosenAssets.value.filter((item) => item.type === 'image').findIndex((item) => item.id === asset.id)
    return ordinal >= 0 && ordinal < nativeImageLimit.value ? '发送给模型：图片参考' : '不会发送：超出图片参考上限'
  }
  if (asset.type === 'video') return supports.video_reference ? '发送给模型：原生视频参考' : '生成前处理：提取关键帧参考'
  if (asset.type === 'audio') return supports.audio_reference && audioStrategy.value !== 'post_mix' ? '发送给模型：音频参考' : '生成后处理：成片混音'
  return '按当前模型能力处理'
}
function shotState(shot) { return ({ completed:'已完成',sd2_waiting:'真人素材认证中',processing:'生成中',upscale_pending:'等待超分',upscaling:'超分中',interpolation_pending:'等待插帧',interpolating:'插帧中',persisting:'持久化中',billing_reconciliation:'待对账',failed:'失败',retryable:'可重试',invalid:'无效',draft:'草稿' })[shot.status] || '草稿' }
function historyStatus(status) { return ({ completed: '已完成', sd2_waiting: '真人素材认证中', processing: '生成中', upscale_pending: '等待超分', upscaling: 'AI 超分中', interpolation_pending: '等待插帧', interpolating: '智能插帧中', persisting: '成片持久化中', billing_reconciliation: '等待计费对账', failed: '失败', retryable: '可重试', invalid: '无效' })[status] || '状态未知' }
function postprocessSummary(job) {
  if (job?.upscale_status === 'source_fallback' || job?.interpolation_status === 'source_fallback') {
    const resolution = job.output_resolution || job.resolution || '原始规格'
    const fps = Number(job.output_fps || 0)
    return `已采用原片 · ${resolution} · ${fps > 0 ? `${fps.toFixed(2).replace(/\.00$/, '')}fps` : '原帧率'}`
  }
  const resolutionText = job.output_resolution || job.upscale_resolution || job.resolution || ''
  const fps = Number(job.output_fps || 0)
  const fpsText = fps > 0 ? `${fps.toFixed(2).replace(/\.00$/, '')}fps` : (job.target_fps ? `${job.target_fps}fps` : '原帧率')
  const stageText = job.upscale_resolution || job.target_fps
    ? [job.upscale_resolution ? `超分 ${job.upscale_resolution}` : '', job.target_fps ? `插帧 ${job.target_fps}fps` : ''].filter(Boolean).join(' + ')
    : '保持原片'
  return `${stageText}${resolutionText ? ` · ${resolutionText}` : ''} · ${fpsText}`
}
function formatHistoryTime(value) { return formatChinaDateTime(value) }
function selectHistoryJob(job) { playOnSelection.value = true; selectedHistoryJobId.value = job.id }
function historyPoster(job) {
  const image = String(job?.poster_local_path || job?.generation?.poster_local_path || job?.image_url || job?.generation?.image_url || '')
  if (!image || image.startsWith('asset://')) return '/images/video-poster-placeholder.svg'
  return /^https?:\/\//.test(image) || image.startsWith('/static/') ? image : `/static/${image.replace(/^\/+/, '')}`
}
function containWorkbenchScroll(event) {
  if (!event.deltaY || !(event.target instanceof Element)) return
  // 提示词有两种实现：旧版 Element Plus textarea 和当前的
  // contenteditable 富文本编辑器。两者都必须优先吃掉自己的滚轮，
  // 不能误落到 shot-script 后被外层固定工作台取消。
  const promptEditor = event.target.closest('textarea.el-textarea__inner, .prompt-rich-editor')
  if (promptEditor) {
    if (promptEditor.scrollHeight <= promptEditor.clientHeight) {
      event.preventDefault()
      return
    }
    const atTop = promptEditor.scrollTop <= 0
    const atBottom = promptEditor.scrollTop + promptEditor.clientHeight >= promptEditor.scrollHeight - 1
    if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) event.preventDefault()
    return
  }
  const panel = event.target.closest('.shot-list, .creation-panel, .shot-script, .material-pool, .selected-assets, .frame-picker-grid')
  // The player area itself must never become a wheel-scrolling surface. This
  // also prevents a list at its boundary from chaining the page underneath it.
  if (!panel || panel.scrollHeight <= panel.clientHeight) {
    event.preventDefault()
    return
  }
  const atTop = panel.scrollTop <= 0
  const atBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1
  if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) event.preventDefault()
}
function sd2Status(asset) { return String(asset?.seedance2_asset?.status || 'none').toLowerCase() }
function sd2StatusLabel(asset) { return ({ none: '未认证', processing: '认证中', active: '可用', invalid: '已失效', failed: '认证失败' })[sd2Status(asset)] || '认证状态未知' }
function sd2ActionLabel(asset) {
  const status = sd2Status(asset)
  if (status === 'active') return '刷新状态'
  if (status === 'processing') return '刷新状态'
  if (status === 'invalid' || status === 'failed' || status === 'stale') return '重新认证'
  return '认证'
}
function localVideoUrl(video) {
  // A post-processing failure can still leave a valid original/upscaled file.
  // Prefer the final file, then the best retained source so storyboard cards
  // never hide a playable result merely because enhancement did not finish.
  const localPath = String(video?.local_path || video?.upscale_local_path || video?.source_local_path || '').replace(/^\/+/, '')
  if (!localPath) return video?.video_url || video?.upscale_video_url || video?.source_video_url || ''
  const version = video.updated_at || video.completed_at || video.id || ''
  return `/static/${localPath}${version ? `?v=${encodeURIComponent(version)}` : ''}`
}
function bestPlayableVideo(items) {
  const videos = items || []
  return videos.find((video) => video.status === 'completed' && !!localVideoUrl(video))
    || videos.find((video) => !!localVideoUrl(video))
    || null
}
function normalizeJob(data) { const generation = data.generation || {}; return { ...data, ...generation, omni_job_id: data.id, status: generation.status || data.status || 'processing', error_msg: generation.error_msg || data.error_msg, task_progress: generation.task_progress ?? data.task_progress ?? null, task_message: generation.task_message || data.task_message || null, task_updated_at: generation.task_updated_at || data.task_updated_at || null, videoUrl: localVideoUrl(generation) || data.video_url, local_path: generation.local_path || data.local_path, duration: generation.duration || data.duration } }
function legacyVideoHistoryItem(video) { return { ...video, id: `video-${video.id}`, omni_job_id: null, video_generation_id: video.id, status: video.status || 'completed', videoUrl: localVideoUrl(video), duration: video.duration } }
function promptDocumentFor(text, preferredAssetIds = []) {
  const value = String(text || '')
  const used = new Map()
  const preferred = preferredAssetIds.map(Number)
  const refs = [...value.matchAll(/@([^\s@]+)/g)].flatMap((match) => {
    const alias = match[1]
    const candidates = assets.value.filter((item) => assetLegacyAliases(item).includes(alias))
    const scoped = candidates.filter((item) => preferred.includes(Number(item.id)))
    const pool = scoped.length ? scoped : candidates
    const occurrence = used.get(alias) || 0
    used.set(alias, occurrence + 1)
    const asset = pool.length === 1 ? pool[0] : pool[occurrence] || null
    return asset ? [{ asset_id: asset.id, alias, occurrence, start: match.index, end: match.index + match[0].length }] : []
  })
  return { text: value, refs }
}
function projectShot(storyboard, video = null) {
  const { omni_asset_ids, omni_asset_usage, ...rest } = storyboard
  const ids = Array.isArray(omni_asset_ids) ? omni_asset_ids.map(Number).filter(Number.isFinite) : []
  const usage = omni_asset_usage || {}
  const firstFrameId = Number(storyboard.omni_first_frame_asset_id) || null
  const lastFrameId = Number(storyboard.omni_last_frame_asset_id) || null
  const assetIds = [...ids]
  if (firstFrameId && !assetIds.includes(firstFrameId)) assetIds.push(firstFrameId)
  if (lastFrameId && !assetIds.includes(lastFrameId)) assetIds.push(lastFrameId)
  return {
    ...rest,
    video_url: video ? localVideoUrl(video) : storyboard.video_url,
    poster_local_path: video?.poster_local_path || null,
    prompt: storyboard.universal_segment_text || storyboard.video_prompt || '',
    prompt_document: storyboard.omni_prompt_document || promptDocumentFor(storyboard.universal_segment_text || storyboard.video_prompt || '', assetIds),
    assets: assetIds.map((asset_id) => ({ asset_id, usage: asset_id === firstFrameId ? 'first_frame' : asset_id === lastFrameId ? 'last_frame' : usage[asset_id] || 'reference' })),
    settings: {
      model: storyboard.video_model === 'auto' ? '' : (storyboard.video_model || ''), creation_mode: storyboard.omni_creation_mode || 'multi_reference', asset_selection_policy: storyboard.omni_asset_send_policy || 'all_selected',
      aspect_ratio: storyboard.video_aspect_ratio || '16:9', duration: Number(storyboard.duration) || 5,
      resolution: storyboard.video_resolution || '720p', upscale_resolution: storyboard.video_upscale_resolution || null, target_fps: storyboard.video_target_fps || null, audio_strategy: storyboard.audio_strategy || 'reference_only',
      keep_original_audio: !!storyboard.keep_original_audio, audio_volume: storyboard.audio_volume ?? 1, audio_fade_seconds: storyboard.audio_fade_seconds ?? 0,
    },
  }
}

function applyGenerationContract(contract) {
  if (!contract) return
  masterShotId.value = contract.master_storyboard_id || contract.storyboards?.[0]?.id || null
  const modes = { ...generationModes.value }
  for (const item of contract.storyboards || []) {
    const shot = shots.value.find((candidate) => Number(candidate.id) === Number(item.id))
    modes[item.id] = item.mode || (Number(item.id) === Number(masterShotId.value) ? 'master' : 'inherited')
    if (shot && item.effective) shot.settings = {
      ...(shot.settings || {}), model: item.effective.video_model === 'auto' ? '' : item.effective.video_model,
      aspect_ratio: item.effective.aspect_ratio, duration: item.effective.duration, resolution: item.effective.resolution, upscale_resolution: item.effective.upscale_resolution || null, target_fps: item.effective.target_fps || null,
    }
  }
  generationModes.value = modes
}

async function restoreCurrentShotMaster() {
  if (!isProjectMode.value || !currentShot.value) return
  try {
    const result = await storyboardsAPI.clearGenerationSettingsOverrides(currentShot.value.id)
    applyGenerationContract(await storyboardsAPI.getEpisodeGenerationSettings(projectEpisodeId.value))
    loadShot(shots.value.find((shot) => Number(shot.id) === Number(result.id)) || currentShot.value)
    ElMessage.success('当前镜头已恢复跟随首镜')
  } catch (error) { ElMessage.error(error.message || '恢复首镜参数失败') }
}
function backToProject() {
  if (isProjectMode.value && projectDramaId.value) router.push({ path: `/film/${projectDramaId.value}`, query: projectEpisodeId.value ? { episode_id: projectEpisodeId.value } : {} })
  else router.push('/')
}
async function loadProjectVideos(storyboards) {
  const groups = await Promise.all((storyboards || []).map(async (storyboard) => {
    const result = await videosAPI.list({
      storyboard_id: storyboard.id,
      episode_id: projectEpisodeId.value,
      storyboard_number: storyboard.storyboard_number,
      page_size: 20,
    })
    return [Number(storyboard.id), bestPlayableVideo(result?.items)]
  }))
  return new Map(groups)
}
function applyProjectVideoSources(storyboards, videos) {
  shots.value = storyboards.map((storyboard) => projectShot(storyboard, videos.get(Number(storyboard.id))))
  jobs.value = jobs.value.map((job) => {
    const shot = shots.value.find((item) => Number(item.omni_job_id) === Number(job.id))
    const video = videos.get(Number(shot?.id))
    return video ? { ...job, videoUrl: localVideoUrl(video), generation: { ...(job.generation || {}), ...video } } : job
  })
}
async function refreshProjectShots(preferredId = activeShotId.value, { light = false } = {}) {
  const [result, generationContract] = await Promise.all([dramaAPI.getStoryboards(projectEpisodeId.value), storyboardsAPI.getEpisodeGenerationSettings(projectEpisodeId.value)])
  const storyboards = result?.storyboards || []
  if (light) {
    // 高频轮询(如外部 AI 生成分镜期间)跳过逐镜视频查询,沿用已加载的 video_url,
    // 只让新解析出的分镜实时出现在镜头列表中
    const prevVideoUrls = new Map(shots.value.map((shot) => [Number(shot.id), shot.video_url]))
    shots.value = storyboards.map((storyboard) => {
      const shot = projectShot(storyboard)
      return { ...shot, video_url: prevVideoUrls.get(Number(storyboard.id)) || shot.video_url }
    })
    applyGenerationContract(generationContract)
    const target = shots.value.find((shot) => Number(shot.id) === Number(preferredId)) || shots.value[0] || null
    if (target && Number(target.id) !== Number(activeShotId.value)) loadShot(target)
    else if (!target) activeShotId.value = null
    return
  }
  applyProjectVideoSources(storyboards, await loadProjectVideos(storyboards))
  applyGenerationContract(generationContract)
  const target = shots.value.find((shot) => Number(shot.id) === Number(preferredId)) || shots.value[0] || null
  if (target) loadShot(target)
  else activeShotId.value = null
}
async function ensureProjectResourceAssets(project, mediaItems) {
  const all = (mediaItems || []).filter((asset) => asset && Number.isFinite(Number(asset.id)))
  const groups = [
    ['character', project?.characters || []], ['scene', project?.scenes || []], ['prop', project?.props || []],
  ]
  for (const [kind, entries] of groups) {
    for (const entry of entries) {
      const localPath = entry?.local_path || null
      const url = entry?.image_url || null
      if (!localPath && !url) continue
      const exists = all.find((asset) => (localPath && asset.local_path === localPath) || (!localPath && url && asset.url === url))
      if (exists) continue
      try {
        // 必须经项目资源映射创建素材：映射记录会保留“已解除”状态，避免用户删除后
        // 页面重载又把同一角色/场景/道具图自动加回素材库。
        const asset = await omniVideoAPI.linkProjectResource({
          drama_id: projectDramaId.value, resource_type: kind, resource_id: entry.id,
        })
        if (asset) all.unshift(asset)
      } catch (_) {
        // 单个实体同步失败不阻塞其余素材和分镜工作台加载。
      }
    }
  }
  return all
}

async function loadAllAssets(params = {}) {
  const items = []
  let page = 1
  let total = Infinity
  while (items.length < total) {
    const result = await omniVideoAPI.assets({ ...params, page, page_size: 100 })
    const batch = (result?.items || []).filter((asset) => asset && Number.isFinite(Number(asset.id)))
    items.push(...batch)
    total = Number(result?.pagination?.total ?? items.length)
    if (!batch.length || page >= Number(result?.pagination?.total_pages || 1)) break
    page += 1
  }
  return { items }
}

async function loadProjectScopedAssets() {
  const [project, global] = await Promise.all([
    loadAllAssets({ scope: 'project', drama_id: projectDramaId.value, include_archived: 1 }),
    loadAllAssets({ scope: 'global', include_archived: 1 }),
  ])
  const byId = new Map()
  ;[...(project.items || []), ...(global.items || [])].forEach((item) => byId.set(Number(item.id), item))
  return { items: [...byId.values()] }
}
async function hideHistoryJob(job) {
  try {
    await ElMessageBox.confirm('隐藏后该版本不会再出现在本镜生成记录中；成片、积分账本和已采用的项目成片不会被删除。', '隐藏生成记录', { type: 'warning', confirmButtonText: '隐藏记录', cancelButtonText: '保留' })
    await omniVideoAPI.hide(job.id)
    shotHistory.value = shotHistory.value.filter((item) => String(item.id) !== String(job.id))
    jobs.value = jobs.value.filter((item) => String(item.id) !== String(job.id))
    if (String(selectedHistoryJobId.value) === String(job.id)) selectedHistoryJobId.value = shotHistory.value[0]?.id || null
    ElMessage.success('生成记录已隐藏')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close' && error?.action !== 'cancel' && error?.action !== 'close') ElMessage.error(error?.message || '隐藏生成记录失败')
  }
}

async function loadFreeScopedAssets() {
  // 已归档素材仍要加载，以便旧镜头可以继续显示自己的工作集；
  // “从素材库加入”面板会在 filteredProjectLibraryAssets 中将其排除。
  const global = await loadAllAssets({ scope: 'global', include_archived: 1 })
  if (assetScope.value !== 'project' || !freeProjectId.value) return global
  const project = await loadAllAssets({ scope: 'project', drama_id: freeProjectId.value, include_archived: 1 })
  return { items: [...(global.items || []), ...(project.items || [])] }
}

function loadShot(shot) { loadingShot.value = true; projectGenerationDirty.value = false; activeShotId.value = shot.id; selectedHistoryJobId.value = null; prompt.value = shot.prompt ?? ''; promptDocument.value = shot.prompt_document || promptDocumentFor(prompt.value); const settings = shot.settings || {}; model.value = settings.model === 'auto' ? '' : (settings.model || ''); creationMode.value = settings.creation_mode || 'multi_reference'; aspectRatio.value = settings.aspect_ratio || '16:9'; duration.value = normalizeDuration(settings.duration || 5); resolution.value = settings.resolution || '720p'; upscaleResolution.value = settings.upscale_resolution || null; targetFps.value = settings.target_fps || null; audioStrategy.value = settings.audio_strategy || 'reference_only'; keepOriginalAudio.value = !!settings.keep_original_audio; audioVolume.value = settings.audio_volume ?? 1; audioFadeSeconds.value = settings.audio_fade_seconds ?? 0; const materialIds = (shot.assets || []).map((item) => Number(item.asset_id)).filter((id) => assets.value.some((asset) => asset.id === id)); const firstFrameId = Number(shot.omni_first_frame_asset_id) || null; const lastFrameId = Number(shot.omni_last_frame_asset_id) || null; selectedOrder.value = [...new Set(materialIds)]; (shot.assets || []).forEach((saved) => { const asset = assets.value.find((item) => item.id === Number(saved.asset_id)); if (asset) asset.usage = Number(saved.asset_id) === firstFrameId ? 'first_frame' : Number(saved.asset_id) === lastFrameId ? 'last_frame' : saved.usage || asset.usage }); restorePromptDraftForShot(shot); setPromptReferences(promptDocument.value); loadShotHistory(shot); queueMicrotask(() => { loadingShot.value = false; projectGenerationDirty.value = false }) }
async function loadShotHistory(shot) {
  if (!shot?.id) return
  const shotId = Number(shot.id)
  try {
    const [result, videoResult] = await Promise.all([
      omniVideoAPI.list(isProjectMode.value ? { storyboard_id: shotId } : { shot_id: shotId }),
      isProjectMode.value ? videosAPI.list({ storyboard_id: shotId, episode_id: projectEpisodeId.value, storyboard_number: shot.storyboard_number, page_size: 100 }) : Promise.resolve({ items: [] }),
    ])
    if (Number(currentShot.value?.id) !== shotId) return
    const jobs = (result || []).map(normalizeJob)
    const playableVideo = bestPlayableVideo(videoResult?.items)
    if (playableVideo) {
      currentShot.value.video_url = localVideoUrl(playableVideo)
      currentShot.value.poster_local_path = playableVideo.poster_local_path || currentShot.value.poster_local_path || null
    }
    const jobGenerationIds = new Set(jobs.map((job) => Number(job.video_generation_id)))
    const legacy = (videoResult?.items || []).filter((video) => !jobGenerationIds.has(Number(video.id))).map(legacyVideoHistoryItem)
    shotHistory.value = [...jobs, ...legacy].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    jobs.filter((job) => activeGenerationStatuses.has(job.status)).forEach((job) => poll(job.id))
  } catch (error) { if (Number(currentShot.value?.id) === shotId) ElMessage.warning(error?.message || '生成记录加载失败，已保留当前列表，请稍后刷新') }
}
async function selectShot(shot) { if (shot.id === activeShotId.value) { playOnSelection.value = true; return }; await saveCurrentShot(false); playOnSelection.value = true; loadShot(shot) }
async function saveCurrentShot(showMessage = true) {
  if (!sequence.value || !currentShot.value || loadingShot.value) return
  clearTimeout(saveTimer)
  const savingShotId = currentShot.value.id
  const savingIdentity = currentPromptDraftIdentity(savingShotId)
  const savingRevision = promptRevision
  const settings = { model: model.value, creation_mode: creationMode.value, asset_selection_policy: 'prompt_references', aspect_ratio: aspectRatio.value, duration: normalizeDuration(duration.value), resolution: resolution.value || '720p', upscale_resolution: upscaleResolution.value || null, target_fps: targetFps.value || null, audio_strategy: audioStrategy.value, keep_original_audio: keepOriginalAudio.value, audio_volume: audioVolume.value, audio_fade_seconds: audioFadeSeconds.value }
  if (isProjectMode.value) {
    if (projectGenerationDirty.value) {
      const changed = await storyboardsAPI.updateGenerationSettings(currentShot.value.id, { scope: 'current', settings: { video_model: settings.model || 'auto', duration: settings.duration, resolution: settings.resolution, aspect_ratio: settings.aspect_ratio, upscale_resolution: settings.upscale_resolution, target_fps: settings.target_fps } })
      applyGenerationContract(changed.storyboards ? changed : await storyboardsAPI.getEpisodeGenerationSettings(projectEpisodeId.value))
      projectGenerationDirty.value = false
    }
    const ids = chosenAssets.value.map((asset) => Number(asset.id))
    const usage = Object.fromEntries(chosenAssets.value.map((asset) => [asset.id, asset.usage || 'reference']))
    const updated = await storyboardsAPI.update(currentShot.value.id, {
      expected_updated_at: currentShot.value.updated_at,
      universal_segment_text: prompt.value, omni_prompt_document: { ...promptDocument.value, text: prompt.value }, omni_asset_ids: ids, omni_asset_usage_json: usage,
      omni_creation_mode: settings.creation_mode, omni_asset_send_policy: settings.asset_selection_policy, audio_strategy: settings.audio_strategy,
      keep_original_audio: settings.keep_original_audio, audio_volume: settings.audio_volume, audio_fade_seconds: settings.audio_fade_seconds,
      omni_first_frame_asset_id: chosenAssets.value.find((asset) => asset.usage === 'first_frame')?.id || null,
      omni_last_frame_asset_id: chosenAssets.value.find((asset) => asset.usage === 'last_frame')?.id || null,
    })
    const preservedVideo = currentShot.value.video_url
    const preservedPoster = currentShot.value.poster_local_path
    Object.assign(currentShot.value, projectShot(updated), {
      video_url: preservedVideo || updated.video_url || '',
      poster_local_path: preservedPoster || updated.poster_local_path || null,
    })
    if (savingRevision === promptRevision && Number(currentShot.value?.id) === Number(savingShotId)) clearPromptDraft(localStorage, savingIdentity)
    if (showMessage) ElMessage.success('当前项目分镜已保存')
    return
  }
  const [updated, savedSequence] = await Promise.all([omniVideoAPI.updateShot(sequence.value.id, currentShot.value.id, { expected_updated_at: currentShot.value.updated_at, title: currentShot.value.title, prompt: prompt.value, prompt_document: { ...promptDocument.value, text: prompt.value }, assets: chosenAssets.value.map((asset, index) => ({ asset_id: asset.id, alias: assetDisplayName(asset), type: asset.type, usage: asset.usage, ordinal: index + 1 })), settings }), omniVideoAPI.updateSequence(sequence.value.id, { name: sequence.value.name })])
  Object.assign(currentShot.value, updated); sequence.value.name = savedSequence.name; if (showMessage) ElMessage.success('整集与当前镜头已保存')
  if (savingRevision === promptRevision && Number(currentShot.value?.id) === Number(savingShotId)) clearPromptDraft(localStorage, savingIdentity)
}
let autoSaveErrorShown = false
function scheduleSave() { if (loadingShot.value || !currentShot.value) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => saveCurrentShot(false).then(() => { autoSaveErrorShown = false }).catch((error) => { if (!autoSaveErrorShown) { autoSaveErrorShown = true; ElMessage.error(error?.message || '自动保存失败，草稿仍保留在当前页面，请重试保存') } }), 650) }
async function addShot(afterCurrent) {
  await saveCurrentShot(false)
  if (isProjectMode.value) {
    const index = afterCurrent ? activeShotIndex.value + 1 : shots.value.length
    const number = index + 1
    const shot = await storyboardsAPI.create({ episode_id: projectEpisodeId.value, storyboard_number: number, title: `镜头 ${number}`, description: '' })
    const newShot = projectShot(shot)
    const list = [...shots.value]
    list.splice(index, 0, newShot)
    // 新镜头创建完成后先切换到服务端返回的空工作集。不能在排序、视频列表等
    // 后续请求完成前继续沿用上一镜的 selected 状态，否则素材库会错误显示“已加入本镜”。
    shots.value = list
    loadShot(newShot)
    await persistShotOrder(list)
    await refreshProjectShots(shot.id)
    emit('changed')
    return
  }
  const shot = await omniVideoAPI.addShot(sequence.value.id, afterCurrent ? { after_shot_id: activeShotId.value } : {})
  const refreshed = await omniVideoAPI.getSequence(sequence.value.id)
  sequence.value = refreshed
  shots.value = refreshed.shots
  loadShot(shots.value.find((item) => item.id === shot.id) || shots.value.at(-1))
}
async function copyCurrentShot() { if (!currentShot.value) return; const draft = { prompt: prompt.value, promptDocument: structuredClone(promptDocument.value || { text: prompt.value, refs: [] }), settings: { model: model.value, creationMode: creationMode.value, aspectRatio: aspectRatio.value, duration: duration.value, resolution: resolution.value, upscaleResolution: upscaleResolution.value, targetFps: targetFps.value, audioStrategy: audioStrategy.value, keepOriginalAudio: keepOriginalAudio.value, audioVolume: audioVolume.value, audioFadeSeconds: audioFadeSeconds.value }, selectedOrder: [...selectedOrder.value], assets: chosenAssets.value.map((asset) => ({ id: asset.id, usage: asset.usage })) }; try { await addShot(true); prompt.value = draft.prompt; promptDocument.value = draft.promptDocument; model.value = draft.settings.model; creationMode.value = draft.settings.creationMode; aspectRatio.value = draft.settings.aspectRatio; duration.value = draft.settings.duration; resolution.value = draft.settings.resolution; upscaleResolution.value = draft.settings.upscaleResolution || null; targetFps.value = draft.settings.targetFps || null; audioStrategy.value = draft.settings.audioStrategy; keepOriginalAudio.value = draft.settings.keepOriginalAudio; audioVolume.value = draft.settings.audioVolume; audioFadeSeconds.value = draft.settings.audioFadeSeconds; selectedOrder.value = draft.selectedOrder.filter((id) => assets.value.some((asset) => asset.id === id)); setPromptReferences(promptDocument.value); for (const saved of draft.assets) { const asset = assets.value.find((item) => item.id === saved.id); if (asset) asset.usage = saved.usage || asset.usage } await saveCurrentShot(false); ElMessage.success('已复制为当前镜头后的新镜头') } catch (error) { ElMessage.error(error.message || '复制镜头失败') } }
async function renameShot(shot) { const previous = shot?.title; try { const { value } = await ElMessageBox.prompt('输入镜头名称', '重命名镜头', { inputValue: previous || '' }); const title = value || '未命名镜头'; if (isProjectMode.value) { Object.assign(shot, projectShot(await storyboardsAPI.update(shot.id, { title, expected_updated_at: shot.updated_at }))); emit('changed'); return } if (shot.id === activeShotId.value) { shot.title = title; await saveCurrentShot(false) } else Object.assign(shot, await omniVideoAPI.updateShot(sequence.value.id, shot.id, { title, expected_updated_at: shot.updated_at })) } catch (error) { if (shot) shot.title = previous; if (error !== 'cancel' && error !== 'close') ElMessage.error(error?.message || '重命名镜头失败') } }
async function removeShot(shot) {
  try {
    await ElMessageBox.confirm(`删除“${shot.title || '未命名镜头'}”？此操作不会删除素材。`, '删除镜头', { type: 'warning', confirmButtonText: '删除镜头', cancelButtonText: '保留' })
    if (isProjectMode.value) {
      const previousIndex = shots.value.findIndex((item) => item.id === shot.id)
      await storyboardsAPI.delete(shot.id)
      const next = shots.value.filter((item) => item.id !== shot.id)
      shots.value = next
      await refreshProjectShots(next[Math.min(previousIndex, next.length - 1)]?.id)
      emit('changed')
      ElMessage.success('镜头已删除')
      return
    }
    await omniVideoAPI.deleteShot(sequence.value.id, shot.id)
    shots.value = shots.value.filter((item) => item.id !== shot.id)
    if (shot.id === activeShotId.value) loadShot(shots.value[Math.min(activeShotIndex.value, shots.value.length - 1)])
    ElMessage.success('镜头已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close' && error?.action !== 'cancel' && error?.action !== 'close') ElMessage.error(error?.message || '删除镜头失败')
  }
}
async function persistShotOrder(list) { const previous = shots.value; shots.value = list; try { const result = isProjectMode.value ? await storyboardsAPI.reorder({ episode_id: projectEpisodeId.value, ids: list.map((shot) => shot.id) }) : await omniVideoAPI.reorderShots(sequence.value.id, list.map((shot) => shot.id)); shots.value = isProjectMode.value ? (result?.storyboards || []).map((item) => { const remote = projectShot(item); const local = list.find((shot) => Number(shot.id) === Number(remote.id)); if (!local) return remote; const localAssets = new Map((local.assets || []).map((asset) => [Number(asset.asset_id), asset])); return { ...remote, prompt: local.prompt, prompt_document: local.prompt_document, settings: local.settings, assets: remote.assets.map((asset) => ({ ...asset, ...localAssets.get(Number(asset.asset_id)) })) } }) : result; if (isProjectMode.value) emit('reordered') } catch (error) { shots.value = previous; ElMessage.error(error.message || '镜头排序保存失败') } }
async function dropShot(targetId) { if (!draggedShotId.value || draggedShotId.value === targetId) return; const list = [...shots.value]; const from = list.findIndex((shot) => shot.id === draggedShotId.value), to = list.findIndex((shot) => shot.id === targetId); const [moved] = list.splice(from, 1); list.splice(to, 0, moved); draggedShotId.value = null; await persistShotOrder(list) }
async function moveShot(index, offset) { const target = index + offset; if (target < 0 || target >= shots.value.length) return; const list = [...shots.value]; [list[index], list[target]] = [list[target], list[index]]; await persistShotOrder(list) }
function selectRelative(offset) { const target = shots.value[activeShotIndex.value + offset]; if (target) selectShot(target) }
function onShotListWheel(event) {
  if (!event.deltaY || wheelShotLocked || shots.value.length < 2) return
  if (event.target instanceof Element && event.target.closest('button, input, textarea, select, .el-select')) return
  const targetIndex = Math.max(0, Math.min(shots.value.length - 1, activeShotIndex.value + (event.deltaY > 0 ? 1 : -1)))
  const target = shots.value[targetIndex]
  if (!target || target.id === activeShotId.value) return
  wheelShotLocked = true
  selectShot(target).finally(() => {
    nextTick(() => shotListRef.value?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }))
    clearTimeout(wheelShotTimer)
    wheelShotTimer = setTimeout(() => { wheelShotLocked = false }, 320)
  })
}

function addShotMaterial(asset) {
  if (selectedOrder.value.includes(asset.id)) return true
  const typeCount = selectionCounts.value[asset.type] || 0
  if (chosenAssets.value.length >= shotLimits.value.total || typeCount >= shotLimits.value[asset.type]) {
    ElMessage.warning(`当前镜头最多选择 ${shotLimits.value[asset.type]} 个${typeName(asset.type)}，总数最多 ${shotLimits.value.total} 个`)
    return false
  }
  selectedOrder.value = [...selectedOrder.value, asset.id]
  asset.usage ||= asset.type === 'image' ? 'reference' : asset.type === 'video' ? 'motion' : 'ambience'
  return true
}
function toggle(asset) {
  const next = new Set(selected.value)
  if (next.has(asset.id)) {
    remove(asset.id)
    return
  }
  if (!addShotMaterial(asset)) return
  next.add(asset.id)
  selected.value = next
  scheduleSave()
}
function toggleProjectLibraryAsset(asset) {
  if (selectedOrder.value.includes(asset.id)) { remove(asset.id); return }
  if (addShotMaterial(asset)) scheduleSave()
}
function onMaterialCardClick(asset) { if (!shouldSuppressAssetClick()) promptEditorRef.value?.insertAtCaret(asset) }
function remove(id) {
  const asset = assets.value.find((item) => Number(item.id) === Number(id))
  const aliases = (promptDocument.value?.refs || [])
    .filter((ref) => Number(ref.asset_id) === Number(id))
    .map((ref) => String(ref.alias || '').trim())
    .filter(Boolean)
  // 当前镜头的“移出”是一个完整的镜头级动作：素材卡消失的同时，
  // 本镜提示词中的对应 @ 引用也必须消失；其他镜头不会被改写。
  const names = [...new Set([...aliases, asset?.alias, asset?.name].filter(Boolean).map((name) => String(name).trim()))]
  let nextPrompt = prompt.value || ''
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    nextPrompt = nextPrompt.replace(new RegExp(`@${escaped}(?=$|\\s)`, 'g'), '')
  }
  prompt.value = nextPrompt.replace(/[ \t]{2,}/g, ' ')
  promptDocument.value = {
    ...(promptDocument.value || {}),
    text: prompt.value,
    refs: (promptDocument.value?.refs || []).filter((ref) => Number(ref.asset_id) !== Number(id)),
  }
  const next = new Set(selected.value)
  next.delete(id)
  selected.value = next
  selectedOrder.value = selectedOrder.value.filter((item) => Number(item) !== Number(id))
  scheduleSave()
}
function clearSelectedAssets() { selected.value = new Set(); selectedOrder.value = []; scheduleSave(); ElMessage.success('已清空本镜素材；历史生成记录保持不变') }
function dropSelectedAsset(targetId) { if (!draggedAssetId.value || draggedAssetId.value === targetId) return; const order = [...selectedOrder.value], from = order.indexOf(draggedAssetId.value), to = order.indexOf(targetId); const [moved] = order.splice(from, 1); order.splice(to, 0, moved); selectedOrder.value = order; draggedAssetId.value = null; scheduleSave() }
function onPickFromEditor(asset) {
  const source = assets.value.find((item) => Number(item.id) === Number(asset?.id))
  if (source && !selected.value.has(source.id)) toggle(source)
}
function setPromptReferences(value) {
  promptDocument.value = value || { text: prompt.value, refs: [] }
  // 勾选只代表提示词中的 @ 引用；本镜已加入素材由 selectedOrder 独立保存。
  const referencedIds = (promptDocument.value.refs || [])
    .map((entry) => Number(entry.asset_id))
    .filter((id) => assets.value.some((asset) => Number(asset.id) === id))
  selected.value = new Set(referencedIds)
}
function showCertificationError(error) { ElMessage.error(error?.message || 'SD2 认证失败，请检查资产库配置后重试') }
async function refreshCertificationUntilSettled(asset) {
  for (let attempt = 0; attempt < 30 && sd2Status(asset) === 'processing'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const out = await omniVideoAPI.refreshAssetCertification(asset.id)
    if (out?.seedance2_asset) asset.seedance2_asset = out.seedance2_asset
  }
}
async function setRealPerson(asset, value) {
  asset.requires_sd2_identity = !!value
  try {
    const updated = await omniVideoAPI.updateAsset(asset.id, { requires_sd2_identity: !!value })
    Object.assign(asset, updated)
    if (value && asset.type === 'image') {
      const out = await omniVideoAPI.certifyAsset(asset.id)
      if (out?.seedance2_asset) asset.seedance2_asset = out.seedance2_asset
      if (sd2Status(asset) === 'processing') void refreshCertificationUntilSettled(asset).catch(showCertificationError)
    }
  } catch (error) {
    asset.requires_sd2_identity = !value
    ElMessage.error(error.message || '真人声明保存或认证失败')
  }
}
function onUsageChange(asset) { void asset; scheduleSave() }
/** 首尾帧占位选择器：当前目标位置已选的素材（用于对话框高亮） */
const framePickerValue = computed(() => framePicker.value.target === 'first_frame' ? firstFrameAsset.value : lastFrameAsset.value)
function openFramePicker(target) { framePicker.value = { open: true, target } }
function confirmFrame(asset) {
  const target = framePicker.value.target
  // 若该图片尚未加入当前镜头，先加入素材池
  if (!selected.value.has(asset.id)) toggle(asset)
  // 腾出目标位置：把原来占该位置的图改回普通参考
  const occupant = target === 'first_frame' ? firstFrameAsset.value : lastFrameAsset.value
  if (occupant && occupant.id !== asset.id) occupant.usage = 'reference'
  // 如果该图原本占着另一个帧位置，清空那一边（避免一张图既是首帧又是尾帧）
  if (asset.usage === 'first_frame' || asset.usage === 'last_frame') asset.usage = 'reference'
  asset.usage = target
  framePicker.value.open = false
  scheduleSave()
}
function clearFrame(target) {
  const occupant = target === 'first_frame' ? firstFrameAsset.value : lastFrameAsset.value
  if (occupant) { occupant.usage = 'reference'; scheduleSave() }
}
function pickFiles() { fileInput.value?.click() }
function dropFiles(event) { upload(event.dataTransfer.files) }
function uploadFiles(event) { upload(event.target.files); event.target.value = '' }
async function upload(files) { for (const file of Array.from(files || [])) { try { const targetDramaId = isProjectMode.value ? projectDramaId.value : (assetScope.value === 'project' ? activeProjectAssetId.value : null); const out = await omniVideoAPI.upload(file, { name: file.name, drama_id: targetDramaId || undefined }); if (out.asset) { const item = { ...out.asset, usage: out.asset.type === 'image' ? 'reference' : out.asset.type === 'video' ? 'motion' : 'ambience' }; assets.value.unshift(item); if (addShotMaterial(item)) scheduleSave() } } catch (error) { ElMessage.error(`${file.name}：${error.message || '上传失败'}`) } } }
async function certify(asset) {
  if (!asset || asset.type !== 'image' || certifyingId.value === asset.id) return
  certifyingId.value = asset.id
  try {
    const status = sd2Status(asset)
    const out = ['processing', 'active'].includes(status)
      ? await omniVideoAPI.refreshAssetCertification(asset.id)
      : await omniVideoAPI.certifyAsset(asset.id)
    if (out?.seedance2_asset) asset.seedance2_asset = out.seedance2_asset
    if (sd2Status(asset) === 'processing') void refreshCertificationUntilSettled(asset).catch(showCertificationError)
    ElMessage.success(`「${assetDisplayName(asset)}」SD2 认证状态：${sd2StatusLabel(asset)}`)
  } catch (error) {
    showCertificationError(error)
  } finally {
    certifyingId.value = null
  }
}

function notifyBalanceChanged() { window.dispatchEvent(new CustomEvent('lmd:balance-changed')) }
function replacePolledJob(id, job) { const index = jobs.value.findIndex((item) => String(item.id) === String(id)); const historyIndex = shotHistory.value.findIndex((item) => String(item.id) === String(id)); if (index >= 0) jobs.value[index] = job; if (historyIndex >= 0) shotHistory.value[historyIndex] = job }
async function refreshUnknownJob(job) { try { const next = normalizeJob(await omniVideoAPI.get(job.id)); replacePolledJob(job.id, next); if (String(currentShot.value?.omni_job_id) === String(job.id)) currentShot.value.status = next.status; if (activeGenerationStatuses.has(next.status)) poll(next.id); else notifyBalanceChanged() } catch (error) { ElMessage.error(error.message || '状态刷新失败，请稍后重试') } }
async function create() { creating.value = true; stagePhase.value = '保存镜头'; try { if (!canCreate.value) throw new Error(isProjectMode.value ? '请补齐当前视频创作模式所需的素材与模型能力' : '请选择计费归属项目并补齐生成参数'); if (!requestAssets.value.length) throw new Error('请先在提示词中插入至少一个 @ 素材'); await saveCurrentShot(false); stagePhase.value = '提交生成任务'; const res = await omniVideoAPI.create({ ...(isProjectMode.value ? { drama_id: projectDramaId.value, storyboard_id: currentShot.value.id } : { sequence_id: sequence.value.id, shot_id: currentShot.value.id, drama_id: Number(freeProjectId.value) }), prompt: prompt.value, prompt_document: promptDocument.value, asset_selection_policy: 'prompt_references', creation_mode: creationMode.value, model: model.value, aspect_ratio: aspectRatio.value, duration: normalizeDuration(duration.value), resolution: resolution.value || '720p', upscale_resolution: upscaleResolution.value || null, target_fps: targetFps.value || null, audio_strategy: audioStrategy.value, keep_original_audio: keepOriginalAudio.value, audio_volume: audioVolume.value, audio_fade_seconds: audioFadeSeconds.value, assets: requestAssets.value.map((asset, index) => ({ asset_id: asset.id, alias: promptAssetFor(asset).alias, usage: asset.usage, role: asset.usage === 'primary' ? 'primary' : 'reference', ordinal: index + 1 })) }); const status = res.status || 'processing'; const job = { id: res.omni_job_id, prompt: prompt.value, status, video_generation_id: res.video_generation_id, storyboard_id: isProjectMode.value ? currentShot.value.id : null, shot_id: isProjectMode.value ? null : currentShot.value.id, created_at: new Date().toISOString() }; jobs.value.unshift(job); shotHistory.value.unshift(job); selectedHistoryJobId.value = job.id; currentShot.value.omni_job_id = job.id; currentShot.value.status = status; notifyBalanceChanged(); stagePhase.value = status === 'sd2_waiting' ? '真人素材认证准备中，完成后自动生成' : '正在生成'; poll(job.id) } catch (error) { ElMessage.error(error.message || '任务提交失败') } finally { creating.value = false } }
async function poll(id) {
  if (!id || pollingJobIds.has(String(id))) return
  pollingJobIds.add(String(id))
  let failures = 0
  try {
    for (let n = 0; n < 450; n++) {
      // Provider state is persisted and the server continues its own polling.
      // Do not keep a hidden browser tab issuing redundant status requests.
      await waitForVisiblePolling()
      if (pollLifecycleStopped) return
      await new Promise((resolve) => setTimeout(resolve, 4000))
      try {
        const data = await omniVideoAPI.get(id)
        const job = normalizeJob(data)
        failures = 0
        replacePolledJob(id, job)
        if (String(currentShot.value?.omni_job_id) === String(id)) {
          currentShot.value.status = job.status
          currentShot.value.video_url = job.videoUrl
          currentShot.value.generation_error = job.error_msg
        }
        if (!activeGenerationStatuses.has(job.status)) { notifyBalanceChanged(); return }
      } catch (_) {
        failures += 1
        const existing = jobs.value.find((item) => String(item.id) === String(id)) || shotHistory.value.find((item) => String(item.id) === String(id)) || { id }
        const retrying = failures >= 5 ? { ...existing, status: 'unknown', task_message: '状态连接暂不可用，请手动刷新状态', task_progress: null } : { ...existing, task_message: `状态连接暂不可用，正在重试（${failures}/5）`, task_progress: null }
        replacePolledJob(id, retrying)
        if (failures >= 5) return
      }
    }
    // 轮询达到上限(约30分钟)仍未终态: 置 unknown 露出手动刷新, 避免永久卡"生成中"
    const timedOut = jobs.value.find((item) => String(item.id) === String(id)) || shotHistory.value.find((item) => String(item.id) === String(id))
    if (timedOut && activeGenerationStatuses.has(timedOut.status)) {
      replacePolledJob(id, { ...timedOut, status: 'unknown', task_message: '任务长时间未返回结果，已停止自动刷新，请手动刷新状态', task_progress: null })
      if (String(currentShot.value?.omni_job_id) === String(id)) currentShot.value.status = 'unknown'
    }
  } finally { pollingJobIds.delete(String(id)) }
}
async function retry(job) { try { const res = await omniVideoAPI.retry(job.id); const next = { id: res.omni_job_id, prompt: job.prompt, status: 'processing', video_generation_id: res.video_generation_id, storyboard_id: isProjectMode.value ? currentShot.value?.id : null, shot_id: isProjectMode.value ? null : currentShot.value?.id, created_at: new Date().toISOString() }; jobs.value.unshift(next); shotHistory.value.unshift(next); selectedHistoryJobId.value = next.id; currentShot.value.omni_job_id = next.id; currentShot.value.status = 'processing'; poll(next.id) } catch (error) { ElMessage.error(error?.message || '重试提交失败，请稍后重试') } }
function downloadCurrentVideo() { if (!activeVideoUrl.value) return; const link = document.createElement('a'); link.href = activeVideoUrl.value; link.download = `local-mini-drama-${activeJob.value?.video_generation_id || currentShot.value?.id || 'storyboard'}.mp4`; document.body.appendChild(link); link.click(); link.remove() }
async function saveResultAsAsset() { const job = activeJob.value; if (!job?.videoUrl || savedResultJobId.value === job.id) return; try { const generation = job.generation || job; const asset = await omniVideoAPI.createAsset({ drama_id: (isProjectMode.value ? projectDramaId.value : freeProjectId.value) || null, name: `成片 ${job.video_generation_id || job.id}`, type: 'video', url: generation.video_url || job.video_url || job.videoUrl, local_path: generation.local_path || job.local_path || null, source_type: 'omni_generation', video_gen_id: job.video_generation_id || null, processing_status: 'ready', metadata: { source_omni_job_id: job.id, source_video_generation_id: job.video_generation_id || null, resolution: generation.output_resolution || generation.resolution || null, fps: generation.output_fps || null, duration_ms: generation.output_duration_ms || null, upscale_resolution: generation.upscale_resolution || null, target_fps: generation.target_fps || null, postprocess_chain: generation.postprocess_chain || null } }); const item = { ...asset, alias: asset.name, usage: 'motion' }; assets.value.unshift(item); savedResultJobId.value = job.id; toggle(item); ElMessage.success('成片已加入素材库，并已选入当前镜头') } catch (error) { ElMessage.error(error.message || '加入素材库失败') } }
async function extractFrame(position) { if (!canExtractFrames.value || extractingPosition.value) return; extractingPosition.value = position; try { const asset = await omniVideoAPI.extractVideoFrame(activeJob.value.video_generation_id, position); const item = { ...asset, alias: asset.name, usage: position === 'first' ? 'first_frame' : 'last_frame' }; assets.value.unshift(item); toggle(item); ElMessage.success(position === 'first' ? '首帧已提取到素材库，并设为当前镜头首帧' : '尾帧已提取到素材库，并设为当前镜头尾帧') } catch (error) { ElMessage.error(error.message || '提取视频帧失败') } finally { extractingPosition.value = '' } }

watch(prompt, () => { persistCurrentPromptDraft(); scheduleSave() })
watch([model, aspectRatio, duration, resolution, upscaleResolution, targetFps], () => { if (isProjectMode.value && !loadingShot.value) projectGenerationDirty.value = true; persistCurrentPromptDraft(); scheduleSave() })
watch([creationMode, audioStrategy, keepOriginalAudio, audioVolume, audioFadeSeconds], () => { persistCurrentPromptDraft(); scheduleSave() })
watch(chosenAssets, () => { persistCurrentPromptDraft(); scheduleSave() }, { deep: true })
watch([assetScope, freeProjectId], async () => {
  if (isProjectMode.value) return
  try {
    const media = await loadFreeScopedAssets()
    assets.value = (media.items || []).filter((item) => item && Number.isFinite(Number(item.id))).map((item) => ({ ...item, usage: item.type === 'image' ? 'reference' : item.type === 'video' ? 'motion' : 'ambience' }))
    const available = new Set(assets.value.map((item) => Number(item.id)))
    selectedOrder.value = selectedOrder.value.filter((id) => available.has(Number(id)))
    selected.value = new Set([...selected.value].filter((id) => available.has(Number(id))))
  } catch (error) { ElMessage.error(error?.message || '素材来源加载失败') }
})
function flushPromptBeforePageHide() { persistCurrentPromptDraft(); saveCurrentShot(false).catch((error) => console.warn('[FreeCreate] page-hide save failed:', error?.message)) }
function onPromptVisibilityChange() { if (document.visibilityState === 'hidden') flushPromptBeforePageHide() }
onBeforeUnmount(() => { pollLifecycleStopped = true; pendingPollVisibilityResumes.forEach((resume) => resume()); clearTimeout(saveTimer); clearTimeout(wheelShotTimer); window.clearTimeout(mediaLayerTransitionTimer); window.clearInterval(generationClockTimer); window.removeEventListener('pagehide', flushPromptBeforePageHide); document.removeEventListener('visibilitychange', onPromptVisibilityChange); flushPromptBeforePageHide() })
onMounted(async () => {
  pollLifecycleStopped = false
  generationClockTimer = window.setInterval(() => { generationClock.value = Date.now() }, 60_000)
  window.addEventListener('pagehide', flushPromptBeforePageHide)
  document.addEventListener('visibilitychange', onPromptVisibilityChange)
  try {
    if (isProjectMode.value) {
      const [media, caps, history, limits, boards, project, generationContract] = await Promise.all([loadProjectScopedAssets(), omniVideoAPI.capabilities(), omniVideoAPI.list(), omniVideoAPI.uploadLimits(), dramaAPI.getStoryboards(projectEpisodeId.value), dramaAPI.get(projectDramaId.value), storyboardsAPI.getEpisodeGenerationSettings(projectEpisodeId.value)])
      const allAssets = await ensureProjectResourceAssets(project, media.items || [])
      assets.value = allAssets.filter(Boolean).map((item) => ({ ...item, usage: item.type === 'image' ? 'reference' : item.type === 'video' ? 'motion' : 'ambience' }))
      capabilities.value = caps || []; uploadLimits.value = limits || null; jobs.value = (history || []).map(normalizeJob); jobs.value.filter((job) => activeGenerationStatuses.has(job.status)).forEach((job) => poll(job.id))
      sequence.value = { id: projectEpisodeId.value, name: `项目剧集 ${projectEpisodeId.value}` }
      const projectStoryboards = boards?.storyboards || []
      applyProjectVideoSources(projectStoryboards, await loadProjectVideos(projectStoryboards))
      applyGenerationContract(generationContract)
      if (shots.value[0]) loadShot(shots.value[0])
      return
    }
    const baseRequests = [loadFreeScopedAssets(), omniVideoAPI.capabilities(), omniVideoAPI.list(), omniVideoAPI.uploadLimits(), dramaAPI.list({ page_size: 100 })]
    const sequenceRequest = route.query.sequence_id ? omniVideoAPI.getSequence(route.query.sequence_id) : omniVideoAPI.defaultSequence()
    const [media, caps, history, limits, projectResult, seq] = await Promise.all([...baseRequests, sequenceRequest])
    assets.value = (media.items || []).filter((item) => item && Number.isFinite(Number(item.id))).map((item) => ({ ...item, usage: item.type === 'image' ? 'reference' : item.type === 'video' ? 'motion' : 'ambience' }))
    projects.value = projectResult?.items || projectResult || []; capabilities.value = caps || []; uploadLimits.value = limits || null; jobs.value = (history || []).map(normalizeJob); jobs.value.filter((job) => activeGenerationStatuses.has(job.status)).forEach((job) => poll(job.id)); sequence.value = seq; if (Number(seq?.drama_id)) freeProjectId.value = Number(seq.drama_id); shots.value = seq.shots || []; if (shots.value[0]) loadShot(shots.value[0])
  } catch (error) { ElMessage.error(error.message || '全能创作工作台加载失败') }
})
onMounted(() => {
  // 媒体库的“用选中素材创作”会传递 assets=1,2,3；旧实现只识别单个
  // asset_id，导致批量带入这一条 P0 主链路表面可见但实际失效。
  const importedIds = [...new Set([
    Number(route.query.asset_id),
    ...String(route.query.assets || '').split(',').map((id) => Number(id)),
  ].filter((id) => Number.isInteger(id) && id > 0))]
  if (!importedIds.length) return
  const stop = watch(assets, (items) => {
    const imported = importedIds.map((id) => items.find((item) => Number(item.id) === id)).filter(Boolean)
    if (!imported.length) return
    let added = 0
    for (const asset of imported) {
      if (selected.value.has(asset.id)) continue
      const before = selected.value.size
      toggle(asset)
      if (selected.value.size > before) added++
    }
    if (added) ElMessage.success(`已将 ${added} 个素材带入当前镜头`)
    stop()
  }, { deep: true })
})

// 供宿主页(FilmCreate)在 AI 生成分镜等外部流程中实时刷新镜头列表:
// light 模式仅重拉分镜与生成合同,不触发逐镜视频查询
defineExpose({ refreshProjectShots })
</script>

<style scoped>
.omni-page{height:100vh;overflow:hidden;background:#171d2d;color:#e7ebf5}.topbar{height:54px;box-sizing:border-box;padding:0 14px;display:flex;align-items:center;justify-content:space-between;background:#20273a;border-bottom:1px solid #323a50}.topbar-left,.topbar-actions{display:flex;align-items:center;gap:8px}.divider{height:26px;width:1px;background:#4a5266}.sequence-name{width:180px}.workbench{height:calc(100vh - 54px);display:grid;grid-template-columns:320px minmax(560px,1fr) 355px}.panel{min-width:0;background:#20273a;border-right:1px solid #333b50;padding:12px;box-sizing:border-box}.shot-panel{display:flex;flex-direction:column}.shot-heading{display:flex;justify-content:space-between;align-items:end}.shot-heading b{font-size:18px}.shot-heading small{color:#8993aa}.shot-actions{display:flex;gap:6px;margin:12px 0}.shot-actions .el-button{flex:1;margin:0}.shot-list{overflow:auto;display:grid;gap:9px;padding-right:3px}.shot-card{border:1px solid #30394e;border-radius:9px;padding:7px;background:#252d42;cursor:pointer}.shot-card.active{border-color:#6c8cff;box-shadow:0 0 0 1px #6c8cff}.shot-card.dragging{opacity:.5}.shot-title{height:28px;display:flex;align-items:center;gap:6px}.shot-title b{flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.drag-handle{cursor:grab;color:#7c879e}.shot-number{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#f2f4fa;color:#273148;font-weight:700}.shot-preview{position:relative;height:128px;border-radius:7px;overflow:hidden;background:#090d16}.shot-preview img,.shot-preview video{width:100%;height:100%;object-fit:cover}.shot-preview>span{position:absolute;right:7px;bottom:5px;font-size:12px}.shot-empty{height:100%;display:grid;place-items:center;font-size:34px;color:#55617a}.shot-state{margin-top:5px;font-size:11px;color:#919bb0}.shot-state i{display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:50%;background:#7f899d}.shot-state.processing i{background:#e7a83b}.shot-state.completed i{background:#3dbb83}.shot-state.failed i,.shot-state.retryable i{background:#ee6d78}.center-stage{min-width:0;display:flex;flex-direction:column;background:#111621}.player-tools{height:44px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid #2f374a}.player-tools>span{flex:1}.video-stage{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#05070c;overflow:hidden}.main-video{width:100%;height:100%;object-fit:contain}.selected-mosaic{position:absolute;inset:8%;display:flex;justify-content:center;align-items:center;gap:8px;opacity:.44}.selected-mosaic img{width:17%;max-height:55%;object-fit:cover;border-radius:8px}.empty-play,.render-play{z-index:2;display:grid;place-items:center;width:76px;height:76px;border-radius:50%;background:#747b8bcc;font-size:27px}.video-stage b,.video-stage small,.video-stage .el-button{z-index:2}.stage-warning{z-index:2;font-size:48px;color:#ec6974}.render-ring{position:absolute;border:1px solid #6685f266;border-radius:50%}.ring-one{width:230px;height:230px;animation:spin 8s linear infinite}.ring-two{width:360px;height:360px;animation:spin 14s linear infinite reverse}.time-ruler{height:46px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;padding:0 16px;font-size:12px;color:#adb6c9;background:#171d2b}.time-ruler div{height:5px;background:#3a4256;border-radius:5px;overflow:hidden}.time-ruler i{display:block;height:100%;background:#6d8bff}.shot-tabs{height:42px;display:flex;align-items:center;gap:26px;padding:0 18px;background:#20273a;border-bottom:1px solid #343c50;font-size:13px;color:#96a0b5}.shot-tabs .active{color:#fff}.shot-script{padding:10px 16px 14px;background:#20273a}.creation-panel{border-left:1px solid #333b50;border-right:0;overflow:auto}.panel-title,.materials-title{display:flex;justify-content:space-between;align-items:center}.parameters{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.parameters label{font-size:11px;color:#9ca7bc}.parameters .el-select{display:block;margin-top:5px}.materials-title{margin:13px 0 7px}.dropzone{height:46px;border:1px dashed #61708d;border-radius:7px;display:flex;align-items:center;justify-content:center;gap:7px;color:#9da8bd;cursor:pointer}.material-pool{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-height:150px;overflow:auto;margin:8px 0 12px}.material-card{position:relative;height:72px;border:1px solid #39435a;border-radius:6px;overflow:hidden;background:#161c2b;cursor:pointer}.material-card.selected{border-color:#6d8bff}.material-card img,.material-card video,.material-card>span{width:100%;height:50px;object-fit:cover;display:grid;place-items:center}.material-card small{display:block;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px}.material-card .el-icon{position:absolute;right:3px;top:3px;color:#7f9aff}.prompt-label{display:flex;justify-content:space-between;margin:8px 0 6px;font-size:13px}.prompt-label em{font-size:10px;color:#d25e67;font-style:normal}.selected-assets{display:grid;gap:5px;max-height:150px;overflow:auto;margin-top:8px}.selected-assets article{display:grid;grid-template-columns:auto minmax(70px,1fr) 120px auto;gap:5px;align-items:center;background:#293248;border-radius:6px;padding:4px}.selected-assets b{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.audio-options{display:grid;gap:6px;margin-top:8px}.generate-button{width:100%;margin-top:12px}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:1150px){.workbench{grid-template-columns:250px minmax(450px,1fr) 310px}}@media(max-width:850px){.omni-page{height:auto;overflow:auto}.workbench{height:auto;grid-template-columns:1fr}.shot-panel,.creation-panel{max-height:none}.center-stage{min-height:620px}.shot-list{grid-template-columns:repeat(2,1fr)}}
.mode-switch{display:flex;margin-top:10px}.mode-note{display:block;line-height:1.5;color:#a9b3c8;margin-top:6px}
/* 2026 工作台层级：中间成片优先，蓝/铜语义色，无紫色强调 */
.omni-page{background:#10151d;color:#f2f0ea}.topbar{height:58px;background:#181f29;border-color:#2d3947}.topbar .el-button{color:#bfcbd5}.workbench{grid-template-columns:260px minmax(680px,1fr) 320px}.panel{background:#181f29;border-color:#2d3947;padding:12px}.shot-heading b{font-size:16px}.shot-heading small{color:#8f9dab}.shot-actions .el-button{font-size:11px}.shot-card{border-color:#303d4b;background:#151b24;border-radius:8px}.shot-card.active{border-color:#4b91c8;box-shadow:0 0 0 1px #4b91c8;background:#1b2834}.shot-number{background:#dbe6ed;color:#173044}.shot-preview{height:112px}.shot-state{display:flex;align-items:center;gap:3px;color:#9facba}.shot-state.processing i{background:#d6a854}.shot-state.completed i{background:#4fa77a}.shot-state.failed i,.shot-state.retryable i{background:#d66b6b}.center-stage{background:#0c1118}.player-tools{height:48px;background:#151b24;border-color:#2d3947}.video-stage{background:#06090d}.selected-mosaic{opacity:.38}.empty-play,.render-play{background:#315e7b;color:#f2f0ea}.render-ring{border-color:#4b91c866}.time-ruler{background:#151b24;color:#aab4c0}.time-ruler div{background:#303d4b}.time-ruler i{background:#4b91c8}.shot-tabs{height:40px;background:#181f29;border-color:#2d3947;color:#9facba}.shot-tabs .active{color:#f2f0ea}.shot-script{padding:10px 16px 14px;background:#181f29}.creation-panel{border-left-color:#2d3947}.panel-title{padding-bottom:10px;border-bottom:1px solid #2d3947}.mode-switch{width:100%;margin:10px 0 0}.mode-switch :deep(.el-radio-button){flex:1}.mode-switch :deep(.el-radio-button__inner){width:100%;background:#151b24;border-color:#334050;color:#b9c5cf}.mode-switch :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner){background:#264b65;border-color:#4b91c8;color:#eff7fb;box-shadow:-1px 0 0 0 #4b91c8}.mode-note{padding:8px 9px;border-left:2px solid #c48a4a;background:#211d17;color:#cdbfa9}.advanced-settings{margin:10px 0;border:1px solid #303d4b;border-radius:7px;background:#151b24}.advanced-settings summary{padding:9px;cursor:pointer;color:#d3dbe1;font-size:12px}.advanced-settings summary span{display:block;margin-top:3px;color:#8f9dab;font-size:10px}.advanced-settings .parameters{padding:0 9px 9px;margin:0}.parameters label{color:#aab4c0}.materials-title{margin-top:15px}.dropzone{border-color:#526b80;background:#151b24;color:#aab4c0}.material-card{border-color:#303d4b;background:#111720}.material-card.selected{border-color:#4b91c8;box-shadow:inset 0 0 0 1px #4b91c8}.material-card .el-icon{color:#84bddd}.prompt-label em{color:#d6a854}.selected-assets article{background:#202b36}.identity-options{margin-top:8px;padding:8px;border:1px solid #3b4550;border-radius:7px;background:#151b24}.selection-limit-note,.upload-limit-note{display:block;margin-top:5px;color:#93a0af;line-height:1.45}.generate-button{margin-top:14px}.generate-button.el-button--primary{--el-button-bg-color:#4b91c8;--el-button-border-color:#4b91c8;--el-button-hover-bg-color:#5ba1d6;--el-button-hover-border-color:#5ba1d6}@media(max-width:1150px){.workbench{grid-template-columns:230px minmax(460px,1fr) 300px}}@media(max-width:850px){.workbench{grid-template-columns:1fr}.center-stage{order:-1;min-height:570px}.shot-panel{max-height:390px}.creation-panel{max-height:none}.shot-list{display:flex;overflow:auto}.shot-card{min-width:205px}.shot-preview{height:100px}}
/* 石墨工作台可读性：正文、说明与可编辑控件采用三档明确对比，避免灰字沉入深色背景。 */
.omni-page{background:#101010!important;color:#f3f1ec!important;--el-text-color-primary:#f3f1ec;--el-text-color-regular:#d5d2cb;--el-text-color-secondary:#bcb8b0;--el-text-color-placeholder:#96928a;--el-text-color-disabled:#7d7972;--el-border-color:#46443f;--el-border-color-light:#3d3b37;--el-fill-color-blank:#202020;--el-fill-color:#272727;--el-fill-color-light:#2d2d2d;--el-bg-color:#202020;--el-bg-color-overlay:#252525}.topbar{background:#181818!important;border-color:#484641!important}.panel{background:#181818!important;border-color:#484641!important}.center-stage{background:#101010!important}.player-tools,.shot-tabs,.shot-script{background:#1b1b1b!important;border-color:#484641!important}.shot-card{background:#202020!important;border-color:#45433f!important}.shot-card.active,.material-card.selected{border-color:#f0eee8!important;box-shadow:inset 2px 0 0 #f0eee8!important;background:#30302e!important}.shot-number{background:#f0eee8!important;color:#252525!important}.video-stage{background:#0c0c0c!important}.video-stage b{color:#f5f3ee!important}.video-stage small{color:#d1cec7!important}.time-ruler{background:#181818!important;color:#d4d1ca!important}.time-ruler div{background:#494742!important}.time-ruler i{background:#f0eee8!important}.shot-heading small,.shot-state,.shot-tabs,.parameters label,.selection-limit-note,.upload-limit-note{color:#c4c1ba!important}.shot-tabs .active,.panel-title b,.materials-title b,.shot-title b,.selected-assets b{color:#f3f1ec!important}.drag-handle{color:#c4c1ba!important}.mode-switch :deep(.el-radio-button__inner){background:#252525!important;border-color:#4a4843!important;color:#dedbd4!important}.omni-page :deep(.el-button--primary){--el-button-bg-color:#f0eee8!important;--el-button-border-color:#f0eee8!important;--el-button-text-color:#252525!important;--el-button-hover-bg-color:#fffdf7!important;--el-button-hover-border-color:#fffdf7!important;--el-color-primary:#f0eee8!important}.omni-page :deep(.el-button.is-text){color:#dedbd4!important}.omni-page :deep(.el-button.is-text:hover){background:#30302e!important;color:#fffdf7!important}.omni-page :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner){background:#f0eee8!important;border-color:#f0eee8!important;box-shadow:none!important;color:#252525!important}.omni-page :deep(.el-input__wrapper),.omni-page :deep(.el-select__wrapper),.omni-page :deep(.el-textarea__inner),.omni-page :deep(.el-input-number__decrease),.omni-page :deep(.el-input-number__increase){background:#292929!important;box-shadow:0 0 0 1px #55524c inset!important;color:#f3f1ec!important}.omni-page :deep(.el-input__inner),.omni-page :deep(.el-select__selected-item),.omni-page :deep(.el-textarea__inner){color:#f3f1ec!important}.omni-page :deep(.el-input__inner::placeholder),.omni-page :deep(.el-textarea__inner::placeholder){color:#aaa69e!important}.mode-note{border-left-color:#aaa69e!important;background:#292826!important;color:#e2dfd8!important}.advanced-settings,.identity-options{background:#222222!important;border-color:#4a4843!important}.advanced-settings summary,.advanced-settings summary span{color:#d8d5ce!important}.dropzone,.material-card{background:#1e1e1e!important;border-color:#4b4944!important;color:#d2cfc8!important}.dropzone:hover{background:#292826!important;border-color:#aaa69e!important}.selected-assets article{background:#2a2a28!important}.empty-play,.render-play{background:#353532!important;color:#f3f1ec!important}.render-ring{border-color:#f0eee866!important}.material-card .el-icon,.prompt-label em{color:#d1cec7!important}
/* SD2 认证为操作性信息，单独提升文字与状态对比度。 */
.identity-options{display:grid;gap:9px;padding:11px!important}.identity-heading{display:grid;gap:3px;padding-bottom:8px;border-bottom:1px solid #4a4843}.identity-heading b{color:#f5f3ee!important;font-size:13px}.identity-heading small,.identity-help{color:#c8c5be!important;line-height:1.45}.identity-row{display:grid;gap:4px}.identity-row :deep(.el-checkbox__label){color:#f0eee8!important;font-size:12px}.identity-status{display:flex;align-items:center;flex-wrap:wrap;gap:3px;color:#d8d5ce!important;line-height:1.4}.identity-status.is-active{color:#e8f1e9!important}.identity-status.is-processing{color:#f0e1bd!important}.identity-status.is-failed,.identity-status.is-invalid{color:#f1c6c3!important}.identity-status :deep(.el-button){margin-left:3px!important;color:#f3f1ec!important;text-decoration:underline;text-underline-offset:2px}
/* 音频后期控件：显式指定标签、滑杆与数字输入的前景色，避免默认灰色沉入深色面板。 */
.audio-options{color:#f3f1ec!important}
.audio-options :deep(.el-checkbox__label){color:#f3f1ec!important;font-size:12px}
.audio-options :deep(.el-checkbox__inner){background:#292929!important;border-color:#77736b!important}
.audio-options :deep(.el-checkbox.is-checked .el-checkbox__inner){background:#4b91c8!important;border-color:#4b91c8!important}
.audio-options :deep(.el-slider__runway){background:#4a4843!important}
.audio-options :deep(.el-slider__bar){background:#4b91c8!important}
.audio-options :deep(.el-slider__button){background:#f3f1ec!important;border-color:#4b91c8!important}
.audio-options :deep(.el-input-number){width:100%}
.audio-options :deep(.el-input-number .el-input__wrapper){background:#292929!important;box-shadow:0 0 0 1px #55524c inset!important}
.audio-options :deep(.el-input-number .el-input__inner){color:#f3f1ec!important}
.audio-options :deep(.el-input-number__decrease),.audio-options :deep(.el-input-number__increase){background:#292929!important;color:#d5d2cb!important;border-color:#55524c!important}
.generate-button.el-button--primary{background:#4b91c8!important;border-color:#4b91c8!important;color:#fff!important;box-shadow:0 2px 8px #0006}
.generate-button.el-button--primary:hover{background:#5ba1d6!important;border-color:#5ba1d6!important;color:#fff!important}
.generate-button.el-button--primary.is-disabled{background:#3d5262!important;border-color:#3d5262!important;color:#b8c1c7!important;box-shadow:none}
.generation-actions{display:grid;grid-template-columns:1fr 1.6fr;gap:7px;margin-top:14px}.generation-actions .generate-button{margin-top:0}
.identity-expired-warn{display:flex;align-items:flex-start;gap:7px;margin-top:10px;padding:8px 10px;border-radius:7px;background:#3a2a1c!important;border:1px solid #7a5430!important;color:#f0d9b5!important;font-size:12px;line-height:1.5}
.identity-expired-warn .el-icon{color:#e6a23c;font-size:15px;flex-shrink:0;margin-top:1px}.request-preview-note{margin:0 0 10px;color:#9ca7bc;font-size:13px}.request-preview{max-height:440px;margin:0;overflow:auto;padding:12px;border:1px solid #39435a;border-radius:7px;background:#111621;color:#dce6ff;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.55}.request-preview-actions{display:flex;gap:8px;margin-top:10px}.polish-suggestion{margin-top:12px;padding:10px;border:1px solid #39435a;border-radius:7px;background:#151b24;color:#dce6ff;font-size:12px}.polish-suggestion b{display:block;margin-bottom:6px}.polish-suggestion pre{margin:0;white-space:pre-wrap;word-break:break-word}
.frame-actions{display:flex;flex:0 0 auto;align-items:center;justify-content:flex-end;gap:6px;min-width:0;padding:8px 12px;border-top:1px solid #45433f;background:#181818;color:#dedbd4;overflow-x:auto;scrollbar-width:thin}.frame-actions .el-button{flex:0 0 auto;margin:0!important}.generation-history{display:grid;gap:7px;margin-top:12px;padding-top:10px;border-top:1px solid #45433f}.generation-history-head{display:flex;align-items:baseline;justify-content:space-between}.generation-history-head b{font-size:12px}.generation-history-head small,.generation-history-empty{margin:0;color:#aaa69e;font-size:11px}.generation-history-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.generation-history-item{position:relative;display:grid;grid-template-rows:92px auto;gap:5px;min-width:0;padding:4px;border:1px solid #4b4944;border-radius:6px;background:#202020;color:#dedbd4;text-align:left;cursor:pointer;font:inherit;overflow:hidden}.generation-history-item video,.history-video-empty{display:block;width:100%;height:92px;object-fit:cover;border-radius:4px;background:#0b0b0b}.history-video-empty{display:grid;place-items:center;color:#96928a;font-size:11px}.generation-history-item:hover,.generation-history-item.active{border-color:#f0eee8;background:#30302e}.generation-history-item.active{box-shadow:inset 0 0 0 1px #f0eee8}.history-card-meta{display:grid;gap:2px;min-width:0;padding:0 2px 2px}.history-card-meta b,.history-card-meta small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-card-meta b{font-size:10px}.history-card-meta small{color:#c4c1ba;font-size:10px}.history-dot{position:absolute;top:8px;right:8px;width:7px;height:7px;border:1px solid #111;border-radius:50%;background:#8b8983}.history-dot.completed{background:#7eae85}.history-dot.processing{background:#d6a854}.history-dot.failed,.history-dot.retryable{background:#d66b6b}@media(max-width:520px){.generation-history-grid{grid-template-columns:1fr}.frame-actions{gap:3px;padding:6px 8px}.frame-actions .el-button{font-size:11px}}
.asset-scope{width:92px;margin-right:4px}.material-card .asset-scope-label{position:absolute;left:3px;top:3px;padding:1px 3px;border-radius:3px;background:#111c;color:#dbe7f2;font-size:9px;font-style:normal;line-height:1.2}
.material-card .insert-at-caret{position:absolute;right:5px;bottom:4px;z-index:2;border:1px solid color-mix(in srgb,var(--accent) 55%,var(--border-color));border-radius:999px;padding:2px 7px;background:color-mix(in srgb,var(--bg-elevated) 92%,transparent);color:var(--text-primary);font-size:10px;line-height:1.35;cursor:pointer;box-shadow:var(--shadow-sm)}
.material-card .material-delete{position:absolute;right:5px;top:5px;z-index:3;display:grid;place-items:center;width:24px;height:24px;padding:0;border:1px solid rgba(255,255,255,.78);border-radius:50%;background:rgba(27,31,42,.9);color:#fff;font-size:17px;line-height:1;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,.4)}
.material-card .material-delete:hover,.material-card .material-delete:focus-visible{border-color:#fff;background:var(--el-color-danger);outline:2px solid color-mix(in srgb,var(--el-color-danger) 58%,transparent);outline-offset:1px}
.material-card .insert-at-caret:hover,.material-card .insert-at-caret:focus-visible{border-color:var(--accent);background:var(--accent);color:var(--text-on-accent);outline:none}
.material-card>small{padding-right:68px!important}
/* 素材池以图片识别为主：两列大缩略图，避免四列小图难以判断内容。 */
.creation-panel .material-pool{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;max-height:330px;margin:10px 0 14px}
.creation-panel .material-card{height:128px;border-radius:8px}
.creation-panel .material-card img,.creation-panel .material-card video,.creation-panel .material-card>span{height:98px}
.creation-panel .material-card small{padding:5px 6px;font-size:12px;line-height:1.2}
.creation-panel .material-card .asset-scope-label{left:6px;top:6px;padding:2px 5px;font-size:10px}
/* 缩放与窄屏：三栏按可用宽度收缩，避免中间预览被固定最小宽度挤出视口。 */
.omni-page{min-width:0;min-height:100dvh}.topbar{min-width:0;gap:8px}.topbar-left,.topbar-actions{min-width:0}.topbar-left{overflow:hidden}.topbar-left>span{white-space:nowrap}.sequence-name{width:clamp(104px,14vw,180px);min-width:0}.workbench{width:100%;min-width:0;grid-template-columns:minmax(196px,260px) minmax(0,1fr) minmax(270px,320px)}.center-stage,.panel,.player-tools,.shot-tabs,.shot-script{min-width:0}.player-tools,.shot-tabs{overflow:hidden}.shot-tabs{gap:clamp(10px,2vw,26px);white-space:nowrap}.selected-assets article{grid-template-columns:auto minmax(0,1fr) minmax(92px,120px) auto}.selected-assets b{min-width:0}.material-pool{grid-template-columns:repeat(2,minmax(0,1fr))}
@media(max-width:1180px){.workbench{grid-template-columns:minmax(184px,22vw) minmax(0,1fr) minmax(244px,27vw)}.panel{padding:10px}.selected-assets article{grid-template-columns:auto minmax(0,1fr) 92px auto}.player-tools{padding:0 10px}.time-ruler{padding:0 10px}}
@media(max-width:960px){.workbench{grid-template-columns:minmax(176px,23vw) minmax(0,1fr) minmax(226px,29vw)}.shot-actions{gap:4px}.shot-actions .el-button{padding-left:5px;padding-right:5px}.shot-preview{height:94px}.material-pool{grid-template-columns:repeat(3,1fr)}.selected-assets article{grid-template-columns:auto minmax(0,1fr) auto}.selected-assets .el-select{grid-column:2 / -1}.prompt-label{gap:8px}.prompt-label em{max-width:55%;text-align:right}.time-ruler{font-size:11px}}
@media(max-width:760px){.omni-page{height:auto;overflow:auto}.topbar{height:auto;min-height:58px;flex-wrap:wrap;padding:8px 12px}.topbar-left{flex:1}.topbar-actions{margin-left:auto}.workbench{height:auto;grid-template-columns:minmax(0,1fr)}.center-stage{order:-1;min-height:500px}.shot-panel{max-height:380px}.creation-panel{max-height:none}.shot-list{display:flex;overflow:auto}.shot-card{min-width:190px}.shot-preview{height:100px}.shot-tabs,.player-tools{overflow:auto}.sequence-name{width:min(40vw,180px)}}
/* T0 创作输入优先：首屏先给提示词与参数留出稳定可编辑面积；播放器和分镜仅保留足够的预览与操作空间。 */
@media(min-width:761px){
  .workbench{grid-template-columns:minmax(196px,230px) minmax(0,1fr) minmax(292px,350px)}
  .video-stage{flex:0 0 clamp(185px,29vh,250px)}
  .shot-script{flex:1;min-height:214px;display:flex;align-items:stretch}
  .shot-script :deep(.editor){width:100%;flex:1;min-height:0}
  .shot-preview{height:84px}
  .shot-card{padding:6px}
  .t0-generation-settings{position:relative;margin:12px 0 14px!important;padding:11px!important;border:1px solid #77736b!important;border-radius:8px;background:#242321!important;box-shadow:inset 3px 0 0 #f0eee8}
  .t0-settings-heading{display:flex!important;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px}
  .t0-settings-heading b{font-size:14px;color:#fffdf7!important}
  .t0-settings-heading small{font-size:11px;color:#d5d2cb!important}
}
/* 左侧分镜管理：统一纵向流自适应宽度，卡片宽度跟随面板，不出横向滚动条。 */
.shot-list{display:flex!important;flex-direction:column;gap:9px;overflow-y:auto;overflow-x:hidden}
.shot-card{width:100%;min-width:0!important;box-sizing:border-box}
.shot-card .shot-title{height:auto;min-height:28px;flex-wrap:nowrap;gap:3px}
.shot-card .shot-title>b{min-width:0}
.shot-controls{display:flex;align-items:center;flex:none;gap:0}
.shot-controls .el-button{margin:0;padding:3px 4px}
.shot-delete{flex:none;min-width:50px;margin-left:3px!important;padding:4px 6px!important;border-color:#b95d5d!important;background:#3a2022!important;color:#ffd1d1!important}
.shot-delete:hover,.shot-delete:focus-visible{border-color:#f09b9b!important;background:#592b2f!important;color:#fff1f1!important}
.asset-name{display:grid;min-width:0;gap:2px}.asset-name b{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.asset-route-hint{font-size:10px;line-height:1.3;color:var(--text-muted,#aab4c0);white-space:normal}
@media(max-width:760px){.shot-list{display:flex!important;flex-direction:column;overflow-y:auto;overflow-x:hidden}.shot-card{min-width:0!important;width:100%}}
/* 首尾帧强制占位框：高亮、必填强调、filled 态展示缩略图。 */
.frame-slots{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0 4px}
.frame-slot{position:relative;height:120px;border:2px dashed #6b6862;border-radius:9px;overflow:hidden;cursor:pointer;background:#1e1e1e;display:flex;align-items:center;justify-content:center;transition:border-color .15s,background .15s}
.frame-slot:hover{border-color:#aaa69e;background:#292826}
.frame-slot.filled{border-style:solid;border-color:#f0eee8}
.frame-slot.required:not(.filled){border-color:#d6a854;background:#26221a}
.frame-slot.required:not(.filled):hover{border-color:#e6bd6e;background:#2e2a1f}
.frame-slot img{width:100%;height:100%;object-fit:cover}
.frame-empty{display:flex;flex-direction:column;align-items:center;gap:4px;color:#bcb8b0}
.frame-empty .el-icon{font-size:26px;color:#8f8d86}
.frame-label{font-size:13px;color:#dedbd4}
.frame-label .req{color:#d6a854;font-style:normal;margin-left:2px}
.frame-empty small{font-size:10px;color:#96928a}
.frame-tag{position:absolute;left:6px;top:6px;font-size:10px;padding:1px 6px;border-radius:4px;background:#3a3733;color:#c4c1ba}
.frame-tag.req{background:#5a4622;color:#e6bd6e}
.frame-clear{position:absolute;right:3px;top:3px;background:#00000080!important;color:#f3f1ec!important}
.frame-picker-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;max-height:380px;overflow:auto}
.frame-picker-card{border:2px solid #4a4843;border-radius:7px;overflow:hidden;cursor:pointer;background:#1e1e1e}
.frame-picker-card.active{border-color:#f0eee8;box-shadow:0 0 0 1px #f0eee8}
.frame-picker-card img{width:100%;height:72px;object-fit:cover;display:block}
.frame-picker-card small{display:block;padding:3px 4px;font-size:10px;color:#c4c1ba;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.frame-picker-empty{padding:30px 0;text-align:center;color:#96928a}
.project-storyboard-page{height:auto!important;min-height:720px!important;background:#10151d!important;color:#f2f0ea!important}.project-storyboard-page .workbench{height:min(820px,calc(100dvh - 120px));min-height:620px;grid-template-columns:minmax(280px,320px) minmax(0,1fr) minmax(250px,290px)!important;gap:0;border:1px solid #334050;border-radius:10px;overflow:hidden;box-shadow:0 16px 42px #0003}.project-storyboard-page .creation-panel{grid-column:1;grid-row:1;border-left:0;border-right:1px solid #334050;background:#181f29!important;overflow-y:auto}.project-storyboard-page .center-stage{grid-column:2;grid-row:1;background:#10151d!important;min-height:0}.project-storyboard-page .shot-panel{grid-column:3;grid-row:1;border-left:1px solid #334050;border-right:0;background:#181f29!important;min-height:0;overflow:hidden}.project-storyboard-page .shot-list{min-height:0;overflow-y:auto!important;overflow-x:hidden;padding-right:3px}.project-storyboard-page .panel,.project-storyboard-page .player-tools,.project-storyboard-page .shot-tabs,.project-storyboard-page .shot-script,.project-storyboard-page .time-ruler{background:#181f29!important;border-color:#334050!important;color:#f2f0ea!important}.project-storyboard-page .video-stage{background:#0b1016!important}.project-storyboard-page .material-card,.project-storyboard-page .shot-card{background:#151b24!important;border-color:#303d4b!important}.project-storyboard-page .shot-card.active,.project-storyboard-page .material-card.selected{border-color:#f5f5f5!important;box-shadow:inset 2px 0 0 #f5f5f5!important;background:#222!important}.project-storyboard-page .shot-title b,.project-storyboard-page .panel-title b,.project-storyboard-page .materials-title b{color:#f2f0ea!important}.project-storyboard-page .shot-state,.project-storyboard-page .parameters label,.project-storyboard-page .selection-limit-note,.project-storyboard-page .upload-limit-note,.project-storyboard-page .materials-title small{color:#aab4c0!important}.project-storyboard-page .mode-switch :deep(.el-radio-button__inner),.project-storyboard-page :deep(.el-input__wrapper),.project-storyboard-page :deep(.el-select__wrapper),.project-storyboard-page :deep(.el-textarea__inner){background:#151b24!important;color:#f2f0ea!important;box-shadow:0 0 0 1px #3c4958 inset!important}.project-storyboard-page :deep(.el-button--primary){--el-button-bg-color:#f5f5f5!important;--el-button-border-color:#f5f5f5!important;--el-button-text-color:#111!important;--el-button-hover-bg-color:#d4d4d4!important;--el-button-hover-border-color:#d4d4d4!important}.project-storyboard-page .mode-note{background:#202934!important;border-left-color:#aab4c0!important;color:#d6dde4!important}.project-storyboard-page .shot-delete{margin-left:auto!important;color:#f09b9b!important}.project-storyboard-page .shot-delete:hover{background:#4a252a!important;color:#ffd4d4!important}@media(max-width:960px){.project-storyboard-page .workbench{height:auto;grid-template-columns:minmax(220px,34vw) minmax(0,1fr)!important}.project-storyboard-page .creation-panel{grid-column:1;grid-row:1 / span 2}.project-storyboard-page .center-stage{grid-column:2;grid-row:1}.project-storyboard-page .shot-panel{grid-column:2;grid-row:2;border-left:0;border-top:1px solid #334050}}@media(max-width:720px){.project-storyboard-page .workbench{display:flex;flex-direction:column}.project-storyboard-page .creation-panel,.project-storyboard-page .center-stage,.project-storyboard-page .shot-panel{width:100%;border:0;border-bottom:1px solid #334050}}
/* 嵌入模式：滚动停留在工作台所属栏内，不能在栏滚到底后继续带动项目页面。
   否则分镜列表或素材栏的上下滚轮会让整个工作台离开可视区，打断当前编辑。 */
.omni-page.embedded.project-storyboard-page{position:sticky!important;top:58px;z-index:20;height:calc(100dvh - 58px)!important;min-height:520px!important;overflow:hidden!important}
.omni-page.embedded.project-storyboard-page .workbench{height:100%!important;min-height:0!important}
.omni-page.embedded.project-storyboard-page .shot-list,
.omni-page.embedded.project-storyboard-page .creation-panel,
.omni-page.embedded.project-storyboard-page .material-pool,
.omni-page.embedded.project-storyboard-page .selected-assets,
.omni-page.embedded.project-storyboard-page .frame-picker-grid{overscroll-behavior-y:contain;scrollbar-gutter:stable}
.creation-generate-dock{position:sticky;top:0;z-index:12;display:grid;gap:8px;margin:12px -2px 14px;padding:10px;border:1px solid #69655e;border-radius:8px;background:#181818f2;box-shadow:0 6px 18px #0006;backdrop-filter:blur(8px)}.creation-generate-summary{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.creation-generate-summary b{color:#f5f3ee;font-size:13px}.creation-generate-summary small{color:#c4c1ba;font-size:11px;white-space:nowrap}.creation-generate-actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:7px}.creation-generate-actions .generate-button{margin:0!important;min-width:0}.project-storyboard-page .creation-generate-dock{top:-1px;background:#181f29f5;border-color:#3c4958}.project-storyboard-page .creation-generate-summary b{color:#f2f0ea}.project-storyboard-page .creation-generate-summary small{color:#aab4c0}@media(max-width:720px){.creation-generate-dock{position:sticky;top:0;margin-left:0;margin-right:0}.creation-generate-summary{align-items:flex-start;flex-direction:column;gap:3px}.creation-generate-summary small{white-space:normal}}
@media(max-width:960px){.omni-page.embedded.project-storyboard-page{position:static!important;height:auto!important;min-height:0!important;overflow:visible!important}.omni-page.embedded.project-storyboard-page .workbench{height:auto!important;min-height:520px}}
.t0-generation-settings{display:grid;gap:10px;margin:12px -2px 14px;padding:12px;border:1px solid #88837a;border-radius:8px;background:#252525}.t0-settings-heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.t0-settings-heading b{font-size:14px;color:#f5f3ee}.t0-settings-heading small{font-size:11px;color:#c4c1ba}.center-stage{grid-template-rows:42px minmax(170px,.8fr) 42px 38px minmax(235px,1fr)}.shot-script{min-height:235px;border-top:2px solid #88837a}.project-storyboard-page .t0-generation-settings{background:#202934;border-color:#506174}.project-storyboard-page .t0-settings-heading b{color:#f2f0ea}.project-storyboard-page .t0-settings-heading small{color:#aab4c0}@media(max-width:760px){.center-stage{grid-template-rows:42px minmax(200px,.8fr) 42px 38px minmax(260px,1fr)}.t0-settings-heading{align-items:flex-start;flex-direction:column;gap:3px}}
.template-status{display:flex;align-items:center;gap:3px;margin-left:auto}.template-status+small{max-width:46%;text-align:right}.shot-preview img{display:block;background:#111820}
/* 2026-08 usability pass: readable T0 controls, wheel navigation, and media-light lists. */
/* Keep the right-hand shot list as the only scrolling surface in the desktop storyboard workspace. */
.project-storyboard-page .shot-list{flex:1 1 auto;min-height:0}
/* At short desktop heights, the prompt must shrink and scroll inside the stage.
   It must never push the player above the visible workbench. */
@media(min-width:761px){.center-stage{min-height:0;overflow:hidden}.shot-script{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior-y:contain}.project-storyboard-page .center-stage{height:100%}}
/* 独立自由创作与项目分镜使用同一工作台方向：素材和参数在左、提示词居中、镜头轨道在右。 */
@media(min-width:761px){
  .omni-page:not(.project-storyboard-page) .workbench{grid-template-columns:minmax(280px,320px) minmax(0,1fr) minmax(250px,290px)!important;gap:0;border:1px solid var(--border-color);border-radius:10px;overflow:hidden;box-shadow:var(--shadow-sm)}
  .omni-page:not(.project-storyboard-page) .creation-panel{grid-column:1;grid-row:1;border-left:0;border-right:1px solid var(--border-color);overflow-y:auto}
  .omni-page:not(.project-storyboard-page) .center-stage{grid-column:2;grid-row:1;min-height:0}
  .omni-page:not(.project-storyboard-page) .shot-panel{grid-column:3;grid-row:1;border-left:1px solid var(--border-color);border-right:0;overflow:hidden}
  .omni-page:not(.project-storyboard-page) .shot-list{flex:1 1 auto;min-height:0;overflow-y:auto!important;overflow-x:hidden}
}
/* Desktop free-create uses a fixed-height workbench too.  Without these
   shrink constraints, a long shot list expands the grid row and makes the
   page itself scroll, carrying the player away while switching later shots. */
@media(min-width:761px){.workbench{min-height:0}.shot-panel,.creation-panel,.center-stage{min-height:0}.shot-panel{overflow:hidden}.shot-list{flex:1 1 auto;min-height:0}}
.omni-page{font-size:14px;line-height:1.5}
.shot-list:focus-visible{outline:1px solid var(--focus-ring,#c7d2dc);outline-offset:3px}
.shot-video-placeholder{display:flex!important;height:100%;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 42%,#704cff 0,#39218f 38%,#171125 75%)}.shot-play{display:grid;place-items:center;width:44px;height:44px;padding-left:3px;border:1px solid #ffffff55;border-radius:50%;background:#7b5cff;color:#fff;font-size:20px;box-shadow:0 10px 26px #6c4bff66}.shot-video-placeholder small{font-size:12px!important;color:#c4c1ba!important}
.material-video-placeholder{display:grid!important;place-items:center;font-size:26px;color:#c4c1ba;background:#111}
.history-poster,.generation-history-item .history-video-empty{display:block;width:100%;height:92px;object-fit:cover;border-radius:4px;background:#0b0b0b}
.generation-history-item .history-video-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font-size:12px!important}
.generation-history-item .history-video-empty .el-icon{font-size:24px}
.omni-page .shot-heading small,.omni-page .shot-state,.omni-page .upload-limit-note,.omni-page .selection-limit-note,
.omni-page .mode-note,.omni-page .identity-help,.omni-page .asset-route-hint,.omni-page .generation-history-head small,
.omni-page .history-card-meta small,.omni-page .history-card-meta b,.omni-page .t0-settings-heading small{font-size:12px!important;line-height:1.5}
.omni-page .parameters label,.omni-page .prompt-label,.omni-page .materials-title,.omni-page .panel-title,
.omni-page .creation-generate-summary{font-size:13px!important;line-height:1.5}
.omni-page :deep(.el-input__inner),.omni-page :deep(.el-textarea__inner),.omni-page :deep(.el-select__selected-item),
.omni-page :deep(.el-button),.omni-page :deep(.el-radio-button__inner){font-size:14px!important}
@media(min-width:961px){
  .omni-page:not(.project-storyboard-page) .workbench{grid-template-columns:minmax(220px,240px) minmax(0,1fr) minmax(340px,360px)}
}
/* Film-canvas visual system: track / stage / director console. */
.omni-page{background:var(--bg-page)!important;color:var(--text-primary)!important;--studio-accent:var(--accent);--studio-teal:var(--accent-teal);--studio-warm:var(--accent-warm)}
.topbar{height:60px!important;padding:0 18px;background:color-mix(in srgb,var(--bg-surface) 90%,transparent)!important;border-color:var(--border-subtle)!important;backdrop-filter:blur(18px) saturate(125%);box-shadow:0 10px 30px rgba(0,0,0,.12)}
.topbar-left{gap:10px}.topbar-left::before{content:'◢';display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:linear-gradient(145deg,var(--studio-accent),var(--studio-teal));color:#fff;font-size:12px;box-shadow:0 6px 18px color-mix(in srgb,var(--studio-accent) 28%,transparent)}
.workbench{height:calc(100vh - 60px);background:var(--bg-page)!important}
.panel{background:color-mix(in srgb,var(--bg-surface) 94%,transparent)!important;border-color:var(--border-subtle)!important}
.shot-panel{position:relative}.shot-panel::before,.creation-panel::before{display:block;margin:0 0 8px;color:var(--text-faint);font-size:9px;font-weight:700;letter-spacing:.16em}
.shot-panel::before,.creation-panel::before{content:none}
.shot-heading b,.panel-title b,.materials-title b,.t0-settings-heading b{color:var(--text-primary)!important}
.shot-card{position:relative;background:var(--bg-raised)!important;border-color:var(--border-subtle)!important;border-radius:11px!important;box-shadow:none!important;transition:transform .16s ease,border-color .16s ease,background .16s ease}
.shot-controls{display:flex;flex:none;gap:0}.shot-controls :deep(.el-button){min-width:20px;padding-inline:3px}.shot-delete{min-width:30px!important;padding:4px!important}.shot-delete span{display:none}
.shot-card:hover{transform:translateX(2px);border-color:var(--border-strong)!important}
.shot-card.active{background:color-mix(in srgb,var(--studio-accent) 12%,var(--bg-raised))!important;border-color:color-mix(in srgb,var(--studio-accent) 68%,var(--border-color))!important;box-shadow:inset 3px 0 0 var(--studio-accent)!important}
.shot-number{background:color-mix(in srgb,var(--studio-accent) 18%,var(--bg-elevated))!important;color:var(--text-primary)!important}
.center-stage{background:#070a11!important;border-inline:1px solid var(--border-subtle)}
.player-tools,.time-ruler,.shot-tabs,.shot-script{background:color-mix(in srgb,var(--bg-surface) 96%,#070a11)!important;border-color:var(--border-subtle)!important}
.player-tools{color:var(--text-muted)}.player-tools>span{color:var(--studio-accent);font-size:12px;font-weight:700;letter-spacing:.08em;text-align:center}
.video-stage{margin:12px;border:1px solid #202940!important;border-radius:14px;box-shadow:inset 0 0 60px rgba(0,0,0,.62),0 18px 46px rgba(0,0,0,.25)}
.empty-play,.render-play{background:linear-gradient(145deg,var(--studio-accent),#5d4dd2)!important;color:#fff!important;box-shadow:0 14px 36px color-mix(in srgb,var(--studio-accent) 30%,transparent)}
.render-ring{border-color:color-mix(in srgb,var(--studio-accent) 42%,transparent)!important}.time-ruler i{background:linear-gradient(90deg,var(--studio-accent),var(--studio-teal))!important}
.shot-script{padding:12px 16px 16px!important;border-top:1px solid var(--border-subtle)!important}
.creation-panel{background:color-mix(in srgb,var(--bg-surface) 97%,transparent)!important;padding:14px!important}
.creation-generate-dock{top:-2px;border-color:color-mix(in srgb,var(--studio-accent) 45%,var(--border-color))!important;border-radius:12px!important;background:color-mix(in srgb,var(--bg-surface) 92%,transparent)!important;box-shadow:0 14px 34px rgba(0,0,0,.2),inset 0 1px 0 color-mix(in srgb,var(--text-primary) 8%,transparent)!important}
.creation-generate-actions .generate-button,.generate-button.el-button--primary{background:linear-gradient(135deg,var(--studio-accent),#6d5de0)!important;border-color:transparent!important;color:#fff!important;box-shadow:0 9px 24px color-mix(in srgb,var(--studio-accent) 28%,transparent)!important}
.t0-generation-settings{border-color:color-mix(in srgb,var(--studio-accent) 42%,var(--border-color))!important;border-radius:12px!important;background:color-mix(in srgb,var(--studio-accent) 7%,var(--bg-raised))!important;box-shadow:inset 3px 0 0 var(--studio-accent)!important}
.mode-note{border-left-color:var(--studio-warm)!important;background:color-mix(in srgb,var(--studio-warm) 8%,var(--bg-raised))!important;color:var(--text-regular)!important}
.advanced-settings,.identity-options,.selected-assets article{background:var(--bg-raised)!important;border-color:var(--border-color)!important}
.dropzone{background:color-mix(in srgb,var(--studio-teal) 5%,var(--bg-raised))!important;border-color:color-mix(in srgb,var(--studio-teal) 44%,var(--border-color))!important;border-radius:10px!important}
.material-card{position:relative;background:var(--bg-raised)!important;border-color:var(--border-color)!important;border-radius:10px!important}.omni-page .material-card.selected{border:2px solid #fff!important;background:var(--bg-raised)!important;box-shadow:0 0 0 2px rgb(255 255 255 / 58%),0 0 14px rgb(84 234 212 / 42%)!important}.asset-send-policy{display:grid;gap:6px;margin-top:10px;padding:9px;border:1px solid color-mix(in srgb,var(--studio-teal) 40%,var(--border-color));border-radius:9px;background:color-mix(in srgb,var(--studio-teal) 6%,var(--bg-raised))}.asset-send-policy label{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--text-primary);font-size:13px;font-weight:700}.selection-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}
.prompt-label em{color:var(--studio-warm)!important}
:global(html.light) .omni-page{--el-bg-color:var(--bg-surface);--el-bg-color-overlay:#fff;--el-fill-color-blank:#fff;--el-fill-color:var(--bg-raised);--el-text-color-primary:var(--text-primary);--el-text-color-regular:var(--text-regular);--el-text-color-secondary:var(--text-muted);--el-border-color:var(--border-color)}
:global(html.light) .topbar,:global(html.light) .panel,:global(html.light) .player-tools,:global(html.light) .time-ruler,:global(html.light) .shot-tabs,:global(html.light) .shot-script{background:rgba(255,255,255,.78)!important}
:global(html.light) .shot-card,:global(html.light) .advanced-settings,:global(html.light) .identity-options,:global(html.light) .selected-assets article,:global(html.light) .material-card{background:#fff!important}
:global(html.light) .center-stage{background:#e7e1d8!important}
:global(html body #app .omni-page .project-asset-library-card.added){border-color:color-mix(in srgb,var(--studio-teal) 65%,var(--el-border-color));background:color-mix(in srgb,var(--studio-teal) 7%,var(--el-fill-color-blank))}.project-asset-library-card.added em{background:color-mix(in srgb,var(--studio-teal) 76%,#111);font-weight:700}
:global(html.light) .creation-generate-dock{background:rgba(255,255,255,.9)!important;box-shadow:0 14px 34px rgba(61,48,35,.12)!important}
:global(html.light) .omni-page :deep(.el-input__wrapper),:global(html.light) .omni-page :deep(.el-select__wrapper),:global(html.light) .omni-page :deep(.el-textarea__inner),:global(html.light) .omni-page :deep(.el-input-number__decrease),:global(html.light) .omni-page :deep(.el-input-number__increase){background:#fff!important;box-shadow:0 0 0 1px var(--border-color) inset!important;color:var(--text-primary)!important}
:global(html.light) .omni-page :deep(.el-input__inner),:global(html.light) .omni-page :deep(.el-select__selected-item),:global(html.light) .omni-page :deep(.el-textarea__inner){color:var(--text-primary)!important}
:global(html.light) .omni-page :deep(.el-input__inner::placeholder),:global(html.light) .omni-page :deep(.el-textarea__inner::placeholder){color:var(--text-faint)!important}
:global(html.light) .mode-switch :deep(.el-radio-button__inner){background:#fff!important;border-color:var(--border-color)!important;color:var(--text-regular)!important}
:global(html.light) .mode-switch :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner){background:var(--text-primary)!important;border-color:var(--text-primary)!important;color:#fff!important}
:global(html.light) .advanced-settings summary,:global(html.light) .advanced-settings summary span,:global(html.light) .shot-heading small,:global(html.light) .shot-state,:global(html.light) .parameters label,:global(html.light) .selection-limit-note,:global(html.light) .upload-limit-note{color:var(--text-muted)!important}
:global(html.light) .shot-script :deep(.el-textarea__inner){background:#fff!important;border-radius:10px!important}
@media(min-width:961px){.omni-page:not(.project-storyboard-page) .workbench{grid-template-columns:minmax(220px,240px) minmax(0,1fr) minmax(340px,370px)}}
.shot-state.upscale_pending i,.shot-state.upscaling i,.shot-state.interpolation_pending i,.shot-state.interpolating i,.shot-state.persisting i{background:#d6a854}
/* 素材是提示词与参数的核心输入：桌面端保留足够宽度并以两列预览呈现，
   避免 220px 四列网格把刚上传的图片压成无法辨识的小条。 */
@media(min-width:961px){
  .omni-page:not(.project-storyboard-page) .workbench{grid-template-columns:minmax(300px,340px) minmax(0,1fr) minmax(280px,320px)!important}
}
.material-pool{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px;max-height:264px}
.material-card{height:auto!important;min-height:126px;display:grid;grid-template-rows:minmax(94px,1fr) auto}
.material-card img,.material-card video,.material-card>span{height:100%!important;min-height:94px;aspect-ratio:4 / 3}
.material-card small{min-width:0;padding:5px 6px;line-height:1.35}
.mobile-workbench-tabs{display:none}
/* Mobile keeps the app shell fixed; the studio itself is the deliberate scroll surface. */
@media(max-width:760px){
  .omni-page{display:flex;flex-direction:column;height:100vh;height:100dvh;min-height:0;overflow:hidden}
  .topbar{flex:0 0 auto}.topbar-actions>:deep(.account-balance),.topbar-actions .el-button:not(:last-child){display:none}
  .mobile-workbench-tabs{display:grid;grid-template-columns:repeat(3,1fr);flex:0 0 44px;padding:5px;border-top:1px solid var(--border-subtle);border-bottom:1px solid var(--border-subtle);background:var(--bg-surface)}
  .mobile-workbench-tabs button{border:0;border-radius:7px;background:transparent;color:var(--text-muted);font:inherit;font-size:.78rem;cursor:pointer;transition:background-color var(--motion-fast) var(--motion-ease),color var(--motion-fast) var(--motion-ease),transform var(--motion-fast) var(--motion-spring)}
  .mobile-workbench-tabs button.active{background:var(--bg-active);color:var(--text-primary);font-weight:750}
  .workbench{display:block;flex:1 1 auto;width:100%;height:auto;min-height:0;overflow:hidden;overscroll-behavior:contain}
  .workbench.mobile-stage>.shot-panel,.workbench.mobile-stage>.creation-panel,.workbench.mobile-shots>.center-stage,.workbench.mobile-shots>.creation-panel,.workbench.mobile-create>.shot-panel,.workbench.mobile-create>.center-stage{display:none!important}
  .workbench.mobile-stage>.center-stage,.workbench.mobile-shots>.shot-panel,.workbench.mobile-create>.creation-panel{display:flex!important;width:100%;height:100%;min-height:0;max-height:none;animation:mobile-panel-in var(--motion-standard) var(--motion-spring) both}
  .workbench.mobile-stage>.center-stage{order:0;min-height:0}.workbench.mobile-shots>.shot-panel{overflow:hidden}.workbench.mobile-shots .shot-list{flex:1;min-height:0;overflow-y:auto}.workbench.mobile-create>.creation-panel{overflow-y:auto}
  .shot-list{display:flex!important;flex-direction:column}.shot-card{width:100%;min-width:0!important}
}
@keyframes mobile-panel-in{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:none}}
.generation-progress{display:grid;grid-template-columns:minmax(130px,240px) auto;gap:7px 10px;align-items:center;margin-top:13px;color:var(--text-regular);font-size:12px}.generation-progress>span{display:block;height:5px;overflow:hidden;border-radius:99px;background:var(--border-strong)}.generation-progress>span i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--studio-accent),var(--studio-teal));transition:width .22s ease}.generation-progress em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--text-primary)}.generation-progress small{grid-column:1 / -1;max-width:360px;line-height:1.45;text-align:center;color:var(--text-muted)!important}
@media(prefers-reduced-motion:reduce){.workbench.mobile-stage>.center-stage,.workbench.mobile-shots>.shot-panel,.workbench.mobile-create>.creation-panel{animation:none!important}}
.video-stage::before{content:'';position:absolute;inset:-28%;z-index:0;pointer-events:none;background:radial-gradient(circle at 38% 44%,color-mix(in srgb,var(--accent) 24%,transparent),transparent 25%),radial-gradient(circle at 67% 57%,color-mix(in srgb,var(--accent-teal) 16%,transparent),transparent 28%);opacity:.82;transform:translate3d(0,0,0)}
.video-stage.rendering::before{animation:stage-atmosphere 7s var(--motion-ease) infinite alternate}
.empty-play,.render-play{box-shadow:0 0 0 .65rem color-mix(in srgb,var(--accent) 5%,transparent),0 1.2rem 3.6rem rgba(0,0,0,.36)!important}
.video-stage.rendering .render-play{animation:stage-pulse 2.4s var(--motion-ease) infinite}
@keyframes stage-atmosphere{to{opacity:1;transform:translate3d(2.2%,-1.5%,0) scale(1.035)}}
@keyframes stage-pulse{50%{transform:scale(1.055);box-shadow:0 0 0 1rem color-mix(in srgb,var(--accent) 8%,transparent),0 1.2rem 3.6rem rgba(0,0,0,.36)}}
@media(prefers-reduced-motion:reduce){.video-stage.rendering::before,.video-stage.rendering .render-play{animation:none!important}}
/* 未生成分镜保留 main 的紫色状态提示。 */
.project-storyboard-page .shot-video-placeholder{background:radial-gradient(circle at 50% 42%,#704cff 0,#39218f 38%,#171125 75%)}
.project-storyboard-page .shot-play{border-color:#ffffff55;background:#7b5cff;box-shadow:0 10px 26px #6c4bff66}
/* 只有已有成片的主播放器去除紫色氛围光；空态、生成态和其它组件沿用 main 的紫色反馈。 */
.video-stage.has-video{background:#05070c!important}
.video-stage.has-video::before{display:none!important}
.video-stage.has-video .main-video{position:relative;z-index:1}
/* 提示词与参数是分镜主操作：播放器只保留审片高度，操作条压缩为单行。 */
@media(min-width:761px){
  .project-storyboard-page .workbench{grid-template-columns:minmax(320px,340px) minmax(0,1fr) minmax(240px,270px)!important}
  .project-storyboard-page .video-stage{flex:0 0 clamp(160px,21vh,200px)}
  .project-storyboard-page .frame-actions{min-height:0;padding:5px 10px}
  .project-storyboard-page .frame-actions .el-button{min-height:30px}
  .project-storyboard-page .time-ruler{height:40px}
  .project-storyboard-page .shot-tabs{height:34px}
  .project-storyboard-page .shot-script{min-height:300px;padding:12px 16px 16px!important}
}
/* 分镜生成沿用 main 的紫色状态层级：可生成时给出明确的主操作，
   未满足素材条件时仍保留紫色轮廓，但不会伪装为可点击。 */
.project-storyboard-page .creation-generate-dock,
.project-storyboard-page .t0-generation-settings{border-color:color-mix(in srgb,var(--studio-accent) 52%,var(--border-color))!important}
.project-storyboard-page .creation-generate-actions .generate-button.el-button--primary:not(.is-disabled):not(:disabled){background:linear-gradient(135deg,var(--studio-accent),#6d5de0)!important;border-color:color-mix(in srgb,var(--studio-accent) 82%,#6d5de0)!important;color:#fff!important;box-shadow:0 9px 24px color-mix(in srgb,var(--studio-accent) 32%,transparent)!important}
.project-storyboard-page .creation-generate-actions .generate-button.el-button--primary.is-disabled,
.project-storyboard-page .creation-generate-actions .generate-button.el-button--primary:disabled{opacity:1!important;background:color-mix(in srgb,var(--studio-accent) 14%,var(--bg-raised))!important;border-color:color-mix(in srgb,var(--studio-accent) 50%,var(--border-color))!important;color:color-mix(in srgb,#fff 68%,var(--studio-accent))!important;box-shadow:none!important}
/* 时长是参数，不再伪装成第二条任务进度；生成态只展示播放器内的真实任务进度。 */
.time-ruler{grid-template-columns:minmax(0,1fr) auto!important;gap:12px!important}
.time-ruler>span:last-child{text-align:right;color:var(--text-muted)!important}
/* 成片切换采用双缓冲：下一条静默加载，准备好后覆盖旧画面，防止静态资源闪回。 */
.video-stage.has-video .main-video{position:absolute!important;inset:0;z-index:1;opacity:0;pointer-events:none;transition:opacity 160ms var(--motion-ease)}
.video-stage.has-video .main-video.is-ready{opacity:1;pointer-events:auto}
.video-stage.has-video .main-video.is-current{z-index:2}
@media(prefers-reduced-motion:reduce){.video-stage.has-video .main-video{transition:none}}
/* 已选状态落在图片外的文件名信息条：密集网格中仍可一眼识别，也不遮盖缩略图。 */
:global(html body #app .omni-page .material-card.selected){border:2px solid #fff!important;background:var(--bg-raised)!important;box-shadow:0 0 0 2px rgb(255 255 255 / 58%),0 0 14px rgb(84 234 212 / 42%)!important}
:global(html body #app .omni-page .material-card.selected small){position:relative;padding-left:24px!important;background:#fff!important;color:#111827!important;font-weight:750!important}
:global(html body #app .omni-page .material-card.selected small::before){content:'✓';position:absolute;left:7px;top:50%;transform:translateY(-50%);font-size:12px;font-weight:900;color:#111827}
.billing-project-field{display:grid;grid-template-columns:minmax(0,1fr) minmax(156px,44%);gap:10px;align-items:center;margin:12px 0;padding:10px;border:1px solid color-mix(in srgb,var(--studio-accent) 52%,var(--border-color));border-radius:8px;background:color-mix(in srgb,var(--studio-accent) 10%,var(--bg-raised))}.billing-project-field b{display:block;color:var(--text-primary);font-size:13px}.billing-project-field small{display:block;margin-top:4px;color:var(--text-muted);line-height:1.45;font-size:11px}.billing-project-field :deep(.el-select__wrapper){min-height:34px;border-color:color-mix(in srgb,var(--studio-accent) 58%,var(--border-color))}@media(max-width:1080px){.billing-project-field{grid-template-columns:1fr}.billing-project-field :deep(.el-select){width:100%}}
/* 素材区分为本镜工作集和项目检索库：编辑镜头时只浏览正在使用的素材。 */
.materials-title>div:first-child{min-width:0}.materials-title>div:first-child small{display:block;max-width:210px;margin-top:2px;line-height:1.35;color:var(--text-muted)!important;font-size:11px!important}.current-shot-material-pool{min-height:72px}.current-shot-material-empty{grid-column:1 / -1;margin:0;padding:12px 4px;color:var(--text-muted);font-size:12px;line-height:1.5}.project-asset-library-toolbar{display:grid;grid-template-columns:minmax(0,1fr) 160px;gap:10px}.project-asset-library-note{margin:10px 0;color:var(--el-text-color-secondary);font-size:13px;line-height:1.5}.project-asset-library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px;max-height:min(54vh,500px);overflow:auto;padding:2px}.project-asset-library-card{position:relative;display:grid;gap:4px;min-width:0;padding:6px;overflow:hidden;border:1px solid var(--el-border-color);border-radius:8px;background:var(--el-fill-color-blank);color:var(--el-text-color-primary);text-align:left;cursor:pointer}.project-asset-library-card:hover{border-color:var(--studio-teal)}.project-asset-library-card.selected{border:2px solid #fff;box-shadow:0 0 0 2px rgb(84 234 212 / 52%)}.project-asset-library-card img,.project-asset-library-card>span{display:grid;width:100%;height:82px;place-items:center;object-fit:cover;border-radius:5px;background:var(--el-fill-color-light);color:var(--el-text-color-secondary)}.project-asset-library-card b,.project-asset-library-card small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.project-asset-library-card b{font-size:12px}.project-asset-library-card small{font-size:11px;color:var(--el-text-color-secondary)}.project-asset-library-card em{position:absolute;right:6px;top:6px;padding:2px 5px;border-radius:4px;background:#111c;color:#fff;font-size:10px;font-style:normal}.project-asset-library-card.selected em{background:#fff;color:#151515;font-weight:700}.project-asset-library-empty{grid-column:1 / -1;margin:0;padding:24px 0;text-align:center;color:var(--el-text-color-secondary);font-size:13px}@media(max-width:640px){.project-asset-library-toolbar{grid-template-columns:1fr}.project-asset-library-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
