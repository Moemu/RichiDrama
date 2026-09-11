<template>
  <div class="drama-detail" :class="{ 'resources-workspace': workspaceTab === 'resources' }">
    <header class="header">
      <div class="header-inner">
        <h1 class="logo" @click="router.push('/')">
          <span class="richi-brand-mark" aria-hidden="true"><img src="/brand/richi-logo-color.png" alt="" /></span>
          <span class="richi-brand-copy"><span class="logo-main">瑞池传媒短剧平台</span><span class="logo-sub">创作工作台</span></span>
        </h1>
        <span class="breadcrumb-sep">›</span>
        <span class="page-title">{{ drama?.title || '剧集管理' }}</span>
        <el-button class="btn-back-list" @click="router.push('/')">
          <el-icon><ArrowLeft /></el-icon>返回列表
        </el-button>
        <div class="header-actions">
          <AccountBalanceBadge />
          <el-button type="primary" @click="goCreate">
            <el-icon><VideoPlay /></el-icon>进入制作
          </el-button>
          <el-button type="primary" plain @click="goCanvasMode">
            <el-icon><Grid /></el-icon>画布模式
          </el-button>
        </div>
      </div>
    </header>

    <main class="main" v-loading="loading">
      <ProjectCollaborationBar :key="String(drama?.permissions?.collaboration_enabled)" :drama-id="dramaId" @refresh="loadDrama" />
      <section class="project-summary" aria-label="项目概览">
        <div class="project-title-row"><h2>{{ drama?.title }}</h2><span class="project-episode-count">{{ episodes.length }} 集</span></div>
        <div class="project-synopsis">
          <p>{{ synopsisPreview || '从分集开始组织制作内容' }}</p>
          <button v-if="drama?.description" type="button" class="synopsis-toggle" @click="synopsisVisible = true">查看完整梗概 <span aria-hidden="true">↗</span></button>
        </div>
      </section>
      <nav class="project-workspace-tabs" aria-label="项目工作区">
        <button v-for="tab in [{v:'episodes',label:'分集'},{v:'resources',label:'制作资源'},{v:'results',label:'成果'},{v:'info',label:'成员与设置'}]" :key="tab.v" type="button" :class="{ active: workspaceTab === tab.v }" :aria-pressed="workspaceTab === tab.v" @click="workspaceTab = tab.v">{{ tab.label }}</button>
      </nav>
      <ProjectResults v-if="workspaceTab === 'results'" :drama-id="dramaId" :episodes="episodes" />
      <div v-show="workspaceTab === 'info'" class="project-settings-layout">
      <!-- 基本信息 + 设置 -->
      <section v-show="workspaceTab === 'info'" class="section card info-section">
        <div class="section-header"><h3 class="section-title">项目设置</h3><span class="section-count">修改后自动保存</span></div>
        <el-form :disabled="drama?.permissions?.can_edit === false" :model="infoForm" label-position="top" class="info-form">
          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="标题">
                <el-input v-model="infoForm.title" placeholder="剧集标题" @blur="saveInfo" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="图片/视频风格">
                <el-select v-model="infoForm.style" clearable style="width: 100%" @change="saveInfo">
                  <el-option-group label="写实 / 影视">
                    <el-option label="写实" value="realistic" />
                    <el-option label="电影感" value="cinematic" />
                    <el-option label="纪录片" value="documentary" />
                    <el-option label="黑色电影" value="noir" />
                    <el-option label="复古胶片" value="retro film" />
                    <el-option label="恐怖" value="horror" />
                  </el-option-group>
                  <el-option-group label="动漫 / 卡通">
                    <el-option label="日本动漫" value="anime style" />
                    <el-option label="欧美漫画" value="comic style" />
                    <el-option label="卡通" value="cartoon" />
                  </el-option-group>
                  <el-option-group label="中国风格">
                    <el-option label="国画水墨" value="ink wash" />
                    <el-option label="中国风" value="chinese style" />
                    <el-option label="古装" value="historical" />
                    <el-option label="武侠" value="wuxia" />
                  </el-option-group>
                  <el-option-group label="绘画艺术">
                    <el-option label="水彩" value="watercolor" />
                    <el-option label="油画" value="oil painting" />
                    <el-option label="素描" value="sketch" />
                    <el-option label="版画" value="woodblock print" />
                    <el-option label="印象派" value="impressionist" />
                  </el-option-group>
                  <el-option-group label="幻想 / 科幻">
                    <el-option label="奇幻" value="fantasy" />
                    <el-option label="暗黑奇幻" value="dark fantasy" />
                    <el-option label="科幻" value="sci-fi" />
                    <el-option label="赛博朋克" value="cyberpunk" />
                    <el-option label="蒸汽朋克" value="steampunk" />
                    <el-option label="末世废土" value="post-apocalyptic" />
                  </el-option-group>
                  <el-option-group label="数字 / 现代">
                    <el-option label="3D 渲染" value="3d render" />
                    <el-option label="像素风" value="pixel art" />
                    <el-option label="低多边形" value="low poly" />
                    <el-option label="极简" value="minimalist" />
                    <el-option label="唯美梦幻" value="dreamy" />
                  </el-option-group>
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="画面比例">
                <el-select v-model="infoForm.aspect_ratio" style="width: 100%" @change="saveInfo">
                  <el-option label="16:9 横屏（默认）" value="16:9" />
                  <el-option label="9:16 竖屏（短视频）" value="9:16" />
                  <el-option label="3:4 竖版" value="3:4" />
                  <el-option label="1:1 方形" value="1:1" />
                  <el-option label="4:3 传统横屏" value="4:3" />
                  <el-option label="21:9 宽银幕" value="21:9" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="故事梗概">
                <el-input v-project-text="{ kind: 'dramas', id: dramaId, field: 'description' }" v-model="infoForm.description" type="textarea" :rows="8" placeholder="一句话描述故事梗概" @blur="saveInfo" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </section>
      <section v-if="workspaceTab === 'info'" class="section card members-section"><ProjectMembers :drama-id="dramaId" :permissions="drama?.permissions || {}" :members="drama?.members || []" @updated="loadDrama" /></section>
        </div>
        <ProjectDangerZone v-if="workspaceTab === 'info'" :drama-id="dramaId" :title="drama?.title || ''" :permissions="drama?.permissions || {}" :members="drama?.members || []" @updated="loadDrama" />

        <!-- 分集列表 -->
      <section v-show="workspaceTab === 'episodes'" class="section card episodes-section" :class="{ 'is-sparse': episodes.length > 0 && episodes.length <= 3, 'is-single': episodes.length === 1 }">
        <div class="section-header">
          <div class="section-title">分集列表</div>
          <span class="section-count">共 {{ episodes.length }} 集</span>
          <EpisodeBatchImportDialog v-if="drama?.permissions?.can_edit !== false" ref="episodeBatchImportDialogRef" :start-episode-number="nextEpisodeNumber" :import-episodes="onBatchImportEpisodes" style="margin-left: auto" />
          <el-button size="small" type="primary" :disabled="drama?.permissions?.can_edit === false" :loading="addingEpisode" @click="onAddEpisode">
            <el-icon><Plus /></el-icon>新增一集
          </el-button>
        </div>
        <div v-if="episodes.length === 0" class="empty-tip">暂无分集</div>
        <div v-else class="episode-stage">
          <div class="episode-grid">
            <div
              v-for="ep in episodes"
              :key="ep.id"
              class="episode-card"
              @click="goEpisode(ep.id)"
            >
              <div class="episode-card-header">
                <span class="episode-num">第 {{ ep.episode_number ?? ep.number ?? '?' }} 集</span>
              </div>
              <div class="episode-title">{{ ep.title || '未命名' }}</div>
              <div class="episode-assignee" @click.stop><el-select :model-value="ep.assignee_user_id" :disabled="!drama?.permissions?.can_edit" clearable placeholder="分配负责人" size="small" @change="value => assignEpisode(ep.id, value)"><el-option v-for="member in (drama?.members || []).filter(item => item.role !== 'viewer')" :key="member.id" :value="member.id" :label="member.display_name || member.username" /></el-select></div>
              <div class="episode-preview">{{ (ep.script_content || '').slice(0, 120) || '暂无剧本' }}</div>
              <div class="episode-stats">
                <span class="ep-stat">
                  <span class="ep-stat-num">{{ ep.storyboards?.length ?? 0 }}</span> 分镜
                </span>
                <span v-if="ep.status" class="ep-stat ep-stat--status" :class="'ep-status--' + ep.status">{{ epStatusLabel(ep.status) }}</span>
              </div>
              <div class="episode-actions"><div class="episode-enter">
                <el-icon class="episode-enter-icon"><VideoPlay /></el-icon>
                进入制作
              </div><button type="button" class="episode-delete" :aria-label="`删除第 ${ep.episode_number ?? ep.number ?? '?'} 集`" :disabled="drama?.permissions?.can_edit === false || deletingEpisodeId === ep.id" @click.stop="onDeleteEpisode(ep)"><el-icon><Delete /></el-icon>{{ deletingEpisodeId === ep.id ? '删除中' : '删除' }}</button></div>
            </div>
          </div>
        </div>
      </section>

      <!-- 本剧资源库（Tab 切换） -->
      <section v-show="workspaceTab === 'resources'" class="section card res-section">
        <nav class="res-tabbar" aria-label="资源分类">
          <button
            v-for="t in [{v:'char',label:'角色'},{v:'scene',label:'场景'},{v:'prop',label:'道具'},{v:'media',label:'项目素材'}]"
            :key="t.v"
            type="button"
            class="res-tab res-tab--lib"
            :class="{ active: activeResTab === t.v }"
            :aria-pressed="activeResTab === t.v"
            @click="selectResourceTab(t.v)"
          >{{ t.label }}</button>
        </nav>

        <div v-if="activeResTab !== 'media'" class="resource-toolbar">
          <el-input v-model="resourceKeyword" :placeholder="`搜索本项目${resourceLabel}`" clearable aria-label="搜索制作资源" />
          <span class="section-count">{{ projectResources.length }} 个{{ resourceLabel }}</span>
          <el-button v-if="drama?.permissions?.can_edit !== false" type="primary" @click="openImport(activeResTab)">从素材库导入</el-button>
        </div>
        <ProjectMediaResources v-if="activeResTab === 'media'" :drama-id="dramaId" />

        <!-- 本剧制作角色 -->
        <template v-if="activeResTab === 'char'">
          <div class="drama-res-list">
            <template v-if="projectResources.length">
              <div v-for="item in projectResources" :key="item.id" class="drama-res-item" role="button" :tabindex="drama?.permissions?.can_edit === false ? -1 : 0" :aria-label="`编辑${item.name || item.location || resourceLabel}`" :aria-disabled="drama?.permissions?.can_edit === false" @click="openResourceEditor(item)" @keydown.enter.prevent="openResourceEditor(item)" @keydown.space.prevent="openResourceEditor(item)">
                <div class="drama-res-cover">
                  <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                  <span v-else class="library-placeholder">暂无图</span>
                </div>
                <div class="drama-res-info">
                  <div class="drama-res-name">{{ item.name || '未命名' }}</div>
                  <div class="drama-res-meta" v-if="item.role">
                    <el-tag size="small" type="info">{{ item.role === 'main' ? '主角' : item.role === 'supporting' ? '配角' : item.role }}</el-tag>
                  </div>
                  <div class="drama-res-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
                </div>
              </div>
            </template>
            <div v-else class="library-empty">{{ resourceKeyword ? '未找到匹配的角色' : '暂无角色，可从素材库导入，或在制作页创建' }}</div>
          </div>
        </template>

        <!-- 本剧制作场景 -->
        <template v-if="activeResTab === 'scene'">
          <div class="drama-res-list">
            <template v-if="projectResources.length">
              <div v-for="item in projectResources" :key="item.id" class="drama-res-item" role="button" :tabindex="drama?.permissions?.can_edit === false ? -1 : 0" :aria-label="`编辑${item.name || item.location || resourceLabel}`" :aria-disabled="drama?.permissions?.can_edit === false" @click="openResourceEditor(item)" @keydown.enter.prevent="openResourceEditor(item)" @keydown.space.prevent="openResourceEditor(item)">
                <div class="drama-res-cover">
                  <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                  <span v-else class="library-placeholder">暂无图</span>
                </div>
                <div class="drama-res-info">
                  <div class="drama-res-name">{{ item.location || '未命名' }}</div>
                  <div class="drama-res-meta" v-if="item.time">
                    <el-tag size="small" type="info">{{ item.time }}</el-tag>
                  </div>
                  <div class="drama-res-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
                </div>
              </div>
            </template>
            <div v-else class="library-empty">{{ resourceKeyword ? '未找到匹配的场景' : '暂无场景，可从素材库导入，或在制作页创建' }}</div>
          </div>
        </template>

        <!-- 本剧制作道具 -->
        <template v-if="activeResTab === 'prop'">
          <div class="drama-res-list">
            <template v-if="projectResources.length">
              <div v-for="item in projectResources" :key="item.id" class="drama-res-item" role="button" :tabindex="drama?.permissions?.can_edit === false ? -1 : 0" :aria-label="`编辑${item.name || item.location || resourceLabel}`" :aria-disabled="drama?.permissions?.can_edit === false" @click="openResourceEditor(item)" @keydown.enter.prevent="openResourceEditor(item)" @keydown.space.prevent="openResourceEditor(item)">
                <div class="drama-res-cover">
                  <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                  <span v-else class="library-placeholder">暂无图</span>
                </div>
                <div class="drama-res-info">
                  <div class="drama-res-name">{{ item.name || '未命名' }}</div>
                  <div class="drama-res-meta" v-if="item.type">
                    <el-tag size="small" type="info">{{ item.type }}</el-tag>
                  </div>
                  <div class="drama-res-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
                </div>
              </div>
            </template>
            <div v-else class="library-empty">{{ resourceKeyword ? '未找到匹配的道具' : '暂无道具，可从素材库导入，或在制作页创建' }}</div>
          </div>
        </template>
      </section>
    </main>

    <!-- 制作角色 编辑 -->
    <el-dialog v-model="editDramaCharVisible" title="编辑制作角色" width="min(720px, 94vw)" top="5vh" @close="editDramaCharForm = null">
      <el-form v-if="editDramaCharForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <div class="lib-img-thumb" @click="openPreview(assetImageUrl(editDramaCharForm))">
              <img v-if="editDramaCharForm.image_url || editDramaCharForm.local_path" :src="assetImageUrl(editDramaCharForm)" />
              <div v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editDramaCharForm.imgUploading" @click="dramaCharFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editDramaCharForm.imgGenerating" @click="generateDramaCharImg">AI 生成</el-button>
            </div>
          </div>
          <input ref="dramaCharFileRef" type="file" accept="image/*" style="display:none" @change="uploadDramaCharImg" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editDramaCharForm.name" /></el-form-item>
        <el-form-item label="角色类型">
          <el-select v-model="editDramaCharForm.role" style="width:100%">
            <el-option label="主角" value="main" />
            <el-option label="配角" value="supporting" />
            <el-option label="次要角色" value="minor" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述"><el-input v-model="editDramaCharForm.description" type="textarea" :rows="3" placeholder="角色背景描述" /></el-form-item>
        <el-form-item label="性格"><el-input v-model="editDramaCharForm.personality" placeholder="性格特征" /></el-form-item>
        <el-form-item label="外貌"><el-input v-model="editDramaCharForm.appearance" type="textarea" :rows="2" placeholder="外貌特征（影响图片生成）" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDramaCharVisible = false">取消</el-button>
        <el-button type="primary" :loading="editDramaCharSaving" @click="saveDramaChar">保存</el-button>
      </template>
    </el-dialog>

    <!-- 制作场景 编辑 -->
    <el-dialog v-model="editDramaSceneVisible" title="编辑制作场景" width="min(720px, 94vw)" top="5vh" @close="editDramaSceneForm = null">
      <el-form v-if="editDramaSceneForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <div class="lib-img-thumb" @click="openPreview(assetImageUrl(editDramaSceneForm))">
              <img v-if="editDramaSceneForm.image_url || editDramaSceneForm.local_path" :src="assetImageUrl(editDramaSceneForm)" />
              <div v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editDramaSceneForm.imgUploading" @click="dramaSceneFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editDramaSceneForm.imgGenerating" @click="generateDramaSceneImg">AI 生成</el-button>
            </div>
          </div>
          <input ref="dramaSceneFileRef" type="file" accept="image/*" style="display:none" @change="uploadDramaSceneImg" />
        </el-form-item>
        <el-form-item label="地点"><el-input v-model="editDramaSceneForm.location" /></el-form-item>
        <el-form-item label="时间"><el-input v-model="editDramaSceneForm.time" placeholder="如：浅色/夜晚" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editDramaSceneForm.description" type="textarea" :rows="3" placeholder="场景描述" /></el-form-item>
        <el-form-item label="图片提示词"><el-input v-model="editDramaSceneForm.prompt" type="textarea" :rows="2" placeholder="图片生成用的详细提示词" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDramaSceneVisible = false">取消</el-button>
        <el-button type="primary" :loading="editDramaSceneSaving" @click="saveDramaScene">保存</el-button>
      </template>
    </el-dialog>

    <!-- 制作道具 编辑 -->
    <el-dialog v-model="editDramaPropVisible" title="编辑制作道具" width="min(720px, 94vw)" top="5vh" @close="editDramaPropForm = null">
      <el-form v-if="editDramaPropForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <div class="lib-img-thumb" @click="openPreview(assetImageUrl(editDramaPropForm))">
              <img v-if="editDramaPropForm.image_url || editDramaPropForm.local_path" :src="assetImageUrl(editDramaPropForm)" />
              <div v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editDramaPropForm.imgUploading" @click="dramaPropFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editDramaPropForm.imgGenerating" @click="generateDramaPropImg">AI 生成</el-button>
            </div>
          </div>
          <input ref="dramaPropFileRef" type="file" accept="image/*" style="display:none" @change="uploadDramaPropImg" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editDramaPropForm.name" /></el-form-item>
        <el-form-item label="类型"><el-input v-model="editDramaPropForm.type" placeholder="如：关键道具、背景物件" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editDramaPropForm.description" type="textarea" :rows="3" placeholder="道具描述" /></el-form-item>
        <el-form-item label="图片提示词"><el-input v-model="editDramaPropForm.prompt" type="textarea" :rows="2" placeholder="图片生成用的详细提示词" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDramaPropVisible = false">取消</el-button>
        <el-button type="primary" :loading="editDramaPropSaving" @click="saveDramaProp">保存</el-button>
      </template>
    </el-dialog>

    <!-- 从素材库导入 -->
    <el-dialog
      v-model="importVisible"
      :title="`选择${importType === 'char' ? '角色' : importType === 'scene' ? '场景' : '道具'}导入`"
      width="min(760px, 94vw)"
      top="4vh"
      :close-on-click-modal="!importing" :close-on-press-escape="!importing" :show-close="!importing"
      destroy-on-close
      @open="loadImportList"
    >
      <div class="library-toolbar">
        <el-input v-model="importKw" placeholder="搜索关键词" clearable style="width: 220px" @input="onImportKwInput" />
      </div>
      <p class="import-tip">导入后直接成为本项目的制作资源，保留素材库中的原始条目。</p>
      <div v-if="importError" class="resource-error" role="alert">{{ importError }}<el-button size="small" @click="loadImportList">重试</el-button></div>
      <div v-loading="importLoading" class="library-list import-list">
        <div v-for="item in importList" :key="item.id" class="library-item import-choice" :class="{ selected: importSelected(item), unavailable: resourceExists(item) }" role="checkbox" :aria-checked="importSelected(item)" :aria-label="item.name || item.location || '未命名素材'" :aria-disabled="resourceExists(item) || importing" :tabindex="resourceExists(item) || importing ? -1 : 0" @click="toggleImport(item)" @keydown.enter.prevent="toggleImport(item)" @keydown.space.prevent="toggleImport(item)">
          <span class="import-check" aria-hidden="true">{{ importSelected(item) ? '✓' : '' }}</span>
          <div class="library-item-cover">
            <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
            <span v-else class="library-placeholder">暂无图</span>
          </div>
          <div class="library-item-info">
            <div class="library-item-name">
              {{ importType === 'scene' ? (item.location || item.time || '未命名') : (item.name || '未命名') }}
            </div>
            <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
            <small v-if="resourceExists(item)" class="import-existing">项目中已存在</small>
          </div>
        </div>
        <div v-if="!importLoading && !importError && importList.length === 0" class="library-empty">素材库暂无内容</div>
      </div>
      <div class="library-pagination">
        <el-pagination
          v-model:current-page="importPage"
          v-model:page-size="importPageSize"
          :total="importTotal"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="loadImportList"
          @size-change="loadImportList"
        />
      </div>
      <template #footer>
        <span class="import-selection-count">已选择 {{ importSelection.length }} 项</span>
        <el-button :disabled="importing" @click="importVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" :disabled="!importSelection.length || drama?.permissions?.can_edit === false" @click="importSelectedResources">导入所选</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="synopsisVisible" title="故事梗概" width="min(720px, calc(100vw - 32px))" class="project-synopsis-dialog">
      <p class="full-synopsis">{{ drama?.description }}</p>
      <template #footer><el-button @click="synopsisVisible = false">关闭</el-button></template>
    </el-dialog>
    <!-- 图片预览 -->
    <Teleport to="body">
      <div v-if="previewUrl" class="image-preview-overlay" @click="previewUrl = null">
        <img :src="previewUrl" alt="" class="image-preview-img" @click.stop="previewUrl = null" />
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { captureProjectEdit } from '@/utils/projectSnapshots'
import request from '@/utils/request'
import ProjectCollaborationBar from '@/components/ProjectCollaborationBar.vue'
import ProjectMembers from '@/components/ProjectMembers.vue'
import ProjectResults from '@/components/ProjectResults.vue'
import ProjectDangerZone from '@/components/ProjectDangerZone.vue'
import { ref, reactive, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, VideoPlay, Plus, Delete, PictureFilled, Grid } from '@element-plus/icons-vue'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'
import EpisodeBatchImportDialog from '@/components/EpisodeBatchImportDialog.vue'
import ProjectMediaResources from '@/components/ProjectMediaResources.vue'
import { dramaAPI } from '@/api/drama'
import { characterLibraryAPI } from '@/api/characterLibrary'
import { sceneLibraryAPI } from '@/api/sceneLibrary'
import { propLibraryAPI } from '@/api/propLibrary'
import { uploadAPI } from '@/api/upload'
import { taskAPI } from '@/api/task'
import { characterAPI } from '@/api/characters'
import { sceneAPI } from '@/api/scenes'
import { propAPI } from '@/api/props'
import { useGenerationTaskStore } from '@/stores/generationTaskStore'
import { stylePromptMetadataForSave, backfillDramaStylePromptMetadataIfNeeded } from '@/constants/styleOptions'

