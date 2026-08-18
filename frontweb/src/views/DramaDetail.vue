<template>
  <div class="drama-detail">
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
      <nav class="project-workspace-tabs" aria-label="项目工作区">
        <button v-for="tab in [{v:'episodes',label:'分集'},{v:'resources',label:'制作资源'},{v:'info',label:'项目设置'}]" :key="tab.v" type="button" :class="{ active: workspaceTab === tab.v }" @click="workspaceTab = tab.v">{{ tab.label }}</button>
      </nav>
      <!-- 基本信息 + 设置 -->
      <section v-show="workspaceTab === 'info'" class="section card info-section">
        <div class="section-title">剧集信息</div>
        <el-form :model="infoForm" label-width="110px" label-position="left" class="info-form">
          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="标题">
                <el-input v-model="infoForm.title" placeholder="剧集标题" @blur="saveInfo" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="图片/视频风格">
                <el-select v-model="infoForm.style" placeholder="选择全剧统一风格" clearable style="width: 100%" @change="saveInfo">
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
                <el-input v-model="infoForm.description" type="textarea" :rows="3" placeholder="一句话描述故事梗概" @blur="saveInfo" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </section>

      <!-- 分集列表 -->
      <section v-show="workspaceTab === 'episodes'" class="section card episodes-section" :class="{ 'is-sparse': episodes.length > 0 && episodes.length <= 3, 'is-single': episodes.length === 1 }">
        <div class="section-header">
          <div class="section-title">分集列表</div>
          <span class="section-count">共 {{ episodes.length }} 集</span>
          <EpisodeBatchImportDialog ref="episodeBatchImportDialogRef" :start-episode-number="nextEpisodeNumber" style="margin-left: auto" @import="onBatchImportEpisodes" />
          <el-button size="small" type="primary" :loading="addingEpisode" @click="onAddEpisode">
            <el-icon><Plus /></el-icon>新增一集
          </el-button>
        </div>
        <div v-if="episodes.length === 0" class="empty-tip">暂无分集，点击「新增一集」开始创作</div>
        <div v-else class="episode-stage">
          <div class="episode-grid">
            <div
              v-for="ep in episodes"
              :key="ep.id"
              class="episode-card"
              title="点击进入制作页"
              @click="goEpisode(ep.id)"
            >
              <div class="episode-card-header">
                <span class="episode-num">第 {{ ep.episode_number ?? ep.number ?? '?' }} 集</span>
                <el-button
                  size="small"
                  type="danger"
                  plain
                  circle
                  :icon="Delete"
                  :loading="deletingEpisodeId === ep.id"
                  @click.stop="onDeleteEpisode(ep)"
                />
              </div>
              <div class="episode-title">{{ ep.title || '未命名' }}</div>
              <div class="episode-preview">{{ (ep.script_content || '').slice(0, 20) || '暂无剧本' }}</div>
              <div class="episode-stats">
                <span class="ep-stat">
                  <span class="ep-stat-num">{{ ep.storyboards?.length ?? 0 }}</span> 分镜
                </span>
                <span v-if="ep.status" class="ep-stat ep-stat--status" :class="'ep-status--' + ep.status">{{ epStatusLabel(ep.status) }}</span>
              </div>
              <div class="episode-enter">
                <el-icon class="episode-enter-icon"><VideoPlay /></el-icon>
                进入制作
              </div>
            </div>
          </div>
          <aside v-if="episodes.length <= 3" class="episode-next-step" aria-labelledby="episode-progress-title">
            <header class="episode-progress-heading"><div><p>制作概览</p><h3 id="episode-progress-title">第 {{ episodes[0]?.episode_number ?? episodes[0]?.number ?? 1 }} 集进度</h3><span>从剧本开始，逐步完成资源、分镜与成片。</span></div><span class="episode-progress-state">{{ episodes[0]?.status ? epStatusLabel(episodes[0].status) : '待制作' }}</span></header>
            <div class="episode-pipeline"><i class="done">01 剧本</i><b></b><i>02 资源</i><b></b><i>03 分镜</i><b></b><i>04 成片</i></div>
            <dl><div><dt>当前分集</dt><dd>{{ episodes[0]?.title || '未命名' }}</dd></div><div><dt>分镜数量</dt><dd>{{ episodes[0]?.storyboards?.length ?? 0 }}</dd></div><div><dt>画面比例</dt><dd>{{ infoForm.aspect_ratio || '16:9' }}</dd></div></dl>
            <div class="episode-next-actions"><button type="button" @click="workspaceTab = 'resources'">准备角色与场景</button><button type="button" class="primary" @click="goEpisode(episodes[0].id)">继续第 {{ episodes[0]?.episode_number ?? episodes[0]?.number ?? 1 }} 集 ↗</button></div>
          </aside>
        </div>
      </section>

      <!-- 本剧资源库（Tab 切换） -->
      <section v-show="workspaceTab === 'resources'" class="section card res-section">
        <nav class="res-tabbar">
          <span class="res-tab-group-label">资源库</span>
          <button
            v-for="t in [{v:'lib-char',label:'角色'},{v:'lib-scene',label:'场景'},{v:'lib-prop',label:'道具'}]"
            :key="t.v"
            class="res-tab res-tab--lib"
            :class="{ active: activeResTab === t.v }"
            @click="activeResTab = t.v"
          >{{ t.label }}</button>
          <span class="res-tab-spacer"></span>
          <span class="res-tab-group-label res-tab-group-label--prod">制作资源</span>
          <button
            v-for="t in [{v:'drama-char',label:'角色'},{v:'drama-scene',label:'场景'},{v:'drama-prop',label:'道具'}]"
            :key="t.v"
            class="res-tab res-tab--drama"
            :class="{ active: activeResTab === t.v }"
            @click="activeResTab = t.v"
          >{{ t.label }}</button>
        </nav>

        <!-- 角色库 -->
        <template v-if="activeResTab === 'lib-char'">
          <div class="library-toolbar">
            <el-input v-model="charKw" placeholder="搜索角色" clearable style="width: 200px" @input="onCharKwInput" />
            <el-button size="small" @click="openImport('char')">从素材库导入</el-button>
          </div>
          <div v-loading="charLoading" class="library-list">
            <div v-for="item in charList" :key="item.id" class="library-item">
              <div class="library-item-cover" @click="openPreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || '').slice(0, 60) }}</div>
                <div class="library-item-actions">
                  <el-button size="small" @click="openEditChar(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="deleteChar(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!charLoading && charList.length === 0" class="library-empty">暂无本剧角色库记录，可在制作页面「加入本剧库」</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="charPage" v-model:page-size="charPageSize" :total="charTotal" :page-sizes="[10,20,50]" layout="total, sizes, prev, pager, next" @current-change="loadCharList" @size-change="loadCharList" />
          </div>
        </template>

        <!-- 场景库 -->
        <template v-if="activeResTab === 'lib-scene'">
          <div class="library-toolbar">
            <el-input v-model="sceneKw" placeholder="搜索场景" clearable style="width: 200px" @input="onSceneKwInput" />
            <el-button size="small" @click="openImport('scene')">从素材库导入</el-button>
          </div>
          <div v-loading="sceneLoading" class="library-list">
            <div v-for="item in sceneList" :key="item.id" class="library-item">
              <div class="library-item-cover" @click="openPreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.location || item.time || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}</div>
                <div class="library-item-actions">
                  <el-button size="small" @click="openEditScene(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="deleteScene(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!sceneLoading && sceneList.length === 0" class="library-empty">暂无本剧场景库记录，可在制作页面「加入本剧库」</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="scenePage" v-model:page-size="scenePageSize" :total="sceneTotal" :page-sizes="[10,20,50]" layout="total, sizes, prev, pager, next" @current-change="loadSceneList" @size-change="loadSceneList" />
          </div>
        </template>

        <!-- 道具库 -->
        <template v-if="activeResTab === 'lib-prop'">
          <div class="library-toolbar">
            <el-input v-model="propKw" placeholder="搜索道具" clearable style="width: 200px" @input="onPropKwInput" />
            <el-button size="small" @click="openImport('prop')">从素材库导入</el-button>
          </div>
          <div v-loading="propLoading" class="library-list">
            <div v-for="item in propList" :key="item.id" class="library-item">
              <div class="library-item-cover" @click="openPreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}</div>
                <div class="library-item-actions">
                  <el-button size="small" @click="openEditProp(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="deleteProp(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!propLoading && propList.length === 0" class="library-empty">暂无本剧道具库记录，可在制作页面「加入本剧库」</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="propPage" v-model:page-size="propPageSize" :total="propTotal" :page-sizes="[10,20,50]" layout="total, sizes, prev, pager, next" @current-change="loadPropList" @size-change="loadPropList" />
          </div>
        </template>
        <!-- 本剧制作角色 -->
        <template v-if="activeResTab === 'drama-char'">
          <div class="drama-res-list">
            <template v-if="drama?.characters?.length">
              <div v-for="item in drama.characters" :key="item.id" class="drama-res-item">
                <div class="drama-res-cover" @click="openPreview(assetImageUrl(item))">
                  <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                  <span v-else class="library-placeholder">暂无图</span>
                </div>
                <div class="drama-res-info">
                  <div class="drama-res-name">{{ item.name || '未命名' }}</div>
                  <div class="drama-res-meta" v-if="item.role">
                    <el-tag size="small" type="info">{{ item.role === 'main' ? '主角' : item.role === 'supporting' ? '配角' : item.role }}</el-tag>
                  </div>
                  <div class="drama-res-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
                  <div class="drama-res-actions">
                    <el-button size="small" @click="openEditDramaChar(item)">编辑</el-button>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="library-empty">本剧暂无制作角色，请前往剧集制作页面创建</div>
          </div>
        </template>

        <!-- 本剧制作场景 -->
        <template v-if="activeResTab === 'drama-scene'">
          <div class="drama-res-list">
            <template v-if="drama?.scenes?.length">
              <div v-for="item in drama.scenes" :key="item.id" class="drama-res-item">
                <div class="drama-res-cover" @click="openPreview(assetImageUrl(item))">
                  <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                  <span v-else class="library-placeholder">暂无图</span>
                </div>
                <div class="drama-res-info">
                  <div class="drama-res-name">{{ item.location || '未命名' }}</div>
                  <div class="drama-res-meta" v-if="item.time">
                    <el-tag size="small" type="info">{{ item.time }}</el-tag>
                  </div>
                  <div class="drama-res-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
                  <div class="drama-res-actions">
                    <el-button size="small" @click="openEditDramaScene(item)">编辑</el-button>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="library-empty">本剧暂无制作场景，请前往剧集制作页面创建</div>
          </div>
        </template>

        <!-- 本剧制作道具 -->
        <template v-if="activeResTab === 'drama-prop'">
          <div class="drama-res-list">
            <template v-if="drama?.props?.length">
              <div v-for="item in drama.props" :key="item.id" class="drama-res-item">
                <div class="drama-res-cover" @click="openPreview(assetImageUrl(item))">
                  <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                  <span v-else class="library-placeholder">暂无图</span>
                </div>
                <div class="drama-res-info">
                  <div class="drama-res-name">{{ item.name || '未命名' }}</div>
                  <div class="drama-res-meta" v-if="item.type">
                    <el-tag size="small" type="info">{{ item.type }}</el-tag>
                  </div>
                  <div class="drama-res-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
                  <div class="drama-res-actions">
                    <el-button size="small" @click="openEditDramaProp(item)">编辑</el-button>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="library-empty">本剧暂无制作道具，请前往剧集制作页面创建</div>
          </div>
        </template>
      </section>
    </main>

    <!-- 制作角色 编辑 -->
    <el-dialog v-model="editDramaCharVisible" title="编辑制作角色" width="500px" @close="editDramaCharForm = null">
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
    <el-dialog v-model="editDramaSceneVisible" title="编辑制作场景" width="500px" @close="editDramaSceneForm = null">
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
    <el-dialog v-model="editDramaPropVisible" title="编辑制作道具" width="500px" @close="editDramaPropForm = null">
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

    <!-- 编辑角色 -->
    <el-dialog v-model="editCharVisible" title="编辑角色库" width="480px" @close="editCharForm = null">
      <el-form v-if="editCharForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <div class="lib-img-thumb" @click="openPreview(assetImageUrl(editCharForm))">
              <img v-if="editCharForm.image_url || editCharForm.local_path" :src="assetImageUrl(editCharForm)" />
              <div v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editCharForm.imgUploading" @click="charFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editCharForm.imgGenerating" @click="doGenerateLibImg(editCharForm, (editCharForm.name + (editCharForm.description ? ', ' + editCharForm.description : '')), characterLibraryAPI, loadCharList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="charFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editCharForm, characterLibraryAPI, loadCharList)" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editCharForm.name" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editCharForm.category" placeholder="可选" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editCharForm.description" type="textarea" :rows="3" placeholder="可选" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editCharForm.tags" placeholder="逗号分隔" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editCharVisible = false">取消</el-button>
        <el-button type="primary" :loading="editCharSaving" @click="saveChar">保存</el-button>
      </template>
    </el-dialog>

    <!-- 编辑场景 -->
    <el-dialog v-model="editSceneVisible" title="编辑场景库" width="480px" @close="editSceneForm = null">
      <el-form v-if="editSceneForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <div class="lib-img-thumb" @click="openPreview(assetImageUrl(editSceneForm))">
              <img v-if="editSceneForm.image_url || editSceneForm.local_path" :src="assetImageUrl(editSceneForm)" />
              <div v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editSceneForm.imgUploading" @click="sceneFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editSceneForm.imgGenerating" @click="doGenerateLibImg(editSceneForm, ([editSceneForm.location, editSceneForm.time, editSceneForm.description].filter(Boolean).join(', ')), sceneLibraryAPI, loadSceneList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="sceneFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editSceneForm, sceneLibraryAPI, loadSceneList)" />
        </el-form-item>
        <el-form-item label="地点"><el-input v-model="editSceneForm.location" /></el-form-item>
        <el-form-item label="时间"><el-input v-model="editSceneForm.time" placeholder="如：浅色/夜晚" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editSceneForm.category" placeholder="可选" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editSceneForm.description" type="textarea" :rows="3" placeholder="可选" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editSceneForm.tags" placeholder="逗号分隔" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editSceneVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSceneSaving" @click="saveScene">保存</el-button>
      </template>
    </el-dialog>

    <!-- 编辑道具 -->
    <el-dialog v-model="editPropVisible" title="编辑道具库" width="480px" @close="editPropForm = null">
      <el-form v-if="editPropForm" label-width="80px">
        <el-form-item label="图片">
          <div class="lib-img-editor">
            <div class="lib-img-thumb" @click="openPreview(assetImageUrl(editPropForm))">
              <img v-if="editPropForm.image_url || editPropForm.local_path" :src="assetImageUrl(editPropForm)" />
              <div v-else class="lib-img-empty"><el-icon><PictureFilled /></el-icon></div>
            </div>
            <div class="lib-img-btns">
              <el-button size="small" :loading="editPropForm.imgUploading" @click="propFileRef.click()">上传图片</el-button>
              <el-button size="small" type="primary" :loading="editPropForm.imgGenerating" @click="doGenerateLibImg(editPropForm, (editPropForm.name + (editPropForm.description ? ', ' + editPropForm.description : '')), propLibraryAPI, loadPropList)">AI 生成</el-button>
            </div>
          </div>
          <input ref="propFileRef" type="file" accept="image/*" style="display:none" @change="e => doUploadLibImg(e, editPropForm, propLibraryAPI, loadPropList)" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="editPropForm.name" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="editPropForm.category" placeholder="可选" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="editPropForm.description" type="textarea" :rows="3" placeholder="可选" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="editPropForm.tags" placeholder="逗号分隔" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editPropVisible = false">取消</el-button>
        <el-button type="primary" :loading="editPropSaving" @click="saveProp">保存</el-button>
      </template>
    </el-dialog>

    <!-- 从素材库导入 -->
    <el-dialog
      v-model="importVisible"
      :title="`从素材库导入${importType === 'char' ? '角色' : importType === 'scene' ? '场景' : '道具'}`"
      width="760px"
      destroy-on-close
      @open="loadImportList"
    >
      <div class="library-toolbar">
        <el-input v-model="importKw" placeholder="搜索关键词" clearable style="width: 220px" @input="onImportKwInput" />
        <span class="import-tip">点击「导入」将素材复制到本剧资源库</span>
      </div>
      <div v-loading="importLoading" class="library-list import-list">
        <div v-for="item in importList" :key="item.id" class="library-item">
          <div class="library-item-cover" @click="openPreview(assetImageUrl(item))">
            <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
            <span v-else class="library-placeholder">暂无图</span>
          </div>
          <div class="library-item-info">
            <div class="library-item-name">
              {{ importType === 'scene' ? (item.location || item.time || '未命名') : (item.name || '未命名') }}
            </div>
            <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 80) }}</div>
            <div class="library-item-actions">
              <el-button size="small" type="primary" :loading="importingId === item.id" @click="doImport(item)">导入</el-button>
            </div>
          </div>
        </div>
        <div v-if="!importLoading && importList.length === 0" class="library-empty">素材库暂无内容</div>
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
        <el-button @click="importVisible = false">关闭</el-button>
      </template>
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
import { ref, reactive, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, VideoPlay, Plus, Delete, PictureFilled, Grid } from '@element-plus/icons-vue'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'
import EpisodeBatchImportDialog from '@/components/EpisodeBatchImportDialog.vue'
import { dramaAPI } from '@/api/drama'
import { characterLibraryAPI } from '@/api/characterLibrary'
import { sceneLibraryAPI } from '@/api/sceneLibrary'
import { propLibraryAPI } from '@/api/propLibrary'
import { uploadAPI } from '@/api/upload'
import { imagesAPI } from '@/api/images'
import { taskAPI } from '@/api/task'
import { characterAPI } from '@/api/characters'
import { sceneAPI } from '@/api/scenes'
import { propAPI } from '@/api/props'
import { useGenerationTaskStore } from '@/stores/generationTaskStore'
import { stylePromptMetadataForSave, backfillDramaStylePromptMetadataIfNeeded } from '@/constants/styleOptions'
import { formatChinaDate } from '@/utils/time'

const route = useRoute()
const router = useRouter()
const generationTasks = useGenerationTaskStore()
const dramaId = Number(route.params.id)

// 图片编辑 – 文件输入 refs（各资源类型独立）
const charFileRef  = ref(null)
const sceneFileRef = ref(null)
const propFileRef  = ref(null)

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

// 共享：上传图片到库条目
async function doUploadLibImg(event, form, api, reloadFn) {
  const file = event.target?.files?.[0]
  if (event.target) event.target.value = ''
  if (!file || !form?.id) return
  form.imgUploading = true
  try {
    const res = await uploadAPI.uploadImage(file, { dramaId })
    const data = res?.data ?? res
    const url = data?.url || data?.path || data?.local_path
    if (!url) { ElMessage.error('上传未返回地址'); return }
    form.image_url = url
    form.local_path = data?.local_path ?? null
    await api.update(form.id, { image_url: url, local_path: data?.local_path ?? null })
    reloadFn()
    ElMessage.success('图片已更新')
  } catch (e) { ElMessage.error(e.message || '上传失败') }
  finally { form.imgUploading = false }
}

// 共享：AI 生成图片到库条目
async function doGenerateLibImg(form, prompt, api, reloadFn) {
  if (!prompt?.trim()) { ElMessage.warning('请先填写名称或描述'); return }
  form.imgGenerating = true
  try {
    const res = await imagesAPI.create({ prompt: prompt.trim(), drama_id: dramaId || null })
    const imgData = res?.data ?? res
    const taskId = imgData?.task_id
    if (!taskId) throw new Error('未返回任务ID')
    const poll = await generationTasks.pollTask(taskId, { dramaId, episodeId: 0, resourceType: 'library_image', resourceId: form.id }, null, { ElMessage, maxAttempts: 450, interval: 2000 })
    if (poll.status !== 'completed') throw new Error(poll.error || '生成超时')
    const result = poll.result
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

// ── 制作资源编辑函数 ────────────────────────────────────────────────────────

function openEditDramaChar(item) {
  editDramaCharForm.value = {
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
    })
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
    })
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
    })
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

