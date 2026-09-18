<template>
  <div class="media-card" :class="{ selected, failed: data.status === 'failed' }">
    <Handle type="target" :position="Position.Left" :is-connectable="false" />
    <div class="card-heading"><span>{{ data.type === 'video' ? '▣ 视频' : '▧ 图片' }}</span><small>{{ statusLabel }}</small></div>
    <video v-if="data.type === 'video' && data.url" :src="data.url" muted playsinline preload="metadata" @dblclick.stop="openMedia"></video>
    <img v-else-if="data.type === 'image' && data.url" :src="data.url" :alt="data.name" draggable="false" />
    <div v-else class="media-empty">{{ data.status === 'failed' ? '生成失败' : '等待媒体' }}</div>
    <div class="card-footer"><NodeTitle v-model="data.title" :placeholder="data.name || '素材'" @update:model-value="data.onChange?.()" /></div>
    <div class="media-actions nodrag nopan" @pointerdown.stop>
      <button v-if="data.type === 'image'" @click="data.onReference?.(id, 'image')">接图片节点</button>
      <button v-if="['image', 'video'].includes(data.type)" @click="data.onReference?.(id, 'video')">接视频节点</button>
      <button v-if="data.type === 'video' && data.source_type === 'video_generation' && data.status === 'completed'" @click="data.onDelivery?.(id)">加入合并导出</button>
      <button v-if="data.type === 'video' && data.source_type === 'video_generation' && ['pending', 'processing', 'sd2_waiting'].includes(data.status)" @click="data.onCancel?.(id)">取消任务</button>
      <a v-if="data.local_path && data.url && ['completed', 'ready'].includes(data.status)" :href="data.url" download @click.stop>下载成果</a>
      <a v-if="data.url" :href="data.url" target="_blank" rel="noopener">查看媒体</a>
    </div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeTitle from './NodeTitle.vue'
const props = defineProps({ id: { type: String, required: true }, data: { type: Object, required: true }, selected: Boolean })
const statusLabel = computed(() => ({ completed: '已完成', ready: '素材', pending: '排队中', processing: '生成中', failed: '失败' }[props.data.status] || props.data.status || '素材'))
function openMedia() { if (props.data.url) window.open(props.data.url, '_blank', 'noopener') }
</script>

<style scoped>
/* Overflow stays visible so the side ports are not clipped by the card. */
.media-card{width:220px;overflow:visible;border:1px solid #344357;border-radius:12px;background:#171f2b;color:#f0f4fa;box-shadow:0 9px 28px rgba(0,0,0,.27)}
.media-card.selected{border-color:#90a7ff;box-shadow:0 0 0 2px rgba(130,157,255,.35),0 9px 28px rgba(0,0,0,.27)}.media-card.failed{border-color:#e48080}
.card-heading{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;color:#b7c8dc;font-size:11px}.card-heading small{color:#8fa6bd}
img,video,.media-empty{display:block;width:100%;height:132px;object-fit:contain;background:#0c1119}.media-empty{display:grid;place-content:center;color:#8798ab}
.card-footer{overflow:hidden;padding:9px 10px;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
.media-actions{display:flex;flex-wrap:wrap;gap:5px;padding:0 10px 10px}.media-actions button,.media-actions a{border:1px solid #41516b;border-radius:5px;background:#223047;color:#dce5f4;font-size:10px;padding:5px;cursor:pointer;text-decoration:none}
</style>