const route = useRoute()
const router = useRouter()
const generationTasks = useGenerationTaskStore()
const dramaId = Number(route.params.id)
const synopsisVisible = ref(false)
const synopsisPreview = computed(() => {
  const text = (drama.value?.description || '').replace(/\s+/g, ' ').trim()
  return text.length > 120 ? text.slice(0, 120) + '…' : text
})

// 制作资源编辑
const dramaCharFileRef  = ref(null)
const dramaSceneFileRef = ref(null)
const dramaPropFileRef  = ref(null)

const editDramaCharVisible = ref(false)
const editDramaCharForm    = ref(null)
const editDramaCharSaving  = ref(false)

const editDramaSceneVisible = ref(false)
const editDramaSceneForm    = ref(null)
const editDramaSceneSaving  = ref(false)

const editDramaPropVisible = ref(false)
const editDramaPropForm    = ref(null)
const editDramaPropSaving  = ref(false)
const episodeBatchImportDialogRef = ref(null)

function openEditDramaChar(item) {
  editDramaCharForm.value = {
    requestConfig: captureProjectEdit('characters', item.id),
    id: item.id, name: item.name ?? '', role: item.role ?? 'minor',
    description: item.description ?? '', personality: item.personality ?? '',
    appearance: item.appearance ?? '',
    image_url: item.image_url ?? '', local_path: item.local_path ?? null,
    imgUploading: false, imgGenerating: false
  }
  editDramaCharVisible.value = true
}
async function saveDramaChar() {
  if (!editDramaCharForm.value?.id) return
  editDramaCharSaving.value = true
  try {
    await characterAPI.update(editDramaCharForm.value.id, {
      name: editDramaCharForm.value.name,
      role: editDramaCharForm.value.role || null,
      description: editDramaCharForm.value.description || null,
      personality: editDramaCharForm.value.personality || null,
      appearance: editDramaCharForm.value.appearance || null,
    }, editDramaCharForm.value.requestConfig)
    ElMessage.success('已保存')
    editDramaCharVisible.value = false
    loadDrama()
  } catch (e) { ElMessage.error(e.message || '保存失败') }
  finally { editDramaCharSaving.value = false }
}
async function uploadDramaCharImg(event) {
  const file = event.target?.files?.[0]
  if (event.target) event.target.value = ''
  const form = editDramaCharForm.value
  if (!file || !form?.id) return
  form.imgUploading = true
  try {
    const res = await uploadAPI.uploadImage(file, { dramaId })
    const data = res?.data ?? res
    const url = data?.url || data?.path || data?.local_path
    if (!url) { ElMessage.error('上传未返回地址'); return }
    form.image_url = url
    form.local_path = data?.local_path ?? null
    await characterAPI.putImage(form.id, { image_url: url, local_path: data?.local_path ?? null })
    loadDrama()
    ElMessage.success('图片已更新')
  } catch (e) { ElMessage.error(e.message || '上传失败') }
  finally { form.imgUploading = false }
}
async function generateDramaCharImg() {
  const form = editDramaCharForm.value
  if (!form?.id) return
  form.imgGenerating = true
  try {
    const res = await characterAPI.generateImage(form.id, null, null)
    const data = res?.data ?? res
    const taskId = data?.task_id
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
    form.image_url = task.result?.image_url || ''
    form.local_path = task.result?.local_path ?? null
    loadDrama()
    ElMessage.success('AI 图片已生成')
  } catch (e) { ElMessage.error(e.message || '生成失败') }
  finally { form.imgGenerating = false }
}

