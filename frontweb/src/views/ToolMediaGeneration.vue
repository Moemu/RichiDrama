<template>
  <main class="media-tool">
    <header class="media-header">
      <AccountBalanceBadge />
      <div><el-button text @click="router.push('/ai-tools')">← AI 工具箱</el-button><p>独立生成记录 · 可导入素材库</p></div>
      <div class="title-wrap"><span>{{ media === 'image' ? '▣' : '▶' }}</span><div><h1>{{ media === 'image' ? '图片生成' : '视频生成' }}</h1><p>{{ media === 'image' ? '定义角色、场景与关键画面。' : '以镜头为单位生成、复核并进入全能创作。' }}</p></div></div>
    </header>
    <section class="media-layout">
      <aside class="control-panel">
        <h2><i>01</i> 创作输入</h2>
        <label>创作模式<el-select v-model="mode"><el-option v-for="item in modes" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
        <p class="mode-info"><b>{{ selectedMode.hint }}</b><span>{{ selectedMode.rule }}</span></p>
        <label>提示词<el-input v-model="prompt" type="textarea" :rows="7" placeholder="描述主体、动作、场景、镜头和风格…" /></label>
        <label v-if="media === 'image'">模型<el-input v-model="model" placeholder="留空使用当前默认模型" /></label>
        <GenerationSettings v-else v-model="videoSettings" :max-duration="15" />
        <template v-if="mode === 'first_last'"><ToolAssetSelector v-model="firstFrameAssetId" :types="['image']" label="首帧来源" @selected="applyFirstFrame" /><ToolAssetSelector v-model="lastFrameAssetId" :types="['image']" label="尾帧来源" @selected="applyLastFrame" /></template>
        <ToolAssetSelector v-else-if="mode !== 'text'" v-model="selectedAssetId" :types="media === 'image' ? ['image'] : ['image', 'video']" label="参考素材来源" @selected="applySelectedAsset" />
        <label>公开素材链接（可选）<el-input v-model="reference" :placeholder="selectedMode.rule" /></label>
        <small>{{ media === 'image' ? '参考素材可来自素材库或公开链接。' : '单镜头最长 15 秒；模型能力决定可用参考类型。' }}</small>
        <el-button type="primary" :loading="running" :disabled="!prompt.trim()" @click="submit">{{ running ? '正在提交任务…' : `生成${media === 'image' ? '图片' : '视频'}` }}</el-button>
      </aside>
      <section class="preview-stage">
        <div class="stage-heading"><div><p>结果预览</p><h2>当前生成结果</h2></div><span class="status-key">● 完成　● 处理中　● 失败</span></div>
        <div v-if="featured" class="featured">
          <img v-if="media === 'image' && featured.image_url" :src="featured.image_url" />
          <video v-else-if="media === 'video' && (featured.local_path || featured.video_url)" :src="mediaUrl(featured)" controls />
          <div v-else class="empty-result"><b>{{ statusText(featured.status) }}</b><small>{{ featured.error_msg || '任务已保存，结果会在这里显示。' }}</small></div>
          <footer><span>{{ statusText(featured.status) }}</span><b>{{ featured.prompt || '尚未填写提示词' }}</b><small>{{ formatDate(featured.updated_at) }}</small></footer>
        </div>
        <div v-else class="empty-result"><strong>{{ media === 'image' ? '▣' : '▶' }}</strong><b>结果会显示在这里</b><small>提交后，任务状态、成片与失败原因都会持续保留。</small></div>
        <div v-if="featured?.status === 'completed'" class="result-actions">
          <el-button :loading="importing" @click="importAsset">导入素材库</el-button>
          <el-button v-if="media === 'video'" type="primary" :loading="importing" @click="continueOmni">带入全能创作</el-button>
        </div>
      </section>
      <aside class="generation-history">
        <div class="history-heading"><h2><i>02</i> 生成历史</h2><el-button text @click="load">刷新</el-button></div>
        <button v-for="item in items" :key="item.id" class="history-card" :class="{ active: featured?.id === item.id }" @click="featured = item">
          <img v-if="media === 'image' && item.image_url" :src="item.image_url" />
          <video v-else-if="media === 'video' && (item.local_path || item.video_url)" :src="mediaUrl(item)" muted preload="metadata" />
          <span v-else>●</span><div><b>{{ statusText(item.status) }} · #{{ item.id }}</b><small>{{ item.prompt || '未命名生成' }}</small><em>{{ formatDate(item.updated_at) }}</em></div>
        </button>
        <p v-if="!items.length" class="history-empty">暂无生成记录</p>
      </aside>
    </section>
  </main>
