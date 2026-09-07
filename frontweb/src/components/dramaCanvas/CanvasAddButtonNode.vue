<template>
  <div
    class="canvas-add-node"
    :class="'kind-' + data.assetType"
    @click.stop="onClick"
  >
    <span class="add-icon">+</span>
    <span class="add-label">{{ data.label || defaultLabel }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useCanvasContext } from '@/composables/useCanvasContext'

const props = defineProps({
  data: { type: Object, required: true },
})

const ctx = useCanvasContext()

const defaultLabel = computed(() => {
  const map = { character: '新建角色', scene: '新建场景', prop: '新建道具', storyboard: '新建分镜' }
  return map[props.data.assetType] || '新建'
})

function onClick() {
  ctx?.openCreateDialog?.(props.data.assetType)
}
</script>

<style scoped>
.canvas-add-node {
  width: 176px;
  padding: 14px 12px;
  border-radius: 10px;
  border: 1px dashed rgba(129, 140, 248, 0.45);
  background: var(--bg-surface);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: border-color 0.15s, background 0.15s;
}
.canvas-add-node:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.add-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--el-color-primary-light-9);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  flex-shrink: 0;
}
.add-label {
  font-size: 12px;
  color: var(--text-muted);
}
.kind-character { border-color: rgba(52, 211, 153, 0.4); }
.kind-character .add-icon { background: var(--status-success-bg); color: var(--status-success); }
.kind-scene { border-color: rgba(96, 165, 250, 0.4); }
.kind-scene .add-icon { background: var(--status-info-bg); color: var(--status-info); }
.kind-prop { border-color: rgba(251, 191, 36, 0.4); }
.kind-prop .add-icon { background: var(--status-warning-bg); color: var(--status-warning); }
.kind-storyboard { border-color: rgba(167, 139, 250, 0.45); width: 200px; }
</style>