function openEditDramaScene(item) {
  editDramaSceneForm.value = {
    requestConfig: captureProjectEdit('scenes', item.id),
    id: item.id, location: item.location ?? '', time: item.time ?? '',
    description: item.description ?? '', prompt: item.prompt ?? '',
    image_url: item.image_url ?? '', local_path: item.local_path ?? null,
    imgUploading: false, imgGenerating: false
  }
  editDramaSceneVisible.value = true
}
async function saveDramaScene() {
  if (!editDramaSceneForm.value?.id) return
  editDramaSceneSaving.value = true
  try {
    await sceneAPI.update(editDramaSceneForm.value.id, {
      location: editDramaSceneForm.value.location,
      time: editDramaSceneForm.value.time || null,
      description: editDramaSceneForm.value.description || null,
      prompt: editDramaSceneForm.value.prompt || null,
    }, editDramaSceneForm.value.requestConfig)
    ElMessage.success('已保存')
    editDramaSceneVisible.value = false
    loadDrama()
  } catch (e) { ElMessage.error(e.message || '保存失败') }
  finally { editDramaSceneSaving.value = false }
}
async function uploadDramaSceneImg(event) {
  const file = event.target?.files?.[0]
  if (event.target) event.target.value = ''
  const form = editDramaSceneForm.value
  if (!file || !form?.id) return
  form.imgUploading = true
  try {
    const res = await uploadAPI.uploadImage(file, { dramaId })
    const data = res?.data ?? res
    const url = data?.url || data?.path || data?.local_path
    if (!url) { ElMessage.error('上传未返回地址'); return }
    form.image_url = url
    form.local_path = data?.local_path ?? null
    await sceneAPI.update(form.id, { image_url: url, local_path: data?.local_path ?? null })
    loadDrama()
    ElMessage.success('图片已更新')
  } catch (e) { ElMessage.error(e.message || '上传失败') }
  finally { form.imgUploading = false }
}
async function generateDramaSceneImg() {
  const form = editDramaSceneForm.value
  if (!form?.id) return
  const prompt = [form.location, form.time, form.description].filter(Boolean).join(', ')
  if (!prompt) { ElMessage.warning('请先填写地点或描述'); return }
  form.imgGenerating = true
  try {
    const res = await sceneAPI.generateImage({ scene_id: form.id, drama_id: dramaId, prompt })
    const data = res?.data ?? res
    const taskId = data?.task_id
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
    form.image_url = task.result?.image_url || ''
    form.local_path = task.result?.local_path ?? null
    loadDrama()
    ElMessage.success('AI 图片已生成')
  } catch (e) { ElMessage.error(e.message || '生成失败') }
  finally { form.imgGenerating = false }
}