</template>
<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'
import { imagesAPI } from '@/api/images'
import { videosAPI } from '@/api/videos'
import ToolAssetSelector from '@/components/ToolAssetSelector.vue'
import GenerationSettings from '@/components/GenerationSettings.vue'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'
import { formatChinaDateTime } from '@/utils/time'
const props = defineProps({ media: { type: String, required: true } })
const router = useRouter(), prompt = ref(''), model = ref(''), reference = ref(''), selectedAssetId = ref(null), firstFrameAssetId = ref(null), lastFrameAssetId = ref(null), firstFrameAssetUrl = ref(''), lastFrameAssetUrl = ref(''), videoSettings = ref({ video_model: 'auto', duration: 15, resolution: '720p', aspect_ratio: '16:9' }), running = ref(false), importing = ref(false), items = ref([]), mode = ref('text'), featured = ref(null)
const modes = computed(() => props.media === 'image' ? [
  { label:'文生图', value:'text', hint:'从文字开始构图', rule:'不需要参考素材' }, { label:'单图生图', value:'image', hint:'基于一张图再创作', rule:'填写一张参考素材 URL' }, { label:'多参考生图', value:'multi', hint:'融合多个参考元素', rule:'用英文逗号分隔多个 URL' }, { label:'组生组图', value:'batch', hint:'共享风格批量出图', rule:'用提示词逐项创建' },
] : [
  { label:'文生视频', value:'text', hint:'仅用提示词生成镜头', rule:'不需要参考素材' }, { label:'图生视频', value:'image', hint:'由一张图片驱动镜头', rule:'填写一张图片 URL' }, { label:'首尾帧生视频', value:'first_last', hint:'锁定镜头起点与终点', rule:'填写“首帧 URL, 尾帧 URL”' }, { label:'多参考生视频', value:'multi', hint:'编排多种参考素材', rule:'用英文逗号分隔参考 URL' },
])
const selectedMode = computed(() => modes.value.find((item) => item.value === mode.value) || modes.value[0])
const statusText = (status) => ({ pending:'排队中', processing:'生成中', completed:'已完成', failed:'生成失败' }[status] || status || '草稿')
const mediaUrl = (item) => item?.local_path ? `/static/${item.local_path}` : item?.video_url || ''
const applySelectedAsset = (asset) => { reference.value = asset?.local_path || asset?.url || '' }
const applyFirstFrame = (asset) => { firstFrameAssetUrl.value = asset?.local_path || asset?.url || '' }
const applyLastFrame = (asset) => { lastFrameAssetUrl.value = asset?.local_path || asset?.url || '' }
const formatDate = (value) => formatChinaDateTime(value)
async function load() { const out = props.media === 'image' ? await imagesAPI.list({ page_size:30, drama_id:0 }) : await videosAPI.list({ page_size:30, drama_id:0 }); items.value = out.items || out || []; featured.value = items.value.find((item) => item.id === featured.value?.id) || featured.value || items.value[0] || null }
async function submit() { if (!prompt.value.trim()) return ElMessage.warning('请输入提示词'); running.value = true; try { const refs = reference.value.split(',').map((item) => item.trim()).filter(Boolean); if (props.media === 'image') await imagesAPI.create({ drama_id:0, prompt:prompt.value, model:model.value || undefined, image_url:reference.value || undefined, reference_images:mode.value === 'multi' ? refs : undefined }); else { const settings = videoSettings.value || {}; const body = { drama_id:0, prompt:prompt.value, model:settings.video_model && settings.video_model !== 'auto' ? settings.video_model : undefined, duration:settings.duration, resolution:settings.resolution, aspect_ratio:settings.aspect_ratio }; if (mode.value === 'image') body.image_url = refs[0]; if (mode.value === 'multi') body.reference_image_urls = refs; if (mode.value === 'first_last') { const first = firstFrameAssetUrl.value || refs[0], last = lastFrameAssetUrl.value || refs[1]; if (!first || !last) throw new Error('请选择或填写首帧与尾帧素材'); body.first_frame_url = first; body.last_frame_url = last } await videosAPI.create(body) } ElMessage.success('任务已提交，记录已保存'); await load() } catch (error) { ElMessage.error(error.message) } finally { running.value = false } }
async function importAsset() { importing.value = true; try { const path = props.media === 'image' ? `/assets/import/image/${featured.value.id}` : `/assets/import/video/${featured.value.id}`; const asset = await request.post(path); ElMessage.success('已导入素材库'); return asset } catch (error) { ElMessage.error(error.message); return null } finally { importing.value = false } }
async function continueOmni() { const asset = await importAsset(); if (asset?.id) router.push({ path:'/free-create', query:{ asset_id:asset.id } }) }
watch(() => props.media, () => { featured.value = null; load() }); onMounted(load)
</script>
<style scoped>
.media-tool{min-height:100vh;padding:22px 28px;background:#f5f5f5;color:#262626}.media-header,.media-layout{max-width:1380px;margin:auto}.media-header{display:flex;justify-content:space-between;align-items:end;padding-bottom:20px;border-bottom:1px solid #e5e5e5}.media-header p,.control-panel small,.history-empty{margin:4px 0 0;color:#737373;font-size:12px}.title-wrap{display:flex;gap:12px;align-items:center}.title-wrap>span{display:grid;place-items:center;width:36px;height:36px;background:#171717;color:#fff;border-radius:7px}.title-wrap h1,.stage-heading h2{margin:0;font-size:22px}.media-layout{display:grid;grid-template-columns:300px minmax(420px,1fr) 280px;gap:12px;margin-top:16px}.control-panel,.preview-stage,.generation-history{border:1px solid #e5e5e5;border-radius:8px;background:#fff;padding:16px}.control-panel{display:grid;align-content:start;gap:13px}.control-panel h2,.history-heading h2{margin:0;font-size:14px}.control-panel h2 i,.history-heading i{display:inline-grid;place-items:center;width:23px;height:23px;margin-right:8px;border-radius:5px;background:#171717;color:#fff;font-size:10px;font-style:normal}.control-panel label{display:grid;gap:6px;font-size:12px}.mode-info{display:grid;gap:4px;margin:0;padding:10px;border-left:2px solid #171717;background:#fafafa;font-size:12px}.mode-info span{color:#737373}.control-panel :deep(.el-button--primary),.result-actions :deep(.el-button--primary){--el-button-bg-color:#171717;--el-button-border-color:#171717;--el-button-text-color:#fff;--el-button-hover-bg-color:#404040;--el-button-hover-border-color:#404040}.preview-stage{min-height:610px;display:flex;flex-direction:column}.stage-heading,.history-heading{display:flex;justify-content:space-between;align-items:center}.stage-heading p{margin:0 0 3px;color:#737373;font-size:10px;letter-spacing:.1em}.status-key{color:#737373;font-size:10px}.featured,.empty-result{position:relative;flex:1;min-height:400px;margin-top:14px;border:1px solid #e5e5e5;background:#111;display:flex;align-items:center;justify-content:center;overflow:hidden}.featured img,.featured video{width:100%;height:100%;object-fit:contain}.featured footer{position:absolute;right:0;bottom:0;left:0;display:grid;gap:3px;padding:12px;background:#111;color:#fff;font-size:12px}.featured footer span{width:max-content;padding:2px 6px;background:#262626;border-radius:4px;font-size:10px}.featured footer small{color:#a3a3a3}.empty-result{flex-direction:column;gap:9px;background:#fafafa;color:#737373;text-align:center}.empty-result strong{font-size:42px;color:#171717}.result-actions{display:flex;gap:8px;margin-top:12px}.generation-history{display:grid;align-content:start;gap:8px;max-height:calc(100vh - 128px);overflow:auto}.history-card{display:grid;grid-template-columns:72px 1fr;gap:8px;padding:7px;border:1px solid #e5e5e5;border-radius:7px;background:#fff;text-align:left;cursor:pointer}.history-card.active,.history-card:hover{border-color:#171717;box-shadow:inset 2px 0 0 #171717}.history-card img,.history-card video,.history-card>span{width:72px;height:58px;object-fit:cover;background:#171717;color:#fff;display:grid;place-items:center;border-radius:4px}.history-card b,.history-card small,.history-card em{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-card b{font-size:11px}.history-card small,.history-card em{margin-top:3px;color:#737373;font-size:10px;font-style:normal}@media(max-width:1050px){.media-layout{grid-template-columns:280px minmax(360px,1fr)}.generation-history{grid-column:1/-1;grid-template-columns:repeat(3,1fr);max-height:240px}.history-heading{grid-column:1/-1}}@media(max-width:760px){.media-tool{padding:16px}.media-header{align-items:flex-start;flex-direction:column}.media-layout{grid-template-columns:1fr}.preview-stage{min-height:460px}.generation-history{grid-column:auto;grid-template-columns:1fr;max-height:300px}.history-heading{grid-column:auto}}
/* Keep this specialist tool on the same monochrome workbench surface as the main workflow. */
.media-tool { background: var(--bg-page); color: var(--text-primary); }
.media-header { border-color: var(--border-subtle); }
.media-header p, .control-panel small, .history-empty, .mode-info span,
.stage-heading p, .status-key, .empty-result, .history-card small, .history-card em { color: var(--text-muted); }
.title-wrap > span, .control-panel h2 i, .history-heading i { background: var(--bg-elevated); color: var(--text-primary); }
.control-panel, .preview-stage, .generation-history, .history-card { background: var(--bg-surface); border-color: var(--border-color); }
.mode-info { background: var(--bg-raised); border-left-color: var(--border-strong); }
.control-panel :deep(.el-button--primary), .result-actions :deep(.el-button--primary) {
  --el-button-bg-color: var(--accent); --el-button-border-color: var(--accent); --el-button-text-color: var(--accent-contrast);
  --el-button-hover-bg-color: var(--accent-hover); --el-button-hover-border-color: var(--accent-hover);
}
.featured, .empty-result { border-color: var(--border-color); }
.empty-result { background: var(--bg-raised); }
.empty-result strong { color: var(--text-primary); }
.featured footer { background: rgba(8, 12, 18, .92); color: var(--text-primary); }
.featured footer span { background: var(--bg-elevated); }
.featured footer small { color: var(--text-muted); }
.history-card.active, .history-card:hover { border-color: var(--accent); box-shadow: inset 2px 0 0 var(--accent); }
.history-card img, .history-card video, .history-card > span { background: var(--bg-elevated); color: var(--text-primary); }
.media-tool { display:grid; grid-template-rows:auto minmax(0,1fr); width:100%; height:100vh; height:100dvh; min-height:0; padding:1.4rem 1.8rem; overflow:hidden; }
.media-layout { width:100%; max-width:1500px; min-height:0; margin-top:1rem; grid-template-columns:19rem minmax(28rem,1fr) 18rem; }.control-panel,.preview-stage,.generation-history { min-height:0; }.control-panel,.generation-history { overflow-y:auto; overscroll-behavior:contain; }.preview-stage { min-height:0; }.featured,.empty-result { min-height:0; }
@media(max-width:1050px){.media-layout{grid-template-columns:18rem minmax(0,1fr);overflow-y:auto}.generation-history{max-height:15rem}}@media(max-width:760px){.media-tool{height:100dvh;overflow:hidden}.media-layout{grid-template-columns:1fr}.preview-stage{min-height:28rem}}
</style>
