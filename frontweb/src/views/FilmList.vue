<template>
  <div class="film-list">
    <AppHeader
      active="projects"
      :importing="importing"
      :is-admin="isAdmin"
      @asset-command="handleAssetCommand"
      @create-command="handleCreateCommand"
      @create-omni="createOmniProject"
      @account-command="handleHeaderCommand"
    />
    <input ref="importFileInput" type="file" accept=".zip" style="display:none" @change="onImportFile" />

    <main class="main">
      <div v-loading="loading" class="projects-wrap" :class="{ 'showing-records': recordsOpen }">
        <section class="media-stage" aria-labelledby="media-stage-title">
          <div class="media-canvas" aria-hidden="true">
            <template v-if="heroVideoLayers.length"><video v-for="layer in heroVideoLayers" :key="layer.id" :src="layer.url" :autoplay="layer.id === activeHeroLayerId && layer.ready" muted playsinline preload="auto" :class="{ 'hero-video-layer': true, 'is-ready': layer.ready, 'is-current': layer.id === activeHeroLayerId }" @loadeddata="promoteHeroVideoLayer(layer.id, $event)" @canplay="promoteHeroVideoLayer(layer.id, $event)" @ended="layer.id === activeHeroLayerId && advanceHeroVideo()" @error="discardHeroVideoLayer(layer.id)"></video></template>
            <div v-else class="media-empty-motion"><i></i><i></i><i></i></div>
          </div>
          <video v-if="nextHeroVideo" class="hero-video-preload" :key="nextHeroVideo.key" :src="nextHeroVideo.url" muted playsinline preload="metadata" aria-hidden="true" tabindex="-1"></video>
          <div class="media-stage-shade"></div>
          <div class="media-stage-content">
            <p class="stage-kicker"><span></span> 创作中心</p>
            <h2 id="media-stage-title">项目工作台</h2>
            <template v-if="focusRecord">
              <p class="focus-current"><span>继续创作</span><b :title="focusRecord.title">{{ focusRecord.title }}</b><em>{{ focusRecord.meta }}</em></p>
            </template>
            <p v-else class="focus-current focus-current--empty">从新建短剧开始你的项目。</p>
          <div class="stage-actions">
            <el-button v-if="focusRecord" type="primary" size="large" @click="openRecord(focusRecord)">继续制作</el-button>
            <el-button size="large" @click="goNewProject"><el-icon><Plus /></el-icon>新建短剧</el-button>
          </div>
          <div v-if="heroVideos.length > 1" class="hero-video-controls" aria-label="主页视频轮播">
            <button type="button" aria-label="上一段视频" @click="previousHeroVideo">←</button>
            <span class="hero-video-count" aria-live="polite">{{ heroVideoIndex + 1 }} / {{ heroVideos.length }}</span>
            <button type="button" aria-label="下一段视频" @click="advanceHeroVideo">→</button>
          </div>
            <dl class="stage-data" aria-label="工作台数据">
              <div><dt>{{ dramas.length }}</dt><dd>短剧项目</dd></div>
              <div><dt>{{ omniProjects.length }}</dt><dd>全能制作</dd></div>
              <div><dt>{{ workspaceAssets.length }}</dt><dd>媒体素材</dd></div>
            </dl>
          </div>
          <button type="button" class="records-jump" :aria-expanded="recordsOpen" aria-controls="creation-records" @click="recordsOpen = !recordsOpen">
            <span>{{ recordsOpen ? '收起记录' : '全部记录' }}</span><b>{{ allRecords.length }}</b><i>{{ recordsOpen ? '收起 ←' : '查看 →' }}</i>
          </button>
          <aside v-if="allRecords.length" class="recent-stack" aria-label="最近项目">
            <p>最近项目</p>
            <button v-for="(record, index) in allRecords.slice(0, 3)" :key="`${record.type}-${record.id}`" type="button" @click="openRecord(record)">
              <span class="recent-thumb"><img v-if="recordCover(record)" :src="recordCover(record)" alt="" /><i v-else>{{ String(index + 1).padStart(2, '0') }}</i></span><div><small>{{ record.type === 'drama' ? '短剧' : '全能视频' }}</small><b>{{ record.title }}</b><em>{{ record.meta }}</em></div><i>→</i>
            </button>
          </aside>
          <aside v-if="recordsOpen" id="creation-records" class="records-panel" aria-labelledby="records-title">
            <header class="records-heading">
              <div><p>创作记录</p><h2 id="records-title">全部项目</h2></div>
              <label class="record-search"><span>搜索</span><input v-model.trim="recordQuery" type="search" placeholder="项目名称或描述" /></label>
              <button type="button" class="records-close" aria-label="关闭创作记录" @click="recordsOpen = false">×</button>
            </header>
            <div class="record-filters" role="group" aria-label="记录类型筛选">
              <button v-for="filter in recordFilters" :key="filter.value" type="button" :class="{ active: recordFilter === filter.value }" @click="recordFilter = filter.value">{{ filter.label }} <span>{{ filter.count }}</span></button>
            </div>
            <div v-if="filteredRecords.length" class="record-list">
              <article v-for="(record, index) in filteredRecords" :key="`${record.type}-${record.id}`" class="record-row">
                <button type="button" class="record-open" @click="openRecord(record)">
                  <span class="record-index">{{ String(index + 1).padStart(2, '0') }}</span>
                  <span class="record-thumb" :class="{ 'has-image': recordCover(record) }"><img v-if="recordCover(record)" :src="recordCover(record)" alt="" loading="lazy" decoding="async" /><i v-else>{{ record.type === 'drama' ? '剧' : '片' }}</i></span>
                  <span class="record-title"><small>{{ record.label }}</small><b :title="record.title">{{ record.title }}</b><em>{{ record.description }}</em></span>
                  <span class="record-meta">{{ record.meta }}</span><span class="record-arrow">→</span>
                </button>
                <div class="record-actions record-actions--panel">
                  <el-button circle type="danger" plain :icon="Delete" :title="`删除${record.title}`" :aria-label="`删除${record.title}`" @click.stop="record.type === 'drama' ? onDelete(record.source) : deleteOmniProject(record.source)" />
                </div>
              </article>
            </div>
            <div v-else class="record-no-result"><b>没有匹配的创作记录</b><span>换一个关键词或筛选类型。</span></div>
          </aside>
        </section>

        <section v-if="false && allRecords.length" ref="recordsSection" class="records-workspace" aria-labelledby="records-title">
          <header class="records-heading">
            <div><h2 id="records-title">创作记录</h2></div>
            <label class="record-search"><span>搜索</span><input v-model.trim="recordQuery" type="search" placeholder="项目名称或描述" /></label>
            <button type="button" class="records-close" aria-label="关闭创作记录" @click="recordsOpen = false">×</button>
          </header>
          <div class="record-filters" role="group" aria-label="记录类型筛选">
            <button v-for="filter in recordFilters" :key="filter.value" type="button" :class="{ active: recordFilter === filter.value }" @click="recordFilter = filter.value">{{ filter.label }} <span>{{ filter.count }}</span></button>
          </div>
          <div v-if="filteredRecords.length" class="record-list">
            <article v-for="(record, index) in filteredRecords" :key="`${record.type}-${record.id}`" class="record-row">
              <button type="button" class="record-open" @click="openRecord(record)">
                <span class="record-index">{{ String(index + 1).padStart(2, '0') }}</span>
                <span class="record-thumb" :class="{ 'has-image': recordCover(record) }">
                  <img v-if="recordCover(record)" :src="recordCover(record)" alt="" loading="lazy" decoding="async" />
                  <i v-else>{{ record.type === 'drama' ? '剧' : '片' }}</i>
                </span>
                <span class="record-title"><small>{{ record.label }}</small><b>{{ record.title }}</b><em>{{ record.description }}</em></span>
                <span class="record-meta">{{ record.meta }}</span>
                <time>{{ formatDate(record.updatedAt) }}</time>
                <span class="record-arrow">→</span>
              </button>
              <div class="record-actions">
                <template v-if="record.type === 'drama'">
                  <el-button circle :icon="Download" title="导出项目" :loading="exportingId === record.source.id" @click="onExport(record.source)" />
                  <el-button circle :icon="Edit" title="编辑" @click="openEditDialog(record.source)" />
                  <el-button circle type="danger" plain :icon="Delete" title="删除" @click="onDelete(record.source)" />
                </template>
                <el-button v-else circle type="danger" plain :icon="Delete" title="删除" @click="deleteOmniProject(record.source)" />
              </div>
            </article>
          </div>
          <div v-else class="record-no-result"><b>没有匹配的创作记录</b><span>换一个关键词或筛选类型。</span></div>
        </section>

        <section v-if="!recordsOpen && heroMedia.length" class="media-showcase" aria-labelledby="media-showcase-title">
          <header class="section-heading"><div><h2 id="media-showcase-title">镜头素材</h2></div><button type="button" @click="$router.push('/media-library')">查看全部素材 →</button></header>
          <div class="media-filmstrip">
            <button v-for="(asset, index) in heroMedia" :key="asset.id" type="button" :class="`film-frame film-frame--${index + 1}`" @click="$router.push('/media-library')">
              <img :src="assetCoverUrl(asset)" :alt="asset.name || '创作媒体'" loading="lazy" decoding="async" />
              <span><small>{{ asset.type === 'video' ? '视频' : '画面' }} · {{ String(index + 1).padStart(2, '0') }}</small><b>{{ asset.name || '未命名镜头' }}</b></span>
            </button>
          </div>
        </section>

        <section v-if="!recordsOpen && !loading && !dramas.length && !omniProjects.length" class="empty-workspace">
          <h2>暂无项目</h2>
          <div><el-button type="primary" size="large" @click="goNewProject">创建短剧项目</el-button><el-button size="large" :loading="importing" @click="triggerImport">导入已有项目</el-button></div>
          <div v-if="exampleList.length" class="empty-examples"><small>或从示例开始：</small><el-button v-for="ex in exampleList" :key="ex.filename" size="small" :loading="importingExample === ex.filename" @click="onImportExample(ex)">{{ ex.name }}</el-button></div>
        </section>
      </div>
    </main>

    <!-- 新建项目：先填标题和描述 -->
    <el-dialog
      v-model="showNewDialog"
      title="新建项目"
      width="480px"
      :close-on-click-modal="false"
      @closed="resetNewForm"
    >
      <el-form :model="newForm" label-width="80px" label-position="top">
        <el-form-item label="标题" required>
          <el-input v-model="newForm.title" placeholder="输入项目标题" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="newForm.description" type="textarea" :rows="3" placeholder="输入项目描述（选填）" />
        </el-form-item>
        <el-form-item label="画面比例">
          <el-select v-model="newForm.aspect_ratio" style="width: 100%">
            <el-option label="16:9 横屏（默认）" value="16:9" />
            <el-option label="9:16 竖屏（短视频）" value="9:16" />
            <el-option label="3:4 竖版" value="3:4" />
            <el-option label="1:1 方形" value="1:1" />
            <el-option label="4:3 传统横屏" value="4:3" />
            <el-option label="21:9 宽银幕" value="21:9" />
          </el-select>
          <p style="margin: 4px 0 0; font-size: 12px; color: #71717a;">影响分镜图和视频的生成比例，短视频选 9:16</p>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showNewDialog = false">取消</el-button>
        <el-button type="primary" :loading="newSaving" :disabled="!newForm.title?.trim()" @click="submitNew">确定</el-button>
      </template>
    </el-dialog>

    <!-- AI 配置弹窗 -->
    <el-dialog v-model="showAiConfigDialog" title="AI 配置" width="90%" destroy-on-close>
      <AIConfigContent v-if="showAiConfigDialog" />
    </el-dialog>

    <!-- 公共角色库 -->
    <el-dialog v-model="showCharLibrary" title="素材库 · 角色" width="720px" destroy-on-close class="library-dialog" @open="loadCharLibraryList">
      <div class="library-toolbar">
        <el-input v-model="charLibraryKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadCharLibrary()" />
      </div>
      <div v-loading="charLibraryLoading" class="library-list">
        <div v-for="item in charLibraryList" :key="item.id" class="library-item">
          <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
            <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
            <span v-else class="library-item-placeholder">暂无图</span>
          </div>
          <div class="library-item-info">
            <div class="library-item-name">{{ item.name || '未命名' }}</div>
            <div class="library-item-desc">{{ (item.description || '').slice(0, 60) }}{{ (item.description || '').length > 60 ? '…' : '' }}</div>
            <div class="library-item-actions">
              <el-button size="small" @click="openEditCharLibrary(item)">编辑</el-button>
              <el-button size="small" type="danger" plain @click="onDeleteCharLibrary(item)">删除</el-button>
            </div>
          </div>
        </div>
        <div v-if="!charLibraryLoading && charLibraryList.length === 0" class="library-empty">素材库暂无角色，可在项目中将角色「加入素材库」后在此查看</div>
      </div>
      <div class="library-pagination">
        <el-pagination v-model:current-page="charLibraryPage" v-model:page-size="charLibraryPageSize" :total="charLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadCharLibraryList" @size-change="loadCharLibraryList" />
      </div>
      <template #footer><el-button @click="showCharLibrary = false">关闭</el-button></template>
    </el-dialog>
    <!-- 编辑公共角色 -->
    <el-dialog v-model="showEditCharLibrary" title="编辑素材角色" width="480px" @close="editCharLibraryForm = null">
      <el-form v-if="editCharLibraryForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <div class="lib-img-thumb" @click="openImagePreview(assetImageUrl(editCharLibraryForm))">
              <img v-if="editCharLibraryForm.image_url || editCharLibraryForm.local_path" :src="assetImageUrl(editCharLibraryForm)" />
              <div v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editCharLibraryForm.imgUploading" @click="charLibFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editCharLibraryForm.imgGenerating" @click="doGenerateLibImg(editCharLibraryForm, (editCharLibraryForm.name + (editCharLibraryForm.description ? ', ' + editCharLibraryForm.description : '')), characterLibraryAPI, loadCharLibraryList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="charLibFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editCharLibraryForm, characterLibraryAPI, loadCharLibraryList)" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editCharLibraryForm.name" placeholder="角色名称" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editCharLibraryForm.category" placeholder="可选" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editCharLibraryForm.description" type="textarea" :rows="3" placeholder="可选" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editCharLibraryForm.tags" placeholder="可选，逗号分隔" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditCharLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editCharLibrarySaving" @click="submitEditCharLibrary">保存</el-button>
      </template>
    </el-dialog>

    <!-- 公共场景库 -->
    <el-dialog v-model="showSceneLibrary" title="素材库 · 场景" width="720px" destroy-on-close class="library-dialog" @open="loadSceneLibraryList">
      <div class="library-toolbar">
        <el-input v-model="sceneLibraryKeyword" placeholder="搜索地点或描述" clearable style="width: 200px" @input="debouncedLoadSceneLibrary()" />
      </div>
      <div v-loading="sceneLibraryLoading" class="library-list">
        <div v-for="item in sceneLibraryList" :key="item.id" class="library-item">
          <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
            <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
            <span v-else class="library-item-placeholder">暂无图</span>
          </div>
          <div class="library-item-info">
            <div class="library-item-name">{{ item.location || item.time || '未命名' }}</div>
            <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
            <div class="library-item-actions">
              <el-button size="small" @click="openEditSceneLibrary(item)">编辑</el-button>
              <el-button size="small" type="danger" plain @click="onDeleteSceneLibrary(item)">删除</el-button>
            </div>
          </div>
        </div>
        <div v-if="!sceneLibraryLoading && sceneLibraryList.length === 0" class="library-empty">素材库暂无场景，可在项目中将场景「加入素材库」后在此查看</div>
      </div>
      <div class="library-pagination">
        <el-pagination v-model:current-page="sceneLibraryPage" v-model:page-size="sceneLibraryPageSize" :total="sceneLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadSceneLibraryList" @size-change="loadSceneLibraryList" />
      </div>
      <template #footer><el-button @click="showSceneLibrary = false">关闭</el-button></template>
    </el-dialog>
    <!-- 编辑公共场景 -->
    <el-dialog v-model="showEditSceneLibrary" title="编辑素材场景" width="480px" @close="editSceneLibraryForm = null">
      <el-form v-if="editSceneLibraryForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <div class="lib-img-thumb" @click="openImagePreview(assetImageUrl(editSceneLibraryForm))">
              <img v-if="editSceneLibraryForm.image_url || editSceneLibraryForm.local_path" :src="assetImageUrl(editSceneLibraryForm)" />
              <div v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editSceneLibraryForm.imgUploading" @click="sceneLibFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editSceneLibraryForm.imgGenerating" @click="doGenerateLibImg(editSceneLibraryForm, ([editSceneLibraryForm.location, editSceneLibraryForm.time, editSceneLibraryForm.description].filter(Boolean).join(', ')), sceneLibraryAPI, loadSceneLibraryList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="sceneLibFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editSceneLibraryForm, sceneLibraryAPI, loadSceneLibraryList)" />
        </el-form-item>
        <el-form-item label="地点"><el-input v-model="editSceneLibraryForm.location" placeholder="场景地点" /></el-form-item>
        <el-form-item label="时间"><el-input v-model="editSceneLibraryForm.time" placeholder="如：浅色/夜晚" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editSceneLibraryForm.category" placeholder="可选" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editSceneLibraryForm.description" type="textarea" :rows="3" placeholder="可选" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editSceneLibraryForm.tags" placeholder="可选，逗号分隔" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditSceneLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editSceneLibrarySaving" @click="submitEditSceneLibrary">保存</el-button>
      </template>
    </el-dialog>

    <!-- 公共道具库 -->
    <el-dialog v-model="showPropLibrary" title="素材库 · 道具" width="720px" destroy-on-close class="library-dialog" @open="loadPropLibraryList">
      <div class="library-toolbar">
        <el-input v-model="propLibraryKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadPropLibrary()" />
      </div>
      <div v-loading="propLibraryLoading" class="library-list">
        <div v-for="item in propLibraryList" :key="item.id" class="library-item">
          <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
            <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
            <span v-else class="library-item-placeholder">暂无图</span>
          </div>
          <div class="library-item-info">
            <div class="library-item-name">{{ item.name || '未命名' }}</div>
            <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
            <div class="library-item-actions">
              <el-button size="small" @click="openEditPropLibrary(item)">编辑</el-button>
              <el-button size="small" type="danger" plain @click="onDeletePropLibrary(item)">删除</el-button>
            </div>
          </div>
        </div>
        <div v-if="!propLibraryLoading && propLibraryList.length === 0" class="library-empty">素材库暂无道具，可在项目中将道具「加入素材库」后在此查看</div>
      </div>
      <div class="library-pagination">
        <el-pagination v-model:current-page="propLibraryPage" v-model:page-size="propLibraryPageSize" :total="propLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadPropLibraryList" @size-change="loadPropLibraryList" />
      </div>
      <template #footer><el-button @click="showPropLibrary = false">关闭</el-button></template>
    </el-dialog>
    <!-- 编辑公共道具 -->
    <el-dialog v-model="showEditPropLibrary" title="编辑素材道具" width="480px" @close="editPropLibraryForm = null">
      <el-form v-if="editPropLibraryForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <div class="lib-img-thumb" @click="openImagePreview(assetImageUrl(editPropLibraryForm))">
              <img v-if="editPropLibraryForm.image_url || editPropLibraryForm.local_path" :src="assetImageUrl(editPropLibraryForm)" />
              <div v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editPropLibraryForm.imgUploading" @click="propLibFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editPropLibraryForm.imgGenerating" @click="doGenerateLibImg(editPropLibraryForm, (editPropLibraryForm.name + (editPropLibraryForm.description ? ', ' + editPropLibraryForm.description : '')), propLibraryAPI, loadPropLibraryList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="propLibFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editPropLibraryForm, propLibraryAPI, loadPropLibraryList)" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editPropLibraryForm.name" placeholder="道具名称" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editPropLibraryForm.category" placeholder="可选" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editPropLibraryForm.description" type="textarea" :rows="3" placeholder="可选" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editPropLibraryForm.tags" placeholder="可选，逗号分隔" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditPropLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editPropLibrarySaving" @click="submitEditPropLibrary">保存</el-button>
      </template>
    </el-dialog>

    <!-- 图片放大预览 -->
    <Teleport to="body">
      <div v-if="previewImageUrl" class="image-preview-overlay" @click="previewImageUrl = null">
        <img :src="previewImageUrl" alt="" class="image-preview-img" @click.stop="previewImageUrl = null" />
      </div>
    </Teleport>

    <!-- 编辑项目：修改标题和故事 -->
    <el-dialog
      v-model="showEditDialog"
      title="编辑项目"
      width="480px"
      :close-on-click-modal="false"
      @closed="resetEditForm"
    >
      <el-form :model="editForm" label-width="80px" label-position="top">
        <el-form-item label="标题" required>
          <el-input v-model="editForm.title" placeholder="输入项目标题" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="故事">
          <el-input v-model="editForm.description" type="textarea" :rows="3" placeholder="输入故事梗概（选填）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" :disabled="!editForm.title?.trim()" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Edit, Delete, Download, PictureFilled, QuestionFilled, FolderOpened, MagicStick } from '@element-plus/icons-vue'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useTheme } from '@/composables/useTheme'
import { dramaAPI } from '@/api/drama'
import { characterLibraryAPI } from '@/api/characterLibrary'
import { sceneLibraryAPI } from '@/api/sceneLibrary'
import { propLibraryAPI } from '@/api/propLibrary'
import AIConfigContent from '@/components/AIConfigContent.vue'
import { uploadAPI } from '@/api/upload'
import { aiAPI } from '@/api/ai'
import { imagesAPI } from '@/api/images'
import { taskAPI } from '@/api/task'
import { omniVideoAPI } from '@/api/omniVideo'
import { videosAPI } from '@/api/videos'
import { formatChinaDateTime } from '@/utils/time'

const router = useRouter()
const { toggle: toggleTheme } = useTheme()
async function logout () {
  try { await fetch('/api/v1/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('lmd_auth_token') || ''}` } }) } catch (_) {}
  localStorage.removeItem('lmd_auth_token')
  localStorage.removeItem('lmd_auth_user')
  router.replace('/login')
}

function handleAssetCommand(command) {
  if (command === 'characters') showCharLibrary.value = true
  else if (command === 'scenes') showSceneLibrary.value = true
  else if (command === 'props') showPropLibrary.value = true
  else if (command === 'media') router.push('/media-library')
}

function handleHeaderCommand(command) {
  if (command === 'theme') toggleTheme()
  else if (command === 'omni') createOmniProject()
  else if (command === 'tools') router.push('/ai-tools')
  else if (command === 'import') triggerImport()
  else if (command === 'deleted') manageDeletedOmniProjects()
  else if (command === 'config') showAiConfigDialog.value = true
  else if (command === 'account') router.push('/account')
  else if (command === 'admin') router.push('/admin')
  else if (command === 'logout') logout()
}

function handleCreateCommand(command) {
  if (command === 'project') goNewProject()
  else if (command === 'import') triggerImport()
}

// 库编辑图片 – 文件输入 refs
const charLibFileRef  = ref(null)
const sceneLibFileRef = ref(null)
const propLibFileRef  = ref(null)

// 共享：上传图片
async function doUploadLibImg(event, form, api, reloadFn) {
  const file = event.target?.files?.[0]
  if (event.target) event.target.value = ''
  if (!file || !form?.id) return
  form.imgUploading = true
  try {
    const res = await uploadAPI.uploadImage(file)
    const data = res?.data ?? res
    const url = data?.url || data?.path || data?.local_path
    if (!url) { ElMessage.error('上传未返回地址'); return }
    form.image_url = url
    form.local_path = data?.local_path ?? null
    await api.update(form.id, { image_url: url, local_path: null })
    reloadFn()
    ElMessage.success('图片已更新')
  } catch (e) { ElMessage.error(e.message || '上传失败') }
  finally { form.imgUploading = false }
}

// 共享：AI 生成图片
async function doGenerateLibImg(form, prompt, api, reloadFn) {
  if (!prompt?.trim()) { ElMessage.warning('请先填写名称或描述'); return }
  form.imgGenerating = true
  try {
    const res = await imagesAPI.create({ prompt: prompt.trim(), drama_id: null })
    const imgData = res?.data ?? res
    const taskId = imgData?.task_id
    if (!taskId) throw new Error('未返回任务ID')
    let task = null
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 1500))
      const tr = await taskAPI.get(taskId)
      task = tr?.data ?? tr
      if (task.status === 'completed') break
      if (task.status === 'failed') throw new Error(task.error || '生成失败')
    }
    if (!task || task.status !== 'completed') throw new Error('生成超时')
    const result = task.result
    const imageUrl = result?.image_url
    const localPath = result?.local_path ?? null
    if (!imageUrl && !localPath) throw new Error('未获取到图片地址')
    form.image_url = imageUrl || ''
    form.local_path = localPath
    await api.update(form.id, { image_url: imageUrl || null, local_path: localPath })
    reloadFn()
    ElMessage.success('AI 图片已生成')
  } catch (e) { ElMessage.error(e.message || '生成失败') }
  finally { form.imgGenerating = false }
}

