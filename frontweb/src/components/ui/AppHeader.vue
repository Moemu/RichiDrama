<template>
  <header class="app-header">
    <div class="app-header__inner">
      <button class="app-header__brand" type="button" aria-label="返回项目" @click="router.push('/')">
        <span class="app-header__mark" aria-hidden="true"><img src="/brand/richi-logo-color.png" alt="" /></span>
        <span><b>瑞池传媒短剧平台</b><small>创作工作台</small></span>
      </button>

      <nav class="app-header__nav" aria-label="主导航">
        <button type="button" :class="{ active: active === 'projects' }" :aria-current="active === 'projects' ? 'page' : undefined" @click="router.push('/')">项目</button>
        <el-dropdown ref="assetDropdown" trigger="click" placement="bottom-start" @command="emit('asset-command', $event)">
          <button type="button" :class="{ active: active === 'assets' }" :aria-current="active === 'assets' ? 'page' : undefined" @keydown.esc.prevent="closeMenus">素材</button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="characters"><el-icon><User /></el-icon>角色素材</el-dropdown-item>
              <el-dropdown-item command="scenes"><el-icon><PictureFilled /></el-icon>场景素材</el-dropdown-item>
              <el-dropdown-item command="props"><el-icon><Box /></el-icon>道具素材</el-dropdown-item>
              <el-dropdown-item divided command="media"><el-icon><Files /></el-icon>媒体素材库</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button type="button" :class="{ active: active === 'tools' }" :aria-current="active === 'tools' ? 'page' : undefined" @click="router.push('/ai-tools')">AI 工具</button>
        <button type="button" :class="{ active: active === 'omni' }" :aria-current="active === 'omni' ? 'page' : undefined" @click="emit('create-omni')">全能创作</button>
      </nav>

      <div class="app-header__actions">
        <AccountBalanceBadge />
        <el-dropdown ref="createDropdown" trigger="click" placement="bottom-end" @command="emit('create-command', $event)">
          <el-button type="primary" @keydown.esc.prevent="closeMenus"><el-icon><Plus /></el-icon>新建</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="project"><el-icon><Plus /></el-icon>新建短剧项目</el-dropdown-item>
              <el-dropdown-item command="import" :disabled="importing"><el-icon><Upload /></el-icon>导入项目</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown ref="accountDropdown" trigger="click" placement="bottom-end" @command="emit('account-command', $event)">
          <button class="app-header__account" type="button" aria-label="账户与偏好" @keydown.esc.prevent="closeMenus"><el-icon><UserFilled /></el-icon></button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="theme"><el-icon><Sunny /></el-icon>{{ isDark ? '切换浅色模式' : '切换深色模式' }}</el-dropdown-item>
              <el-dropdown-item command="account"><el-icon><User /></el-icon>账户中心</el-dropdown-item>
              <el-dropdown-item command="config"><el-icon><Setting /></el-icon>AI 配置</el-dropdown-item>
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
import { Box, DataAnalysis, Delete, Files, PictureFilled, Plus, Setting, Sunny, SwitchButton, Upload, User, UserFilled } from '@element-plus/icons-vue'
import { useTheme } from '@/composables/useTheme'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'

defineProps({
  active: { type: String, default: 'projects' },
  importing: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
})
const emit = defineEmits(['asset-command', 'create-command', 'create-omni', 'account-command'])
const router = useRouter()
const { isDark } = useTheme()
const assetDropdown = ref(null)
const createDropdown = ref(null)
const accountDropdown = ref(null)

function closeMenus() {
  assetDropdown.value?.handleClose?.()
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
.app-header__nav{display:flex;align-items:center;gap:2px;padding:4px;border:1px solid color-mix(in srgb,var(--ui-line-2) 78%,transparent);border-radius:13px;background:color-mix(in srgb,var(--ui-surface-2) 72%,transparent);box-shadow:inset 0 1px color-mix(in srgb,#fff 6%,transparent)}
.app-header__nav>button,.app-header__nav :deep(.el-dropdown>button){position:relative;min-width:72px;height:34px;padding:0 13px;border:0;border-radius:9px;background:transparent;color:var(--ui-text-3);font-size:13px;font-weight:620;letter-spacing:-.01em;cursor:pointer;transition:color var(--ui-motion-fast) var(--ui-ease-standard),background-color var(--ui-motion-fast) var(--ui-ease-standard),box-shadow var(--ui-motion-fast) var(--ui-ease-standard)}
.app-header__nav>button::after,.app-header__nav :deep(.el-dropdown>button)::after{display:none}.app-header__nav>button:hover,.app-header__nav>button.active,.app-header__nav :deep(.el-dropdown>button:hover),.app-header__nav :deep(.el-dropdown>button.active){color:var(--ui-text-1)}.app-header__nav>button:hover,.app-header__nav :deep(.el-dropdown>button:hover){background:color-mix(in srgb,var(--ui-text-1) 6%,transparent)}.app-header__nav>button.active,.app-header__nav :deep(.el-dropdown>button.active){background:var(--ui-surface-3);box-shadow:0 2px 8px rgba(0,0,0,.16),inset 0 1px color-mix(in srgb,#fff 10%,transparent)}
.app-header__actions{display:flex;align-items:center;justify-content:flex-end;gap:9px;min-width:0}.app-header__actions :deep(.el-button--primary){min-height:36px;padding-inline:14px;border-color:transparent;background:linear-gradient(135deg,var(--ui-accent),#6d5de0);box-shadow:0 8px 18px color-mix(in srgb,var(--ui-accent) 28%,transparent)}.app-header__account{display:grid;width:36px;height:36px;place-items:center;border:1px solid var(--ui-line-2);border-radius:11px;background:color-mix(in srgb,var(--ui-surface-2) 86%,transparent);color:var(--ui-text-2);cursor:pointer;transition:transform var(--ui-motion-fast) var(--ui-ease-out),background-color var(--ui-motion-fast) var(--ui-ease-standard),border-color var(--ui-motion-fast) var(--ui-ease-standard),color var(--ui-motion-fast) var(--ui-ease-standard)}.app-header__account:hover{border-color:var(--ui-accent);background:var(--ui-surface-hover);color:var(--ui-text-1);transform:translateY(-1px)}
@media(max-width:1180px){.app-header__inner{grid-template-columns:minmax(11rem,1fr) auto minmax(11rem,1fr);gap:14px;padding-inline:24px}.app-header__nav>button,.app-header__nav :deep(.el-dropdown>button){min-width:60px;padding-inline:10px}.app-header__actions{gap:6px}}
</style>