function formatDate(val) {
  return formatChinaDate(val)
}

async function loadDrama() {
  loading.value = true
  try {
    let d = await dramaAPI.get(dramaId)
    d = await backfillDramaStylePromptMetadataIfNeeded(dramaAPI, dramaId, d)
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
  const current = episodes.value.map((ep, i) => ({
    episode_number: ep.episode_number ?? i + 1,
    title: ep.title || '第' + (ep.episode_number ?? i + 1) + '集',
    script_content: ep.script_content || '',
    description: ep.description ?? null,
    duration: ep.duration ?? 0,
  }))
  await dramaAPI.saveEpisodes(dramaId, [...current, ...importedEpisodes])
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
    const remaining = episodes.value
      .filter((e) => e.id !== ep.id)
      .map((e, i) => ({
        episode_number: e.episode_number ?? i + 1,
        title: e.title || '第' + (e.episode_number ?? i + 1) + '集',
        script_content: e.script_content || '',
        description: e.description ?? null,
        duration: e.duration ?? 0,
      }))
    await dramaAPI.saveEpisodes(dramaId, remaining)
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
    const list = episodes.value
    const nextNum = list.length > 0
      ? Math.max(...list.map((e) => Number(e.episode_number) || 0), 0) + 1
      : 1
    const updated = list.map((ep, i) => ({
      episode_number: ep.episode_number ?? i + 1,
      title: ep.title || '第' + (ep.episode_number ?? i + 1) + '集',
      script_content: ep.script_content || '',
      description: ep.description ?? null,
      duration: ep.duration ?? 0
    }))
    updated.push({ episode_number: nextNum, title: '第' + nextNum + '集', script_content: '', description: null, duration: 0 })
    await dramaAPI.saveEpisodes(dramaId, updated)
    ElMessage.success('已添加第' + nextNum + '集')
    await loadDrama()
  } catch (e) {
    ElMessage.error(e.message || '添加失败')
  } finally {
    addingEpisode.value = false
  }
}

