<template>
  <el-drawer :model-value="show" title="合并导出" size="min(560px, 100vw)" class="delivery-drawer" @update:model-value="$emit('update:show', $event)">
    <div class="drawer-body">
      <p class="drawer-intro">将已完成的片段按播放顺序排列，合并为一个视频。字幕与配乐均可选。</p>

      <section class="drawer-section">
        <h3>片段顺序<span v-if="deliveryIds.length" class="section-hint">共 {{ deliveryIds.length }} 段 · 约 {{ Math.round(deliveryDurationMs / 1000) }} 秒</span></h3>
        <div v-for="(id, index) in deliveryIds" :key="`${id}-${index}`" class="clip-row">
          <span class="clip-order">{{ index + 1 }}</span>
          <span class="clip-name" :title="videoName(id)">{{ videoName(id) }}</span>
          <div class="clip-tools">
            <el-button size="small" text :disabled="index === 0" aria-label="上移" @click="moveClip(index, -1)">↑</el-button>
            <el-button size="small" text :disabled="index === deliveryIds.length - 1" aria-label="下移" @click="moveClip(index, 1)">↓</el-button>
            <el-button size="small" text type="danger" aria-label="移除" @click="deliveryIds.splice(index, 1)">×</el-button>
          </div>
        </div>
        <p v-if="!deliveryIds.length" class="empty-list">先选中一张已完成的视频卡片，点击“加入合并导出”。</p>
      </section>

      <section class="drawer-section">
        <h3>字幕时间轴<span class="section-hint">可选</span></h3>
        <div v-for="(line, index) in subtitles" :key="index" class="subtitle-line">
          <el-input-number v-model="line.start" :min="0" :max="deliveryDurationMs / 1000" :precision="1" :step="0.1" controls-position="right" />
          <span class="subtitle-sep">至</span>
          <el-input-number v-model="line.end" :min="0" :max="deliveryDurationMs / 1000" :precision="1" :step="0.1" controls-position="right" />
          <el-input v-model="line.text" placeholder="字幕内容" />
          <el-button text aria-label="删除字幕" @click="subtitles.splice(index, 1)">×</el-button>
        </div>
        <el-button v-if="deliveryIds.length" size="small" text @click="subtitles.push({ start: 0, end: 2, text: '' })">＋ 添加字幕</el-button>
      </section>

      <section class="drawer-section">
        <h3>配乐<span class="section-hint">可选</span></h3>
        <el-select :model-value="bgmAssetId" clearable placeholder="不叠加 BGM" class="bgm-select" @update:model-value="$emit('update:bgmAssetId', $event)">
          <el-option v-for="asset in bgmAssets" :key="asset.id" :label="asset.name" :value="asset.id" />
        </el-select>
        <p class="section-note">净片保留片段原声，不叠加平台 BGM，也不烧录字幕。请在交付前检查模型是否已将音乐或文字做进原片。</p>
      </section>

      <el-button type="primary" class="submit-button" :loading="submitting" :disabled="!canSubmit" @click="$emit('submit')">合并导出视频</el-button>

      <section v-if="deliveryItems.length" class="drawer-section">
        <h3>导出记录</h3>
        <div v-for="item in deliveryItems" :key="item.id" class="record-row" :class="`is-${item.status}`">
          <div class="record-head">
            <b>#{{ item.id }}</b>
            <span class="record-status">{{ statusLabel(item.status) }}</span>
            <el-button v-if="item.status === 'failed'" size="small" text @click="$emit('restore', item)">复制输入后重做</el-button>
          </div>
          <p v-if="item.error_msg" class="record-error" :title="item.error_msg">{{ item.error_msg }}</p>
          <div v-if="item.status === 'completed'" class="record-links">
            <a :href="item.finished_url" download>下载成片</a>
            <a :href="item.clean_url" download>下载净片</a>
            <a v-if="item.srt_url" :href="item.srt_url" download>下载 SRT</a>
          </div>
        </div>
      </section>
    </div>
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
.drawer-body{display:grid;gap:18px;padding:4px 2px}
.drawer-intro{margin:0;color:#8fa1b5;font-size:12px;line-height:1.6}
.drawer-section{display:grid;gap:8px}
.drawer-section h3{display:flex;align-items:baseline;gap:8px;margin:0;font-size:13px;font-weight:600;color:#dbe4f2}
.section-hint{color:#8193a7;font-size:11px;font-weight:400}
.section-note{margin:0;color:#8193a7;font-size:11px;line-height:1.55}
.empty-list{margin:0;color:#8193a7;font-size:12px}
.clip-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px 10px;border:1px solid #334357;border-radius:8px;background:#1a2434}
.clip-order{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#2a3a52;color:#a8bdff;font-size:11px}
.clip-name{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}
.clip-tools{display:flex;gap:2px}
.subtitle-line{display:grid;grid-template-columns:96px auto 96px minmax(0,1fr) auto;align-items:center;gap:6px}
.subtitle-line :deep(.el-input-number){width:96px}
.subtitle-sep{color:#8193a7;font-size:11px}
.bgm-select{width:100%}
.submit-button{width:100%;margin-top:2px}
.record-row{display:grid;gap:6px;padding:10px 12px;border:1px solid #334357;border-radius:8px;background:#1a2434}
.record-row.is-completed{border-color:#3f6b52}
.record-row.is-failed{border-color:#7a4343}
.record-head{display:flex;align-items:center;gap:10px;font-size:12px}
.record-status{color:#8fa6bd;font-size:11px}
.record-error{overflow:hidden;margin:0;color:#f1a1a1;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.record-links{display:flex;gap:14px}
.record-links a{color:#a8bdff;font-size:12px;text-decoration:none}
</style>
