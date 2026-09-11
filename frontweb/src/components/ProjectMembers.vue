<template>
  <section class="project-members">
    <div class="members-heading"><h2>项目成员</h2><template v-if="permissions.can_manage"><el-button v-if="permissions.collaboration_enabled" :loading="busy" @click="disable">关闭协作</el-button><el-button v-else :loading="busy" @click="enable">启用共同编辑</el-button></template></div>
    <p>编辑成员可以共同修改全部分集与制作资源。AI 生成使用发起人自己的额度。</p>
    <p v-if="!permissions.collaboration_enabled">协作已关闭，仅负责人可访问。成员名单已保留，重新启用后恢复访问。</p>
    <form v-if="permissions.can_manage && permissions.collaboration_enabled" class="member-add" @submit.prevent="save">
      <el-input v-model="username" aria-label="成员用户名" placeholder="输入准确用户名" maxlength="64" />
      <el-select v-model="role" aria-label="成员权限"><el-option label="编辑成员" value="editor"/><el-option label="只读成员" value="viewer"/></el-select>
      <el-button type="primary" native-type="submit" :loading="busy" :disabled="!username.trim()">添加成员</el-button>
    </form>
    <ul><li v-for="member in members" :key="member.id"><span><b>{{ member.display_name || member.username }}</b><small>{{ member.username }}</small></span><span>{{ labels[member.role] }}</span><div v-if="permissions.can_manage && permissions.collaboration_enabled && member.role !== 'owner'" class="member-actions"><el-button text @click="changeRole(member)">{{ member.role === 'editor' ? '设为只读' : '设为编辑' }}</el-button><el-button text type="danger" @click="remove(member)">移除</el-button></div></li></ul>
  </section>
</template>
<script setup>
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'
import { savePendingProjectText, closeProjectSession, hasUnsavedProjectText } from '@/composables/useProjectCollaboration'
const props = defineProps({ dramaId: { type: [Number, String], required: true }, permissions: { type: Object, default: () => ({}) }, members: { type: Array, default: () => [] } })
const emit = defineEmits(['updated'])
const username = ref(''); const role = ref('editor'); const busy = ref(false)
const labels = { owner: '负责人', editor: '编辑成员', viewer: '只读成员' }
async function run(fn) { busy.value = true; try { await fn(); emit('updated') } catch(error) { ElMessage.error(error.message) } finally { busy.value = false } }
function save() { return run(async () => { await request.put(`/dramas/${props.dramaId}/collaboration/members`, { username: username.value.trim(), role: role.value }); username.value = '' }) }
function enable() { return run(() => request.post(`/dramas/${props.dramaId}/collaboration/enable`, {})) }
async function disable() {
  try { await ElMessageBox.confirm('关闭后，仅负责人可以访问和编辑项目。已保存内容、成员名单和已有任务都会保留；重新启用后成员恢复访问。请先让成员确认各自的修改已保存。', '关闭协作', { type: 'warning', confirmButtonText: '关闭协作', cancelButtonText: '取消' }) } catch { return }
  await run(async () => {
    await savePendingProjectText()
    await request.post(`/dramas/${props.dramaId}/collaboration/disable`, {}, { errorHandledLocally: true })
    if (hasUnsavedProjectText()) throw new Error('协作已关闭，但此页面还有未保存文字。请先复制备份，再刷新页面。')
    closeProjectSession()
    ElMessage.success('协作已关闭')
  })
}
function changeRole(member) { return run(() => request.put(`/dramas/${props.dramaId}/collaboration/members`, { username: member.username, role: member.role === 'editor' ? 'viewer' : 'editor' })) }
async function remove(member) { try { await ElMessageBox.confirm(`移除 ${member.display_name || member.username} 后，该成员将无法访问此项目。已提交的生成任务继续执行。`, '移除成员', { type: 'warning' }) } catch { return }; await run(() => request.delete(`/dramas/${props.dramaId}/collaboration/members/${member.id}`)) }
</script>
<style scoped>
.members-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:17px}p{color:var(--text-muted);line-height:1.6}.member-add{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.member-add>.el-input{flex:1;min-width:180px}.member-add>.el-select{width:140px}ul{list-style:none;padding:0;margin:0}li{display:flex;align-items:center;gap:20px;padding:14px 0;border-bottom:1px solid var(--border-subtle)}li>span:first-child{flex:1;min-width:0}b,small{display:block;overflow-wrap:anywhere}small{color:var(--text-muted);margin-top:4px}.member-actions{display:flex;flex-wrap:wrap}@media(max-width:600px){li{flex-wrap:wrap;gap:10px}.member-actions{width:100%}}
</style>
