<template>
  <header class="app-header">
    <div class="app-header__inner">
      <button class="app-header__brand" type="button" aria-label="返回首页" @click="router.push('/')">
        <span class="app-header__mark" aria-hidden="true"><img src="/brand/richi-logo-color.png" alt="" /></span>
        <span><b>瑞池传媒短剧平台</b><small>创作工作台</small></span>
      </button>

      <!-- 标签栏自带全部跳转与创建逻辑，任何页面都能直接渲染，不依赖页面级事件处理器。 -->
      <nav class="app-header__nav" aria-label="主导航">
        <button type="button" :class="{ active: active === 'projects' }" :aria-current="active === 'projects' ? 'page' : undefined" @click="router.push('/')">项目</button>
        <button type="button" :class="{ active: active === 'boards' }" :aria-current="active === 'boards' ? 'page' : undefined" @click="router.push('/creative-boards')">画布</button>
        <button type="button" :class="{ active: active === 'omni' }" :aria-current="active === 'omni' ? 'page' : undefined" @click="startOmniProject(router)">全能创作</button>
        <el-dropdown trigger="click" placement="bottom-start" popper-class="app-header__menu" @command="router.push($event)">
          <button type="button" :class="{ active: active === 'assets' }" :aria-current="active === 'assets' ? 'page' : undefined" @keydown.esc.prevent="closeMenus">素材<em aria-hidden="true">▾</em></button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="/?assets=characters"><el-icon><User /></el-icon>角色素材</el-dropdown-item>
              <el-dropdown-item command="/?assets=scenes"><el-icon><PictureFilled /></el-icon>场景素材</el-dropdown-item>
              <el-dropdown-item command="/?assets=props"><el-icon><Box /></el-icon>道具素材</el-dropdown-item>
              <el-dropdown-item divided command="/media-library"><el-icon><Files /></el-icon>媒体素材库</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown trigger="click" placement="bottom-start" popper-class="app-header__menu" @command="router.push($event)">
          <button type="button" :class="{ active: active === 'tools' }" :aria-current="active === 'tools' ? 'page' : undefined">AI 工具<em aria-hidden="true">▾</em></button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="tool in AI_TOOLS" :key="tool.to" :command="tool.to">{{ tool.title }}<small>{{ tool.group }}</small></el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown v-if="isAdmin" trigger="click" placement="bottom-start" popper-class="app-header__menu" @command="router.push($event)">
          <button type="button" :class="{ active: active === 'admin' }" :aria-current="active === 'admin' ? 'page' : undefined">运营<em aria-hidden="true">▾</em></button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="/admin">后台管理</el-dropdown-item>
              <el-dropdown-item command="/admin/costs">消耗与成本</el-dropdown-item>
              <el-dropdown-item command="/admin/operations">运营告警与报表</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </nav>

      <div class="app-header__actions">
        <AccountBalanceBadge />
        <el-dropdown ref="createDropdown" trigger="click" placement="bottom-end" @command="onCreateCommand">
          <el-button type="primary" @keydown.esc.prevent="closeMenus"><el-icon><Plus /></el-icon>新建</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="project"><el-icon><Plus /></el-icon>新建短剧项目</el-dropdown-item>
              <el-dropdown-item command="omni"><el-icon><Files /></el-icon>新建全能项目</el-dropdown-item>
              <el-dropdown-item command="board"><el-icon><Grid /></el-icon>新建纯画布</el-dropdown-item>
              <el-dropdown-item divided command="import" :disabled="importing"><el-icon><Upload /></el-icon>导入项目</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown ref="accountDropdown" trigger="click" placement="bottom-end" @command="onAccountCommand">
          <button class="app-header__account" type="button" aria-label="账户与偏好" @keydown.esc.prevent="closeMenus"><el-icon><UserFilled /></el-icon></button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="theme"><el-icon><Sunny /></el-icon>{{ isDark ? '切换浅色模式' : '切换深色模式' }}</el-dropdown-item>
              <el-dropdown-item command="account"><el-icon><User /></el-icon>账户中心</el-dropdown-item>
              <el-dropdown-item v-if="isAdmin" command="config"><el-icon><Setting /></el-icon>AI 配置</el-dropdown-item>
              <el-dropdown-item v-if="isAdmin" command="group-settings"><el-icon><DataAnalysis /></el-icon>项目分组 API</el-dropdown-item>
              <el-dropdown-item command="deleted"><el-icon><Delete /></el-icon>已删除项目</el-dropdown-item>
              <el-dropdown-item v-if="isAdmin" divided command="admin"><el-icon><DataAnalysis /></el-icon>运营后台</el-dropdown-item>
              <el-dropdown-item divided command="logout"><el-icon><SwitchButton /></el-icon>退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>
  </header>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Box, DataAnalysis, Delete, Files, Grid, PictureFilled, Plus, Setting, Sunny, SwitchButton, Upload, User, UserFilled } from '@element-plus/icons-vue'
