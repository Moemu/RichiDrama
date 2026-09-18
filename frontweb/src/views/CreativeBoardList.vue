<template>
  <div class="board-list-page">
    <AppHeader active="boards" :is-admin="isAdmin" />
    <main class="board-list-main">
      <header class="board-list-heading">
        <div>
          <p class="board-list-eyebrow">创作画布</p>
          <h1>我的画布</h1>
          <p class="board-list-lede">从素材出发，自由生成和挑选视频。画布与短剧项目相互独立，可随时回到这里继续。</p>
        </div>
        <el-button type="primary" size="large" @click="createBoard"><el-icon><Plus /></el-icon>新建画布</el-button>
      </header>

      <p v-if="errorMessage" class="board-list-error" role="alert">{{ errorMessage }}</p>
      <p v-if="loading" class="board-list-state">正在加载画布…</p>
      <div v-else-if="boards.length" class="board-grid">
        <article v-for="board in boards" :key="board.id" class="board-card">
          <button type="button" class="board-card__open" @click="openBoard(board)">
            <span class="board-card__mark" aria-hidden="true">画</span>
            <span class="board-card__copy"><b :title="board.name">{{ board.name }}</b><em>更新于 {{ formatChinaDate(board.updated_at) }}</em></span>
            <span class="board-card__arrow" aria-hidden="true">→</span>
          </button>
          <el-button class="board-card__delete" circle type="danger" plain :icon="Delete" :title="`删除${board.name}`" :aria-label="`删除${board.name}`" @click.stop="removeBoard(board)" />
        </article>
      </div>
      <div v-else class="board-list-state board-list-empty">
        <b>还没有画布</b>
        <span>新建一张纯画布，从素材开始自由创作。</span>
        <el-button type="primary" @click="createBoard">新建画布</el-button>
      </div>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Plus } from '@element-plus/icons-vue'
import AppHeader from '@/components/ui/AppHeader.vue'
import { creativeBoardAPI } from '@/api/creativeBoards'
import { readAuthUser } from '@/utils/authUser'
import { formatChinaDate } from '@/utils/time'
import { promptCreateCreativeBoard } from '@/utils/workspaceEntry'

const router = useRouter()
const isAdmin = computed(() => readAuthUser()?.console_access === true)
const boards = ref([])
const loading = ref(true)
const errorMessage = ref('')

async function loadBoards() {
  loading.value = true
  errorMessage.value = ''
  try {
    boards.value = (await creativeBoardAPI.list()) || []
  } catch (error) {
    errorMessage.value = error.message || '画布列表加载失败'
  } finally {
    loading.value = false
  }
}

function openBoard(board) {
  router.push(`/creative-boards/${board.id}`)
}

function createBoard() {
  return promptCreateCreativeBoard(router)
}

async function removeBoard(board) {
  try {
    await ElMessageBox.confirm(`删除“${board.name || '未命名画布'}”？画布会从列表移除，已生成的成片与素材保留，且暂不支持恢复。`, '删除纯画布', { type: 'warning' })
    await creativeBoardAPI.remove(board.id)
    ElMessage.success('画布已删除')
    await loadBoards()
  } catch (_) {}
}

onMounted(loadBoards)
</script>

<style scoped>
.board-list-page { min-height: 100dvh; background: var(--ui-canvas); color: var(--ui-text-1); }
.board-list-main { max-width: 1520px; margin: 0 auto; padding: clamp(1.6rem,4vw,3rem) clamp(1.2rem,4vw,3.5rem) 4rem; }
.board-list-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 2rem; flex-wrap: wrap; padding-bottom: 1.6rem; border-bottom: 1px solid var(--ui-line-1); }
.board-list-eyebrow { margin: 0 0 .55rem; color: var(--ui-accent); font-size: .62rem; font-weight: 750; letter-spacing: .12em; }
.board-list-heading h1 { margin: 0; font-size: clamp(2rem,3.2vw,3.1rem); letter-spacing: -.045em; }
.board-list-lede { max-width: 34rem; margin: .8rem 0 0; color: var(--ui-text-3); font-size: .82rem; line-height: 1.7; }
.board-list-error { margin: 1.4rem 0 0; color: #f2a5a5; font-size: .82rem; }
.board-list-state { display: grid; min-height: 16rem; place-content: center; gap: .6rem; text-align: center; color: var(--ui-text-3); font-size: .85rem; }
.board-list-empty b { color: var(--ui-text-1); font-size: 1.05rem; }
.board-list-empty .el-button { justify-self: center; margin-top: 1rem; }
.board-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(17rem,1fr)); gap: 1rem; padding-top: 1.6rem; }
.board-card { position: relative; display: flex; border: 1px solid var(--ui-line-1); border-radius: 14px; background: color-mix(in srgb,var(--ui-surface-1) 88%,transparent); transition: border-color var(--ui-motion-fast) var(--ui-ease-standard), transform var(--ui-motion-fast) var(--ui-ease-out), box-shadow var(--ui-motion-fast) var(--ui-ease-standard); }
.board-card:hover, .board-card:focus-within { border-color: color-mix(in srgb,var(--ui-accent) 58%,var(--ui-line-2)); box-shadow: 0 12px 30px rgba(0,0,0,.18); transform: translateY(-2px); }
.board-card__open { display: grid; grid-template-columns: 2.6rem minmax(0,1fr) 1.2rem; align-items: center; gap: .9rem; width: 100%; padding: 1.1rem 3.4rem 1.1rem 1.1rem; border: 0; border-radius: 14px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.board-card__mark { display: grid; width: 2.6rem; height: 2.6rem; place-items: center; border: 1px solid var(--ui-line-2); border-radius: 10px; background: color-mix(in srgb,var(--ui-accent) 12%,transparent); color: var(--ui-text-2); font-size: .9rem; }
.board-card__copy { display: grid; gap: .35rem; min-width: 0; }
.board-card__copy b { overflow: hidden; font-size: 1rem; text-overflow: ellipsis; white-space: nowrap; }
.board-card__copy em { color: var(--ui-text-3); font-size: .68rem; font-style: normal; }
.board-card__arrow { color: var(--ui-text-3); transition: transform var(--ui-motion-fast) var(--ui-ease-standard); }
.board-card:hover .board-card__arrow { transform: translateX(.25rem); }
.board-card__delete { position: absolute; right: .9rem; top: 50%; transform: translateY(-50%); opacity: 0; transition: opacity var(--ui-motion-fast) var(--ui-ease-standard); }
.board-card:hover .board-card__delete, .board-card:focus-within .board-card__delete { opacity: 1; }
@media (max-width: 52rem) {
  .board-list-heading { align-items: flex-start; }
  .board-grid { grid-template-columns: 1fr; }
  .board-card__delete { opacity: 1; }
}
</style>
