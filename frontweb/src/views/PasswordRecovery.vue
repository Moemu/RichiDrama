<template>
  <main class="recovery-page">
    <section class="recovery-card">
      <p class="brand">瑞池传媒 · 账号安全</p>
      <h1>{{ forced ? '设置新的登录密码' : '找回密码' }}</h1>
      <template v-if="forced">
        <p>你正在使用管理员提供的临时密码。请先设置自己的密码，再进入创作台。</p>
        <form @submit.prevent="changePassword">
          <label>临时密码<input v-model="password.old_password" type="password" autocomplete="current-password" required></label>
          <label>新密码<input v-model="password.new_password" type="password" autocomplete="new-password" required><small>8–128 个字符，不能与临时密码相同</small></label>
          <label>确认新密码<input v-model="confirmation" type="password" autocomplete="new-password" required></label>
          <p role="status">{{ status }}</p>
          <el-button native-type="submit" type="primary" :loading="busy">保存密码并重新登录</el-button>
        </form>
        <el-button class="back" @click="logout">退出登录</el-button>
      </template>
      <template v-else-if="complete">
        <p role="status">密码已重置，请使用新密码登录。</p>
        <router-link to="/login">返回登录</router-link>
      </template>
      <template v-else>
        <p>通过已验证的邮箱重置密码。未绑定邮箱的创作账号，请联系管理员。</p>
        <EmailRecoveryForm @complete="resetComplete" />
        <router-link class="back" to="/login">返回登录</router-link>
      </template>
    </section>
  </main>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import request from '@/utils/request'
import { accountAPI } from '@/api/account'
import EmailRecoveryForm from '@/components/EmailRecoveryForm.vue'
import { clearPasswordSession, newPasswordError } from '@/utils/passwordRecovery'
const route = useRoute(), router = useRouter()
const forced = computed(() => route.path === '/change-password')
const password = reactive({ old_password: '', new_password: '' })
const confirmation = ref(''), status = ref(''), busy = ref(false), complete = ref(false)
function resetComplete() { clearPasswordSession(); complete.value = true }
async function changePassword() {
  status.value = newPasswordError(password.new_password, confirmation.value)
  if (status.value) return
  busy.value = true
  try {
    await accountAPI.changePassword(password)
    clearPasswordSession()
    await router.replace('/login')
  } catch (error) { status.value = error.message }
  finally { busy.value = false }
}
async function logout() {
  try { await request.post('/auth/logout') } catch (_) {}
  clearPasswordSession(); await router.replace('/login')
}
</script>

<style scoped>
.recovery-page{min-height:100dvh;padding:48px 20px;background:radial-gradient(ellipse at top right,color-mix(in srgb,var(--accent-teal) 12%,transparent),transparent 60%),var(--bg-page)}.recovery-card{max-width:520px;margin:0 auto;padding:32px;border:1px solid var(--border-subtle);border-radius:18px;background:var(--bg-surface);overflow-wrap:anywhere}.brand{font-size:13px;color:var(--text-muted)}h1{font-size:26px}p{line-height:1.7}form{display:grid;gap:18px;margin:24px 0}label{display:grid;gap:8px;font-size:14px}input{width:100%;min-width:0;padding:12px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-page);color:var(--text-primary);font:inherit}small{color:var(--text-muted)}.back{display:inline-block;margin-top:24px}a{color:var(--accent-teal)}
@media(max-width:560px){.recovery-page{padding:24px 14px}.recovery-card{padding:22px 18px}}
</style>