import { useTheme } from '@/composables/useTheme'
import { signOut } from '@/utils/session'
import { promptCreateCreativeBoard, startOmniProject } from '@/utils/workspaceEntry'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'

defineProps({
  // 当前页面在标签栏中的位置，例如 'projects'、'boards'、'tools'。
  active: { type: String, default: 'projects' },
  importing: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
})
const router = useRouter()
const { isDark, toggle: toggleTheme } = useTheme()
const createDropdown = ref(null)
const accountDropdown = ref(null)

// 工具箱的完整入口：全部工具都能从标签栏直达，不再需要先进目录页。
const AI_TOOLS = [
  { title: '剧本分析', group: '文本策划', to: '/ai-tools/script-analysis' },
  { title: '剧本分析（流式）', group: '批量处理', to: '/ai-tools/script-analysis-stream' },
  { title: '剧本创作', group: '文本策划', to: '/ai-tools/script-writing' },
  { title: '图片生成', group: '视觉生成', to: '/ai-tools/image-generation' },
  { title: '视频生成', group: '视频工作流', to: '/ai-tools/video-generation' },
  { title: '视频本地化', group: '视频工作流', to: '/ai-tools/video-localization' },
  { title: '反推提示词', group: '素材分析', to: '/ai-tools/reverse-prompt' },
]

// 需要首页上下文的操作走查询参数，首页读取后自行打开对应面板。
function onCreateCommand(command) {
  if (command === 'board') return promptCreateCreativeBoard(router)
  if (command === 'omni') return startOmniProject(router)
  if (command === 'import') return router.push({ path: '/', query: { import: '1' } })
  return router.push({ path: '/', query: { new: '1' } })
}
function onAccountCommand(command) {
  if (command === 'theme') return toggleTheme()
  if (command === 'account') return router.push('/account')
  if (command === 'admin') return router.push('/admin')
  if (command === 'group-settings') return router.push('/admin?tab=governance&settings=tenants')
  if (command === 'logout') return signOut(router)
  if (command === 'config') return router.push({ path: '/', query: { config: '1' } })
  return router.push({ path: '/', query: { deleted: '1' } })
}

function closeMenus() {
  createDropdown.value?.handleClose?.()
  accountDropdown.value?.handleClose?.()
}

function closeMenusOnEscape(event) {
  if (event.key !== 'Escape') return
  closeMenus()
}

onMounted(() => window.addEventListener('keydown', closeMenusOnEscape, true))
onBeforeUnmount(() => window.removeEventListener('keydown', closeMenusOnEscape, true))
</script>

