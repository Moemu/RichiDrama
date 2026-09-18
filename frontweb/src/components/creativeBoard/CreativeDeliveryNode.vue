<template>
  <div class="delivery-card" :class="{ selected }">
    <div class="card-heading"><NodeTitle v-model="data.title" placeholder="合并导出" @update:model-value="data.onChange?.()" /><small>{{ statusLabel }}</small></div>
    <div class="delivery-body">
      <p class="delivery-id">{{ delivery ? `交付记录 #${delivery.id}` : '尚未关联交付记录' }}</p>
      <div v-if="delivery && delivery.status === 'completed'" class="delivery-links">
        <a :href="delivery.finished_url" download>成片</a>
        <a :href="delivery.clean_url" download>净片</a>
        <a v-if="delivery.srt_url" :href="delivery.srt_url" download>SRT</a>
      </div>
      <p v-else-if="delivery && delivery.error_msg" class="error" :title="delivery.error_msg">{{ delivery.error_msg }}</p>
      <p v-else class="hint">点击打开交付抽屉</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import NodeTitle from './NodeTitle.vue'
const props = defineProps({ data: { type: Object, required: true }, selected: Boolean })
const delivery = computed(() => props.data.delivery || null)
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
.delivery-id{margin:0;font-size:12px}
.delivery-links{display:flex;gap:.6rem;flex-wrap:wrap}
.delivery-links a{color:#a8e6bb;font-size:12px}
.hint{margin:0;color:#7fa98d;font-size:11px}
.error{overflow:hidden;margin:0;color:#f1a1a1;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
</style>