function openEditDramaProp(item) {
  editDramaPropForm.value = {
    requestConfig: captureProjectEdit('props', item.id),
    id: item.id, name: item.name ?? '', type: item.type ?? '',
    description: item.description ?? '', prompt: item.prompt ?? '',
    image_url: item.image_url ?? '', local_path: item.local_path ?? null,
    imgUploading: false, imgGenerating: false
  }
  editDramaPropVisible.value = true
}
async function saveDramaProp() {
  if (!editDramaPropForm.value?.id) return
  editDramaPropSaving.value = true
  try {
    await propAPI.update(editDramaPropForm.value.id, {
      name: editDramaPropForm.value.name,
      type: editDramaPropForm.value.type || null,
      description: editDramaPropForm.value.description || null,
      prompt: editDramaPropForm.value.prompt || null,
    }, editDramaPropForm.value.requestConfig)
    ElMessage.success('已保存')
    editDramaPropVisible.value = false
    loadDrama()
  } catch (e) { ElMessage.error(e.message || '保存失败') }
  finally { editDramaPropSaving.value = false }
}
async function uploadDramaPropImg(event) {
  const file = event.target?.files?.[0]
  if (event.target) event.target.value = ''
  const form = editDramaPropForm.value
  if (!file || !form?.id) return
  form.imgUploading = true
  try {
    const res = await uploadAPI.uploadImage(file, { dramaId })
    const data = res?.data ?? res
    const url = data?.url || data?.path || data?.local_path
    if (!url) { ElMessage.error('上传未返回地址'); return }
    form.image_url = url
    form.local_path = data?.local_path ?? null
    await propAPI.update(form.id, { image_url: url, local_path: data?.local_path ?? null })
    loadDrama()
    ElMessage.success('图片已更新')
  } catch (e) { ElMessage.error(e.message || '上传失败') }
  finally { form.imgUploading = false }
}
async function generateDramaPropImg() {
  const form = editDramaPropForm.value
  if (!form?.id) return
  form.imgGenerating = true
  try {
    const res = await propAPI.generateImage(form.id, null, null)
    const data = res?.data ?? res
    const taskId = data?.task_id
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
    form.image_url = task.result?.image_url || ''
    form.local_path = task.result?.local_path ?? null
    loadDrama()
    ElMessage.success('AI 图片已生成')
  } catch (e) { ElMessage.error(e.message || '生成失败') }
  finally { form.imgGenerating = false }
}

const loading = ref(false)
const drama = ref(null)
const episodes = ref([])
const nextEpisodeNumber = computed(() => (
  episodes.value.length > 0
    ? Math.max(...episodes.value.map((e) => Number(e.episode_number) || 0), 0) + 1
    : 1
))

const infoForm = reactive({ title: '', description: '', genre: '', style: '', aspect_ratio: '16:9' })

