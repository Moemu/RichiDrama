<template>
  <section v-if="permissions.can_manage" class="project-danger-zone">
    <h2>危险选项</h2>
    <div class="danger-row">
      <div><h3>转让项目负责人</h3><p>接任成员将获得成员管理和项目删除权限。你将保留编辑权限。已有任务和计费归属不变。</p></div>
      <el-button plain type="danger" :disabled="!candidates.length" @click="transferVisible = true">转让负责人</el-button>
    </div>
    <p v-if="!candidates.length" class="danger-hint">{{ permissions.collaboration_enabled ? '请先添加接任成员。' : '请先启用共同编辑，并添加接任成员。' }}</p>
    <div class="danger-row">
      <div><h3>删除项目</h3><p>删除后，所有成员都将无法访问此项目。此处不能撤销。</p></div>
      <el-button plain type="danger" :loading="deleting" @click="removeProject">删除项目</el-button>
    </div>
    <el-dialog v-model="transferVisible" title="转让项目负责人" width="min(480px, calc(100vw - 24px))" :close-on-click-modal="!transferring" :show-close="!transferring" :close-on-press-escape="!transferring">
      <p>选择接任成员。转让后，你不能再管理成员或删除项目。</p>
      <el-select v-model="targetId" placeholder="选择接任成员" aria-label="接任成员" style="width:100%"><el-option v-for="member in candidates" :key="member.id" :value="member.id" :label="`${member.display_name || member.username}（${member.username}）`" /></el-select>
      <template #footer><el-button :disabled="transferring" @click="transferVisible = false">取消</el-button><el-button type="danger" :disabled="!targetId" :loading="transferring" @click="transfer">确认转让</el-button></template>
    </el-dialog>
  </section>
</template>
<script setup>
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import { dramaAPI } from '@/api/drama'
const props = defineProps({ dramaId: { type: [Number, String], required: true }, title: { type: String, default: '' }, permissions: { type: Object, default: () => ({}) }, members: { type: Array, default: () => [] } })
const emit = defineEmits(['updated'])
const router = useRouter()
const candidates = computed(() => props.permissions.collaboration_enabled ? props.members.filter(member => member.role !== 'owner') : [])
const transferVisible = ref(false); const targetId = ref(null); const transferring = ref(false); const deleting = ref(false)
async function transfer() {
  if (!targetId.value || transferring.value) return
  transferring.value = true
  try {
    await request.post(`/dramas/${props.dramaId}/collaboration/transfer`, { user_id: targetId.value })
    transferVisible.value = false
    ElMessage.success('项目负责人已转让，你仍可编辑项目')
    emit('updated')
  } catch (error) { ElMessage.error(error.message || '转让失败') } finally { transferring.value = false }
}
async function removeProject() {
  try {
    await ElMessageBox.prompt(`请输入项目名称“${props.title}”以确认删除。`, '删除项目', {
      confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning',
      inputValidator: value => value === props.title || '项目名称不匹配',
    })
  } catch { return }
  deleting.value = true
  try { await dramaAPI.delete(props.dramaId); ElMessage.success('项目已删除'); await router.push('/') }
  catch (error) { ElMessage.error(error.message || '删除失败') } finally { deleting.value = false }
}
</script>
<style scoped>
.project-danger-zone{margin-top:24px;padding:24px;border:1px solid color-mix(in srgb,var(--el-color-danger) 40%,var(--border-subtle));border-radius:12px;background:var(--bg-surface)}h2{margin:0 0 4px;font-size:17px;color:var(--el-color-danger)}h3{margin:0;font-size:14px}p{margin:8px 0 0;color:var(--text-muted);line-height:1.6}.danger-row{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:20px 0}.danger-row+.danger-row{border-top:1px solid var(--border-subtle)}.danger-row>div{min-width:0}.danger-row>.el-button{flex-shrink:0}.danger-hint{margin:0 0 16px;font-size:13px}@media(max-width:600px){.project-danger-zone{padding:16px}.danger-row{align-items:flex-start;flex-direction:column;gap:12px}}
</style>
