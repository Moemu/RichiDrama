<template>
  <div class="email-recovery">
    <p v-if="binding">当前邮箱：{{ boundEmail || '未绑定' }}。验证后可用于找回密码。</p>
    <p v-if="loading" role="status">正在检查邮件服务…</p>
    <el-alert v-else-if="!enabled" title="邮件功能暂不可用，请联系管理员。" type="warning" :closable="false" />
    <form v-if="enabled" @submit.prevent="submit">
      <label>邮箱<input v-model.trim="form.email" type="email" autocomplete="email" required maxlength="254"></label>
      <label v-if="binding">当前密码<input v-model="form.password" type="password" autocomplete="current-password" required></label>
      <div class="code-row">
        <label>邮箱验证码<input v-model="form.code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
        <el-button :disabled="busy || sending || remaining > 0 || !form.email || (binding && !form.password)" :loading="sending" @click="sendCode">{{ remaining ? `${remaining} 秒后重发` : '发送验证码' }}</el-button>
      </div>
      <template v-if="!binding">
        <label>新密码<input v-model="form.new_password" type="password" autocomplete="new-password" required><small>8–128 个字符</small></label>
        <label>确认新密码<input v-model="confirmation" type="password" autocomplete="new-password" required></label>
      </template>
      <p role="status" aria-live="polite">{{ status }}</p>
      <el-button type="primary" native-type="submit" :loading="busy" :disabled="sending">{{ binding ? '验证并保存邮箱' : '重置密码' }}</el-button>
    </form>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { accountAPI } from '@/api/account'
import { newPasswordError } from '@/utils/passwordRecovery'

const props = defineProps({ binding: Boolean })
const emit = defineEmits(['complete'])
const form = reactive({ email: '', password: '', code: '', new_password: '' })
const confirmation = ref('')
const boundEmail = ref('')
const loading = ref(true), enabled = ref(false), busy = ref(false), sending = ref(false)
const status = ref(''), remaining = ref(0)
let deadline = 0
const timer = setInterval(() => { remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) }, 500)
onBeforeUnmount(() => clearInterval(timer))
onMounted(async () => {
  try {
    const data = await (props.binding ? accountAPI.email() : accountAPI.recoveryOptions())
    enabled.value = data.email_enabled
    boundEmail.value = data.email || ''
  } catch (_) { enabled.value = false }
  finally { loading.value = false }
})
async function sendCode() {
  sending.value = true
  try {
    const data = await (props.binding ? accountAPI.sendEmailCode : accountAPI.sendPasswordResetCode)({ email: form.email, password: form.password })
    status.value = data.message
    deadline = Date.now() + 60000
    remaining.value = 60
  } catch (error) { status.value = error.message }
  finally { sending.value = false }
}
async function submit() {
  if (!props.binding) {
    const error = newPasswordError(form.new_password, confirmation.value)
    if (error) { status.value = error; return }
  }
  busy.value = true
  try {
    const data = await (props.binding ? accountAPI.confirmEmail : accountAPI.confirmPasswordReset)({ ...form })
    status.value = data.message
    if (props.binding) boundEmail.value = form.email.trim().toLowerCase()
    form.password = ''; form.code = ''; form.new_password = ''; confirmation.value = ''
    emit('complete')
  } catch (error) { status.value = error.message }
  finally { busy.value = false }
}
</script>

<style scoped>
.email-recovery{min-width:0}.email-recovery p{line-height:1.6;overflow-wrap:anywhere;color:var(--text-secondary)}
form{display:grid;gap:16px;margin-top:18px;min-width:0}label{display:grid;gap:8px;min-width:0;font-size:14px}input{width:100%;min-width:0;min-height:42px;padding:10px 12px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-surface);color:var(--text-primary);font:inherit}input:focus-visible{outline:2px solid var(--accent-teal);outline-offset:2px}small{color:var(--text-muted)}.code-row{display:flex;align-items:end;gap:12px}.code-row label{flex:1}.code-row .el-button{min-height:42px}form>p{margin:0}form>.el-button{justify-self:start}
@media(max-width:420px){.code-row{align-items:stretch;flex-direction:column}.code-row .el-button{align-self:start}}
</style>