function assetImageUrl(item) {
  if (!item) return ''
  const lp = item.local_path && String(item.local_path).trim()
  if (lp) return '/static/' + lp.replace(/^\//, '')
  return item.image_url || ''
}

async function assignEpisode(id, userId) {
  try { await request.put(`/dramas/${dramaId}/collaboration/episodes/${id}/assignee`, { user_id: userId || null }); await loadDrama() } catch(error) { ElMessage.error(error.message) }
}
async function loadDrama() {
  loading.value = true
  try {
    let d = await dramaAPI.get(dramaId)
    if (!d.permissions?.collaboration_enabled) d = await backfillDramaStylePromptMetadataIfNeeded(dramaAPI, dramaId, d)
    drama.value = d
    episodes.value = d.episodes || []
    infoForm.title = d.title || ''
    infoForm.description = d.description || ''
    infoForm.genre = d.genre || ''
    infoForm.style = d.style || ''
    infoForm.aspect_ratio = d.metadata?.aspect_ratio || '16:9'
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

let infoSaveTimer = null
function saveInfo() {
  if (infoSaveTimer) clearTimeout(infoSaveTimer)
  infoSaveTimer = setTimeout(async () => {
    try {
      await dramaAPI.update(dramaId, { title: infoForm.title, description: infoForm.description })
      await dramaAPI.saveOutline(dramaId, {
        genre: infoForm.genre || undefined,
        style: infoForm.style || undefined,
        metadata: {
          ...stylePromptMetadataForSave(infoForm.style),
          aspect_ratio: infoForm.aspect_ratio || '16:9',
        },
      })
    } catch (e) {
      console.error('saveInfo failed', e)
    }
  }, 600)
}

function goCreate() {
  router.push(`/film/${dramaId}`)
}

function goCanvasMode() {
  router.push(`/film/${dramaId}/canvas`)
}

function goEpisode(epId) {
  router.push(`/film/${dramaId}?episode=${epId}`)
}

function epStatusLabel(status) {
  const map = { draft: '草稿', processing: '生成中', completed: '已完成', failed: '失败' }
  return map[status] || status
}

async function onBatchImportEpisodes(importedEpisodes) {
  await dramaAPI.appendEpisodes(dramaId, importedEpisodes)
  await loadDrama()
}

const addingEpisode = ref(false)
const deletingEpisodeId = ref(null)

async function onDeleteEpisode(ep) {
  const label = `第 ${ep.episode_number ?? '?'} 集「${ep.title || '未命名'}」`
  try {
    await ElMessageBox.confirm(`确定删除 ${label}？此操作不可恢复。`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    })
  } catch { return }
  deletingEpisodeId.value = ep.id
  try {
    await dramaAPI.deleteEpisode(dramaId, ep)
    ElMessage.success(`${label} 已删除`)
    await loadDrama()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  } finally {
    deletingEpisodeId.value = null
  }
}

async function onAddEpisode() {
  addingEpisode.value = true
  try {
    const result = await dramaAPI.appendEpisodes(dramaId, [{ script_content: '' }])
    const nextNum = result.episodes[0].episode_number
    await loadDrama()
    ElMessage.success('已添加第' + nextNum + '集')
  } catch (e) {
    ElMessage.error(e.message || '添加失败')
  } finally {
    addingEpisode.value = false
  }
}

// ---------- 资源库 Tab ----------
const resourceTabs = ['char', 'scene', 'prop', 'media']
const workspaceTab = ref(route.query.tab === 'resources' ? 'resources' : 'episodes')
const activeResTab = ref(resourceTabs.includes(route.query.resource) ? route.query.resource : 'char')
const resourceKeyword = ref('')
const resourceKinds = { char: 'character', scene: 'scene', prop: 'prop' }
const resourceLabel = computed(() => ({ char: '角色', scene: '场景', prop: '道具' })[activeResTab.value] || '')
const projectResources = computed(() => {
  const rows = ({ char: drama.value?.characters, scene: drama.value?.scenes, prop: drama.value?.props })[activeResTab.value] || []
  const keyword = resourceKeyword.value.trim().toLowerCase()
  return keyword ? rows.filter(row => [row.name, row.location, row.time, row.description, row.prompt].some(value => String(value || '').toLowerCase().includes(keyword))) : rows
})
function selectResourceTab(tab) {
  activeResTab.value = tab
  resourceKeyword.value = ''
  router.replace({ query: { ...route.query, tab: 'resources', resource: tab } })
}
function openResourceEditor(item) {
  if (drama.value?.permissions?.can_edit === false) return
  const open = { char: openEditDramaChar, scene: openEditDramaScene, prop: openEditDramaProp }[activeResTab.value]
  open?.(item)
}
const previewUrl = ref(null)
function openPreview(url) { if (url) previewUrl.value = url }

// ---------- 从素材库导入 ----------
const importVisible = ref(false)
const importType = ref('char') // 'char' | 'scene' | 'prop'
const importList = ref([])
const importLoading = ref(false)
const importError = ref('')
const importPage = ref(1)
const importPageSize = ref(20)
const importTotal = ref(0)
const importKw = ref('')
const importing = ref(false)
const importSelection = ref([])
let importKwTimer = null

function openImport(type) {
  importType.value = type
  importSelection.value = []
  importKw.value = ''
  importPage.value = 1
  importVisible.value = true
}

async function loadImportList() {
  importLoading.value = true
  importError.value = ''
  try {
    const api = importType.value === 'char' ? characterLibraryAPI
      : importType.value === 'scene' ? sceneLibraryAPI : propLibraryAPI
    const res = await api.list({ page: importPage.value, page_size: importPageSize.value, keyword: importKw.value || undefined, global: 1 })
    importList.value = res?.items ?? []
    importTotal.value = res?.pagination?.total ?? 0
  } catch (error) { importList.value = []; importError.value = error.message || '素材库加载失败，请重试' } finally { importLoading.value = false }
}

function onImportKwInput() {
  if (importKwTimer) clearTimeout(importKwTimer)
  importKwTimer = setTimeout(() => { importPage.value = 1; loadImportList() }, 300)
}

function resourceExists(item) {
  const rows = importType.value === 'char' ? drama.value?.characters : importType.value === 'scene' ? drama.value?.scenes : drama.value?.props
  const name = importType.value === 'scene' ? item.location : item.name
  return (rows || []).some(row => (importType.value === 'scene' ? row.location : row.name) === name)
}

function importSelected(item) { return importSelection.value.some(row => row.id === item.id) }
function toggleImport(item) {
  if (importing.value || resourceExists(item) || drama.value?.permissions?.can_edit === false) return
  importSelection.value = importSelected(item) ? importSelection.value.filter(row => row.id !== item.id) : [...importSelection.value, item]
}
async function importSelectedResources() {
  if (importing.value || !importSelection.value.length || drama.value?.permissions?.can_edit === false) return
  importing.value = true
  let imported = 0
  try {
    for (const item of [...importSelection.value]) {
      await dramaAPI.importResource(dramaId, { type: resourceKinds[importType.value], library_id: item.id })
      importSelection.value = importSelection.value.filter(row => row.id !== item.id)
      imported++
      await loadDrama()
    }
    importVisible.value = false
    ElMessage.success(`已导入 ${imported} 项制作资源`)
  } catch (error) {
    ElMessage.error(`${imported ? `已导入 ${imported} 项。` : ''}${error.message || '导入失败'}，其余选择已保留`)
  } finally {
    importing.value = false
  }
}

let importBatchTimer = null
onMounted(() => {
  loadDrama()
  if (route.query.importBatch) {
    importBatchTimer = setTimeout(() => {
      episodeBatchImportDialogRef.value?.openDialog?.()
    }, 0)
  }
})
onBeforeUnmount(() => { [importBatchTimer, infoSaveTimer, importKwTimer].forEach(clearTimeout) })
</script>

<style scoped>
.drama-detail {
  min-height: 100vh;
  background: #0f0f12;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(120, 60, 220, 0.18) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(60, 100, 220, 0.12) 0%, transparent 60%);
  color: #e4e4e7;
}
.header {
  background: rgba(18, 18, 22, 0.82);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(139, 92, 246, 0.18);
  padding: 12px 24px;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 2px 20px rgba(0, 0, 0, 0.4);
}
html.light .drama-detail {
  background: #f5f3ff;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(139, 92, 246, 0.12) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(99, 102, 241, 0.08) 0%, transparent 60%);
}
html.light .drama-detail .header {
  background: rgba(255, 255, 255, 0.85) !important;
  border-bottom-color: rgba(139, 92, 246, 0.2) !important;
  box-shadow: 0 2px 16px rgba(139, 92, 246, 0.08) !important;
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
  font-size: 1.1rem;
  font-weight: 700;
  background: linear-gradient(135deg, #c4b5fd 0%, #818cf8 50%, #a78bfa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.logo-sub {
  font-size: 0.68rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: #6d6d7a;
  -webkit-text-fill-color: #6d6d7a;
}
html.light .drama-detail .logo-main {
  color: #3479ae;
  -webkit-text-fill-color: #3479ae;
}
html.light .drama-detail .logo-sub {
  color: #9ca3af;
  -webkit-text-fill-color: #9ca3af;
}
.header-inner { max-width: min(1200px, 96vw); margin: 0 auto; display: flex; align-items: center; gap: 16px; }
.breadcrumb-sep {
  color: #3f3f46;
  font-size: 1rem;
  font-weight: 300;
  flex-shrink: 0;
  user-select: none;
}
html.light .breadcrumb-sep { color: #d1d5db; }
.page-title {
  font-size: 0.88rem;
  font-weight: 500;
  color: #a1a1aa;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 3px 10px;
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
html.light .page-title {
  color: #6b7280;
  background: rgba(99, 102, 241, 0.06);
  border-color: rgba(99, 102, 241, 0.15);
}
.btn-back-list {
  flex-shrink: 0;
}
.header-actions { margin-left: auto; display: flex; gap: 8px; flex-shrink: 0; }
.main { max-width: min(1200px, 96vw); margin: 0 auto; padding: 24px 16px 48px; display: flex; flex-direction: column; gap: 20px; }
.section.card {
  background: rgba(24, 24, 27, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 16px;
  padding: 20px 24px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
  transition: box-shadow 0.3s, border-color 0.3s;
}
.section.card:hover {
  border-color: rgba(139, 92, 246, 0.25);
  box-shadow: 0 6px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(139, 92, 246, 0.08);
}
html.light .section.card {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(139, 92, 246, 0.15);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.06);
}
html.light .section.card:hover {
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 6px 28px rgba(139, 92, 246, 0.1);
}
.section-title { font-size: 1rem; font-weight: 600; color: #fafafa; margin-bottom: 16px; }
html.light .section-title { color: #18181b; }
.section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.section-header .section-title { margin-bottom: 0; }
.section-count { color: #71717a; font-size: 0.85rem; }
.info-form { max-width: 100%; }
.empty-tip { color: #71717a; text-align: center; padding: 32px; }

/* 分集卡片 */
.episode-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.episode-card {
  background: rgba(28, 28, 30, 0.8);
  border: 1px solid rgba(63, 63, 70, 0.6);
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: border-color 0.25s, transform 0.2s, box-shadow 0.25s, background 0.2s;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}
.episode-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.06), transparent 60%);
  opacity: 0;
  transition: opacity 0.25s;
}
.episode-card:hover {
  border-color: rgba(139, 92, 246, 0.5);
  background: rgba(35, 35, 38, 0.9);
  transform: translateY(-3px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(139, 92, 246, 0.15);
}
.episode-card:hover::before { opacity: 1; }
.episode-card:hover .episode-enter {
  color: var(--el-color-primary);
  opacity: 1;
}
.episode-card:hover .episode-enter-icon {
  transform: translateX(3px);
}
.episode-enter {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #27272a;
  font-size: 0.78rem;
  color: #52525b;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0.7;
  transition: color 0.2s, opacity 0.2s;
}
.episode-enter-icon {
  font-size: 0.85rem;
  transition: transform 0.2s;
}
.episode-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.episode-num { font-size: 0.8rem; color: #71717a; }
.episode-title { font-weight: 500; color: #fafafa; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.episode-preview { font-size: 0.78rem; color: #71717a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 8px; }
.episode-stats { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ep-stat { font-size: 0.72rem; color: #71717a; }
.ep-stat-num { color: #38bdf8; font-weight: 600; }
.ep-stat--status { padding: 1px 7px; border-radius: 99px; font-size: 0.7rem; }
.ep-status--draft { background: rgba(113,113,122,0.15); color: #a1a1aa; }
.ep-status--processing { background: rgba(234,179,8,0.12); color: #fcd34d; }
.ep-status--completed { background: rgba(34,197,94,0.12); color: #4ade80; }
.ep-status--failed { background: rgba(239,68,68,0.12); color: #f87171; }

/* 资源库 */
.library-toolbar { margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
.import-tip { font-size: 0.8rem; color: #71717a; }
.import-list { max-height: 480px; }
.library-list { min-height: 120px; display: flex; flex-direction: column; gap: 10px; max-height: 400px; overflow-y: auto; }
.library-item { display: flex; gap: 12px; padding: 10px; background: #1c1c1e; border: 1px solid #27272a; border-radius: 8px; }
.library-item-cover { width: 72px; height: 72px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: var(--bg-inner); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.library-item-cover img { width: 100%; height: 100%; object-fit: cover; }
.library-placeholder { font-size: 0.8rem; color: #71717a; }
.library-item-info { flex: 1; min-width: 0; }
.library-item-name { font-weight: 500; color: #fafafa; margin-bottom: 4px; }
.library-item-desc { font-size: 0.85rem; color: #a1a1aa; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.library-item-actions { display: flex; gap: 8px; }
.library-empty { text-align: center; color: #71717a; padding: 40px 20px; }
.library-pagination { margin-top: 12px; display: flex; justify-content: center; }

/* ——— 编辑器风格 Tab 栏 ——— */
.res-section { padding-bottom: 0 !important; }
.res-tabbar {
  display: flex;
  align-items: center;
  gap: 0;
  border-bottom: 1px solid var(--border-color, #27272a);
  padding: 0 4px;
  overflow-x: auto;
  scrollbar-width: none;
  margin: -4px -20px 0;
  padding-left: 20px;
}
.res-tabbar::-webkit-scrollbar { display: none; }
.res-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 9px 16px 8px;
  font-size: 13px;
  color: var(--text-secondary, #a1a1aa);
  background: transparent;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s, background 0.15s;
  flex-shrink: 0;
  outline: none;
}
.res-tab::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: transparent;
  transition: background 0.15s;
}
.res-tab:hover { color: var(--text-primary); background: var(--bg-inner, rgba(255,255,255,0.04)); }
.res-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
.resource-source { display: inline-block; align-self: flex-start; margin-bottom: 6px; padding: 2px 6px; border-radius: 4px; background: var(--bg-hover); color: var(--text-muted); font-size: 11px; }
.resource-error { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 0; color: var(--el-color-danger); }
.resource-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:12px; margin-top:20px; }
.resource-toolbar > .el-input { width:240px; max-width:100%; }
.resource-toolbar > .el-button { margin-left:auto; }
.res-section .drama-res-list { padding-top: 20px; }
.res-section .library-toolbar { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--border-subtle); flex-wrap: wrap; }
.res-section .library-pagination { max-width: 100%; }
.res-section .library-pagination :deep(.el-pagination) { flex-wrap: wrap; justify-content: center; gap: 4px; }
/* 资源库激活 */
.res-tab--lib.active { color: #60a5fa; font-size: 14px; font-weight: 600; }
.res-tab--lib.active::after { background: #60a5fa; }
/* 制作资源激活 */
.res-tab--drama.active { color: #a78bfa; font-size: 14px; font-weight: 600; }
.res-tab--drama.active::after { background: #a78bfa; }

html.light .episode-card { background: rgba(255, 255, 255, 0.85); border-color: rgba(139, 92, 246, 0.12); }
html.light .episode-card:hover { background: rgba(245, 243, 255, 0.95); border-color: rgba(139, 92, 246, 0.4); box-shadow: 0 8px 24px rgba(139, 92, 246, 0.12); }
html.light .episode-card::before { background: linear-gradient(135deg, rgba(139, 92, 246, 0.05), transparent 60%); }
html.light .episode-enter { border-top-color: #e4e4e7; color: #a1a1aa; }
html.light .episode-card:hover .episode-enter { color: var(--el-color-primary); }
html.light .episode-title { color: #18181b; }
html.light .res-tab:hover { background: rgba(0,0,0,0.04); }
html.light .res-tab--lib.active { color: #2563eb; }
html.light .res-tab--lib.active::after { background: #2563eb; }
html.light .res-tab--drama.active { color: #3479ae; }
html.light .res-tab--drama.active::after { background: #3479ae; }

/* 本剧制作资源列表 */
.drama-res-list { display: flex; flex-wrap: wrap; gap: 12px; padding: 4px 0 8px; }
.drama-res-item { display: flex; gap: 12px; width: calc(50% - 6px); background: var(--bg-inner, #1c1c1e); border: 1px solid var(--border-color, #27272a); border-radius: 8px; padding: 10px; box-sizing: border-box; }
.drama-res-cover { width: 72px; height: 72px; border-radius: 6px; overflow: hidden; flex-shrink: 0; cursor: zoom-in; background: var(--bg-page, #0f0f12); display: flex; align-items: center; justify-content: center; }
.drama-res-cover img { width: 100%; height: 100%; object-fit: cover; }
.drama-res-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.drama-res-name { font-size: 14px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.drama-res-meta { display: flex; gap: 4px; flex-wrap: wrap; }
.drama-res-desc { font-size: 12px; color: var(--text-secondary, #a1a1aa); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.drama-res-actions { margin-top: 6px; }

/* 编辑弹框内图片区 */
.lib-img-editor { display: flex; align-items: center; gap: 14px; }
.lib-img-thumb { width: 88px; height: 88px; border-radius: 8px; overflow: hidden; cursor: zoom-in; background: var(--bg-inner, #1c1c1e); border: 1px solid var(--border-color, #27272a); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.lib-img-thumb img { width: 100%; height: 100%; object-fit: cover; }
.lib-img-empty { color: var(--text-faint, #52525b); font-size: 26px; }
.lib-img-btns { display: flex; flex-direction: column; gap: 8px; }

/* 图片预览 */
.image-preview-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.85); display: flex; align-items: center; justify-content: center; z-index: 9999; cursor: zoom-out; }
.image-preview-img { max-width: 90vw; max-height: 90vh; border-radius: 8px; object-fit: contain; }

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
.drama-detail { background: var(--bg-page); background-image: none; color: var(--text-primary); }
/* UI refactor: project detail uses the shared creative-workspace language. */
.drama-detail{background:var(--bg-page);background-image:radial-gradient(56% 38% at 7% -8%,color-mix(in srgb,var(--accent) 14%,transparent),transparent 72%),radial-gradient(42% 32% at 96% 12%,color-mix(in srgb,var(--accent-teal) 8%,transparent),transparent 70%)}
.header{padding:10px 20px;background:color-mix(in srgb,var(--bg-surface) 88%,transparent)!important;border-bottom-color:var(--border-subtle)!important;box-shadow:var(--shadow-sm)!important}.header-inner,.main{width:100%;max-width:1200px;box-sizing:border-box}.header-inner{gap:12px}.logo{flex-direction:row;align-items:center;gap:8px}.logo-main{background:none;color:var(--text-primary);-webkit-text-fill-color:var(--text-primary)}.logo-sub{color:var(--text-muted);-webkit-text-fill-color:var(--text-muted)}.page-title{color:var(--text-regular);border-color:var(--border-subtle);border-radius:9px;background:color-mix(in srgb,var(--bg-raised) 76%,transparent)}
.main{padding:clamp(1rem,2.7vw,2.5rem) 0 4rem;gap:16px}.section.card{border-color:var(--border-subtle);border-radius:var(--radius-lg);background:color-mix(in srgb,var(--bg-surface) 93%,transparent);box-shadow:var(--shadow-sm)}.section.card:hover{border-color:color-mix(in srgb,var(--accent) 43%,var(--border-color));box-shadow:var(--shadow-md)}.section-title{color:var(--text-primary);font-size:1.05rem;letter-spacing:-.015em}.section-count,.empty-tip,.import-tip,.library-placeholder,.library-empty{color:var(--text-muted)}
.episode-grid{gap:14px}.episode-card{border-color:var(--border-subtle);border-radius:12px;background:var(--bg-raised);box-shadow:none}.episode-card::before{background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 12%,transparent),transparent 62%)}.episode-card:hover{border-color:color-mix(in srgb,var(--accent) 56%,var(--border-color));background:color-mix(in srgb,var(--accent) 7%,var(--bg-raised));box-shadow:var(--shadow-sm)}.episode-title,.library-item-name{color:var(--text-primary)}.episode-num,.episode-preview,.ep-stat,.library-item-desc{color:var(--text-muted)}.ep-stat-num{color:var(--accent-teal)}.episode-enter{border-color:var(--border-subtle);color:var(--text-faint)}
.library-item,.drama-res-item{border-color:var(--border-subtle);border-radius:10px;background:var(--bg-raised)}.res-tabbar{border-color:var(--border-subtle)}.res-tab{color:var(--text-muted)}.res-tab:hover{color:var(--text-primary);background:color-mix(in srgb,var(--bg-raised) 76%,transparent)}.res-tab--lib.active,.res-tab--drama.active{color:var(--accent)}.res-tab--lib.active::after,.res-tab--drama.active::after{background:var(--accent)}
@media(max-width:760px){.header{padding:9px 12px}.header-inner{gap:7px}.logo{min-width:30px}.richi-brand-copy,.breadcrumb-sep,.btn-back-list{display:none}.richi-brand-mark{width:30px;height:30px;flex:0 0 30px}.page-title{min-width:0;flex:1;padding:0;border:0;background:transparent}.header-actions{margin-left:0;gap:4px}.header-actions :deep(.account-balance){display:none}.header-actions .el-button{height:34px;padding-inline:9px;font-size:0}.header-actions .el-icon{font-size:15px}.main{padding:18px 12px 40px}.section.card{padding:16px;border-radius:14px}.section-header{align-items:flex-start;flex-wrap:wrap;gap:8px}.section-header .section-count{margin-right:auto}.episode-grid{grid-template-columns:1fr}.episode-card{min-height:132px}.drama-res-item{width:100%}.res-tabbar{margin-inline:-16px;padding-left:16px}:deep(.info-form .el-col){width:100%;max-width:100%;flex:0 0 100%}:deep(.info-form .el-form-item){margin-bottom:16px}:deep(.info-form .el-form-item__label){font-size:13px}}
@media(min-width:900px){
  .drama-detail{background-image:radial-gradient(52% 42% at 7% -8%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 72%),radial-gradient(38% 36% at 94% 18%,color-mix(in srgb,var(--accent-teal) 13%,transparent),transparent 70%),linear-gradient(180deg,color-mix(in srgb,var(--bg-page) 82%,#05070b),var(--bg-page) 36%)}
  .header{padding-block:13px}.header-inner{max-width:1340px}.main{max-width:1340px;padding-top:42px;gap:22px}.section.card{position:relative;overflow:hidden;padding:28px 30px;border-radius:20px}.section.card::after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(120deg,color-mix(in srgb,var(--text-primary) 4%,transparent),transparent 34%);opacity:.6}.section.card>*{position:relative;z-index:1}
  .main > .section.card:first-child{min-height:276px;padding:34px 36px;border-color:color-mix(in srgb,var(--accent) 44%,var(--border-color));background:radial-gradient(circle at 92% 10%,color-mix(in srgb,var(--accent-teal) 24%,transparent),transparent 25%),radial-gradient(circle at 76% 105%,color-mix(in srgb,var(--accent) 24%,transparent),transparent 39%),linear-gradient(140deg,color-mix(in srgb,var(--accent) 16%,var(--bg-surface)),var(--bg-surface) 54%,color-mix(in srgb,var(--accent-teal) 7%,var(--bg-surface)))}
  .main > .section.card:first-child::before{content:'';position:absolute;right:-90px;top:-152px;width:420px;height:420px;border:1px solid color-mix(in srgb,var(--accent) 34%,transparent);border-radius:50%;box-shadow:0 0 0 36px color-mix(in srgb,var(--accent) 6%,transparent),0 0 0 74px color-mix(in srgb,var(--accent) 4%,transparent);pointer-events:none}
  .section-title{display:flex;align-items:center;gap:10px;margin-bottom:24px;font-size:1.25rem;font-weight:740}.main > .section.card:first-child .section-title::before,.main > .section.card:nth-child(2) .section-title::before,.main > .section.card:nth-child(3) .section-title::before{font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--accent);white-space:nowrap}.main > .section.card:first-child .section-title::before{content:'项目'}.main > .section.card:nth-child(2) .section-title::before{content:'分集'}.main > .section.card:nth-child(3) .section-title::before{content:'素材'}
  .info-form{max-width:1020px}.info-form :deep(.el-input__wrapper),.info-form :deep(.el-select__wrapper),.info-form :deep(.el-textarea__inner){background:color-mix(in srgb,var(--bg-page) 46%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--text-primary) 10%,transparent) inset!important}.info-form :deep(.el-input__wrapper:hover),.info-form :deep(.el-select__wrapper:hover),.info-form :deep(.el-textarea__inner:hover){box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 58%,var(--border-color)) inset!important}.info-form :deep(.el-form-item__label){font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--text-muted)}
  .section-header{padding-bottom:16px;border-bottom:1px solid var(--border-subtle)}.episode-grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}.episode-card{min-height:178px;padding:18px}.episode-card::after{content:'';position:absolute;right:14px;bottom:15px;width:32px;height:32px;border-right:1px solid color-mix(in srgb,var(--accent) 58%,transparent);border-bottom:1px solid color-mix(in srgb,var(--accent) 58%,transparent);opacity:.55}.episode-card:hover{transform:translateY(-5px) scale(1.01)}.episode-title{font-size:1rem}.episode-preview{line-height:1.55;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.episode-enter{margin-top:auto}
  .res-section{padding-top:22px!important}.res-tabbar{margin-inline:-30px;padding-left:30px;background:color-mix(in srgb,var(--bg-page) 26%,transparent)}.res-tab{padding:13px 18px}.drama-res-list{gap:16px}.drama-res-item{padding:14px;border-radius:12px;transition:transform .18s ease,border-color .18s ease}.drama-res-item:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--accent) 48%,var(--border-color))}
}


.drama-detail { display:flex; height:100dvh; min-height:0; flex-direction:column; overflow-y:auto; overflow-x:clip; }
.drama-detail > .header { position:relative; flex:0 0 auto; }
.drama-detail > .main { display:block; flex:0 0 auto; min-height:0; width:100%; max-width:min(1340px,calc(100vw - 64px)); padding:28px 0 48px; overflow:visible; }
.drama-detail .header-inner { max-width:1340px; }
.project-summary { margin:8px 0 24px; }
.project-title-row { display:flex; align-items:center; gap:14px; }
.project-summary h2 { margin:0; font-size:28px; font-weight:650; letter-spacing:-.02em; line-height:1.4; overflow-wrap:anywhere; }
.project-episode-count { flex-shrink:0; padding:4px 9px; border:1px solid var(--border-subtle); border-radius:6px; color:var(--text-muted); font-size:12px; }
.project-synopsis { display:flex; align-items:flex-start; gap:20px; margin-top:12px; }
.project-summary p { flex:1; margin:0; color:var(--text-muted); font-size:14px; font-weight:400; line-height:1.8; overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.synopsis-toggle { flex-shrink:0; padding:3px 0; border:0; background:none; color:var(--accent); font:inherit; font-size:13px; cursor:pointer; }
.synopsis-toggle:hover { text-decoration:underline; }
.full-synopsis { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font-size:14px; line-height:1.9; color:var(--text-primary); }
.project-workspace-tabs { display:flex; gap:24px; width:100%; border-bottom:1px solid var(--border-subtle); }
.project-workspace-tabs button { position:relative; padding:14px 4px; border:0; background:transparent; color:var(--text-muted); font:inherit; font-size:14px; cursor:pointer; }
.project-workspace-tabs button:hover { color:var(--text-primary); }
.project-workspace-tabs button.active { color:var(--text-primary); font-weight:600; }
.project-workspace-tabs button.active::after { content:''; position:absolute; inset:auto 0 -1px; height:2px; background:var(--accent); }
.project-workspace-tabs button:focus-visible,.synopsis-toggle:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.project-settings-layout { display:grid; grid-template-columns:minmax(0,1.5fr) minmax(340px,1fr); align-items:start; gap:20px; margin-top:24px; }
.project-settings-layout > .section.card { min-width:0; padding:24px; border-radius:12px; overflow:visible; }
.project-settings-layout .section-title { margin:0; font-size:17px; }
.project-settings-layout .section-count { font-size:12px; }
.project-settings-layout .info-form :deep(.el-form-item__label) { margin-bottom:8px; font-weight:500; }
.project-settings-layout .info-form :deep(.el-row > .el-col:last-child .el-form-item) { margin-bottom:0; }
.project-settings-layout :deep(.members-heading h2) { margin:0; }
.project-settings-layout :deep(.project-members > p) { margin:16px 0; font-size:13px; }
.drama-detail .main > .section.card { margin-top:20px; padding:24px; overflow:visible; border-radius:16px; }
.drama-detail .section-title::before { content:none!important; }
.drama-detail .episodes-section .episode-grid { display:flex; flex-direction:column; gap:0; }
.drama-detail .episodes-section .episode-stage { display:block; height:auto; }
.drama-detail .episodes-section .episode-card { display:grid; grid-template-columns:65px minmax(160px,1fr) 170px 100px 100px; grid-template-rows:auto auto; align-items:center; gap:8px 20px; width:100%; min-height:110px; height:auto; padding:18px 8px; border:0; border-bottom:1px solid var(--border-subtle); border-radius:0; background:transparent; box-shadow:none; box-sizing:border-box; }
.drama-detail .episodes-section .episode-card:hover { transform:none; background:var(--bg-raised); }
.drama-detail .episode-card::before,.drama-detail .episode-card::after { display:none; }
.drama-detail .episode-card-header { grid-column:1; grid-row:1/3; display:flex; flex-direction:column; align-items:flex-start; justify-content:space-between; gap:12px; }
.drama-detail .episode-title { grid-column:2; grid-row:1; margin:0; font-size:16px; line-height:1.4; }
.drama-detail .episode-preview { grid-column:2; grid-row:2; margin:0; line-height:1.5; }
.drama-detail .episode-assignee { grid-column:3; grid-row:1/3; min-width:0; }
.drama-detail .episode-stats { grid-column:4; grid-row:1/3; }
.drama-detail .episode-enter { grid-column:5; grid-row:1/3; margin:0; padding:0; border:0; font-size:13px; color:var(--accent); opacity:1; }
.episode-next-step { display:none; }
.resources-workspace .drama-res-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr)); }
.resources-workspace .drama-res-item { width:auto; min-width:0; box-sizing:border-box; }
.resources-workspace .res-section .library-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr)); max-height:none; overflow:visible; }
.resources-workspace .res-section .library-empty { grid-column:1/-1; }
.resources-workspace .res-tabbar { margin-inline:0; padding-inline:0; }
@media(max-width:900px) {
  .project-settings-layout { grid-template-columns:minmax(0,1fr); }
  .project-summary h2 { font-size:24px; }
  .project-synopsis { display:block; }
  .synopsis-toggle { margin-top:8px; }
  .drama-detail > .main { max-width:calc(100vw - 24px); }
  .drama-detail .main > .section.card { padding:16px; }
  .drama-detail .episodes-section .episode-card { grid-template-columns:54px minmax(0,1fr) 80px; gap:8px 12px; }
  .drama-detail .episode-assignee { grid-column:2; grid-row:3; width:170px; max-width:100%; }
  .drama-detail .episode-stats { grid-column:2; grid-row:4; }
  .drama-detail .episode-enter { grid-column:3; grid-row:1/4; }
  .project-workspace-tabs { width:100%; gap:4px; box-sizing:border-box; }
  .project-workspace-tabs button { flex:1; padding:12px 4px; white-space:nowrap; font-size:13px; }
}
.drama-detail .episode-actions { grid-column:5; grid-row:1/3; display:flex; flex-direction:column; align-items:flex-end; gap:14px; }
.drama-detail .episode-actions .episode-enter { display:flex; align-items:center; gap:5px; }
.episode-delete { display:inline-flex; align-items:center; gap:5px; margin:0; padding:0; border:0; background:none; color:var(--el-color-danger); font:inherit; font-size:13px; cursor:pointer; }
.episode-delete:disabled { opacity:.4; cursor:not-allowed; }
.episode-delete:focus-visible,.drama-res-item:focus-visible,.import-choice:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.drama-res-item[role="button"] { cursor:pointer; }
.drama-res-item[aria-disabled="true"] { cursor:default; }
.drama-res-item[role="button"]:hover { border-color:var(--accent); }
.import-choice { cursor:pointer; }
.import-list { max-height:min(42dvh,420px); overflow-y:auto; }
.import-choice.selected { border-color:var(--accent); background:color-mix(in srgb,var(--accent) 12%,var(--bg-surface)); }
.import-choice.unavailable { opacity:.55; cursor:default; }
.import-check { display:grid; place-items:center; flex-shrink:0; width:20px; height:20px; border:1px solid var(--border-subtle); border-radius:5px; color:white; }
.selected .import-check { background:var(--accent); border-color:var(--accent); }
.import-existing { color:var(--text-muted); }
.import-selection-count { margin-right:16px; font-size:13px; color:var(--text-muted); }
@media(max-width:900px) { .drama-detail .episode-actions { grid-column:3; grid-row:1/5; } }
</style>
