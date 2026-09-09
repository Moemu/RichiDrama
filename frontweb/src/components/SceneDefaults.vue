<template>
  <section class="scene-defaults" aria-label="业务默认模型" v-loading="loading">
    <h2>业务默认模型</h2>
    <p>为不同用途选择模型。角色、场景、道具图和分镜图可共用图片连接。创作时手动选择的模型优先。</p>
    <p v-if="error" role="alert" class="defaults-error">{{ error }}</p>
    <div class="defaults-grid">
      <article v-for="scene in scenes" :key="scene.type">
        <h3>{{ scene.label }}</h3><p>{{ scene.note }}</p>
        <el-select v-model="selection[scene.type]" :aria-label="`${scene.label}默认模型`" filterable clearable placeholder="沿用现有默认模型" :disabled="saving === scene.type">
          <el-option-group v-for="group in options(scene.type)" :key="group.id" :label="group.name">
            <el-option v-for="option in group.options" :key="option.value" :value="option.value" :label="`${option.label} · ${group.name}`" />
          </el-option-group>
        </el-select>
        <footer><span>{{ current[scene.key]?.routing_version === version ? '已配置场景默认' : '沿用现有配置' }}</span><el-button :loading="saving === scene.type" :disabled="saving !== null" @click="save(scene)">保存</el-button></footer>
      </article>
    </div>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { aiAPI } from '@/api/ai'
import { sceneModelMapAPI as api } from '@/api/sceneModelMap'
import { providerGroups, resolveProviderConfig } from '@/utils/providerModelSelection'
const version = 'capability-default-v1'
const scenes = [
  { type: 'text', key: 'default_text_generation', label: '文本任务', note: '具体文本场景可在下方单独覆盖。' },
  { type: 'image', key: 'default_resource_image_generation', label: '角色、场景与道具图片', note: '使用图片能力的模型。' },
  { type: 'storyboard_image', key: 'default_storyboard_image_generation', label: '分镜图片', note: '可选择共享图片连接，无需重复填写凭据。' },
  { type: 'video', key: 'default_video_generation', label: '视频任务', note: '只影响未手动指定模型的新请求。' },
]
const configs = ref([]); const current = ref({}); const selection = ref({}); const loading = ref(false); const saving = ref(null); const error = ref('')
function options(type) {
  const currentId = selection.value[type] ? JSON.parse(selection.value[type])[0] : null
  return providerGroups(configs.value, type, true).map(group => ({ ...group, options: group.models.map(model => ({ value: JSON.stringify([resolveProviderConfig(group, model, type, currentId).id, model]), label: model })) }))
}
async function load() {
  loading.value = true; error.value = ''
  try {
    const [connections, maps] = await Promise.all([aiAPI.list(null, { platform: true }), api.list()]); configs.value = connections.filter(config => !config.owner_tenant_id); current.value = Object.fromEntries(maps.map(row => [row.key, row]))
    selection.value = Object.fromEntries(scenes.map(scene => { const row = current.value[scene.key]; return [scene.type, row?.routing_version === version ? JSON.stringify([row.config_id, row.model_override]) : ''] }))
  } catch (e) { error.value = e.message || '读取默认模型失败' } finally { loading.value = false }
}
async function save(scene) {
  saving.value = scene.type; error.value = ''
  try {
    const existing = current.value[scene.key]
    if (existing && existing.routing_version !== version) throw new Error('此场景键已有旧记录，已保留原设置，请先检查下方业务场景')
    if (!selection.value[scene.type]) { if (existing) await api.delete(scene.key) }
    else {
      const [config_id, model_override] = JSON.parse(selection.value[scene.type]); const body = { key: scene.key, service_type: scene.type, config_id, model_override, routing_version: version, description: scene.label }
      if (existing) await api.update(scene.key, body); else await api.create(body)
    }
    await load(); ElMessage.success('业务默认模型已保存')
  } catch (e) { error.value = e.message || '保存失败' } finally { saving.value = null }
}
onMounted(load)
</script>

<style scoped>
.scene-defaults{margin-bottom:2rem}.scene-defaults h2{margin:0 0 .6rem}.scene-defaults p{color:var(--text-muted);line-height:1.6;margin:.4rem 0 1rem}.defaults-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.defaults-grid article{border:1px solid var(--el-border-color);border-radius:10px;padding:1rem;min-width:0}.defaults-grid h3{margin:0;font-size:16px}.defaults-grid .el-select{width:100%}.defaults-grid footer{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-top:1rem}.defaults-grid footer span{font-size:12px;color:var(--text-muted)}.defaults-error{color:var(--el-color-danger)!important}@media(max-width:600px){.defaults-grid{grid-template-columns:minmax(0,1fr)}}
</style>