// ---------- 资源库 Tab ----------
const workspaceTab = ref('episodes')
const activeResTab = ref('lib-char') // lib-char | lib-scene | lib-prop | drama-char | drama-scene | drama-prop
const previewUrl = ref(null)
function openPreview(url) { if (url) previewUrl.value = url }

// 角色
const charList = ref([]), charLoading = ref(false), charPage = ref(1), charPageSize = ref(20), charTotal = ref(0), charKw = ref('')
let charKwTimer = null
async function loadCharList() {
  charLoading.value = true
  try {
    const res = await characterLibraryAPI.list({ drama_id: dramaId, page: charPage.value, page_size: charPageSize.value, keyword: charKw.value || undefined })
    charList.value = res?.items ?? []; charTotal.value = res?.pagination?.total ?? 0
  } catch { charList.value = [] } finally { charLoading.value = false }
}
function onCharKwInput() { if (charKwTimer) clearTimeout(charKwTimer); charKwTimer = setTimeout(() => { charPage.value = 1; loadCharList() }, 300) }
const editCharVisible = ref(false), editCharForm = ref(null), editCharSaving = ref(false)
function openEditChar(item) {
  editCharForm.value = { id: item.id, name: item.name ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  editCharVisible.value = true
}
async function saveChar() {
  if (!editCharForm.value?.id) return; editCharSaving.value = true
  try {
    await characterLibraryAPI.update(editCharForm.value.id, { name: editCharForm.value.name, category: editCharForm.value.category || null, description: editCharForm.value.description || null, tags: editCharForm.value.tags || null, image_url: editCharForm.value.image_url || null, local_path: editCharForm.value.local_path ?? null })
    ElMessage.success('已保存'); editCharVisible.value = false; loadCharList()
  } catch (e) { ElMessage.error(e.message || '保存失败') } finally { editCharSaving.value = false }
}
async function deleteChar(item) {
  try { await ElMessageBox.confirm(`确定删除「${(item.name || '未命名').slice(0, 20)}」？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await characterLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadCharList() } catch (e) { ElMessage.error(e.message || '删除失败') }
}

// 场景
const sceneList = ref([]), sceneLoading = ref(false), scenePage = ref(1), scenePageSize = ref(20), sceneTotal = ref(0), sceneKw = ref('')
let sceneKwTimer = null
async function loadSceneList() {
  sceneLoading.value = true
  try {
    const res = await sceneLibraryAPI.list({ drama_id: dramaId, page: scenePage.value, page_size: scenePageSize.value, keyword: sceneKw.value || undefined })
    sceneList.value = res?.items ?? []; sceneTotal.value = res?.pagination?.total ?? 0
  } catch { sceneList.value = [] } finally { sceneLoading.value = false }
}
function onSceneKwInput() { if (sceneKwTimer) clearTimeout(sceneKwTimer); sceneKwTimer = setTimeout(() => { scenePage.value = 1; loadSceneList() }, 300) }
const editSceneVisible = ref(false), editSceneForm = ref(null), editSceneSaving = ref(false)
function openEditScene(item) {
  editSceneForm.value = { id: item.id, location: item.location ?? '', time: item.time ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  editSceneVisible.value = true
}
async function saveScene() {
  if (!editSceneForm.value?.id) return; editSceneSaving.value = true
  try {
    await sceneLibraryAPI.update(editSceneForm.value.id, { location: editSceneForm.value.location, time: editSceneForm.value.time || null, category: editSceneForm.value.category || null, description: editSceneForm.value.description || null, tags: editSceneForm.value.tags || null, image_url: editSceneForm.value.image_url || null, local_path: editSceneForm.value.local_path ?? null })
    ElMessage.success('已保存'); editSceneVisible.value = false; loadSceneList()
  } catch (e) { ElMessage.error(e.message || '保存失败') } finally { editSceneSaving.value = false }
}
async function deleteScene(item) {
  const n = (item.location || item.time || '未命名').slice(0, 20)
  try { await ElMessageBox.confirm(`确定删除「${n}」？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await sceneLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadSceneList() } catch (e) { ElMessage.error(e.message || '删除失败') }
}

// 道具
const propList = ref([]), propLoading = ref(false), propPage = ref(1), propPageSize = ref(20), propTotal = ref(0), propKw = ref('')
let propKwTimer = null
async function loadPropList() {
  propLoading.value = true
  try {
    const res = await propLibraryAPI.list({ drama_id: dramaId, page: propPage.value, page_size: propPageSize.value, keyword: propKw.value || undefined })
    propList.value = res?.items ?? []; propTotal.value = res?.pagination?.total ?? 0
  } catch { propList.value = [] } finally { propLoading.value = false }
}
function onPropKwInput() { if (propKwTimer) clearTimeout(propKwTimer); propKwTimer = setTimeout(() => { propPage.value = 1; loadPropList() }, 300) }
const editPropVisible = ref(false), editPropForm = ref(null), editPropSaving = ref(false)
function openEditProp(item) {
  editPropForm.value = { id: item.id, name: item.name ?? '', category: item.category ?? '', description: item.description ?? '', tags: item.tags ?? '', image_url: item.image_url ?? '', local_path: item.local_path ?? null, imgUploading: false, imgGenerating: false }
  editPropVisible.value = true
}
async function saveProp() {
  if (!editPropForm.value?.id) return; editPropSaving.value = true
  try {
    await propLibraryAPI.update(editPropForm.value.id, { name: editPropForm.value.name, category: editPropForm.value.category || null, description: editPropForm.value.description || null, tags: editPropForm.value.tags || null, image_url: editPropForm.value.image_url || null, local_path: editPropForm.value.local_path ?? null })
    ElMessage.success('已保存'); editPropVisible.value = false; loadPropList()
  } catch (e) { ElMessage.error(e.message || '保存失败') } finally { editPropSaving.value = false }
}
async function deleteProp(item) {
  try { await ElMessageBox.confirm(`确定删除「${(item.name || '未命名').slice(0, 20)}」？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try { await propLibraryAPI.delete(item.id); ElMessage.success('已删除'); loadPropList() } catch (e) { ElMessage.error(e.message || '删除失败') }
}

// ---------- 从素材库导入 ----------
const importVisible = ref(false)
const importType = ref('char') // 'char' | 'scene' | 'prop'
const importList = ref([])
const importLoading = ref(false)
const importPage = ref(1)
const importPageSize = ref(20)
const importTotal = ref(0)
const importKw = ref('')
const importingId = ref(null)
let importKwTimer = null

function openImport(type) {
  importType.value = type
  importKw.value = ''
  importPage.value = 1
  importVisible.value = true
}

async function loadImportList() {
  importLoading.value = true
  try {
    const api = importType.value === 'char' ? characterLibraryAPI
      : importType.value === 'scene' ? sceneLibraryAPI : propLibraryAPI
    // 不传 drama_id，获取全局素材库（所有记录）
    const res = await api.list({ page: importPage.value, page_size: importPageSize.value, keyword: importKw.value || undefined, global: 1 })
    importList.value = res?.items ?? []
    importTotal.value = res?.pagination?.total ?? 0
  } catch { importList.value = [] } finally { importLoading.value = false }
}

function onImportKwInput() {
  if (importKwTimer) clearTimeout(importKwTimer)
  importKwTimer = setTimeout(() => { importPage.value = 1; loadImportList() }, 300)
}

async function doImport(item) {
  importingId.value = item.id
  try {
    if (importType.value === 'char') {
      await characterLibraryAPI.create({
        drama_id: dramaId,
        name: item.name || '',
        image_url: item.image_url || null,
        local_path: item.local_path || null,
        description: item.description || null,
        category: item.category || null,
        tags: item.tags || null,
        source_type: 'imported',
      })
      loadCharList()
    } else if (importType.value === 'scene') {
      await sceneLibraryAPI.create({
        drama_id: dramaId,
        location: item.location || '',
        time: item.time || null,
        prompt: item.prompt || null,
        description: item.description || null,
        image_url: item.image_url || null,
        local_path: item.local_path || null,
        category: item.category || null,
        tags: item.tags || null,
        source_type: 'imported',
      })
      loadSceneList()
    } else {
      await propLibraryAPI.create({
        drama_id: dramaId,
        name: item.name || '',
        description: item.description || null,
        prompt: item.prompt || null,
        image_url: item.image_url || null,
        local_path: item.local_path || null,
        category: item.category || null,
        tags: item.tags || null,
        source_type: 'imported',
      })
      loadPropList()
    }
    ElMessage.success('已导入到本剧资源库')
  } catch (e) {
    ElMessage.error(e.message || '导入失败')
  } finally {
    importingId.value = null
  }
}

watch(activeResTab, (tab) => {
  if (tab === 'lib-char') loadCharList()
  else if (tab === 'lib-scene') loadSceneList()
  else if (tab === 'lib-prop') loadPropList()
})

let importBatchTimer = null
onMounted(() => {
  loadDrama()
  loadCharList()
  if (route.query.importBatch) {
    importBatchTimer = setTimeout(() => {
      episodeBatchImportDialogRef.value?.openDialog?.()
    }, 0)
  }
})
onBeforeUnmount(() => { if (importBatchTimer) clearTimeout(importBatchTimer) })
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
.library-item-cover { width: 72px; height: 72px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: #27272a; display: flex; align-items: center; justify-content: center; cursor: pointer; }
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
.res-tab-group-label {
  font-size: 11px;
  color: var(--text-faint, #52525b);
  padding: 0 8px 0 4px;
  white-space: nowrap;
  user-select: none;
  letter-spacing: 0.03em;
  align-self: center;
}
.res-tab-group-label--prod { color: #a78bfa; }
.res-tab-spacer {
  flex: 1;
  min-width: 40px;
}
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
@media(max-width:760px){.header{padding:9px 12px}.header-inner{gap:7px}.logo{min-width:30px}.richi-brand-copy,.breadcrumb-sep,.btn-back-list{display:none}.richi-brand-mark{width:30px;height:30px;flex:0 0 30px}.page-title{min-width:0;flex:1;padding:0;border:0;background:transparent}.header-actions{margin-left:0;gap:4px}.header-actions :deep(.account-balance){display:none}.header-actions .el-button{height:34px;padding-inline:9px;font-size:0}.header-actions .el-icon{font-size:15px}.main{padding:18px 12px 40px}.section.card{padding:16px;border-radius:14px}.section-header{align-items:flex-start;flex-wrap:wrap;gap:8px}.section-header .section-count{margin-right:auto}.episode-grid{grid-template-columns:1fr}.episode-card{min-height:132px}.drama-res-item{width:100%}.res-tabbar{margin-inline:-16px;padding-left:16px}.res-tab-spacer,.res-tab-group-label--prod{display:none}:deep(.info-form .el-col){width:100%;max-width:100%;flex:0 0 100%}:deep(.info-form .el-form-item){margin-bottom:16px}:deep(.info-form .el-form-item__label){font-size:13px}}
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

/* Project cockpit: one bounded workspace instead of three stacked admin cards. */
.drama-detail { display:flex; height:100vh; height:100dvh; min-height:0; flex-direction:column; overflow:hidden; }
.drama-detail > .header { position:relative; flex:0 0 auto; }
.drama-detail > .main { display:grid; grid-template-rows:auto minmax(0,1fr); flex:1; min-height:0; width:100%; max-width:min(1500px,calc(100vw - 3rem)); padding:1.2rem 0; overflow:hidden; }
.project-workspace-tabs { display:flex; gap:.3rem; align-items:center; padding:.35rem; justify-self:start; border:1px solid var(--border-subtle); border-radius:999px; background:color-mix(in srgb,var(--bg-surface) 84%,transparent); }
.project-workspace-tabs button { padding:.65rem 1rem; border:0; border-radius:999px; background:transparent; color:var(--text-muted); font-size:.75rem; cursor:pointer; transition:background-color var(--motion-fast,140ms) ease,color var(--motion-fast,140ms) ease; }.project-workspace-tabs button:hover,.project-workspace-tabs button.active { background:var(--text-primary); color:var(--bg-page); }
.drama-detail .main > .section.card { min-height:0; margin-top:.8rem; padding:clamp(1.2rem,2.5vw,2.4rem); overflow:auto; border-radius:1.1rem; }
.drama-detail .main > .episodes-section { background:linear-gradient(145deg,color-mix(in srgb,var(--bg-surface) 94%,transparent),color-mix(in srgb,var(--bg-page) 94%,transparent)); }
.drama-detail .episodes-section .section-title::before { content:'分集'!important; }.drama-detail .info-section .section-title::before { content:'项目'!important; }
.drama-detail .main > .episodes-section .episode-grid { display:flex; flex-direction:column; align-content:start; gap:0; border-top:1px solid var(--border-color); }.drama-detail .main > .episodes-section .episode-card { display:grid; grid-template-columns:6rem minmax(12rem,1fr) 10rem 7rem; grid-template-rows:auto auto; gap:.35rem 1.2rem; align-items:center; width:100%; min-height:6.7rem; padding:1rem .5rem; border-width:0 0 1px; border-radius:0; background:transparent; box-shadow:none; }.drama-detail .episodes-section .episode-card:hover { transform:none; background:color-mix(in srgb,var(--bg-hover) 42%,transparent); }.drama-detail .episodes-section .episode-card::after,.drama-detail .episodes-section .episode-card::before { display:none; }.drama-detail .episodes-section .episode-card-header { grid-column:1; grid-row:1 / 3; align-self:stretch; flex-direction:column; align-items:flex-start; justify-content:space-between; }.drama-detail .episodes-section .episode-title { grid-column:2; grid-row:1; align-self:end; }.drama-detail .episodes-section .episode-preview { grid-column:2; grid-row:2; align-self:start; }.drama-detail .episodes-section .episode-stats { grid-column:3; grid-row:1 / 3; }.drama-detail .episodes-section .episode-enter { grid-column:4; grid-row:1 / 3; margin:0; padding:0; border:0; }
.drama-detail .episodes-section .episode-stage { min-height:0; }.drama-detail .episodes-section.is-sparse .episode-stage { display:grid; grid-template-columns:minmax(34rem,1.1fr) minmax(27rem,.9fr); gap:clamp(1.5rem,3vw,3.5rem); height:100%; min-height:0; padding-top:1.2rem; }.drama-detail .episodes-section.is-sparse .episode-grid { align-self:start; border-top:1px solid var(--border-color); }
.drama-detail .episodes-section.is-single .episode-grid { align-self:stretch; height:100%; border-bottom:1px solid var(--border-color); }.drama-detail .episodes-section.is-single .episode-card { grid-template-columns:minmax(0,1fr) auto; grid-template-rows:auto minmax(0,1fr) auto auto; height:100%; min-height:0; padding:clamp(1.4rem,3vw,3rem); }.drama-detail .episodes-section.is-single .episode-card-header { grid-column:1/-1; grid-row:1; flex-direction:row; align-items:center; }.drama-detail .episodes-section.is-single .episode-title { grid-column:1/-1; grid-row:2; align-self:end; max-width:13ch; font-size:clamp(2.4rem,4vw,5.2rem); line-height:.9; letter-spacing:-.07em; }.drama-detail .episodes-section.is-single .episode-preview { grid-column:1/-1; grid-row:3; align-self:start; margin-top:1rem; font-size:.9rem; }.drama-detail .episodes-section.is-single .episode-stats { grid-column:1; grid-row:4; align-self:end; margin-top:1.8rem; }.drama-detail .episodes-section.is-single .episode-enter { grid-column:2; grid-row:4; align-self:end; padding:.7rem .9rem; border:1px solid var(--border-strong); border-radius:.5rem; }
.episode-next-step { display:flex; min-width:0; flex-direction:column; justify-content:space-between; padding:clamp(1.3rem,2.5vw,2.6rem) 0; border-top:1px solid var(--border-color); border-bottom:1px solid var(--border-color); }.episode-next-step p { margin:0 0 1rem; color:var(--accent-teal); font:800 .62rem/1 ui-monospace,monospace; letter-spacing:.15em; }.episode-next-step h3 { margin:0; font-size:clamp(2.7rem,4vw,4.8rem); line-height:.9; letter-spacing:-.07em; }.episode-next-step>div:first-child>span { display:block; max-width:38rem; margin-top:1.2rem; color:var(--text-muted); line-height:1.7; }.episode-pipeline { display:flex; align-items:center; gap:.55rem; color:var(--text-faint); font:700 .6rem/1 ui-monospace,monospace; }.episode-pipeline i { font-style:normal; white-space:nowrap; }.episode-pipeline i.done { color:var(--accent-teal); }.episode-pipeline b { flex:1; height:1px; background:var(--border-color); }.episode-next-step dl { display:grid; grid-template-columns:1.5fr .65fr .65fr; margin:0; border-top:1px solid var(--border-color); border-bottom:1px solid var(--border-color); }.episode-next-step dl div { min-width:0; padding:1rem; border-right:1px solid var(--border-color); }.episode-next-step dl div:last-child { border-right:0; }.episode-next-step dt { color:var(--text-faint); font-size:.6rem; }.episode-next-step dd { overflow:hidden; margin:.5rem 0 0; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }.episode-next-actions { display:flex; gap:.65rem; }.episode-next-actions button { padding:.78rem 1rem; border:1px solid var(--border-strong); border-radius:.5rem; background:transparent; color:var(--text-regular); cursor:pointer; }.episode-next-actions button.primary { border-color:var(--accent); background:var(--accent); color:#fff; }
.drama-detail .main > .info-section { background:radial-gradient(circle at 90% 5%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 26%),var(--bg-surface); }
.drama-detail .main > .res-section { display:block; }
@media(max-width:72rem){.drama-detail .episodes-section.is-sparse .episode-stage{grid-template-columns:1fr}.episode-next-step{display:none}}
@media(max-width:48rem){.drama-detail>.main{max-width:100%;padding:.75rem}.project-workspace-tabs{width:100%;justify-content:space-between}.project-workspace-tabs button{flex:1;padding:.6rem .5rem}.drama-detail .main>.section.card{margin-top:.65rem;padding:1rem}.drama-detail .main>.episodes-section .episode-card{grid-template-columns:3.7rem minmax(0,1fr) 1rem;min-height:5.8rem;gap:.25rem .7rem}.drama-detail .episodes-section .episode-card-header{grid-column:1}.drama-detail .episodes-section .episode-title,.drama-detail .episodes-section .episode-preview{grid-column:2}.drama-detail .episodes-section .episode-stats{display:none}.drama-detail .episodes-section .episode-enter{grid-column:3;font-size:0}}
@media(max-width:48rem){
  .drama-detail .main>.episodes-section{display:flex;flex-direction:column;overflow:hidden}
  .drama-detail .episodes-section.is-sparse .episode-stage{display:grid;grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr);gap:.8rem;flex:1;height:auto;min-height:0;padding-top:.7rem;overflow:hidden}
  .drama-detail .episodes-section.is-single .episode-grid{align-self:start;height:auto}
  .drama-detail .episodes-section.is-single .episode-card{grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto auto auto;height:auto;min-height:14rem;padding:1.1rem}
  .drama-detail .episodes-section.is-single .episode-card-header{grid-column:1/-1;grid-row:1;flex-direction:row;align-items:center}
  .drama-detail .episodes-section.is-single .episode-title{grid-column:1/-1;grid-row:2;align-self:auto;margin-top:2rem;font-size:2.35rem;line-height:.92}
  .drama-detail .episodes-section.is-single .episode-preview{grid-column:1/-1;grid-row:3;margin-top:.7rem}
  .drama-detail .episodes-section.is-single .episode-enter{grid-column:1/-1;grid-row:4;justify-self:start;margin-top:1rem;padding:.55rem .75rem;font-size:.78rem}
  .drama-detail .episodes-section .episode-next-step{display:grid;grid-template-rows:auto auto auto auto;gap:.7rem;min-height:0;padding:.8rem 0;overflow:hidden}
  .drama-detail .episodes-section .episode-next-step h3{font-size:1.8rem}.drama-detail .episodes-section .episode-next-step p{margin-bottom:.35rem}
  .drama-detail .episodes-section .episode-pipeline{gap:.25rem}.drama-detail .episodes-section .episode-next-step dl div{padding:.65rem .45rem}.drama-detail .episodes-section .episode-next-actions button{flex:1;padding:.65rem .5rem}
}
.drama-detail .episodes-section.is-single .episode-title{max-width:18ch;overflow-wrap:anywhere;font-size:clamp(2rem,3vw,3.8rem);line-height:1;letter-spacing:-.055em}
/* 单集概览以“剧集信息 + 下一步”成对呈现，避免大字与大片空白割裂项目页。 */
@media(min-width:72.1rem){
  .drama-detail .episodes-section.is-single .episode-stage{grid-template-columns:minmax(24rem,.86fr) minmax(31rem,1.14fr);gap:clamp(1.25rem,2.4vw,2.4rem);align-items:stretch;min-height:27rem}
  .drama-detail .episodes-section.is-single .episode-grid{height:auto;min-height:27rem;border:1px solid var(--border-subtle);border-radius:1rem;background:color-mix(in srgb,var(--bg-raised) 80%,transparent);overflow:hidden}
  .drama-detail .episodes-section.is-single .episode-card{height:auto;min-height:27rem;padding:clamp(1.35rem,2.6vw,2.4rem);grid-template-rows:auto minmax(0,1fr) auto auto;background:transparent}
  .drama-detail .episodes-section.is-single .episode-title{align-self:center;max-width:16ch;font-size:clamp(2rem,3vw,3.35rem);line-height:1.04;letter-spacing:-.052em}
  .drama-detail .episodes-section.is-single .episode-preview{max-width:38ch;margin-top:.7rem;line-height:1.6}
  .drama-detail .episodes-section.is-single .episode-stats{margin-top:1rem}
  .episode-next-step{min-height:27rem;padding:clamp(1.35rem,2.6vw,2.4rem);border:1px solid var(--border-subtle);border-radius:1rem;background:color-mix(in srgb,var(--bg-surface) 88%,transparent);box-sizing:border-box}
  .episode-progress-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}
  .episode-next-step p{margin-bottom:.55rem}
  .episode-next-step h3{font-size:clamp(1.55rem,2.15vw,2.35rem);line-height:1.08;letter-spacing:-.045em}
  .episode-progress-heading>div>span{display:block;max-width:34rem;margin-top:.7rem;color:var(--text-muted);font-size:.84rem;line-height:1.6}
  .episode-progress-state{flex:0 0 auto;padding:.38rem .58rem;border:1px solid color-mix(in srgb,var(--accent-teal) 38%,var(--border-subtle));border-radius:999px;color:var(--accent-teal);font-size:.72rem;font-weight:700;white-space:nowrap}
  .episode-pipeline{margin-top:1.35rem;padding:.75rem .85rem;border-radius:.65rem;background:color-mix(in srgb,var(--bg-page) 54%,transparent)}
  .episode-next-step dl{margin-top:1.25rem}
  .episode-next-actions{margin-top:1.25rem}
  .episode-next-actions button{min-height:2.7rem}
}
</style>