<style scoped>
.app-header{position:relative;z-index:var(--ui-z-header);height:var(--ui-header-height);border-bottom:1px solid var(--ui-line-1);background:color-mix(in srgb,var(--ui-surface-1) 92%,transparent);box-shadow:0 1px 0 color-mix(in srgb,var(--ui-text-1) 3%,transparent);backdrop-filter:blur(18px)}
.app-header__inner{display:grid;grid-template-columns:minmax(15rem,1fr) auto minmax(15rem,1fr);align-items:center;gap:clamp(20px,3vw,54px);width:100%;height:100%;padding:0 clamp(28px,3vw,60px)}
.app-header__brand{display:flex;align-items:center;gap:11px;min-width:0;padding:5px 0;border:0;background:none;color:var(--ui-text-1);text-align:left;cursor:pointer;transition:opacity var(--ui-motion-fast) var(--ui-ease-standard)}.app-header__brand:hover{opacity:.82}
.app-header__mark{display:grid;flex:0 0 34px;width:34px;height:34px;place-items:center;overflow:hidden;border-radius:10px;background:color-mix(in srgb,var(--ui-accent) 12%,transparent);box-shadow:inset 0 1px color-mix(in srgb,#fff 18%,transparent)}.app-header__mark img{width:34px;height:34px;object-fit:cover}.app-header__brand span:last-child{display:grid;gap:2px;min-width:0}.app-header__brand b{overflow:hidden;font-size:13px;font-weight:720;letter-spacing:-.02em;line-height:1.15;text-overflow:ellipsis;white-space:nowrap}.app-header__brand small{color:var(--ui-text-3);font-size:10px;font-weight:560;letter-spacing:.06em;line-height:1.15}
.app-header__nav{display:flex;align-items:center;gap:clamp(14px,1.9vw,32px);padding:0;border:0;background:none;box-shadow:none}
.app-header__nav>button,.app-header__nav :deep(.el-dropdown>button){position:relative;display:inline-flex;align-items:center;gap:4px;height:auto;padding:7px 0;border:0;border-radius:0;background:transparent;color:var(--ui-text-3);font-size:13px;font-weight:620;letter-spacing:-.01em;white-space:nowrap;cursor:pointer;transition:color var(--ui-motion-fast) var(--ui-ease-standard)}
.app-header__nav>button::after,.app-header__nav :deep(.el-dropdown>button)::after{content:'';position:absolute;right:0;bottom:2px;left:0;height:2px;background:var(--ui-accent);transform:scaleX(0);transform-origin:center;transition:transform var(--ui-motion-fast) var(--ui-ease-standard)}
.app-header__nav>button:hover,.app-header__nav>button.active,.app-header__nav :deep(.el-dropdown>button:hover),.app-header__nav :deep(.el-dropdown>button.active){color:var(--ui-text-1)}
.app-header__nav>button:hover::after,.app-header__nav>button.active::after,.app-header__nav :deep(.el-dropdown>button:hover)::after,.app-header__nav :deep(.el-dropdown>button.active)::after{transform:scaleX(1)}
.app-header__nav em{color:currentColor;font-size:.6rem;font-style:normal;opacity:.55}
.app-header__actions{display:flex;align-items:center;justify-content:flex-end;gap:9px;min-width:0}.app-header__actions :deep(.el-button--primary){min-height:36px;padding-inline:14px;border-color:transparent;background:linear-gradient(135deg,var(--ui-accent),#6d5de0);box-shadow:0 8px 18px color-mix(in srgb,var(--ui-accent) 28%,transparent)}.app-header__account{display:grid;width:36px;height:36px;place-items:center;border:1px solid var(--ui-line-2);border-radius:11px;background:color-mix(in srgb,var(--ui-surface-2) 86%,transparent);color:var(--ui-text-2);cursor:pointer;transition:transform var(--ui-motion-fast) var(--ui-ease-out),background-color var(--ui-motion-fast) var(--ui-ease-standard),border-color var(--ui-motion-fast) var(--ui-ease-standard),color var(--ui-motion-fast) var(--ui-ease-standard)}.app-header__account:hover{border-color:var(--ui-accent);background:var(--ui-surface-hover);color:var(--ui-text-1);transform:translateY(-1px)}
@media(max-width:1180px){.app-header__inner{grid-template-columns:minmax(11rem,1fr) auto minmax(11rem,1fr);gap:14px;padding-inline:24px}.app-header__nav{gap:14px}.app-header__nav>button,.app-header__nav :deep(.el-dropdown>button){font-size:12px}.app-header__actions{gap:6px}}
@media(max-width:720px){
  .app-header{height:auto;min-height:var(--ui-header-height)}
  .app-header__inner{grid-template-columns:minmax(0,1fr) auto;grid-template-rows:34px 26px;grid-template-areas:"brand actions" "nav nav";gap:2px 8px;height:auto;min-height:var(--ui-header-height);padding:1px 12px}
  .app-header__brand{grid-area:brand;min-width:0}
  .app-header__nav{grid-area:nav;justify-self:stretch;width:100%;min-width:0;height:26px;gap:16px;padding:2px 0;overflow-x:auto;scrollbar-width:none}
  .app-header__nav::-webkit-scrollbar{display:none}
  .app-header__nav>button,.app-header__nav :deep(.el-dropdown>button){flex:0 0 auto;height:20px;padding:0;font-size:12px}
  .app-header__actions{grid-area:actions;gap:4px;min-width:0}
  .app-header__actions :deep(.el-dropdown){flex:0 0 auto}
  .app-header__actions :deep(.account-balance){max-width:7rem;min-width:0;padding-inline:8px;overflow:hidden}
  .app-header__actions :deep(.el-button--primary){min-height:34px;padding-inline:9px}
  .app-header__account{width:34px;height:34px}
}
</style>

<!-- 下拉浮层被 teleport 到 body，作用域样式选不中，只能按 popper-class 生效。 -->
<style>
.app-header__menu .el-dropdown-menu__item{display:flex;align-items:center;justify-content:space-between;gap:1.8rem;min-width:11.5rem}
.app-header__menu .el-dropdown-menu__item small{padding-left:.6rem;color:var(--ui-text-3);font-size:11px}
</style>
