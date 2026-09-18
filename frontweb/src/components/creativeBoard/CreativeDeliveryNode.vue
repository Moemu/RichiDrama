<template>
  <div class="delivery-card" :class="{ selected }">
    <div class="card-heading"><NodeTitle v-model="data.title" placeholder="合并导出" @update:model-value="data.onChange?.()" /><small>{{ statusLabel }}</small></div>
    <div class="delivery-body">
      <p class="delivery-meta">{{ clipText }}</p>
      <div class="delivery-actions nodrag nopan" @pointerdown.stop>
        <button class="run-button" :disabled="!data.canSubmit || data.submitting" @click="data.onRunDelivery?.()">{{ data.submitting ? '提交中…' : '合并导出' }}</button>
        <button @click="data.onOpenDelivery?.()">配置</button>
      </div>
      <div v-if="delivery && delivery.status === 'completed'" class="delivery-links">
        <a :href="delivery.finished_url" download>成片</a>
        <a :href="delivery.clean_url" download>净片</a>
        <a v-if="delivery.srt_url" :href="delivery.srt_url" download>SRT</a>
      </div>
      <p v-else-if="delivery && delivery.error_msg" class="error" :title="delivery.error_msg">{{ delivery.error_msg }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import NodeTitle from './NodeTitle.vue'
const props = defineProps({ data: { type: Object, required: true }, selected: Boolean })
const delivery = computed(() => props.data.delivery || null)
const clipText = computed(() => {
  const count = props.data.clipCount || 0
  if (!count) return '尚未选择片段'
  const seconds = props.data.clipSeconds || 0
  return `已选 ${count} 个片段${seconds ? ` · 约 ${seconds} 秒` : ''}`
})
const statusLabel = computed(() => {
  if (!delivery.value) return '未提交'
  return ({ processing: '组装中', completed: '已完成', failed: '失败' })[delivery.value.status] || delivery.value.status
})
</script>

<style scoped>
.delivery-card{width:220px;overflow:hidden;border:1px solid #3f6b52;border-radius:12px;background:#16241c;color:#f0f4fa;box-shadow:0 9px 28px rgba(0,0,0,.27)}
.delivery-card.selected{border-color:#8fd6a4;box-shadow:0 0 0 2px rgba(120,220,150,.3),0 9px 28px rgba(0,0,0,.27)}
.card-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;color:#bfe3cb;font-size:11px}.card-heading small{white-space:nowrap;color:#8fb89d}
.delivery-body{display:grid;gap:8px;padding:10px;min-height:88px;background:#101b15}
.delivery-meta{margin:0;font-size:12px;color:#a9d4b6}
.delivery-actions{display:flex;gap:6px}
.delivery-actions button{flex:1;border:1px solid #3f6b52;border-radius:6px;padding:6px 8px;background:#1d3226;color:#dcefe2;font-size:11px;cursor:pointer}
.delivery-actions button:disabled{opacity:.45;cursor:not-allowed}
.delivery-actions .run-button{background:#2f7a4d;border-color:#3f9a63;color:#fff}
.delivery-links{display:flex;gap:.6rem;flex-wrap:wrap}
.delivery-links a{color:#a8e6bb;font-size:12px}
.error{overflow:hidden;margin:0;color:#f1a1a1;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
</style>