const loading = ref(false)
const dramas = ref([])
const omniProjects = ref([])
const workspaceAssets = ref([])
const workspaceVideos = ref([])
const total = ref(0)
const recordQuery = ref('')
const recordFilter = ref('all')
const recordsOpen = ref(false)
const recordsSection = ref(null)
const heroVideoFailed = ref(false)
const heroVideoIndex = ref(0)
const heroVideoLayers = ref([])
let heroRotationTimer = null
let heroVideoLayerSequence = 0
let heroVideoLayerTransitionTimer = null

function assetCoverUrl(asset) {
  if (!asset) return ''
  if (asset.thumbnail_local_path) return `/static/${String(asset.thumbnail_local_path).replace(/^\/+/, '')}`
  if (asset.local_path && asset.type === 'image') return `/static/${String(asset.local_path).replace(/^\/+/, '')}`
  return asset.type === 'image' ? (asset.url || '') : ''
}

function assetMediaUrl(asset) {
  if (!asset) return ''
  const localPath = asset.local_path || asset.video_local_path || asset.image_local_path
  if (localPath) return `/static/${String(localPath).replace(/^\/+/, '')}`
  return asset.url || asset.video_url || asset.image_url || ''
}

const heroMedia = computed(() => workspaceAssets.value.filter(asset => assetCoverUrl(asset)).slice(0, 10))
const heroVideos = computed(() => {
  const seen = new Set()
  return [...workspaceVideos.value]
    .filter(video => video.status === 'completed' && assetMediaUrl(video))
    .map(video => ({ key: `video-${video.id}-${assetMediaUrl(video)}`, url: assetMediaUrl(video), projectId: video.drama_id || null }))
    .filter(video => {
      if (seen.has(video.url)) return false
      seen.add(video.url)
      return true
    })
    // 主页只保留最近四条，控制预加载数量；同一项目的多个成片也属于可轮播作品。
    .slice(0, 4)
})
const activeHeroVideo = computed(() => heroVideos.value[heroVideoIndex.value] || null)
const nextHeroVideo = computed(() => heroVideos.value.length > 1 ? heroVideos.value[(heroVideoIndex.value + 1) % heroVideos.value.length] : null)
const activeHeroLayerId = computed(() => heroVideoLayers.value.at(-1)?.id || null)
function discardHeroVideoLayer(id) {
  const index = heroVideoLayers.value.findIndex((layer) => layer.id === id)
  if (index < 0) return
  heroVideoLayers.value.splice(index, 1)
  if (!heroVideoLayers.value.length) handleHeroVideoError()
}
function promoteHeroVideoLayer(id, event) {
  const layer = heroVideoLayers.value.find((item) => item.id === id)
  if (!layer || layer.ready) return
  layer.ready = true
  // 只在静音的主页背景视频上显式续播；浏览器不会因轮播切换停在首帧。
  event?.currentTarget?.play?.().catch(() => {})
  window.clearTimeout(heroVideoLayerTransitionTimer)
  heroVideoLayerTransitionTimer = window.setTimeout(() => {
    const current = heroVideoLayers.value.find((item) => item.id === id)
    if (current) heroVideoLayers.value = [current]
  }, 220)
}
watch(activeHeroVideo, (video) => {
  const url = String(video?.url || '')
  if (!url) {
    window.clearTimeout(heroVideoLayerTransitionTimer)
    heroVideoLayers.value = []
    return
  }
  const latest = heroVideoLayers.value.at(-1)
  if (latest?.url === url) return
  // 保留上一条背景成片，直到下一条媒体可播放；主页切换不再闪出静态封面。
  heroVideoLayers.value.push({ id: ++heroVideoLayerSequence, url, ready: heroVideoLayers.value.length === 0 })
}, { immediate: true })

function stopHeroRotation() {
  if (heroRotationTimer) window.clearTimeout(heroRotationTimer)
  heroRotationTimer = null
}
function scheduleHeroRotation() {
  stopHeroRotation()
  if (heroVideos.value.length > 1) heroRotationTimer = window.setTimeout(advanceHeroVideo, 9000)
}
function selectHeroVideo(index) {
  if (!heroVideos.value.length) return
  heroVideoIndex.value = (index + heroVideos.value.length) % heroVideos.value.length
  heroVideoFailed.value = false
  scheduleHeroRotation()
}
function advanceHeroVideo() { selectHeroVideo(heroVideoIndex.value + 1) }
function previousHeroVideo() { selectHeroVideo(heroVideoIndex.value - 1) }
function handleHeroVideoError() {
  heroVideoFailed.value = true
  if (heroVideos.value.length > 1) window.setTimeout(advanceHeroVideo, 400)
}
watch(heroVideos, (videos) => {
  if (!videos.length) { stopHeroRotation(); heroVideoIndex.value = 0; return }
  if (heroVideoIndex.value >= videos.length) heroVideoIndex.value = 0
  heroVideoFailed.value = false
  scheduleHeroRotation()
}, { flush: 'post' })
const allRecords = computed(() => {
  const dramaRecords = dramas.value.map(drama => ({
    id: drama.id,
    type: 'drama',
    label: `短剧项目 · ${formatStatus(drama.status)}`,
    title: drama.title || '未命名项目',
    description: drama.description || '暂无故事描述',
    meta: `${drama.episodes?.length || 0} 集 · ${totalStoryboards(drama)} 分镜`,
    updatedAt: drama.updated_at,
    source: drama,
  }))
  const omniRecords = omniProjects.value.map(project => ({
    id: project.id,
    type: 'omni',
    label: '全能视频 · 连续镜头',
    title: project.name || '未命名全能项目',
    description: project.description || '全能视频制作序列',
    meta: `${project.completed_count || 0} / ${project.shot_count || 0} 镜头完成`,
    updatedAt: project.updated_at,
    source: project,
  }))
  return [...dramaRecords, ...omniRecords].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
})
const focusRecord = computed(() => allRecords.value.find(record => record.type === 'drama') || allRecords.value[0] || null)
const recordFilters = computed(() => [
  { value: 'all', label: '全部记录', count: allRecords.value.length },
  { value: 'drama', label: '短剧项目', count: dramas.value.length },
  { value: 'omni', label: '全能制作', count: omniProjects.value.length },
])
const filteredRecords = computed(() => {
  const keyword = recordQuery.value.toLowerCase()
  return allRecords.value.filter(record => {
    if (recordFilter.value !== 'all' && record.type !== recordFilter.value) return false
    return !keyword || `${record.title} ${record.description} ${record.label}`.toLowerCase().includes(keyword)
  })
})

function openRecord(record) {
  if (record?.type === 'omni') openOmniProject(record.id)
  else if (record?.id) openProject(record.id)
}

function recordCover(record) {
  if (record?.type !== 'drama') return ''
  const matched = workspaceAssets.value.find(asset => Number(asset.drama_id) === Number(record.id) && assetCoverUrl(asset))
  return assetCoverUrl(matched)
}

const showAiConfigDialog = ref(false)
const vendorLockEnabled = ref(false)

