<template>
  <el-drawer :model-value="show" title="合并导出" size="min(640px, 100vw)" class="delivery-drawer" @update:model-value="$emit('update:show', $event)">
    <p>将已完成的片段按播放顺序排列，合并为一个视频。字幕与配乐均可选。</p>
    <p v-if="deliveryIds.length" class="panel-hint">当前片段约 {{ Math.round(deliveryDurationMs / 1000) }} 秒。</p>
    <div v-for="(id, index) in deliveryIds" :key="`${id}-${index}`" class="delivery-clip"><b>{{ index + 1 }}. {{ videoName(id) }}</b><div><el-button size="small" :disabled="index === 0" @click="moveClip(index, -1)">上移</el-button><el-button size="small" :disabled="index === deliveryIds.length - 1" @click="moveClip(index, 1)">下移</el-button><el-button size="small" @click="deliveryIds.splice(index, 1)">移除</el-button></div></div>
    <p v-if="!deliveryIds.length" class="empty-list">先选中一张已完成的视频卡片，点击“加入合并导出”。</p>
    <h3>字幕时间轴（可选）</h3><div v-for="(line, index) in subtitles" :key="index" class="subtitle-line"><el-input-number v-model="line.start" :min="0" :max="deliveryDurationMs / 1000" :precision="1" :step="0.1" /><span>至</span><el-input-number v-model="line.end" :min="0" :max="deliveryDurationMs / 1000" :precision="1" :step="0.1" /><el-input v-model="line.text" placeholder="字幕内容" /><el-button @click="subtitles.splice(index, 1)">×</el-button></div><el-button @click="subtitles.push({ start: 0, end: 2, text: '' })">＋ 字幕</el-button>
    <h3>配乐</h3><el-select :model-value="bgmAssetId" clearable placeholder="不叠加 BGM" @update:model-value="$emit('update:bgmAssetId', $event)"><el-option v-for="asset in bgmAssets" :key="asset.id" :label="asset.name" :value="asset.id" /></el-select>
    <p class="panel-hint">净片保留片段原声，不叠加平台 BGM，也不烧录字幕。请在交付前检查模型是否已将音乐或文字做进原片。</p>
    <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="$emit('submit')">合并导出视频</el-button>
    <h3>交付记录</h3><div v-for="item in deliveryItems" :key="item.id" class="delivery-result"><b>#{{ item.id }} · {{ statusLabel(item.status) }}</b><p v-if="item.error_msg" class="error">{{ item.error_msg }}</p><el-button v-if="item.status === 'failed'" size="small" @click="$emit('restore', item)">复制输入后重做</el-button><div v-if="item.status === 'completed'"><a :href="item.finished_url" download>下载成片</a><a :href="item.clean_url" download>下载净片</a><a v-if="item.srt_url" :href="item.srt_url" download>下载 SRT</a></div></div>
  </el-drawer>
</template>

<script setup>
const props = defineProps({
  show: Boolean,
  deliveryIds: { type: Array, required: true },
  subtitles: { type: Array, required: true },
  bgmAssetId: { type: [Number, String, null], default: null },
  deliveryItems: { type: Array, required: true },
  bgmAssets: { type: Array, required: true },
  deliveryDurationMs: { type: Number, required: true },
  canSubmit: Boolean,
  submitting: Boolean,
  videoName: { type: Function, required: true },
})
defineEmits(['update:show', 'update:bgmAssetId', 'submit', 'restore'])

function statusLabel(status) { return ({ processing: '组装中', completed: '已完成', failed: '失败' })[status] || status }
function moveClip(index, delta) { const next = index + delta; if (next < 0 || next >= props.deliveryIds.length) return; const rows = props.deliveryIds; [rows[index], rows[next]] = [rows[next], rows[index]] }
</script>

<style scoped>
.panel-hint{color:#8fa1b5;font-size:.72rem;line-height:1.55}
.empty-list{color:#8193a7;font-size:.8rem}
.error{color:#f1a1a1}
.delivery-clip,.delivery-result{display:grid;gap:.5rem;margin:.6rem 0;padding:.7rem;border:1px solid #334357;border-radius:8px}
.delivery-clip{grid-template-columns:minmax(0,1fr) auto;align-items:center}
.delivery-clip div,.delivery-result div{display:flex;gap:.5rem;flex-wrap:wrap}
.delivery-result a{color:#a8bdff}
.subtitle-line{display:grid;grid-template-columns:110px auto 110px minmax(0,1fr) auto;align-items:center;gap:.4rem;margin:.4rem 0}
.subtitle-line :deep(.el-input-number){width:110px}
</style>
