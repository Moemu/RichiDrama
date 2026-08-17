<template>
  <div class="film-list">
    <header class="header">
      <div class="header-inner">
        <h1 class="logo">
          <span class="richi-brand-mark" aria-hidden="true"><img src="/brand/richi-logo-color.png" alt="" /></span>
          <span class="richi-brand-copy"><span class="logo-main">瑞池传媒短剧平台</span><span class="logo-sub">RICH MEDIA</span></span>
        </h1>
        <nav class="header-library" aria-label="创作资源">
          <el-dropdown trigger="click" @command="handleAssetCommand">
            <el-button class="btn-library"><el-icon><Files /></el-icon>素材中心</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="characters"><el-icon><User /></el-icon>角色素材</el-dropdown-item>
                <el-dropdown-item command="scenes"><el-icon><PictureFilled /></el-icon>场景素材</el-dropdown-item>
                <el-dropdown-item command="props"><el-icon><Box /></el-icon>道具素材</el-dropdown-item>
                <el-dropdown-item divided command="media"><el-icon><Files /></el-icon>媒体素材库</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </nav>
        <!-- 右侧操作区 -->
        <div class="header-actions">
          <AccountBalanceBadge />
          <el-button class="btn-library" title="全能视频" @click="createOmniProject">
            <el-icon><MagicStick /></el-icon>全能视频
          </el-button>
          <el-button class="btn-library" title="AI 工具箱" @click="$router.push('/ai-tools')">
            <el-icon><MagicStick /></el-icon>AI 工具箱
          </el-button>
          <el-button class="btn-theme" :title="isDark ? '切换到浅色模式' : '切换到暗色模式'" @click="toggleTheme">
            <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
            {{ isDark ? '浅色' : '暗色' }}
          </el-button>
          <el-button class="btn-import" :loading="importing" @click="triggerImport">
            <el-icon><Upload /></el-icon>导入项目
          </el-button>
          <input ref="importFileInput" type="file" accept=".zip" style="display:none" @change="onImportFile" />
          <el-button type="primary" class="btn-new" @click="goNewProject">
            <el-icon><Plus /></el-icon>新建项目
          </el-button>
          <el-dropdown class="header-more" trigger="click" @command="handleHeaderCommand">
            <el-button class="btn-more" aria-label="更多操作">更多</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="omni"><el-icon><MagicStick /></el-icon>全能视频</el-dropdown-item>
                <el-dropdown-item command="tools"><el-icon><MagicStick /></el-icon>AI 工具箱</el-dropdown-item>
                <el-dropdown-item command="import"><el-icon><Upload /></el-icon>导入项目</el-dropdown-item>
                <el-dropdown-item command="deleted">已删除项目</el-dropdown-item>
                <el-dropdown-item divided command="config"><el-icon><Setting /></el-icon>AI 配置</el-dropdown-item>
                <el-dropdown-item command="account">账户</el-dropdown-item>
                <el-dropdown-item v-if="isAdmin" command="admin">后台</el-dropdown-item>
                <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </header>

    <main class="main">
      <div v-loading="loading" class="projects-wrap">
        <section class="projects-heading">
          <div>
            <p class="projects-kicker">PROJECT WORKSPACE</p>
            <h2>{{ dramas.length || omniProjects.length ? '项目工作台' : '开始你的第一个短剧项目' }}</h2>
            <p>{{ dramas.length || omniProjects.length ? '管理剧本、分镜与生成素材。' : '创建项目后，依次完成剧本、角色、场景、分镜与成片制作。' }}</p>
          </div>
          <span v-if="dramas.length || omniProjects.length" class="projects-count">{{ dramas.length + omniProjects.length }} 个项目</span>
        </section>
        <div class="project-grid" :class="{ 'is-empty': !loading && dramas.length === 0 && omniProjects.length === 0 }">
          <!-- 操作卡片：始终作为第一个格子 -->
          <div class="project-card action-card">
            <div class="action-card-inner">
              <h3 class="action-card-title">快速开始</h3>
              <div class="action-card-buttons">
                <el-button type="primary" size="large" class="action-btn action-btn-new" @click="goNewProject">
                  <el-icon><Plus /></el-icon>新建短剧项目
                </el-button>
                <el-button size="large" class="action-btn action-btn-import" :loading="importing" @click="triggerImport">
                  <el-icon><Upload /></el-icon>导入短剧项目
                </el-button>
              </div>
              <div v-if="exampleList.length > 0" class="action-card-example">
                <div class="example-hint">
                  <el-icon class="example-hint-icon"><QuestionFilled /></el-icon>
                  <span class="example-hint-text">新手？试试导入示例项目快速体验</span>
                </div>
                <div class="example-list">
                  <el-button
                    v-for="ex in exampleList"
                    :key="ex.filename"
                    size="small"
                    class="example-btn"
                    :loading="importingExample === ex.filename"
                    @click="onImportExample(ex)"
                  >
                    <el-icon><FolderOpened /></el-icon>{{ ex.name }}
                  </el-button>
                </div>
              </div>
            </div>
          </div>
          <nav class="project-card workspace-links" aria-label="常用工作台入口">
            <div class="workspace-links-heading">
              <div><p class="workspace-kicker">QUICK ACCESS</p><h3>常用入口</h3></div>
              <span>工作台</span>
            </div>
            <p>素材与工具可跨项目复用；从这里继续当前的创作环节。</p>
            <div class="workspace-link-list">
              <el-button @click="$router.push('/free-create')"><el-icon><MagicStick /></el-icon>自由创作</el-button>
              <el-button @click="$router.push('/media-library')"><el-icon><Files /></el-icon>媒体素材库</el-button>
              <el-button @click="$router.push('/ai-tools')"><el-icon><MagicStick /></el-icon>AI 工具</el-button>
            </div>
          </nav>
          <div
            v-for="project in omniProjects"
            :key="`omni-${project.id}`"
            class="project-card omni-project-card"
            @click="openOmniProject(project.id)"
          >
            <div class="project-card-actions" @click.stop><el-button size="small" type="danger" plain @click="deleteOmniProject(project)">删除</el-button></div>
            <div class="project-card-body">
              <h3 class="project-title">{{ project.name || '未命名全能项目' }}</h3>
              <p class="project-desc">全能创作工作台 · 可按镜头顺序继续编辑与生成</p>
              <div class="project-badges">
                <span class="badge badge-omni">全能视频</span>
                <span class="badge badge-storyboards">{{ project.shot_count || 0 }} 个镜头</span>
                <span v-if="project.completed_count" class="badge badge-status badge-status--published">{{ project.completed_count }} 个成片</span>
              </div>
              <p class="project-meta">{{ formatDate(project.updated_at) }}</p>
            </div>
          </div>
          <div
            v-for="d in dramas"
            :key="d.id"
            class="project-card"
            @click="openProject(d.id)"
          >
            <div class="project-card-actions" @click.stop>
              <el-button size="small" circle :icon="Download" title="导出项目" :loading="exportingId === d.id" @click="onExport(d)" />
              <el-button size="small" circle :icon="Edit" title="编辑" @click="openEditDialog(d)" />
              <el-button size="small" type="danger" plain circle :icon="Delete" title="删除" @click="onDelete(d)" />
            </div>
            <div class="project-card-body">
              <h3 class="project-title">{{ d.title || '未命名项目' }}</h3>
              <p class="project-desc">{{ d.description || '暂无描述' }}</p>
              <div class="project-badges">
                <span class="badge badge-status" :class="'badge-status--' + (d.status || 'draft')">{{ formatStatus(d.status) }}</span>
                <span v-if="d.episodes?.length" class="badge badge-episodes">{{ d.episodes.length }} 集</span>
                <span v-if="totalStoryboards(d) > 0" class="badge badge-storyboards">{{ totalStoryboards(d) }} 分镜</span>
                <span v-if="d.metadata?.aspect_ratio" class="badge badge-ratio">{{ d.metadata.aspect_ratio }}</span>
                <span v-if="d.style" class="badge badge-style">{{ formatStyle(d.style) }}</span>
                <span v-if="d.genre" class="badge badge-genre">{{ formatGenre(d.genre) }}</span>
              </div>
              <p class="project-meta">{{ formatDate(d.updated_at) }}</p>
            </div>
          </div>
        </div>
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
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Edit, Delete, Setting, Plus, User, PictureFilled, Box, Sunny, Moon, Download, Upload, QuestionFilled, FolderOpened, MagicStick, Files } from '@element-plus/icons-vue'
import { useTheme } from '@/composables/useTheme'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'
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
import { formatChinaDateTime } from '@/utils/time'

const router = useRouter()
const { isDark, toggle: toggleTheme } = useTheme()

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
  if (command === 'omni') createOmniProject()
  else if (command === 'tools') router.push('/ai-tools')
  else if (command === 'import') triggerImport()
  else if (command === 'deleted') manageDeletedOmniProjects()
  else if (command === 'config') showAiConfigDialog.value = true
  else if (command === 'account') router.push('/account')
  else if (command === 'admin') router.push('/admin')
  else if (command === 'logout') logout()
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
const total = ref(0)

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
  Promise.all([dramaAPI.list({ page: 1, page_size: 50 }), omniVideoAPI.listSequences()])
    .then(([dramaResult, omniResult]) => {
      dramas.value = dramaResult?.items ?? []
      total.value = dramaResult?.pagination?.total ?? 0
      omniProjects.value = omniResult ?? []
    })
    .catch(() => { dramas.value = []; omniProjects.value = [] })
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
</style>