// 图片预览
const previewImageUrl = ref(null)
function assetImageUrl(item) {
  if (!item) return ''
  if (typeof item === 'string') return item.startsWith('http') ? item : item
  const localPath = item.local_path && String(item.local_path).trim()
  if (localPath) return '/static/' + localPath.replace(/^\//, '')
  return item.image_url || ''
}
function openImagePreview(url) {
  if (url) previewImageUrl.value = url
}

// 公共角色库
const showCharLibrary = ref(false)
const charLibraryList = ref([])
const charLibraryLoading = ref(false)
const charLibraryPage = ref(1)
const charLibraryPageSize = ref(20)
const charLibraryTotal = ref(0)
const charLibraryKeyword = ref('')
const showEditCharLibrary = ref(false)
const editCharLibraryForm = ref(null)
const editCharLibrarySaving = ref(false)
let charLibraryKeywordTimer = null

async function loadCharLibraryList() {
  charLibraryLoading.value = true
  try {
    const res = await characterLibraryAPI.list({ page: charLibraryPage.value, page_size: charLibraryPageSize.value, keyword: charLibraryKeyword.value || undefined, global: 1 })
    charLibraryList.value = res?.items ?? []
    const p = res?.pagination ?? {}
    charLibraryTotal.value = p.total ?? 0
    if (p.page != null) charLibraryPage.value = p.page
    if (p.page_size != null) charLibraryPageSize.value = p.page_size
  } catch { charLibraryList.value = [] } finally { charLibraryLoading.value = false }
}
function debouncedLoadCharLibrary() {
  if (charLibraryKeywordTimer) clearTimeout(charLibraryKeywordTimer)
  charLibraryKeywordTimer = setTimeout(() => { charLibraryPage.value = 1; loadCharLibraryList() }, 300)
}
function openEditCharLibrary(item) {
  editCharLibraryForm.value = { id: item.id, name: item.name ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  showEditCharLibrary.value = true
}
async function submitEditCharLibrary() {
  if (!editCharLibraryForm.value?.id) return
  editCharLibrarySaving.value = true
  try {
    await characterLibraryAPI.update(editCharLibraryForm.value.id, { name: editCharLibraryForm.value.name, category: editCharLibraryForm.value.category || null, description: editCharLibraryForm.value.description || null, tags: editCharLibraryForm.value.tags || null, image_url: editCharLibraryForm.value.image_url || null, local_path: editCharLibraryForm.value.local_path ?? null })
    ElMessage.success('已保存')
    showEditCharLibrary.value = false
    loadCharLibraryList()
  } catch (e) { ElMessage.error(e.message || '保存失败') } finally { editCharLibrarySaving.value = false }
}
async function onDeleteCharLibrary(item) {
  try { await ElMessageBox.confirm(`确定删除公共角色「${(item.name || '未命名').slice(0, 20)}」吗？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await characterLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadCharLibraryList() } catch (e) { ElMessage.error(e.message || '删除失败') }
}

// 公共场景库
const showSceneLibrary = ref(false)
const sceneLibraryList = ref([])
const sceneLibraryLoading = ref(false)
const sceneLibraryPage = ref(1)
const sceneLibraryPageSize = ref(20)
const sceneLibraryTotal = ref(0)
const sceneLibraryKeyword = ref('')
const showEditSceneLibrary = ref(false)
const editSceneLibraryForm = ref(null)
const editSceneLibrarySaving = ref(false)
let sceneLibraryKeywordTimer = null

async function loadSceneLibraryList() {
  sceneLibraryLoading.value = true
  try {
    const res = await sceneLibraryAPI.list({ page: sceneLibraryPage.value, page_size: sceneLibraryPageSize.value, keyword: sceneLibraryKeyword.value || undefined, global: 1 })
    sceneLibraryList.value = res?.items ?? []
    const p = res?.pagination ?? {}
    sceneLibraryTotal.value = p.total ?? 0
    if (p.page != null) sceneLibraryPage.value = p.page
    if (p.page_size != null) sceneLibraryPageSize.value = p.page_size
  } catch { sceneLibraryList.value = [] } finally { sceneLibraryLoading.value = false }
}
function debouncedLoadSceneLibrary() {
  if (sceneLibraryKeywordTimer) clearTimeout(sceneLibraryKeywordTimer)
  sceneLibraryKeywordTimer = setTimeout(() => { sceneLibraryPage.value = 1; loadSceneLibraryList() }, 300)
}
function openEditSceneLibrary(item) {
  editSceneLibraryForm.value = { id: item.id, location: item.location ?? '', time: item.time ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  showEditSceneLibrary.value = true
}
async function submitEditSceneLibrary() {
  if (!editSceneLibraryForm.value?.id) return
  editSceneLibrarySaving.value = true
  try {
    await sceneLibraryAPI.update(editSceneLibraryForm.value.id, { location: editSceneLibraryForm.value.location, time: editSceneLibraryForm.value.time || null, category: editSceneLibraryForm.value.category || null, description: editSceneLibraryForm.value.description || null, tags: editSceneLibraryForm.value.tags || null, image_url: editSceneLibraryForm.value.image_url || null, local_path: editSceneLibraryForm.value.local_path ?? null })
    ElMessage.success('已保存')
    showEditSceneLibrary.value = false
    loadSceneLibraryList()
  } catch (e) { ElMessage.error(e.message || '保存失败') } finally { editSceneLibrarySaving.value = false }
}
async function onDeleteSceneLibrary(item) {
  const name = (item.location || item.time || '未命名').slice(0, 20)
  try { await ElMessageBox.confirm(`确定删除公共场景「${name}」吗？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await sceneLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadSceneLibraryList() } catch (e) { ElMessage.error(e.message || '删除失败') }
}

// 公共道具库
const showPropLibrary = ref(false)
const propLibraryList = ref([])
const propLibraryLoading = ref(false)
const propLibraryPage = ref(1)
const propLibraryPageSize = ref(20)
const propLibraryTotal = ref(0)
const propLibraryKeyword = ref('')
const showEditPropLibrary = ref(false)
const editPropLibraryForm = ref(null)
const editPropLibrarySaving = ref(false)
let propLibraryKeywordTimer = null

async function loadPropLibraryList() {
  propLibraryLoading.value = true
  try {
    const res = await propLibraryAPI.list({ page: propLibraryPage.value, page_size: propLibraryPageSize.value, keyword: propLibraryKeyword.value || undefined, global: 1 })
    propLibraryList.value = res?.items ?? []
    const p = res?.pagination ?? {}
    propLibraryTotal.value = p.total ?? 0
    if (p.page != null) propLibraryPage.value = p.page
    if (p.page_size != null) propLibraryPageSize.value = p.page_size
  } catch { propLibraryList.value = [] } finally { propLibraryLoading.value = false }
}
function debouncedLoadPropLibrary() {
  if (propLibraryKeywordTimer) clearTimeout(propLibraryKeywordTimer)
  propLibraryKeywordTimer = setTimeout(() => { propLibraryPage.value = 1; loadPropLibraryList() }, 300)
}
function openEditPropLibrary(item) {
  editPropLibraryForm.value = { id: item.id, name: item.name ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  showEditPropLibrary.value = true
}
async function submitEditPropLibrary() {
  if (!editPropLibraryForm.value?.id) return
  editPropLibrarySaving.value = true
  try {
    await propLibraryAPI.update(editPropLibraryForm.value.id, { name: editPropLibraryForm.value.name, category: editPropLibraryForm.value.category || null, description: editPropLibraryForm.value.description || null, tags: editPropLibraryForm.value.tags || null, image_url: editPropLibraryForm.value.image_url || null, local_path: editPropLibraryForm.value.local_path ?? null })
    ElMessage.success('已保存')
    showEditPropLibrary.value = false
    loadPropLibraryList()
  } catch (e) { ElMessage.error(e.message || '保存失败') } finally { editPropLibrarySaving.value = false }
}
async function onDeletePropLibrary(item) {
  try { await ElMessageBox.confirm(`确定删除公共道具「${(item.name || '未命名').slice(0, 20)}」吗？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await propLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadPropLibraryList() } catch (e) { ElMessage.error(e.message || '删除失败') }
}

const showNewDialog = ref(false)
const newForm = ref({ title: '', description: '', aspect_ratio: '16:9' })
const newSaving = ref(false)
const exportingId = ref(null)
const isAdmin = JSON.parse(localStorage.getItem('lmd_auth_user') || '{}').role === 'admin'
const importing = ref(false)
const importFileInput = ref(null)

const exampleList = ref([])
const importingExample = ref(null)

function loadExamples() {
  dramaAPI.listExamples()
    .then(res => { exampleList.value = Array.isArray(res) ? res : (res?.data ?? []) })
    .catch(() => { exampleList.value = [] })
}

async function onImportExample(ex) {
  importingExample.value = ex.filename
  try {
    const data = await dramaAPI.importExample(ex.filename)
    ElMessage.success(`示例导入成功：${data?.title || ex.name}`)
    loadList()
  } catch (e) {
    const msg = e.response?.data?.message || e.message || '导入失败'
    ElMessage.error(msg)
  } finally {
    importingExample.value = null
  }
}

const showEditDialog = ref(false)
const editForm = ref({ id: null, title: '', description: '' })
const editSaving = ref(false)

function loadList() {
  loading.value = true
  Promise.all([dramaAPI.list({ page: 1, page_size: 50 }), omniVideoAPI.listSequences(), omniVideoAPI.assets({ page: 1, page_size: 40 }).catch(() => ({ items: [] })), videosAPI.list({ page: 1, page_size: 12, status: 'completed' }).catch(() => ({ items: [] }))])
    .then(([dramaResult, omniResult, assetResult, videoResult]) => {
      dramas.value = dramaResult?.items ?? []
      total.value = dramaResult?.pagination?.total ?? 0
      omniProjects.value = omniResult ?? []
      workspaceAssets.value = assetResult?.items ?? []
      workspaceVideos.value = videoResult?.items ?? []
      heroVideoFailed.value = false
    })
    .catch(() => { dramas.value = []; omniProjects.value = []; workspaceAssets.value = []; workspaceVideos.value = [] })
    .finally(() => { loading.value = false })
}

function formatDate(val) {
  return formatChinaDateTime(val, '')
}

function formatStatus(status) {
  const map = { draft: '草稿', published: '已发布', archived: '已归档', generating: '生成中' }
  return map[status] || status || '草稿'
}

function formatStyle(style) {
  const map = {
    // 写实 / 影视
    realistic: '写实',
    cinematic: '电影感',
    documentary: '纪录片',
    noir: '黑色电影',
    'retro film': '复古胶片',
    horror: '恐怖',
    // 动漫 / 卡通
    'anime style': '日本动漫',
    anime: '日本动漫',
    'comic style': '欧美漫画',
    cartoon: '卡通',
    // 中国风格
    'ink wash': '国画水墨',
    'chinese style': '中国风',
    historical: '古装',
    wuxia: '武侠',
    // 绘画艺术
    watercolor: '水彩',
    'oil painting': '油画',
    sketch: '素描',
    'woodblock print': '版画',
    impressionist: '印象派',
    // 幻想 / 科幻
    fantasy: '奇幻',
    'dark fantasy': '暗黑奇幻',
    'sci-fi': '科幻',
    sci_fi: '科幻',
    cyberpunk: '赛博朋克',
    steampunk: '蒸汽朋克',
    'post-apocalyptic': '末世废土',
    // 数字 / 现代
    '3d render': '3D渲染',
    'pixel art': '像素风',
    'low poly': '低多边形',
    minimalist: '极简',
    dreamy: '唯美梦幻',
  }
  return map[style] || style
}

function formatGenre(genre) {
  const map = { drama: '剧情', comedy: '喜剧', adventure: '冒险', romance: '爱情', thriller: '悬疑', action: '动作', horror: '恐怖' }
  return map[genre] || genre
}

function totalStoryboards(d) {
  return (d.episodes || []).reduce((sum, ep) => sum + (ep.storyboards?.length || 0), 0)
}

function goNewProject() {
  showNewDialog.value = true
}

function resetNewForm() {
  newForm.value = { title: '', description: '', aspect_ratio: '16:9' }
}

async function submitNew() {
  const title = newForm.value.title?.trim()
  if (!title) return
  newSaving.value = true
  try {
    const drama = await dramaAPI.create({ title, description: newForm.value.description?.trim() || undefined, metadata: { aspect_ratio: newForm.value.aspect_ratio || '16:9' } })
    showNewDialog.value = false
    ElMessage.success('项目已创建')
    loadList()
    router.push('/film/' + drama.id)
  } catch (e) {
    ElMessage.error(e.message || '创建失败')
  } finally {
    newSaving.value = false
  }
}

function openEditDialog(d) {
  editForm.value = { id: d.id, title: d.title || '', description: d.description || '' }
  showEditDialog.value = true
}

function resetEditForm() {
  editForm.value = { id: null, title: '', description: '' }
}

async function submitEdit() {
  const title = editForm.value.title?.trim()
  if (!title || editForm.value.id == null) return
  editSaving.value = true
  try {
    await dramaAPI.update(editForm.value.id, { title, description: editForm.value.description?.trim() || undefined })
    showEditDialog.value = false
    ElMessage.success('已保存')
    loadList()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    editSaving.value = false
  }
}

function openProject(id) {
  router.push('/drama/' + id)
}

async function createOmniProject() {
  try {
    const project = await omniVideoAPI.createSequence()
    router.push({ path: '/free-create', query: { sequence_id: project.id } })
  } catch (e) {
    ElMessage.error(e.message || '创建全能创作项目失败')
  }
}

function openOmniProject(id) {
  router.push({ path: '/free-create', query: { sequence_id: id } })
}

async function deleteOmniProject(project) {
  try {
    await ElMessageBox.confirm(`删除“${project.name || '未命名全能项目'}”？已生成成片和素材会保留，进行中的供应商任务不会被取消。`, '删除全能项目', { type: 'warning' })
    await omniVideoAPI.deleteSequence(project.id)
    ElMessage.success('全能项目已删除，可在后续恢复列表中找回')
    loadList()
  } catch (_) {}
}

async function manageDeletedOmniProjects() {
  try {
    const projects = await omniVideoAPI.listDeletedSequences()
    if (!projects.length) return ElMessage.info('没有已删除的全能项目')
    const lines = projects.map((item) => `${item.id}：${item.name || '未命名全能项目'}（${item.shot_count || 0} 个镜头）`).join('\n')
    const { value } = await ElMessageBox.prompt(`${lines}\n\n输入项目 ID 恢复；输入 purge:ID 永久清理。永久清理只删除项目编排，保留成片、素材与任务历史。`, '已删除全能项目', { inputPlaceholder: '例如：12 或 purge:12' })
    const valueText = String(value || '').trim()
    if (!valueText) return
    const purge = valueText.startsWith('purge:'); const id = Number(purge ? valueText.slice(6) : valueText)
    if (!projects.some((item) => item.id === id)) throw new Error('请输入列表中的项目 ID')
    if (purge) await omniVideoAPI.purgeSequence(id); else await omniVideoAPI.restoreSequence(id)
    ElMessage.success(purge ? '项目编排已永久清理，成片与素材仍保留' : '全能项目已恢复')
    loadList()
  } catch (error) { if (error !== 'cancel') ElMessage.error(error.message || '操作失败') }
}

async function onExport(d) {
  if (exportingId.value) return
  exportingId.value = d.id
  try {
    const token = localStorage.getItem('lmd_auth_token')
    const res = await fetch(`/api/v1/dramas/${d.id}/export`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error('导出失败')
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${d.title || 'drama'}.zip`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
    ElMessage.success('开始下载')
  } catch (e) {
    ElMessage.error(e.message || '导出失败')
  } finally {
    exportingId.value = null
  }
}

function triggerImport() {
  importFileInput.value?.click()
}

async function onImportFile(e) {
  const file = e.target.files?.[0]
  if (!file) return
  e.target.value = ''
  if (!file.name.endsWith('.zip')) {
    ElMessage.error('请选择 .zip 格式的文件')
    return
  }
  importing.value = true
  try {
    const data = await dramaAPI.importDrama(file)
    ElMessage.success(`导入成功：${data?.title || '项目'}`) 
    loadList()
  } catch (e) {
    const msg = e.response?.data?.message || e.message || '导入失败'
    ElMessage.error(msg)
  } finally {
    importing.value = false
  }
}

async function onDelete(d) {
  try {
    await ElMessageBox.confirm(
      `确定要删除项目「${(d.title || '未命名').slice(0, 20)}${(d.title && d.title.length > 20) ? '…' : ''}」吗？此操作不可恢复。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await dramaAPI.delete(d.id)
    ElMessage.success('已删除')
    loadList()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

onMounted(async () => {
  loadList()
  loadExamples()
  try {
    const lock = await aiAPI.getVendorLock()
    vendorLockEnabled.value = !!lock?.enabled
  } catch (_) {}
})

onBeforeUnmount(() => { stopHeroRotation(); window.clearTimeout(heroVideoLayerTransitionTimer) })
</script>

<style scoped>
.film-list {
  min-height: 100vh;
  background: #08080d;
  color: #e4e4e7;
  background-image:
    radial-gradient(ellipse 70% 45% at 50% -10%, rgba(99, 102, 241, 0.18) 0%, transparent 70%),
    radial-gradient(ellipse 50% 35% at 85% 55%, rgba(139, 92, 246, 0.1) 0%, transparent 60%),
    radial-gradient(ellipse 40% 30% at 10% 80%, rgba(79, 70, 229, 0.08) 0%, transparent 60%);
}
.header {
  background: rgba(12, 12, 18, 0.82);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(99, 102, 241, 0.18);
  padding: 12px 24px;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 1px 0 rgba(99, 102, 241, 0.08), 0 4px 24px rgba(0, 0, 0, 0.3);
}
.header-inner {
  max-width: min(1400px, 96vw);
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: nowrap;
  min-width: 0;
}
.logo {
  margin: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1;
}
.logo-main {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #9dc8e5;
  -webkit-text-fill-color: #9dc8e5;
  filter: none;
}
.logo-sub {
  font-size: 0.68rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: #6d6d7a;
  -webkit-text-fill-color: #6d6d7a;
  filter: none;
}
.page-title {
  color: #a1a1aa;
  font-size: 0.95rem;
}
.header-library {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  flex: 0 0 auto;
}
.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-end;
  white-space: nowrap;
  overflow: visible;
}
.header-library .el-button,
.header-actions .el-button {
  flex: 0 0 auto;
  padding-inline: 10px;
  font-size: 13px;
}

/* 资源库按钮 —— 靛紫调 */
.btn-library {
  --el-button-bg-color: rgba(99, 102, 241, 0.12);
  --el-button-border-color: rgba(99, 102, 241, 0.35);
  --el-button-text-color: #a5b4fc;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.22);
  --el-button-hover-border-color: rgba(99, 102, 241, 0.55);
  --el-button-hover-text-color: #c7d2fe;
  --el-button-active-bg-color: rgba(99, 102, 241, 0.3);
  --el-button-active-border-color: rgba(99, 102, 241, 0.7);
}
html.light .btn-library {
  --el-button-bg-color: rgba(79, 70, 229, 0.08);
  --el-button-border-color: rgba(79, 70, 229, 0.3);
  --el-button-text-color: #3730a3;
  --el-button-hover-bg-color: rgba(79, 70, 229, 0.14);
  --el-button-hover-border-color: rgba(79, 70, 229, 0.5);
  --el-button-hover-text-color: #312e81;
  --el-button-active-bg-color: rgba(79, 70, 229, 0.2);
  --el-button-active-border-color: rgba(79, 70, 229, 0.65);
}

/* 主题切换按钮 */
.btn-theme {
  --el-button-bg-color: rgba(148, 163, 184, 0.1);
  --el-button-border-color: rgba(148, 163, 184, 0.3);
  --el-button-text-color: #94a3b8;
  --el-button-hover-bg-color: rgba(148, 163, 184, 0.2);
  --el-button-hover-border-color: rgba(148, 163, 184, 0.5);
  --el-button-hover-text-color: #cbd5e1;
  transition: all 0.2s;
}
html.light .btn-theme {
  --el-button-bg-color: rgba(99, 102, 241, 0.08);
  --el-button-border-color: rgba(99, 102, 241, 0.3);
  --el-button-text-color: #6366f1;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.15);
  --el-button-hover-border-color: rgba(99, 102, 241, 0.5);
  --el-button-hover-text-color: #4f46e5;
}

/* 微信我按钮 —— 绿调 */
/* AI配置按钮 —— 琥珀调 */
.btn-settings {
  --el-button-bg-color: rgba(234, 179, 8, 0.1);
  --el-button-border-color: rgba(234, 179, 8, 0.32);
  --el-button-text-color: #fcd34d;
  --el-button-hover-bg-color: rgba(234, 179, 8, 0.2);
  --el-button-hover-border-color: rgba(234, 179, 8, 0.5);
  --el-button-hover-text-color: #fde68a;
  --el-button-active-bg-color: rgba(234, 179, 8, 0.28);
  --el-button-active-border-color: rgba(234, 179, 8, 0.65);
}
html.light .btn-settings {
  --el-button-bg-color: rgba(180, 83, 9, 0.07);
  --el-button-border-color: rgba(180, 83, 9, 0.28);
  --el-button-text-color: #92400e;
  --el-button-hover-bg-color: rgba(180, 83, 9, 0.12);
  --el-button-hover-border-color: rgba(180, 83, 9, 0.45);
  --el-button-hover-text-color: #78350f;
  --el-button-active-bg-color: rgba(180, 83, 9, 0.18);
  --el-button-active-border-color: rgba(180, 83, 9, 0.6);
}

/* 导入按钮 —— 亮色模式下提升可读性 */
html.light .btn-import {
  --el-button-text-color: #374151;
  --el-button-border-color: #d1d5db;
  --el-button-hover-text-color: #1f2937;
  --el-button-hover-border-color: #9ca3af;
}

.main {
  max-width: min(1400px, 96vw);
  margin: 0 auto;
  padding: 24px 16px 48px;
}
.projects-wrap {
  min-height: 200px;
}
.projects-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin: 22px 0 18px;
}
.projects-kicker {
  margin: 0 0 7px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .12em;
}
.projects-heading h2 {
  margin: 0;
  color: var(--text-bright);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -.02em;
  line-height: 1.25;
}
.projects-heading p:not(.projects-kicker) {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 14px;
}
.projects-count {
  flex: none;
  color: var(--text-muted);
  font-size: 13px;
}
.empty {
  text-align: center;
  padding: 48px 24px;
}
.empty-title {
  font-size: 1.1rem;
  color: #e4e4e7;
  margin: 0 0 8px;
}
.empty-desc {
  color: #71717a;
  font-size: 0.9rem;
  margin: 0 0 20px;
}
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 18px;
}
.project-grid.is-empty {
  grid-template-columns: minmax(0, 720px);
  justify-content: start;
}
.project-card {
  position: relative;
  background: rgba(24, 24, 30, 0.75);
  border: 1px solid rgba(63, 63, 70, 0.6);
  border-radius: 14px;
  padding: 20px;
  cursor: pointer;
  transition: border-color 0.25s, background 0.25s, transform 0.25s, box-shadow 0.25s;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  overflow: hidden;
}
.project-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.04) 0%, transparent 60%);
  pointer-events: none;
}
.project-card:hover {
  border-color: rgba(99, 102, 241, 0.55);
  background: rgba(28, 28, 36, 0.9);
  transform: translateY(-3px);
  box-shadow: 0 12px 40px rgba(99, 102, 241, 0.15), 0 0 0 1px rgba(99, 102, 241, 0.1), 0 2px 8px rgba(0, 0, 0, 0.4);
}
.omni-project-card {
  border-color: rgba(108, 140, 255, 0.45);
  background: linear-gradient(135deg, rgba(69, 92, 171, 0.16), rgba(24, 24, 30, 0.86));
}
.badge-omni {
  color: #a9bbff;
  background: rgba(108, 140, 255, 0.16);
  border: 1px solid rgba(108, 140, 255, 0.3);
}

/* 操作卡片 */
.action-card {
  cursor: default;
  border-style: dashed;
  border-color: rgba(99, 102, 241, 0.4);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.06) 0%, rgba(139, 92, 246, 0.04) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 40px rgba(99, 102, 241, 0.04);
}
.project-grid.is-empty .action-card {
  min-height: 238px;
  padding: 30px 34px;
  border-style: solid;
}
.project-grid.is-empty .action-card-inner {
  align-items: flex-start;
  max-width: 560px;
}
.project-grid.is-empty .action-card-title {
  font-size: 18px;
}
.project-grid.is-empty .action-card-title::after {
  content: '从一个简短想法开始，建立完整的短剧制作流程。';
  display: block;
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 400;
  line-height: 1.6;
}
.project-grid.is-empty .action-card-buttons { justify-content: flex-start; }
.action-card:hover {
  border-color: rgba(99, 102, 241, 0.65);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.07) 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 30px rgba(99, 102, 241, 0.12), inset 0 0 40px rgba(99, 102, 241, 0.06);
}
.action-card::before {
  display: none;
}
.action-card-inner {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.action-card-title {
  font-size: 1rem;
  font-weight: 600;
  color: #a5b4fc;
  margin: 0;
}
.action-card-buttons {
  display: flex;
  gap: 12px;
  width: 100%;
  justify-content: center;
}
.action-btn {
  min-width: 150px;
}
.action-btn-new {
  --el-button-bg-color: var(--el-color-primary);
}
.action-btn-import {
  --el-button-bg-color: rgba(99, 102, 241, 0.12);
  --el-button-border-color: rgba(99, 102, 241, 0.35);
  --el-button-text-color: #a5b4fc;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.22);
  --el-button-hover-border-color: rgba(99, 102, 241, 0.55);
  --el-button-hover-text-color: #c7d2fe;
}
.action-card-example {
  width: 100%;
  padding-top: 8px;
  border-top: 1px solid rgba(99, 102, 241, 0.15);
}
.workspace-links {
  cursor: default;
  display: flex;
  min-height: 170px;
  flex-direction: column;
  gap: 14px;
}
.workspace-links-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.workspace-links-heading h3 { margin: 2px 0 0; font-size: 16px; font-weight: 600; color: var(--text-primary); }
.workspace-links-heading > span { color: var(--text-faint); font-size: 11px; }
.workspace-kicker { margin: 0; color: var(--text-muted); font-size: 10px; font-weight: 600; letter-spacing: .12em; }
.workspace-links > p { margin: 0; color: var(--text-muted); font-size: 13px; line-height: 1.55; }
.workspace-link-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: auto; }
.workspace-link-list .el-button { min-width: 0; padding-inline: 8px; }
.example-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  margin-bottom: 8px;
}
.example-hint-icon {
  color: #a5b4fc;
  font-size: 15px;
}
.example-hint-text {
  font-size: 0.8rem;
  color: #71717a;
}
.example-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.example-btn {
  --el-button-bg-color: rgba(34, 197, 94, 0.1);
  --el-button-border-color: rgba(34, 197, 94, 0.3);
  --el-button-text-color: #4ade80;
  --el-button-hover-bg-color: rgba(34, 197, 94, 0.2);
  --el-button-hover-border-color: rgba(34, 197, 94, 0.5);
  --el-button-hover-text-color: #22c55e;
}
.project-card-body {
  padding-right: 56px;
}
.project-title {
  font-size: 1.05rem;
  margin: 0 0 8px;
  color: #fafafa;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-desc {
  font-size: 0.875rem;
  color: #a1a1aa;
  margin: 0 0 12px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.project-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 10px;
}
.badge {
  display: inline-flex;
  align-items: center;
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 99px;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
}
.badge-status--draft {
  background: rgba(113, 113, 122, 0.15);
  color: #a1a1aa;
  border: 1px solid rgba(113, 113, 122, 0.3);
}
.badge-status--published {
  background: rgba(34, 197, 94, 0.12);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.3);
}
.badge-status--generating {
  background: rgba(234, 179, 8, 0.12);
  color: #fcd34d;
  border: 1px solid rgba(234, 179, 8, 0.3);
}
.badge-status--archived {
  background: rgba(99, 102, 241, 0.1);
  color: #a5b4fc;
  border: 1px solid rgba(99, 102, 241, 0.25);
}
.badge-episodes {
  background: rgba(14, 165, 233, 0.12);
  color: #38bdf8;
  border: 1px solid rgba(14, 165, 233, 0.28);
}
.badge-storyboards {
  background: rgba(20, 184, 166, 0.12);
  color: #2dd4bf;
  border: 1px solid rgba(20, 184, 166, 0.28);
}
.badge-ratio {
  background: rgba(251, 146, 60, 0.1);
  color: #fb923c;
  border: 1px solid rgba(251, 146, 60, 0.25);
  font-family: monospace;
}
.badge-style {
  background: rgba(168, 85, 247, 0.1);
  color: #4b91c8;
  border: 1px solid rgba(168, 85, 247, 0.25);
}
.badge-genre {
  background: rgba(249, 115, 22, 0.1);
  color: #fb923c;
  border: 1px solid rgba(249, 115, 22, 0.25);
}
.project-meta {
  font-size: 0.75rem;
  color: #71717a;
  margin: 0;
}
.project-card-actions {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 6px;
}
.project-card-actions .el-button {
  --el-button-size: 28px;
  padding: 0;
}
.project-card-actions .el-button .el-icon {
  font-size: 14px;
}

/* 公共库弹窗 */
:global(.library-dialog .el-dialog__body) { padding-top: 8px; }

/* 编辑弹框内图片区 */
.lib-img-editor { display: flex; align-items: center; gap: 14px; }
.lib-img-thumb { width: 88px; height: 88px; border-radius: 8px; overflow: hidden; cursor: zoom-in; background: var(--bg-inner, #1c1c1e); border: 1px solid var(--border-color, #27272a); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.lib-img-thumb img { width: 100%; height: 100%; object-fit: cover; }
.lib-img-empty { color: var(--text-faint, #52525b); font-size: 26px; }
.lib-img-btns { display: flex; flex-direction: column; gap: 8px; }
.library-toolbar { margin-bottom: 12px; }
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
  padding: 10px;
  background: #1c1c1e;
  border: 1px solid #27272a;
  border-radius: 8px;
}
.library-item-cover {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  background: #27272a;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.library-item-cover img { width: 100%; height: 100%; object-fit: cover; }
.library-item-placeholder { font-size: 0.8rem; color: #71717a; }
.library-item-info { flex: 1; min-width: 0; }
.library-item-name { font-weight: 500; margin-bottom: 4px; color: #fafafa; }
.library-item-desc { font-size: 0.85rem; color: #a1a1aa; margin-bottom: 8px; }
.library-item-actions { display: flex; gap: 8px; }
.library-empty { text-align: center; color: #71717a; padding: 40px 20px; }
.library-pagination { margin-top: 12px; display: flex; justify-content: center; }

/* ===== 亮色模式适配 ===== */
html.light .film-list {
  background: #f4f7f8;
  color: #1e2d38;
  background-image: none;
}
html.light .header {
  background: rgba(248, 246, 255, 0.88);
  border-bottom-color: rgba(99, 102, 241, 0.2);
  box-shadow: 0 1px 0 rgba(99, 102, 241, 0.1), 0 4px 16px rgba(99, 102, 241, 0.06);
}
html.light .logo-main {
  background: none;
  color: #3479ae;
  -webkit-text-fill-color: #3479ae;
  filter: none;
}
html.light .logo-sub {
  color: #9ca3af;
  -webkit-text-fill-color: #9ca3af;
}
html.light .project-card {
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(199, 210, 254, 0.8);
  box-shadow: 0 1px 4px rgba(99, 102, 241, 0.06), 0 2px 12px rgba(0, 0, 0, 0.04);
  backdrop-filter: none;
}
html.light .project-card::before {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.03) 0%, transparent 60%);
}
html.light .project-card:hover {
  border-color: rgba(99, 102, 241, 0.5);
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 12px 36px rgba(99, 102, 241, 0.12), 0 0 0 1px rgba(99, 102, 241, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06);
}
html.light .action-card {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.06) 0%, rgba(139, 92, 246, 0.04) 100%);
  border-color: rgba(99, 102, 241, 0.35);
}
html.light .action-card:hover {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.07) 100%);
  border-color: rgba(99, 102, 241, 0.55);
}
html.light .action-card-title { color: #4f46e5; }
html.light .project-title { color: #1e1b4b; }
html.light .project-desc { color: #4b5563; }
html.light .project-meta { color: #6b7280; }
html.light .example-hint-text { color: #6b7280; }
html.light .library-item {
  background: #faf9ff;
  border-color: #e5e7eb;
}
html.light .library-item-name { color: #1e1b4b; }
html.light .library-item-desc { color: #4b5563; }
html.light .library-empty { color: #6b7280; }
html.light .lib-img-thumb {
  background: #f3f4f6;
  border-color: #e5e7eb;
}
html.light .lib-img-empty { color: #9ca3af; }
html.light .badge-status--draft {
  background: rgba(107, 114, 128, 0.1);
  color: #4b5563;
  border-color: rgba(107, 114, 128, 0.25);
}

/* ===== 图片放大预览 ===== */
.image-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  cursor: zoom-out;
}
.image-preview-img {
  max-width: 90vw;
  max-height: 90vh;
  border-radius: 8px;
  object-fit: contain;
}
/* LensRhyme monochrome project desk */
/* Modern creative-product home: brand navigation and an editorial project canvas. */
.film-list{background:var(--bg-page);background-image:radial-gradient(70% 50% at 8% -10%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 68%),radial-gradient(42% 38% at 100% 35%,color-mix(in srgb,var(--accent-teal) 9%,transparent),transparent 72%)}
.header{padding:13px 24px;border-bottom-color:var(--border-subtle);box-shadow:none}
.header-inner{max-width:min(1520px,96vw);gap:12px}
.logo{position:relative;min-width:146px;padding-left:38px}
.logo::before{content:'◢';position:absolute;left:0;top:0;display:grid;place-items:center;width:30px;height:30px;border-radius:10px;background:linear-gradient(145deg,var(--accent),#42d3c7);color:#fff;font-size:14px;box-shadow:0 8px 22px color-mix(in srgb,var(--accent) 30%,transparent)}
.logo-main{font-size:15px;font-weight:720;letter-spacing:-.025em}.logo-sub{font-size:10px;letter-spacing:.08em;text-transform:uppercase}
.header-library{display:flex;flex:0 0 auto;margin-left:8px;padding:4px;border:1px solid var(--border-subtle);border-radius:12px;background:color-mix(in srgb,var(--bg-raised) 74%,transparent)}
.header-library .el-button,.header-actions .el-button{height:34px;border-radius:9px!important}
.header-actions{gap:4px}.header-actions .btn-library,.header-actions .btn-settings,.header-actions .btn-theme,.header-actions .btn-import{border-color:transparent!important;background:transparent!important;box-shadow:none!important}
.header-more{flex:0 0 auto}.btn-more{height:34px!important;border-color:transparent!important;background:transparent!important}.btn-more::after{content:'•••';margin-left:6px;color:var(--text-faint);letter-spacing:1px}
.header-actions .btn-new{margin-left:6px;height:36px;padding-inline:16px}
.main{max-width:min(1520px,96vw);padding:42px 20px 64px}
.projects-heading{position:relative;align-items:center;margin:8px 0 26px;padding:0 4px}
.projects-heading::after{content:'';position:absolute;right:84px;top:-18px;width:160px;height:80px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 13%,transparent),transparent 70%);filter:blur(8px);pointer-events:none}
.projects-kicker{color:var(--accent);font-size:10px;letter-spacing:.18em}
.projects-heading h2{font-size:clamp(28px,3vw,38px);font-weight:700;letter-spacing:-.045em}
.projects-heading p:not(.projects-kicker){max-width:560px;font-size:15px}
.projects-count{padding:6px 10px;border:1px solid var(--border-subtle);border-radius:999px;background:color-mix(in srgb,var(--bg-surface) 72%,transparent)}
.project-grid{grid-template-columns:repeat(12,minmax(0,1fr));gap:16px}
.project-card{grid-column:span 4;min-height:170px;padding:22px;border-color:var(--border-subtle);background:color-mix(in srgb,var(--bg-surface) 92%,transparent);backdrop-filter:blur(16px)}
.project-card::before{display:block;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 7%,transparent),transparent 55%)}
.action-card{grid-column:span 5;align-items:flex-start;justify-content:flex-end;min-height:198px;border-style:solid!important;background:radial-gradient(circle at 88% 10%,color-mix(in srgb,var(--accent-teal) 18%,transparent),transparent 42%),linear-gradient(135deg,color-mix(in srgb,var(--accent) 18%,var(--bg-surface)),var(--bg-surface))!important}
.action-card::after{content:'IDEA → SHOT → FILM';position:absolute;right:22px;top:21px;color:color-mix(in srgb,var(--text-primary) 52%,transparent);font-size:10px;font-weight:700;letter-spacing:.14em}
.action-card-inner{align-items:flex-start;justify-content:flex-end;height:100%;gap:14px}.action-card-title{color:var(--text-primary);font-size:21px;font-weight:700}.action-card-buttons{justify-content:flex-start}
.workspace-links{grid-column:span 3;min-height:198px;background:color-mix(in srgb,var(--bg-raised) 75%,var(--bg-surface))!important}
.omni-project-card{grid-column:span 4;min-height:198px;border-color:color-mix(in srgb,var(--accent) 35%,var(--border-color));background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 12%,var(--bg-surface)),var(--bg-surface))!important}
.omni-project-card::after{content:'▶';position:absolute;right:22px;bottom:20px;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--accent);color:#fff;font-size:12px;box-shadow:0 8px 22px color-mix(in srgb,var(--accent) 30%,transparent)}
.workspace-link-list{grid-template-columns:1fr;gap:6px}.workspace-link-list .el-button{justify-content:flex-start;margin:0;border-color:transparent!important;background:transparent!important}
.badge{border-color:color-mix(in srgb,var(--border-color) 72%,transparent)!important;background:color-mix(in srgb,var(--bg-raised) 72%,transparent)!important}
html.light .film-list{background-image:radial-gradient(70% 50% at 8% -10%,rgba(103,87,217,.13),transparent 68%),radial-gradient(42% 38% at 100% 35%,rgba(8,127,120,.07),transparent 72%)}
html.light .project-card{background:rgba(255,255,255,.72)!important}
@media(max-width:1180px){.action-card{grid-column:span 7}.workspace-links{grid-column:span 5}.project-card,.omni-project-card{grid-column:span 6}}
@media(max-width:880px){.header-actions .btn-library,.header-actions .btn-import{display:none}}
@media(max-width:760px){.header{padding:10px 12px}.logo{min-width:118px}.header-library{margin-left:0}.header-library .el-button{font-size:0!important;padding-inline:9px}.header-library .el-icon{font-size:15px}.header-actions .btn-library,.header-actions .btn-settings,.header-actions .btn-import{display:none}.header-actions .btn-theme{font-size:0!important;padding-inline:9px}.header-actions .btn-theme .el-icon{font-size:15px}.main{padding:28px 12px 44px}.project-grid{display:grid;grid-template-columns:1fr}.project-card,.action-card,.workspace-links,.omni-project-card{grid-column:1}.projects-heading h2{font-size:28px}}
/* UI refactor pass 1: this page consumes the shared theme contract instead of a parallel palette. */
.film-list{background:var(--bg-page);color:var(--text-primary);background-image:radial-gradient(70% 50% at 8% -10%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 68%),radial-gradient(42% 38% at 100% 35%,color-mix(in srgb,var(--accent-teal) 9%,transparent),transparent 72%)}.header{background:color-mix(in srgb,var(--bg-surface) 86%,transparent);border-bottom-color:var(--border-subtle);box-shadow:0 1px 0 color-mix(in srgb,var(--accent) 9%,transparent),var(--shadow-sm)}.logo-main{color:var(--text-primary);-webkit-text-fill-color:var(--text-primary)}.logo-sub{color:var(--text-muted);-webkit-text-fill-color:var(--text-muted)}.header-library{border:1px solid var(--border-subtle);border-radius:12px;background:color-mix(in srgb,var(--bg-raised) 74%,transparent)}.header-library .el-button,.header-actions .el-button{height:34px;border-radius:9px!important}.project-card{border-color:var(--border-subtle);background:color-mix(in srgb,var(--bg-surface) 92%,transparent);box-shadow:var(--shadow-sm)}.project-card:hover{border-color:color-mix(in srgb,var(--accent) 52%,var(--border-color));box-shadow:var(--shadow-md)}.action-card{background:radial-gradient(circle at 88% 10%,color-mix(in srgb,var(--accent-teal) 18%,transparent),transparent 42%),linear-gradient(135deg,color-mix(in srgb,var(--accent) 18%,var(--bg-surface)),var(--bg-surface))!important}.workspace-links{background:color-mix(in srgb,var(--bg-raised) 75%,var(--bg-surface))!important}html.light .film-list{background-image:radial-gradient(70% 50% at 8% -10%,color-mix(in srgb,var(--accent) 13%,transparent),transparent 68%),radial-gradient(42% 38% at 100% 35%,color-mix(in srgb,var(--accent-teal) 7%,transparent),transparent 72%)}
@media(max-width:760px){.header-inner{gap:6px}.logo{min-width:0;padding-left:0}.logo::before{display:none}.richi-brand-mark{width:30px;height:30px;flex-basis:30px}.richi-brand-copy{display:none}.header-actions{gap:4px;overflow:hidden}.header-actions :deep(.account-balance){display:none}.header-actions .btn-new{margin-left:0;padding-inline:12px}.header-more .btn-more{padding-inline:8px}}

/* Editorial entry point: the project desk opens as a focused creative studio. */
.studio-hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(320px, .92fr);
  min-height: 354px;
  margin: 4px 0 52px;
  padding: clamp(28px, 4vw, 58px);
  overflow: hidden;
  isolation: isolate;
  border: 1px solid color-mix(in srgb, var(--border-strong) 54%, transparent);
  border-radius: 24px;
  background:
    linear-gradient(115deg, color-mix(in srgb, var(--bg-raised) 96%, #020408), color-mix(in srgb, var(--bg-surface) 86%, #070a10));
  box-shadow: 0 24px 70px rgba(0, 0, 0, .22);
}
.studio-hero::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 0;
  opacity: .42;
  background-image: radial-gradient(color-mix(in srgb, var(--text-faint) 28%, transparent) .7px, transparent .7px);
  background-size: 14px 14px;
  mask-image: linear-gradient(90deg, #000 0 36%, transparent 75%);
}
.studio-hero::after {
  content: '';
  position: absolute;
  z-index: -1;
  right: -17%; top: -52%;
  width: 76%; aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--accent) 27%, transparent), transparent 64%);
  filter: blur(8px);
}
.studio-hero-copy { position: relative; z-index: 2; display: flex; flex-direction: column; justify-content: center; max-width: 610px; }
.studio-hero-kicker { display: flex; align-items: center; gap: 8px; margin: 0 0 16px; color: var(--accent-teal); font-size: 10px; font-weight: 760; letter-spacing: .18em; }
.studio-hero-kicker span { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-teal); box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent-teal) 16%, transparent); }
.studio-hero h2 { max-width: 600px; margin: 0; color: var(--text-bright); font-size: clamp(36px, 4.2vw, 58px); font-weight: 720; line-height: 1.08; letter-spacing: -.065em; }
.studio-hero h2 em { display: block; font-style: normal; color: color-mix(in srgb, var(--text-primary) 72%, var(--accent)); }
.studio-hero-copy > p:not(.studio-hero-kicker) { max-width: 505px; margin: 19px 0 25px; color: var(--text-muted); font-size: 15px; line-height: 1.75; }
.studio-hero-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 50px; }
.studio-hero-actions .el-button { min-height: 44px; padding-inline: 18px; }
.studio-hero-visual { position: relative; min-height: 225px; overflow: hidden; }
.visual-orbit { position: absolute; border: 1px solid color-mix(in srgb, var(--accent) 34%, transparent); border-radius: 50%; transform: rotate(-26deg); }
.visual-orbit-a { right: -20px; top: 1px; width: 264px; height: 392px; }
.visual-orbit-b { right: 49px; top: 36px; width: 168px; height: 290px; border-color: color-mix(in srgb, var(--accent-teal) 34%, transparent); }
.visual-frame { position: absolute; display: flex; flex-direction: column; justify-content: space-between; padding: 15px; border: 1px solid color-mix(in srgb, var(--text-primary) 24%, transparent); border-radius: 13px; background: linear-gradient(135deg, color-mix(in srgb, var(--bg-elevated) 80%, transparent), color-mix(in srgb, var(--bg-page) 78%, transparent)); box-shadow: 0 20px 38px rgba(0, 0, 0, .22); backdrop-filter: blur(7px); }
.visual-frame span { color: var(--text-faint); font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .12em; }
.visual-frame b { color: var(--text-primary); font-size: 11px; letter-spacing: .16em; }
.visual-frame-main { right: 60px; top: 24px; width: 180px; height: 138px; transform: rotate(7deg); }
.visual-frame-main i { width: 68px; height: 3px; background: var(--accent); box-shadow: 0 8px 0 color-mix(in srgb, var(--accent) 48%, transparent), 0 16px 0 color-mix(in srgb, var(--accent) 22%, transparent); }
.visual-frame-side { right: 190px; top: 122px; width: 142px; height: 106px; transform: rotate(-12deg); opacity: .87; }
.visual-play { position: absolute; z-index: 2; right: 109px; top: 122px; display: grid; width: 47px; height: 47px; place-items: center; padding-left: 2px; border: 1px solid color-mix(in srgb, #fff 44%, transparent); border-radius: 50%; background: var(--accent); color: #fff; font-size: 15px; box-shadow: 0 10px 30px color-mix(in srgb, var(--accent) 48%, transparent); }
.studio-hero-visual > p { position: absolute; right: 11px; bottom: 5px; margin: 0; color: color-mix(in srgb, var(--text-primary) 62%, transparent); font: 750 10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .12em; text-align: right; }
.studio-stats { position: absolute; z-index: 3; bottom: 22px; left: clamp(28px, 4vw, 58px); display: flex; gap: clamp(20px, 4vw, 54px); margin: 0; }
.studio-stats div { min-width: 76px; }
.studio-stats dt { color: var(--text-primary); font-size: 20px; font-weight: 680; letter-spacing: -.04em; }
.studio-stats dd { margin: 3px 0 0; color: var(--text-faint); font-size: 11px; }
@media (hover: hover) { .studio-hero-actions .el-button:hover { transform: translateY(-1px); } .visual-play { transition: transform var(--motion-fast) var(--motion-ease), box-shadow var(--motion-fast) var(--motion-ease); } .studio-hero:hover .visual-play { transform: scale(1.06); box-shadow: 0 13px 38px color-mix(in srgb, var(--accent) 58%, transparent); } }
@media (max-width: 760px) { .studio-hero { grid-template-columns: 1fr; min-height: 0; margin-bottom: 34px; padding: 29px 24px 110px; border-radius: 19px; } .studio-hero-actions { margin-bottom: 0; } .studio-hero h2 { font-size: clamp(33px, 11vw, 44px); } .studio-hero-visual { position: absolute; right: -68px; bottom: 22px; width: 280px; min-height: 150px; opacity: .58; } .visual-frame-main { right: 50px; top: 16px; transform: scale(.74) rotate(7deg); transform-origin: top right; } .visual-frame-side { right: 136px; top: 88px; transform: scale(.7) rotate(-12deg); transform-origin: top right; } .visual-play { right: 86px; top: 90px; transform: scale(.8); } .visual-orbit-a { transform: scale(.75) rotate(-26deg); transform-origin: top right; } .visual-orbit-b { transform: scale(.7) rotate(-26deg); transform-origin: top right; } .studio-hero-visual > p { display: none; } .studio-stats { bottom: 20px; left: 24px; gap: 17px; } .studio-stats dt { font-size: 17px; } .studio-stats dd { font-size: 10px; } }

/* Project desk v2 — a cinematic work surface, not a generic card catalogue. */
@media (min-width: 961px) {
  .main { max-width: min(1740px, calc(100vw - 56px)); padding: 34px 0 84px; }
  .header-inner { max-width: min(1740px, calc(100vw - 56px)); }
}
.film-list { background-image: radial-gradient(70% 54% at 50% -28%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 72%), linear-gradient(180deg, #080b12 0, var(--bg-page) 32rem); }
.studio-hero { min-height: clamp(420px, 50vw, 590px); grid-template-columns: minmax(0, .98fr) minmax(420px, 1.02fr); margin: 10px 0 68px; padding: clamp(38px, 5vw, 76px); border-radius: 30px; background: linear-gradient(112deg, color-mix(in srgb, var(--bg-raised) 98%, #010205), color-mix(in srgb, var(--bg-surface) 88%, #0b0d1a)); box-shadow: 0 38px 95px rgba(0, 0, 0, .32); }
.studio-hero::before { opacity: .6; background-size: 11px 11px; mask-image: linear-gradient(90deg, #000 0 56%, transparent 94%); }
.studio-hero::after { right: -6%; top: -22%; width: 68%; opacity: .82; }
.studio-hero-copy { max-width: 655px; }
.studio-hero h2 { max-width: 645px; font-size: clamp(48px, 5.4vw, 83px); line-height: .98; letter-spacing: -.078em; }
.studio-hero-copy > p:not(.studio-hero-kicker) { max-width: 535px; margin: 27px 0 31px; font-size: 16px; }
.studio-hero-kicker { margin-bottom: 22px; font-size: 11px; }
.studio-hero-actions { margin-bottom: 70px; }
.studio-hero-actions .el-button { min-height: 50px; padding-inline: 23px; }
.studio-hero-visual { min-height: 330px; align-self: center; }
.visual-orbit-a { right: 8px; top: -23px; width: 390px; height: 505px; }
.visual-orbit-b { right: 107px; top: 42px; width: 255px; height: 374px; }
.visual-frame-main { right: 100px; top: 33px; width: 242px; height: 184px; padding: 21px; border-radius: 17px; }
.visual-frame-side { right: 262px; top: 168px; width: 187px; height: 140px; padding: 17px; }
.visual-play { right: 154px; top: 173px; width: 59px; height: 59px; font-size: 18px; }
.studio-hero-visual > p { right: 31px; bottom: 20px; font-size: 11px; }
.studio-stats { bottom: 42px; left: clamp(38px, 5vw, 76px); gap: clamp(38px, 5vw, 74px); }
.studio-stats div { min-width: 108px; }
.studio-stats dt { font-size: 25px; }.studio-stats dd { margin-top: 5px; font-size: 12px; }
.projects-heading { align-items:end; margin: 0 0 22px; padding: 0 8px; }
.projects-heading h2 { font-size: clamp(32px, 3vw, 48px); }.projects-heading p:not(.projects-kicker) { font-size: 15px; }.projects-count { padding: 9px 15px; }
.project-grid { grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 18px; align-items:stretch; }
.project-card { grid-column: span 4; display: grid; grid-template-columns: 118px minmax(0, 1fr); min-height: 210px; padding: 12px; border-radius: 18px; background: color-mix(in srgb, var(--bg-surface) 88%, transparent); box-shadow: 0 10px 26px rgba(0,0,0,.12); }
.project-card::before { background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 13%, transparent), transparent 46%); }
.project-card:hover { transform: translateY(-4px); border-color: color-mix(in srgb, var(--accent) 62%, var(--border-color)); box-shadow: 0 22px 42px rgba(0,0,0,.22); }
.project-card-cover { position: relative; z-index: 1; display:flex; flex-direction:column; justify-content:space-between; min-width:0; overflow:hidden; padding:13px; border:1px solid color-mix(in srgb,var(--text-primary) 15%,transparent); border-radius:12px; background: radial-gradient(circle at 75% 22%, color-mix(in srgb,var(--accent) 52%, transparent), transparent 24%), linear-gradient(145deg, #252d54, #101522 68%); }
.project-card-cover::after { content:''; position:absolute; right:-31px; bottom:-52px; width:124px; height:124px; border:1px solid color-mix(in srgb,var(--text-primary) 36%,transparent); border-radius:50%; box-shadow:0 0 0 18px color-mix(in srgb,var(--accent-teal) 12%,transparent); }
.project-card:nth-of-type(3n) .project-card-cover { background:radial-gradient(circle at 24% 70%, color-mix(in srgb,var(--accent-teal) 42%,transparent),transparent 26%),linear-gradient(145deg,#173d45,#101522 68%); }.project-card:nth-of-type(4n) .project-card-cover { background:radial-gradient(circle at 75% 22%,rgba(255,168,92,.36),transparent 26%),linear-gradient(145deg,#3a2935,#101522 68%); }
.project-card-cover span,.project-card-cover b { position:relative;z-index:1;color:#fff;font:700 10px/1 ui-monospace,monospace;letter-spacing:.1em; }.project-card-cover b { color:color-mix(in srgb,#fff 68%,transparent); font-size:9px; }.project-card-cover i { position:relative;z-index:1;align-self:center;width:34px;height:34px;border:1px solid color-mix(in srgb,#fff 48%,transparent);border-radius:50%;box-shadow:0 0 0 7px color-mix(in srgb,#fff 8%,transparent); }
.project-card-cover--omni { background:radial-gradient(circle at 68% 25%,color-mix(in srgb,var(--accent) 62%,transparent),transparent 27%),linear-gradient(145deg,#32325c,#0d101d 68%)!important; }.project-card-cover--omni span { display:grid;place-items:center;align-self:center;width:42px;height:42px;border-radius:50%;background:var(--accent);box-shadow:0 9px 22px color-mix(in srgb,var(--accent) 54%,transparent);font-size:14px; }
.project-card-body { z-index:1; display:flex; flex-direction:column; padding:8px 10px 7px 15px; min-width:0; }.project-title { margin:0 0 9px;font-size:17px; }.project-desc { margin:0 0 13px;font-size:13px;line-height:1.55; }.project-badges { margin-top:auto;margin-bottom:10px; }.project-meta { font-size:11px; }
.project-card-actions { z-index:3; top:15px; right:15px; }.project-card-actions .el-button { opacity:.68; }
.action-card { grid-column:span 7; display:flex; min-height:270px; padding:31px; border:none!important; border-radius:20px; background:linear-gradient(128deg,color-mix(in srgb,var(--accent) 28%,var(--bg-surface)),color-mix(in srgb,var(--bg-surface) 94%,#101521))!important; }.action-card::after { right:30px;top:29px;font-size:11px; }.action-card-inner { position:relative;z-index:2;max-width:440px;align-items:flex-start;justify-content:center;gap:18px; }.action-card-title { font-size:30px;letter-spacing:-.05em; }.action-card-title::after { content:'从一个想法进入完整的短剧制作流程。';display:block;margin-top:10px;max-width:300px;color:var(--text-muted);font-size:14px;font-weight:400;line-height:1.6;letter-spacing:0; }.action-card-buttons { justify-content:flex-start; }.action-card-example { max-width:400px; }.example-hint,.example-list { justify-content:flex-start; }
.workspace-links { grid-column:span 5; display:flex; min-height:270px; padding:28px; border-radius:20px; background:linear-gradient(150deg,color-mix(in srgb,var(--bg-raised) 92%,transparent),color-mix(in srgb,var(--bg-surface) 78%,transparent))!important; }.workspace-links-heading h3 { font-size:23px;letter-spacing:-.04em; }.workspace-links > p { max-width:400px; }.workspace-link-list { grid-template-columns:repeat(3,1fr);gap:7px; }.workspace-link-list .el-button { min-height:44px;align-items:center;justify-content:center;flex-direction:column;gap:3px;font-size:11px; }
@media (max-width:1180px) { .studio-hero { grid-template-columns:minmax(0,1fr) 380px; }.project-card{grid-column:span 6}.action-card{grid-column:span 7}.workspace-links{grid-column:span 5}.workspace-link-list{grid-template-columns:1fr}.workspace-link-list .el-button{align-items:flex-start;justify-content:flex-start;flex-direction:row;} }
@media (max-width:760px) { .main{padding:18px 12px 56px}.studio-hero{grid-template-columns:1fr;min-height:470px;margin:0 0 42px;padding:31px 25px 120px;border-radius:22px}.studio-hero h2{font-size:47px;line-height:1.01}.studio-hero-copy>p:not(.studio-hero-kicker){font-size:14px}.studio-hero-actions .el-button{min-height:44px;padding-inline:15px}.projects-heading{padding:0;margin-bottom:16px}.projects-heading h2{font-size:32px}.project-grid{gap:12px}.project-card,.action-card,.workspace-links{grid-column:1;min-height:auto}.project-card{grid-template-columns:96px 1fr;padding:9px;border-radius:15px}.project-card-cover{min-height:132px;padding:10px}.project-card-body{padding:7px 6px 6px 12px}.project-title{font-size:15px}.project-desc{font-size:12px;margin-bottom:8px}.action-card,.workspace-links{padding:24px;min-height:230px;border-radius:17px}.action-card-title{font-size:27px}.workspace-link-list{grid-template-columns:repeat(3,1fr)}.workspace-link-list .el-button{min-height:42px;align-items:center;justify-content:center;flex-direction:column;font-size:10px}.studio-stats{bottom:22px}.studio-stats div{min-width:78px}.studio-stats dt{font-size:18px}.studio-stats dd{font-size:10px} }

/* Major project desk rebuild: stage, dock, horizontal production lane and editorial ledger. */
.creative-stage {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(360px, .88fr);
  gap: clamp(2rem, 5vw, 6rem);
  min-height: clamp(34rem, 70vh, 47rem);
  padding: clamp(2.5rem, 6vw, 6.5rem);
  overflow: hidden;
  isolation: isolate;
  border-bottom: 1px solid var(--border-subtle);
  background:
    radial-gradient(ellipse at 76% 45%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 34%),
    radial-gradient(ellipse at 91% 67%, color-mix(in srgb, var(--accent-teal) 11%, transparent), transparent 28%);
}
.creative-stage::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 0;
  opacity: .48;
  background-image: radial-gradient(color-mix(in srgb, var(--text-faint) 35%, transparent) .65px, transparent .65px);
  background-size: 13px 13px;
  mask-image: linear-gradient(90deg, #000, transparent 74%);
}
.creative-stage::after {
  content: 'CREATIVE / PRODUCTION / SYSTEM';
  position: absolute;
  right: clamp(2rem, 5vw, 5rem);
  bottom: 2rem;
  color: color-mix(in srgb, var(--text-primary) 34%, transparent);
  font: 700 .625rem/1 ui-monospace, monospace;
  letter-spacing: .2em;
  writing-mode: vertical-rl;
}
.stage-copy { align-self: center; max-width: 48rem; }
.stage-kicker { display: flex; align-items: center; gap: .65rem; margin: 0 0 1.5rem; color: var(--accent-teal); font-size: .6875rem; font-weight: 760; letter-spacing: .17em; }
.stage-kicker span { width: .45rem; height: .45rem; border-radius: 50%; background: var(--accent-teal); box-shadow: 0 0 0 .35rem color-mix(in srgb, var(--accent-teal) 14%, transparent); }
.stage-copy h2 { max-width: 47rem; margin: 0; color: var(--text-bright); font-size: clamp(3.5rem, 6.1vw, 7.4rem); font-weight: 730; line-height: .91; letter-spacing: -.082em; }
.stage-copy h2 span, .stage-copy h2 em { display: block; }.stage-copy h2 em { padding-left: clamp(1.5rem, 6vw, 7rem); color: color-mix(in srgb, var(--text-primary) 68%, var(--accent)); font-style: normal; }
.stage-lede { max-width: 36rem; margin: 2rem 0 2.2rem; color: var(--text-muted); font-size: 1rem; line-height: 1.75; }
.stage-actions { display: flex; flex-wrap: wrap; gap: .7rem; }
.stage-actions .el-button { min-height: 3rem; padding-inline: 1.4rem; }
.stage-metrics { display: flex; gap: clamp(2rem, 4vw, 4.5rem); margin: clamp(3rem, 6vh, 5rem) 0 0; }
.stage-metrics div { min-width: 5.8rem; }
.stage-metrics dt { color: var(--text-primary); font-size: 1.65rem; font-weight: 680; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.stage-metrics dd { margin: .3rem 0 0; color: var(--text-faint); font-size: .72rem; }
.now-producing {
  position: relative;
  align-self: center;
  min-height: 31rem;
  padding: 1.2rem;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--border-strong) 65%, transparent);
  border-radius: 1.4rem;
  background: linear-gradient(145deg, color-mix(in srgb, var(--bg-elevated) 86%, transparent), color-mix(in srgb, var(--bg-page) 82%, transparent));
  box-shadow: 0 2rem 5rem rgba(0, 0, 0, .32);
  transform: rotate(1.25deg);
  transition: transform var(--motion-normal, 220ms) var(--ease-out-premium, cubic-bezier(.22,1,.36,1)), border-color var(--motion-fast, 140ms) ease;
}
.now-producing:hover, .now-producing:focus-visible { transform: rotate(0) translateY(-.3rem); border-color: color-mix(in srgb, var(--accent) 58%, var(--border-color)); }
.now-producing-head { position: relative; z-index: 3; display: flex; align-items: center; justify-content: space-between; padding: .25rem .2rem 1rem; color: var(--text-faint); font-size: .62rem; font-weight: 700; letter-spacing: .15em; }
.now-producing-head i { color: var(--text-regular); font-style: normal; letter-spacing: 0; }
.now-poster { position: relative; display: grid; height: 20rem; place-items: center; overflow: hidden; border-radius: .95rem; background: radial-gradient(circle at 57% 44%, color-mix(in srgb, var(--accent) 64%, transparent), transparent 19%), linear-gradient(145deg, #182144, #080b13 72%); }
.now-poster::before, .now-poster::after { content: ''; position: absolute; width: 18rem; height: 18rem; border: 1px solid color-mix(in srgb, var(--accent-teal) 36%, transparent); border-radius: 50%; transform: rotate(-24deg) scaleY(.55); }
.now-poster::after { width: 24rem; height: 24rem; border-color: color-mix(in srgb, var(--accent) 33%, transparent); }
.now-poster b { position: relative; z-index: 2; display: grid; width: 4.2rem; height: 4.2rem; place-items: center; padding-left: .15rem; border-radius: 50%; background: color-mix(in srgb, var(--accent) 88%, #fff); color: white; font-size: 1.15rem; box-shadow: 0 1rem 2.5rem color-mix(in srgb, var(--accent) 50%, transparent); }
.now-poster span { position: absolute; left: 1rem; bottom: .9rem; color: color-mix(in srgb, #fff 62%, transparent); font: 700 .62rem/1 ui-monospace, monospace; letter-spacing: .16em; }
.now-poster--story { justify-items: start; align-content: end; padding: 2rem; background: linear-gradient(145deg, #243443, #0b0f17 72%); }
.now-poster--story b { width: auto; height: auto; padding: 0; background: transparent; box-shadow: none; font-size: 4.3rem; }
.now-poster--story span { left: auto; right: 1rem; }
.now-producing-copy { padding: 1.1rem .3rem .2rem; }
.now-producing-copy p { margin: 0 0 .25rem; color: var(--accent-teal); font-size: .66rem; font-weight: 700; letter-spacing: .1em; }
.now-producing-copy h3 { margin: 0 0 .75rem; overflow: hidden; color: var(--text-primary); font-size: 1.4rem; letter-spacing: -.035em; text-overflow: ellipsis; white-space: nowrap; }
.now-producing-copy > span { color: var(--text-muted); font-size: .72rem; }
.now-progress { height: .2rem; margin: .2rem 0 .65rem; overflow: hidden; border-radius: 999px; background: var(--border-subtle); }
.now-progress i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent), var(--accent-teal)); }
.now-producing--empty { display: flex; flex-direction: column; justify-content: space-between; padding: 2.4rem; cursor: default; transform: none; }
.now-producing--empty span { color: var(--accent-teal); font-size: .65rem; letter-spacing: .16em; }.now-producing--empty h3 { margin: 1rem 0 .3rem; font-size: 2rem; }.now-producing--empty p { color: var(--text-muted); }
.command-dock { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-block: 1px solid var(--border-subtle); }
.command-dock button { position: relative; display: grid; grid-template-columns: auto 1fr auto; grid-template-rows: auto auto; column-gap: 1rem; min-height: 7rem; padding: 1.25rem clamp(1rem, 2vw, 2rem); border: 0; border-right: 1px solid var(--border-subtle); border-radius: 0; background: transparent; color: var(--text-primary); text-align: left; cursor: pointer; transition: background-color var(--motion-fast, 140ms) ease; }
.command-dock button:last-child { border-right: 0; }.command-dock button:hover { background: color-mix(in srgb, var(--bg-hover) 58%, transparent); }.command-dock button:disabled { opacity: .5; cursor: wait; }
.command-dock span { grid-row: 1 / 3; align-self: start; color: var(--text-faint); font: 700 .62rem/1 ui-monospace, monospace; }.command-dock b { align-self: end; font-size: .95rem; }.command-dock small { align-self: start; margin-top: .25rem; color: var(--text-muted); font-size: .68rem; }.command-dock i { grid-column: 3; grid-row: 1 / 3; align-self: center; color: var(--text-faint); font-style: normal; transition: transform var(--motion-fast, 140ms) ease; }.command-dock button:hover i { transform: translate(.2rem, -.2rem); }
.production-lane, .story-ledger, .empty-workspace { padding: clamp(3rem, 7vw, 7rem) clamp(1.25rem, 5vw, 5rem); }
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 2rem; margin-bottom: 1.8rem; }
.section-heading p { margin: 0 0 .45rem; color: var(--accent); font-size: .65rem; font-weight: 720; letter-spacing: .17em; }.section-heading h2 { margin: 0; font-size: clamp(2rem, 3.4vw, 3.8rem); letter-spacing: -.06em; }.section-heading > span { color: var(--text-faint); font-size: .72rem; }
.production-lane { border-bottom: 1px solid var(--border-subtle); }
.production-track { display: flex; gap: .85rem; margin-inline: calc(clamp(1.25rem, 5vw, 5rem) * -1); padding-inline: clamp(1.25rem, 5vw, 5rem); padding-bottom: 1rem; overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: thin; }
.production-item { position: relative; flex: 0 0 clamp(17rem, 23vw, 24rem); scroll-snap-align: start; }
.production-open { display: grid; grid-template-columns: 5.5rem minmax(0, 1fr); grid-template-rows: auto 1fr; gap: .7rem 1rem; width: 100%; min-height: 11rem; padding: .8rem; border: 1px solid var(--border-subtle); border-radius: .85rem; background: color-mix(in srgb, var(--bg-surface) 76%, transparent); color: inherit; text-align: left; cursor: pointer; transition: transform var(--motion-fast, 140ms) var(--motion-ease), border-color var(--motion-fast, 140ms) ease, background-color var(--motion-fast, 140ms) ease; }
.production-open:hover { transform: translateY(-.2rem); border-color: color-mix(in srgb, var(--accent) 52%, var(--border-color)); background: var(--bg-raised); }
.production-index { grid-column: 2; justify-self: end; color: var(--text-faint); font: 700 .65rem/1 ui-monospace, monospace; }
.production-art { position: relative; grid-row: 1 / 3; display: grid; place-items: center; overflow: hidden; border-radius: .6rem; background: radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--accent) 62%, transparent), transparent 25%), linear-gradient(145deg, #222c54, #0a0d16 70%); }
.production-art::after { content: ''; position: absolute; width: 6rem; height: 6rem; border: 1px solid color-mix(in srgb, var(--accent-teal) 44%, transparent); border-radius: 50%; transform: translate(1.8rem, 3.2rem); }.production-art i { position: relative; z-index: 1; display: grid; width: 2.35rem; height: 2.35rem; place-items: center; padding-left: .1rem; border-radius: 50%; background: var(--accent); color: #fff; font-size: .7rem; }
.production-copy { align-self: end; min-width: 0; }.production-copy small, .production-copy b, .production-copy em { display: block; }.production-copy small { color: var(--accent-teal); font-size: .58rem; letter-spacing: .08em; }.production-copy b { margin: .4rem 0 .65rem; overflow: hidden; font-size: .95rem; text-overflow: ellipsis; white-space: nowrap; }.production-copy em { color: var(--text-faint); font-size: .63rem; font-style: normal; }
.production-delete { position: absolute; z-index: 3; right: .6rem; top: .5rem; display: grid; width: 1.8rem; height: 1.8rem; min-height: 0; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--text-faint); cursor: pointer; opacity: 0; transition: opacity var(--motion-fast, 140ms) ease, background-color var(--motion-fast, 140ms) ease; }.production-item:hover .production-delete, .production-delete:focus-visible { opacity: 1; }.production-delete:hover { background: var(--status-danger-bg); color: var(--status-danger); }
.story-ledger { padding-top: clamp(3.5rem, 7vw, 7rem); }
.story-list { border-top: 1px solid var(--border-color); }
.story-row { position: relative; display: flex; align-items: stretch; border-bottom: 1px solid var(--border-color); transition: background-color var(--motion-fast, 140ms) ease; }.story-row:hover { background: color-mix(in srgb, var(--bg-hover) 38%, transparent); }
.story-main { display: grid; grid-template-columns: 3rem minmax(12rem, 1fr) 5rem 5rem 9rem 2rem; gap: 1rem; align-items: center; width: 100%; min-height: 7.5rem; padding: 1rem 10rem 1rem .5rem; border: 0; border-radius: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.story-index { color: var(--text-faint); font: 700 .68rem/1 ui-monospace, monospace; }.story-title { min-width: 0; }.story-title small, .story-title b, .story-title em { display: block; }.story-title small { color: var(--accent-teal); font-size: .59rem; font-weight: 650; letter-spacing: .09em; text-transform: uppercase; }.story-title b { margin: .45rem 0 .35rem; overflow: hidden; font-size: 1.15rem; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }.story-title em { overflow: hidden; color: var(--text-muted); font-size: .72rem; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }.story-data { text-align: center; }.story-data b, .story-data small { display: block; }.story-data b { color: var(--text-primary); font-size: 1.15rem; font-variant-numeric: tabular-nums; }.story-data small { margin-top: .2rem; color: var(--text-faint); font-size: .6rem; }.story-time { color: var(--text-faint); font-size: .66rem; font-variant-numeric: tabular-nums; }.story-arrow { color: var(--text-faint); font-size: 1.1rem; transition: transform var(--motion-fast, 140ms) ease; }.story-row:hover .story-arrow { transform: translateX(.3rem); }
.story-actions { position: absolute; right: 2.8rem; top: 50%; display: flex; gap: .35rem; transform: translateY(-50%); opacity: 0; transition: opacity var(--motion-fast, 140ms) ease; }.story-row:hover .story-actions, .story-actions:focus-within { opacity: 1; }.story-actions .el-button { width: 2rem; height: 2rem; min-height: 0; }
.empty-workspace { min-height: 30rem; text-align: center; }.empty-workspace > p { margin: 0 0 1rem; color: var(--accent); font-size: .65rem; letter-spacing: .16em; }.empty-workspace h2 { margin: 0; font-size: clamp(2.8rem, 6vw, 6rem); letter-spacing: -.07em; }.empty-workspace > span { display: block; max-width: 35rem; margin: 1.2rem auto 2rem; color: var(--text-muted); line-height: 1.7; }.empty-workspace > div { display: flex; justify-content: center; gap: .7rem; }.empty-examples { margin-top: 1.5rem; align-items: center; flex-wrap: wrap; }.empty-examples small { color: var(--text-faint); }
@media (max-width: 70rem) {
  .header-actions :deep(.account-balance), .header-actions .btn-library { display: none; }
  .creative-stage { grid-template-columns: minmax(0, 1fr) minmax(20rem, .75fr); gap: 2rem; padding-inline: 2.5rem; }
  .stage-copy h2 { font-size: clamp(3.4rem, 7vw, 5.7rem); }
  .now-producing { min-height: 27rem; }.now-poster { height: 17rem; }
  .story-main { grid-template-columns: 2.5rem minmax(10rem, 1fr) 4rem 4rem 7.5rem 1.5rem; padding-right: 8rem; }
  .story-actions { right: 2rem; }
}
@media (max-width: 52rem) {
  .creative-stage { grid-template-columns: 1fr; min-height: auto; padding: 4rem 1.5rem; }
  .creative-stage::after { display: none; }
  .stage-copy h2 { max-width: 40rem; font-size: clamp(3.5rem, 13vw, 6rem); }.stage-copy h2 em { padding-left: 0; }
  .stage-lede { max-width: 32rem; }.stage-metrics { margin-top: 3rem; }
  .now-producing { width: min(100%, 35rem); min-height: 26rem; justify-self: center; transform: none; }.now-poster { height: 16rem; }
  .command-dock { grid-template-columns: 1fr 1fr; }.command-dock button:nth-child(2) { border-right: 0; }.command-dock button:nth-child(-n+2) { border-bottom: 1px solid var(--border-subtle); }
  .production-lane, .story-ledger { padding-inline: 1.5rem; }.production-track { margin-inline: -1.5rem; padding-inline: 1.5rem; }
  .section-heading { align-items: start; flex-direction: column; gap: .7rem; }
  .story-main { grid-template-columns: 2.2rem minmax(0, 1fr) 3.5rem 1.3rem; min-height: 7rem; padding-right: 1rem; }.story-main .story-data:nth-of-type(2), .story-time { display: none; }.story-actions { display: none; }
}
@media (max-width: 32rem) {
  .creative-stage { padding: 3rem 1rem; }.stage-kicker { max-width: 16rem; line-height: 1.55; }.stage-copy h2 { font-size: clamp(3.1rem, 16vw, 4.5rem); }.stage-lede { font-size: .88rem; }
  .stage-actions { display: grid; grid-template-columns: 1fr 1fr; }.stage-actions .el-button { width: 100%; margin: 0; padding-inline: .8rem; }
  .stage-metrics { justify-content: space-between; gap: .7rem; }.stage-metrics div { min-width: 0; }.stage-metrics dt { font-size: 1.25rem; }.stage-metrics dd { font-size: .62rem; }
  .now-producing { min-height: 24rem; padding: .8rem; border-radius: 1rem; }.now-poster { height: 14.5rem; }.now-producing-copy h3 { font-size: 1.1rem; }
  .command-dock button { min-height: 6.3rem; padding: 1rem; column-gap: .65rem; }.command-dock small { max-width: 7rem; }.command-dock i { display: none; }
  .production-lane, .story-ledger { padding-block: 3.5rem; padding-inline: 1rem; }.production-track { margin-inline: -1rem; padding-inline: 1rem; }.production-item { flex-basis: 17rem; }
  .section-heading h2 { font-size: 2.4rem; }.section-heading > span { font-size: .65rem; }
  .story-main { grid-template-columns: 1.8rem minmax(0, 1fr) 2.8rem 1rem; gap: .55rem; padding-left: 0; }.story-title b { font-size: 1rem; }.story-title em { max-width: 13rem; }
}
@media (prefers-reduced-motion: reduce) {
  .now-producing, .production-open, .story-arrow, .command-dock i { transition-duration: 1ms !important; transform: none !important; }
}

/* Media-first home: real local imagery is the composition, records are the workspace. */
.media-stage {
  position: relative;
  min-height: min(53rem, calc(100vh - 4rem));
  overflow: hidden;
  isolation: isolate;
  background: #07090d;
  color: #fff;
}
.media-stage::before { content: none; }
.media-stage::after { content:none; }
.media-stage-shade { position: absolute; z-index: 1; inset: 0; background: linear-gradient(90deg, rgba(5,7,11,.96) 0%, rgba(5,7,11,.72) 37%, rgba(5,7,11,.12) 73%), linear-gradient(0deg, rgba(5,7,11,.92) 0%, transparent 42%, rgba(5,7,11,.18)); pointer-events: none; }
.media-stage-content { position: relative; z-index: 2; display: flex; min-height: inherit; flex-direction: column; justify-content: center; align-items: flex-start; width: min(56rem, 64vw); padding: clamp(4rem, 8vw, 8rem) clamp(1.5rem, 6vw, 6rem) 9rem; }
.media-stage-content .stage-kicker { color: #9ff6df; text-shadow: 0 1px 1rem rgba(0,0,0,.55); }
.media-stage-content h2 { max-width:none; margin:0; overflow:visible; font-size:clamp(3.8rem,6vw,6.8rem); font-weight:760; line-height:1; letter-spacing:-.075em; white-space:nowrap; text-shadow:0 .1em .45em rgba(0,0,0,.42); }
.focus-type { margin-bottom:1rem; color:rgba(255,255,255,.58); font-size:.64rem; font-weight:720; letter-spacing:.11em; }.focus-meta { margin:1.2rem 0 1.7rem; color:rgba(255,255,255,.72); font-size:.78rem; font-variant-numeric:tabular-nums; }
.media-stage-content .stage-lede { max-width: 34rem; margin: 2.3rem 0 2rem; color: rgba(255,255,255,.7); text-shadow: 0 1px .8rem #000; }
.media-stage-content .el-button:not(.el-button--primary) { border-color: rgba(255,255,255,.34); background: rgba(10,12,16,.52); color: #fff; backdrop-filter: blur(.5rem); }
.stage-data { display:flex; gap:2.6rem; margin:2.1rem 0 0; padding:1rem 0 0; border-top:1px solid rgba(255,255,255,.22); }
.stage-data div { min-width:5rem; }.stage-data dt { color:#fff; font-size:1.45rem; font-weight:780; font-variant-numeric:tabular-nums; }.stage-data dd { margin:.25rem 0 0; color:rgba(255,255,255,.52); font-size:.62rem; letter-spacing:.08em; }
.records-jump { position: absolute; z-index: 3; right: clamp(1.5rem, 4vw, 4.5rem); top: 4rem; display: grid; grid-template-columns: auto auto; gap: .25rem 1rem; width: 10rem; padding: 1rem 0; border: 0; border-block: 1px solid rgba(255,255,255,.34); border-radius: 0; background: transparent; color: #fff; text-align: left; cursor: pointer; }
.records-jump span { font-size: .72rem; letter-spacing: .12em; }.records-jump b { grid-row: 1 / 3; grid-column: 2; align-self: center; justify-self: end; font-size: 2rem; font-variant-numeric: tabular-nums; }.records-jump i { color: rgba(255,255,255,.54); font-size: .7rem; font-style: normal; transition: transform var(--motion-fast, 140ms) ease; }.records-jump:hover i { transform: translateY(.25rem); }
.continue-strip { position: absolute; z-index: 3; right: clamp(1.5rem, 4vw, 4.5rem); bottom: 2.4rem; display: grid; grid-template-columns: minmax(12rem, 1fr) auto auto; gap: 2rem; align-items: end; width: min(48rem, 60vw); padding: 1rem 0; border: 0; border-block: 1px solid rgba(255,255,255,.32); border-radius: 0; background: rgba(5,7,11,.16); color: #fff; text-align: left; cursor: pointer; backdrop-filter: blur(.45rem); }
.continue-strip span small, .continue-strip span b { display: block; }.continue-strip small { margin-bottom: .35rem; color: #9ff6df; font-size: .58rem; letter-spacing: .14em; }.continue-strip b { overflow: hidden; font-size: 1rem; text-overflow: ellipsis; white-space: nowrap; }.continue-strip em { color: rgba(255,255,255,.6); font-size: .68rem; font-style: normal; }.continue-strip i { font-size: .76rem; font-style: normal; }
.recent-stack { position:absolute; z-index:3; right:clamp(2rem,4vw,4.5rem); top:10.5rem; display:grid; width:min(27rem,32vw); border-top:1px solid rgba(255,255,255,.28); }
.recent-stack button { display:grid; grid-template-columns:3.25rem minmax(0,1fr) auto; gap:.9rem; align-items:center; min-height:5.2rem; padding:.65rem 0; overflow:hidden; border:0; border-bottom:1px solid rgba(255,255,255,.18); border-radius:0; background:linear-gradient(90deg,rgba(5,7,11,.66),rgba(5,7,11,.14)); color:#fff; text-align:left; cursor:pointer; backdrop-filter:blur(.45rem); opacity:0; animation:recent-in var(--motion-slow,420ms) var(--motion-spring,cubic-bezier(.16,1,.3,1)) forwards; transition:padding var(--motion-fast) var(--motion-ease),background-color var(--motion-fast) var(--motion-ease); }
.recent-stack button:nth-child(2){animation-delay:70ms}.recent-stack button:nth-child(3){animation-delay:140ms}.recent-stack button:hover{padding-inline:.6rem;background:rgba(5,7,11,.72)}
.recent-thumb { display:grid; width:3.25rem; height:3.25rem; place-items:center; overflow:hidden; border:1px solid rgba(255,255,255,.2); background:rgba(255,255,255,.07); color:rgba(255,255,255,.52); font:700 .62rem/1 ui-monospace,monospace; }.recent-thumb img{width:100%;height:100%;object-fit:cover}.recent-thumb i{font-style:normal}
.recent-stack div{min-width:0}.recent-stack small,.recent-stack b,.recent-stack em{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.recent-stack small{color:#9ff6df;font-size:.55rem;letter-spacing:.11em}.recent-stack b{margin:.28rem 0;font-size:.82rem}.recent-stack em{color:rgba(255,255,255,.48);font-size:.6rem;font-style:normal}.recent-stack>button>i{color:rgba(255,255,255,.55);font-style:normal;transition:transform var(--motion-fast) var(--motion-ease)}.recent-stack button:hover>i{transform:translateX(.25rem)}
@keyframes recent-in{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}
.records-workspace { scroll-margin-top: 4.5rem; padding: clamp(4rem, 7vw, 7rem) clamp(1.25rem, 5vw, 5rem); border-bottom: 1px solid var(--border-subtle); }
.records-heading { display: grid; grid-template-columns: minmax(0,1fr) minmax(15rem, 25rem); gap: 3rem; align-items: end; }
.records-heading p { margin: 0 0 .6rem; color: var(--accent-teal); font-size: .64rem; font-weight: 700; letter-spacing: .17em; }.records-heading h2 { margin: 0; font-size: clamp(3.4rem, 6vw, 7rem); line-height: .9; letter-spacing: -.075em; }.records-heading > div > span { display: block; margin-top: 1.1rem; color: var(--text-muted); font-size: .82rem; }
.record-search { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 1rem; align-items: center; padding-bottom: .7rem; border-bottom: 1px solid var(--border-strong); color: var(--text-faint); font-size: .7rem; }
.record-search input { width: 100%; min-height: 2rem; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: .82rem; }.record-search input::placeholder { color: var(--text-faint); }
.record-filters { display: flex; gap: .35rem; margin: 2.5rem 0 1rem; overflow-x: auto; }
.record-filters button { flex: 0 0 auto; padding: .58rem .85rem; border: 1px solid transparent; border-radius: 999px; background: transparent; color: var(--text-muted); font-size: .72rem; cursor: pointer; transition: border-color var(--motion-fast,140ms) ease, background-color var(--motion-fast,140ms) ease, color var(--motion-fast,140ms) ease; }.record-filters button span { margin-left: .25rem; color: var(--text-faint); font-variant-numeric: tabular-nums; }.record-filters button:hover, .record-filters button.active { border-color: var(--border-strong); background: var(--bg-hover); color: var(--text-primary); }
.record-list { border-top: 1px solid var(--border-color); }
.record-row { position: relative; border-bottom: 1px solid var(--border-color); transition: background-color var(--motion-fast,140ms) ease; }.record-row:hover { background: color-mix(in srgb, var(--bg-hover) 46%, transparent); }
.record-open { display: grid; grid-template-columns: 2.4rem 6.5rem minmax(12rem,1fr) 8.5rem 9rem 1.5rem; gap: 1rem; align-items: center; width: 100%; min-height: 7.8rem; padding: .85rem 10rem .85rem .4rem; border: 0; border-radius: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.record-index { color: var(--text-faint); font: 700 .66rem/1 ui-monospace,monospace; }.record-thumb { display: grid; width: 6.5rem; height: 4.5rem; place-items: center; overflow: hidden; background: linear-gradient(145deg, var(--bg-raised), var(--bg-page)); color: var(--text-faint); }.record-thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform var(--motion-normal,220ms) var(--ease-out-premium,cubic-bezier(.22,1,.36,1)); }.record-row:hover .record-thumb img { transform: scale(1.045); }.record-thumb i { font-style: normal; font-size: 1.1rem; }
.record-title { min-width: 0; }.record-title small, .record-title b, .record-title em { display: block; }.record-title small { color: var(--accent-teal); font-size: .58rem; font-weight: 700; letter-spacing: .08em; }.record-title b { margin: .4rem 0 .3rem; overflow: hidden; font-size: 1.05rem; letter-spacing: -.02em; text-overflow: ellipsis; white-space: nowrap; }.record-title em { overflow: hidden; color: var(--text-muted); font-size: .7rem; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }.record-meta, .record-open time { color: var(--text-faint); font-size: .67rem; }.record-arrow { color: var(--text-muted); transition: transform var(--motion-fast,140ms) ease; }.record-row:hover .record-arrow { transform: translateX(.3rem); }
.record-actions { position: absolute; right: 2rem; top: 50%; display: flex; gap: .35rem; transform: translateY(-50%); opacity: 0; transition: opacity var(--motion-fast,140ms) ease; }.record-row:hover .record-actions, .record-actions:focus-within { opacity: 1; }.record-actions .el-button { width: 2rem; height: 2rem; min-height: 0; }
.record-no-result { display: grid; min-height: 12rem; place-content: center; text-align: center; }.record-no-result b, .record-no-result span { display: block; }.record-no-result span { margin-top: .5rem; color: var(--text-muted); font-size: .75rem; }
.media-showcase { padding: clamp(4rem,7vw,7rem) 0; overflow: hidden; }.media-showcase .section-heading { padding-inline: clamp(1.25rem,5vw,5rem); }.media-showcase .section-heading button { border: 0; background: transparent; color: var(--text-muted); cursor: pointer; }
.media-filmstrip { display: grid; grid-template-columns: 1.35fr .8fr 1fr .72fr 1.12fr .8fr; grid-template-rows: 14rem 10rem; gap: .45rem; padding-inline: .45rem; }
.film-frame { position: relative; min-width: 0; min-height: 0; padding: 0; overflow: hidden; border: 0; border-radius: 0; background: var(--bg-raised); color: #fff; text-align: left; cursor: pointer; }.film-frame--1 { grid-row: 1 / 3; }.film-frame--2 { grid-row: 1; }.film-frame--3 { grid-row: 1 / 3; }.film-frame--4 { grid-row: 2; }.film-frame--5 { grid-row: 1 / 3; }.film-frame--6 { grid-row: 1 / 3; }.film-frame:nth-child(n+7) { display: none; }
.film-frame img { width: 100%; height: 100%; object-fit: cover; transition: transform var(--motion-slow,320ms) var(--ease-out-premium,cubic-bezier(.22,1,.36,1)), filter var(--motion-normal,220ms) ease; }.film-frame:hover img { transform: scale(1.035); filter: brightness(.72); }.film-frame > span { position: absolute; right: 0; bottom: 0; left: 0; padding: 3rem .8rem .8rem; opacity: 0; background: linear-gradient(transparent,rgba(0,0,0,.84)); transform: translateY(.5rem); transition: opacity var(--motion-fast,140ms) ease, transform var(--motion-fast,140ms) ease; }.film-frame:hover > span, .film-frame:focus-visible > span { opacity: 1; transform: none; }.film-frame small, .film-frame b { display: block; }.film-frame small { color: #9ff6df; font-size: .55rem; letter-spacing: .12em; }.film-frame b { margin-top: .35rem; overflow: hidden; font-size: .82rem; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 86rem) and (min-width: 70.01rem) { .recent-stack{width:min(23rem,31vw)}.recent-stack button:nth-child(n+3){display:none}.stage-data{gap:1.6rem}.media-stage-content h2{font-size:clamp(4rem,7vw,6.5rem)} }
@media (max-width: 70rem) {
  .media-stage-content { width: 72vw; }.media-stage-content h2 { font-size: clamp(4.2rem,10vw,7rem); }.recent-stack{display:none}
  .continue-strip { width: min(42rem,72vw); }.record-open { grid-template-columns: 2rem 5.5rem minmax(10rem,1fr) 7rem 1.5rem; padding-right: 7rem; }.record-thumb { width: 5.5rem; }.record-open time { display: none; }.record-actions { right: 1.5rem; }
  .media-filmstrip { grid-template-columns: 1.3fr .8fr 1fr .9fr; }.film-frame--5,.film-frame--6 { display:none; }
}
@media (max-width: 52rem) {
  .media-stage { min-height: 43rem; }.media-canvas { grid-template-columns: 1.3fr .7fr; }.media-frame--1 { grid-column:1; }.media-frame--2 { grid-column:2; }.media-frame--3 { grid-column:2; grid-row:2; }.media-frame--4 { display:none; }
  .media-stage-shade { background: linear-gradient(90deg,rgba(5,7,11,.94),rgba(5,7,11,.28)),linear-gradient(0deg,rgba(5,7,11,.94),transparent 58%); }.media-stage-content { width: 92vw; padding: 5rem 1.5rem 9rem; }.media-stage-content h2 { font-size: clamp(4rem,14vw,6.5rem); }.media-stage-content h2 em { margin-left: 0; }
  .records-jump { top: 1.6rem; right: 1.5rem; width: 8rem; }.continue-strip { right:1.5rem; left:1.5rem; width:auto; grid-template-columns:minmax(0,1fr) auto; gap:1rem; }.continue-strip em { display:none; }
  .records-heading { grid-template-columns:1fr; gap:2rem; }.record-open { grid-template-columns:1.8rem 4.6rem minmax(0,1fr) 1rem; gap:.7rem; min-height:6.8rem; padding-right:.5rem; }.record-thumb { width:4.6rem; height:3.7rem; }.record-meta,.record-open time { display:none; }.record-actions { display:none; }
  .media-filmstrip { display:flex; height:22rem; gap:.45rem; padding:.45rem; overflow-x:auto; scroll-snap-type:x mandatory; }.film-frame,.film-frame--1,.film-frame--2,.film-frame--3,.film-frame--4 { display:block; flex:0 0 72vw; height:100%; scroll-snap-align:start; }
}
@media (max-width: 32rem) {
  .media-stage { min-height: 39rem; }.media-stage-content { width:100%; padding:4.5rem 1rem 8.5rem; }.media-stage-content h2 { font-size:clamp(3.4rem,16vw,4.35rem); }.media-stage-content .stage-lede { max-width:22rem; font-size:.82rem; line-height:1.65; }.records-jump { top:1rem; right:1rem; width:7.2rem; }.records-jump b { font-size:1.5rem; }
  .continue-strip { right:1rem; left:1rem; bottom:1.2rem; }.command-dock button { grid-template-columns:1fr; grid-template-rows:auto auto auto; }.command-dock span { grid-row:auto; }.command-dock b { white-space:nowrap; }.command-dock small { max-width:none; }
  .records-workspace { padding:3.5rem 1rem; }.records-heading h2 { font-size:3.3rem; }.record-open { grid-template-columns:1.5rem 3.8rem minmax(0,1fr) .8rem; gap:.55rem; }.record-thumb { width:3.8rem; height:3.25rem; }.record-title em { max-width:12rem; }.record-filters { margin-top:1.8rem; }
}
@media (prefers-reduced-motion: reduce) {
  .media-frame img,.records-jump i,.record-thumb img,.record-arrow,.film-frame img,.film-frame > span,.recent-stack button { transition-duration:1ms !important; animation:none!important; opacity:1; transform:none !important; }
  html { scroll-behavior:auto; }
}

/* Viewport workspace: one stage, one bounded archive panel, no document-length dashboard. */
.film-list { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; }
.header { position: relative; height: 4rem; padding-block: .65rem; }
.header-inner { height: 100%; }
.main { width: 100%; max-width: none; height: calc(100vh - 4rem); height: calc(100dvh - 4rem); padding: 0; overflow: hidden; }
.projects-wrap { position: relative; height: 100%; min-height: 0; overflow: hidden; }
.media-stage { height: 100%; min-height: 0; }
.media-stage-content { padding-bottom: 9.5rem; }
.continue-strip { bottom: 7.6rem; }
.command-dock { position: absolute; z-index: 5; right: 0; bottom: 0; left: 0; min-height: 6.25rem; border-top-color: rgba(255,255,255,.18); border-bottom: 0; background: linear-gradient(180deg, rgba(5,7,11,.72), rgba(5,7,11,.96)); color: #fff; backdrop-filter: blur(.8rem) saturate(115%); }
.command-dock button { min-height: 6.25rem; border-color: rgba(255,255,255,.12); color: #fff; }.command-dock button:hover { background: rgba(255,255,255,.075); }.command-dock small,.command-dock span,.command-dock i { color: rgba(255,255,255,.52); }
.records-heading { position: relative; grid-template-columns: minmax(0,1fr) minmax(13rem,22rem); padding-right: 3rem; }
.records-heading h2 { font-size: clamp(2.8rem,4.5vw,5.3rem); }
.records-close { position: absolute; right: 0; top: 0; display: grid; width: 2.4rem; height: 2.4rem; place-items: center; border: 1px solid var(--border-color); border-radius: 50%; background: transparent; color: var(--text-muted); font-size: 1.35rem; cursor: pointer; transition: border-color var(--motion-fast,140ms) ease, color var(--motion-fast,140ms) ease, transform var(--motion-fast,140ms) ease; }.records-close:hover { border-color: var(--text-primary); color: var(--text-primary); transform: rotate(5deg); }
.record-filters { margin: 1.8rem 0 .8rem; }
.record-list { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.record-open { grid-template-columns: 2rem 5.5rem minmax(10rem,1fr) 7.5rem 1.5rem; min-height: 6.4rem; padding-right: 7rem; }.record-thumb { width: 5.5rem; height: 3.8rem; }.record-open time { display: none; }.record-actions { right: 1.4rem; }
.media-showcase { display: none; }
.empty-workspace { position: absolute; z-index: 3; inset: 0; display: grid; min-height: 0; place-content: center; background: rgba(5,7,11,.72); }
@media (max-width: 70rem) {
  .records-workspace { width: min(50rem,82vw); }.records-heading { grid-template-columns:1fr; gap:1.3rem; }
}
@media (max-width: 52rem) {
  .header { height: 3.7rem; }.main { height: calc(100vh - 3.7rem); height: calc(100dvh - 3.7rem); }.records-workspace { width:100%; padding:2rem 1.2rem 1.2rem; }
  .media-stage-content { padding-bottom: 8rem; }.continue-strip { bottom: 5.8rem; }
  .command-dock { display:flex; min-height:4.9rem; overflow-x:auto; }.command-dock button { flex:1 0 10.5rem; grid-template-columns:auto 1fr auto; grid-template-rows:auto; min-height:4.9rem; padding:.8rem 1rem; border-bottom:0!important; }.command-dock span { grid-row:auto; }.command-dock b { align-self:center; }.command-dock small { display:none; }.command-dock i { grid-row:auto; }
  .record-open { grid-template-columns:1.6rem 4.2rem minmax(0,1fr) .8rem; min-height:5.7rem; padding-right:.4rem; }.record-thumb { width:4.2rem; height:3.2rem; }
}
@media (max-width: 32rem) {
  .media-stage-content { justify-content:flex-start; padding-top:5rem; padding-bottom:10.5rem; }.media-stage-content h2 { font-size:clamp(3.1rem,15vw,4rem); }.media-stage-content .stage-lede { margin-block:1.3rem; }.stage-actions .el-button { min-height:2.7rem; }
  .records-jump { top:.8rem; }.continue-strip { bottom:5.45rem; padding-block:.7rem; }
  .records-heading h2 { font-size:3rem; }.records-heading > div > span { margin-top:.6rem; }.record-search { margin-right:0; }.record-filters { margin-top:1.2rem; }
}

/* One navigation system and a moving project backdrop. */
.film-list>.header{height:4.5rem;padding:0;border-bottom:1px solid rgba(255,255,255,.1);background:#0a0f17!important;box-shadow:none!important}
.film-list>.header .header-inner{display:grid;grid-template-columns:auto minmax(22rem,1fr) auto;gap:2rem;width:100%;max-width:none;height:100%;padding:0 clamp(1.5rem,4vw,4.5rem)}
.film-list>.header .logo{align-self:center}.film-list>.header .logo-main{font-size:.78rem}.film-list>.header .logo-sub{font-size:.52rem}
.primary-nav{display:flex;align-self:stretch;justify-self:center;gap:2.4rem;height:100%}.primary-nav>button,.primary-nav :deep(.el-dropdown)>button{position:relative;height:100%;padding:0;border:0;border-radius:0;background:transparent;color:rgba(255,255,255,.58);font:inherit;font-size:.75rem;cursor:pointer;transition:color var(--motion-fast) var(--motion-ease)}
.primary-nav>button::after,.primary-nav :deep(.el-dropdown)>button::after{content:'';position:absolute;right:0;bottom:0;left:0;height:2px;background:#9ff6df;transform:scaleX(0);transform-origin:center;transition:transform var(--motion-fast) var(--motion-spring)}.primary-nav>button:hover,.primary-nav>button.active,.primary-nav :deep(.el-dropdown)>button:hover{color:#fff}.primary-nav>button.active::after,.primary-nav>button:hover::after,.primary-nav :deep(.el-dropdown)>button:hover::after{transform:scaleX(1)}
.film-list>.header .header-actions{justify-self:end;gap:.45rem}.film-list>.header .header-actions .el-button{border-color:rgba(255,255,255,.14);background:transparent;color:rgba(255,255,255,.72)}.film-list>.header .header-actions .btn-new{border-color:transparent;background:var(--accent);color:#fff}.film-list>.header .btn-theme{width:2.35rem;padding:0;font-size:0}.film-list>.header .btn-theme .el-icon{margin:0}
.film-list>.main{height:calc(100vh - 4.5rem);height:calc(100dvh - 4.5rem)}
.media-canvas{display:block;inset:0;padding:0;overflow:hidden;background:#07090d}.media-canvas>video,.media-canvas>img{width:100%;height:100%;object-fit:cover;filter:saturate(.82) contrast(1.08) brightness(.78);transform:scale(1.025);animation:backdrop-breathe 16s var(--motion-ease) infinite alternate}.media-canvas>video{object-position:center 42%}.media-canvas>img{object-position:center 35%}
.media-empty-motion{position:absolute;inset:0;background:radial-gradient(circle at 27% 38%,#303d62,transparent 26%),radial-gradient(circle at 76% 52%,#183f48,transparent 22%),#07090d}.media-empty-motion i{position:absolute;width:38vw;aspect-ratio:1;border:1px solid rgba(159,246,223,.16);border-radius:50%;animation:empty-orbit 18s linear infinite}.media-empty-motion i:nth-child(1){left:-8%;top:9%}.media-empty-motion i:nth-child(2){right:-5%;bottom:-22%;animation-duration:27s;animation-direction:reverse}.media-empty-motion i:nth-child(3){left:38%;top:24%;width:22vw;animation-duration:12s}
.media-stage-shade{background:linear-gradient(90deg,rgba(4,6,10,.95) 0%,rgba(4,6,10,.74) 35%,rgba(4,6,10,.22) 62%,rgba(4,6,10,.48)),linear-gradient(0deg,rgba(4,6,10,.78),transparent 42%,rgba(4,6,10,.18))}
.media-stage::after{bottom:0}.media-stage-content{width:min(46rem,48vw);padding:clamp(4rem,8vh,7rem) clamp(2.5rem,5vw,6rem)}
.recent-stack{top:9.5rem}.records-jump{top:2.2rem}
@keyframes backdrop-breathe{from{transform:scale(1.025) translate3d(0,0,0)}to{transform:scale(1.075) translate3d(-.7%,.35%,0)}}
@keyframes empty-orbit{to{transform:rotate(360deg) scale(1.08)}}
@media(prefers-reduced-motion:reduce){.media-canvas>video,.media-canvas>img,.media-empty-motion i{animation:none!important;transform:none!important}}

/* Shared desktop header + in-page archive: records no longer cover the stage. */
.film-list>.main{height:calc(100vh - var(--ui-header-height));height:calc(100dvh - var(--ui-header-height))}.projects-wrap.showing-records{overflow:auto;background:var(--ui-canvas)}.records-workspace{position:relative;top:auto;right:auto;bottom:auto;display:grid;width:min(1180px,calc(100% - 64px));min-height:100%;margin:0 auto;padding:clamp(32px,5vw,72px) 0;overflow:visible;border:0;background:transparent;box-shadow:none;transform:none;visibility:visible;transition:none}.records-heading{grid-template-columns:minmax(0,1fr) minmax(14rem,22rem)}.record-list{max-height:none;overflow:visible}.records-close{position:static;justify-self:end;grid-column:3;grid-row:1}.records-heading{grid-template-columns:minmax(0,1fr) minmax(14rem,22rem) auto}.records-workspace .record-open{padding-right:8rem}.records-workspace .record-actions{opacity:1}.records-workspace .record-row:hover .record-actions{opacity:1}

/* The home is a real moving-video stage. The project rail is intentionally quiet. */
.media-stage-content{width:min(38rem,44vw);padding:clamp(3rem,7vh,6rem) clamp(2.5rem,5vw,5.5rem)}.media-stage-content h2{max-width:none;font-size:clamp(3.5rem,5.3vw,6.15rem);line-height:.94;white-space:nowrap}.focus-current{display:grid;gap:.22rem;max-width:25rem;margin:1rem 0 1.35rem}.focus-current span{color:#9ff6df;font-size:.6rem;font-weight:750;letter-spacing:.12em}.focus-current b{overflow:hidden;color:rgba(255,255,255,.92);font-size:1rem;text-overflow:ellipsis;white-space:nowrap}.focus-current em{color:rgba(255,255,255,.55);font-size:.68rem;font-style:normal}.focus-current--empty{display:block;color:rgba(255,255,255,.64);font-size:.8rem}.stage-actions{margin-top:0}.stage-data{gap:2rem;margin-top:1.35rem;padding-top:.8rem}.stage-data dt{font-size:1.25rem}
.hero-video-controls{display:flex;align-items:center;gap:.65rem;margin-top:1.45rem}.hero-video-controls button{display:grid;width:1.8rem;height:1.8rem;place-items:center;padding:0;border:1px solid rgba(255,255,255,.28);border-radius:50%;background:rgba(7,10,15,.38);color:#fff;cursor:pointer}.hero-video-controls button:hover{border-color:#fff;background:rgba(255,255,255,.16)}.hero-video-count{min-width:3.5rem;color:rgba(255,255,255,.58);font:700 .62rem/1 ui-monospace,monospace;letter-spacing:.08em;text-align:center}
.records-jump{right:clamp(2rem,3vw,3.8rem);top:2.15rem;width:8.3rem;padding:.75rem 0}.records-jump b{font-size:1.65rem}.records-jump i{grid-column:1/3;color:rgba(255,255,255,.48);font-size:.58rem;font-style:normal}.recent-stack{right:clamp(2rem,3vw,3.8rem);top:8.1rem;width:min(20rem,20vw);border:1px solid rgba(255,255,255,.2);background:rgba(7,10,15,.38);backdrop-filter:blur(.8rem)}.recent-stack>p{margin:0;padding:.7rem .7rem .35rem;color:rgba(255,255,255,.54);font-size:.58rem;font-weight:740;letter-spacing:.12em}.recent-stack button{grid-template-columns:2.5rem minmax(0,1fr) auto;min-height:4.35rem;padding:.45rem .65rem;background:transparent}.recent-thumb{width:2.5rem;height:2.5rem}.recent-stack b{margin:.18rem 0;font-size:.75rem}.recent-stack em{font-size:.56rem}.recent-stack small{font-size:.5rem}
.recent-stack button:nth-of-type(n+3){display:none}@media (min-width:86.01rem){.recent-stack button:nth-of-type(n+3){display:grid}}
@media (max-width:86rem) and (min-width:70.01rem){.recent-stack button:nth-child(n+3){display:grid}.recent-stack button:nth-of-type(n+3){display:none}}
@media (max-width:86rem){.recent-stack{width:min(18.5rem,25vw)}.media-stage-content{width:min(37rem,53vw)}}
@media (max-width:70rem){.hero-video-controls{margin-top:1rem}.recent-stack{display:none}.media-stage-content{width:min(38rem,78vw)}}

/* Desktop resolution profiles: compact studio, standard desk, and large display. */
@media (min-width:70.01rem) and (max-height:48rem){
  .media-stage-content{width:min(34rem,46vw);padding:clamp(2.4rem,6vh,3.6rem) clamp(2rem,5vw,4rem)}
  .media-stage-content h2{font-size:clamp(3.25rem,5vw,4.8rem)}
  .focus-current{margin:.7rem 0 1rem}.stage-data{margin-top:1rem}.recent-stack{top:7.3rem}
}
@media (min-width:90rem) and (min-height:49rem){
  .media-stage-content{width:min(42rem,44vw);padding:clamp(4.5rem,9vh,7.5rem) clamp(3.5rem,5vw,6.5rem)}
  .media-stage-content h2{font-size:clamp(4.2rem,5.1vw,6.4rem)}
  .focus-current{margin:1.2rem 0 1.7rem}.recent-stack{top:clamp(8.6rem,13vh,10.8rem);width:min(21rem,20vw)}
  .records-jump{top:clamp(1.7rem,3vh,2.5rem)}
}
@media (min-width:112rem) and (min-height:60rem){
  .media-stage-content{width:min(46rem,43vw);padding-left:clamp(4.5rem,6vw,7.5rem)}
  .media-stage-content h2{font-size:clamp(5rem,5.2vw,7rem)}
  .recent-stack{right:clamp(3.8rem,4vw,6rem);width:min(22rem,18vw)}.records-jump{right:clamp(3.8rem,4vw,6rem)}
}

/* Records expand inside the stage, preserving the current video's context. */
.records-panel{position:absolute;z-index:5;top:clamp(1.25rem,3vh,2.5rem);right:clamp(1.5rem,3vw,3.8rem);bottom:clamp(1.25rem,3vh,2.5rem);display:flex;flex-direction:column;width:min(58rem,62vw);min-height:0;padding:clamp(1rem,1.8vw,1.8rem);overflow:hidden;border:1px solid rgba(255,255,255,.2);background:rgba(8,12,18,.9);box-shadow:0 1.5rem 5rem rgba(0,0,0,.4);backdrop-filter:blur(1.2rem)}
.records-panel .records-heading{grid-template-columns:minmax(0,1fr) minmax(16rem,22rem) auto;gap:1.2rem;align-items:end;padding:0}.records-panel .records-heading p{margin:0 0 .35rem;color:#9ff6df;font-size:.64rem;font-weight:750;letter-spacing:.12em}.records-panel .records-heading h2{font-size:clamp(1.8rem,2.4vw,2.8rem);line-height:1}.records-panel .records-close{position:static;justify-self:end}.records-panel .record-filters{flex:0 0 auto;margin:1.1rem 0 .7rem}.records-panel .record-list{flex:1;min-height:0;overflow:auto;border-top:1px solid rgba(255,255,255,.16)}.records-panel .record-open{grid-template-columns:2rem 5.2rem minmax(12rem,1fr) 8rem 1.5rem;min-height:5.8rem;padding:.65rem 3.65rem .65rem .4rem;gap:.9rem;color:#fff}.records-panel .record-thumb{width:5.2rem;height:3.8rem}.records-panel .record-title b{font-size:1rem}.records-panel .record-meta{font-size:.72rem}.records-panel .record-row:hover{background:rgba(255,255,255,.06)}.records-panel .record-arrow{display:none}.records-panel .record-actions--panel{right:.65rem;z-index:1;opacity:1}.records-panel .record-actions--panel .el-button{border-color:rgba(255,116,116,.5);background:rgba(132,31,31,.16);color:#ff9b9b}.records-panel .record-actions--panel .el-button:hover,.records-panel .record-actions--panel .el-button:focus-visible{border-color:#ffb5b5;background:rgba(170,43,43,.34);color:#fff}
@media (min-width:112rem) and (min-height:60rem){
  .focus-current span{font-size:.72rem}.focus-current b{font-size:1.25rem}.focus-current em{font-size:.82rem}.stage-actions .el-button{min-height:3.2rem;padding-inline:1.35rem;font-size:1rem}.hero-video-count{font-size:.74rem}.stage-data dt{font-size:1.55rem}.stage-data dd{font-size:.72rem}
  .recent-stack>p{padding:.9rem .9rem .48rem;font-size:.68rem}.recent-stack button{min-height:5.2rem;padding:.6rem .8rem}.recent-thumb{width:3rem;height:3rem}.recent-stack small{font-size:.62rem}.recent-stack b{font-size:.98rem}.recent-stack em{font-size:.68rem}.recent-stack>button>i{font-size:.85rem}
}
@media (max-width:70rem){.records-panel{right:1rem;left:1rem;width:auto}.records-panel .records-heading{grid-template-columns:1fr auto}.records-panel .record-search{grid-column:1/-1}.records-panel .record-open{grid-template-columns:1.5rem 4.2rem minmax(0,1fr) 1rem}.records-panel .record-thumb{width:4.2rem;height:3.2rem}.records-panel .record-meta{display:none}}
.hero-video-preload{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
/* 媒体是舞台背景层，不能进入普通文档流把首屏文字推到视口外。 */
.media-stage>.media-canvas{position:absolute;inset:0}
/* 主页轮播不使用静态 poster 过渡：新视频可播放后才淡入，旧视频始终留在底层。 */
.media-canvas>.hero-video-layer{position:absolute;inset:0;z-index:1;opacity:0;pointer-events:none;transition:opacity 220ms var(--motion-ease)}
.media-canvas>.hero-video-layer.is-ready{opacity:1}
.media-canvas>.hero-video-layer.is-current{z-index:2}
@media(prefers-reduced-motion:reduce){.media-canvas>.hero-video-layer{transition:none}}
</style>
