<template>
  <main class="login-page" :class="{ dark: isDark }">
    <button class="theme-toggle" type="button" :aria-label="isDark ? '切换亮色模式' : '切换暗色模式'" @click="toggleTheme">
      {{ isDark ? '☀' : '☾' }}
    </button>
    <section class="login-card">
      <div class="brand-mark"><i></i><i></i><i></i></div>
      <p class="brand">LOCAL MINIDRAMA</p>
      <h1>{{ mode === 'login' ? '欢迎回来' : '创建账号' }}</h1>
      <p class="subtitle">{{ mode === 'login' ? '登录后继续创作' : '注册后即可开始创作' }}</p>

      <el-form class="login-form" :model="form" @submit.prevent="submit">
        <el-form-item v-if="mode === 'register'">
          <el-input v-model.trim="form.display_name" size="large" autocomplete="name" placeholder="昵称（可选）" />
        </el-form-item>
        <el-form-item>
          <el-input v-model.trim="form.username" size="large" autocomplete="username" placeholder="用户名" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" size="large" type="password" show-password autocomplete="current-password" placeholder="密码" @keyup.enter="submit" />
        </el-form-item>
        <el-button type="primary" class="submit" size="large" :loading="loading" @click="submit">
          {{ loading ? '处理中…' : (mode === 'login' ? '登录' : '注册') }}
        </el-button>
      </el-form>
      <button class="mode-switch" type="button" @click="mode = mode === 'login' ? 'register' : 'login'">
        {{ mode === 'login' ? '没有账号？注册' : '已有账号？登录' }}
      </button>
    </section>
  </main>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import request from '@/utils/request'
import { useTheme } from '@/composables/useTheme'

const router = useRouter()
const route = useRoute()
const loading = ref(false)
const mode = ref('login')
const form = reactive({ username: '', password: '', display_name: '' })
const { isDark, toggle: toggleTheme } = useTheme()

async function submit () {
  if (!form.username || !form.password || loading.value) return
  loading.value = true
  try {
    const data = await request.post(`/auth/${mode.value}`, form)
    localStorage.setItem('lmd_auth_token', data.token)
    localStorage.setItem('lmd_auth_user', JSON.stringify(data.user))
    router.replace(typeof route.query.redirect === 'string' ? route.query.redirect : '/')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page{--page:#f4f6fb;--card:#fff;--text:#1f2940;--muted:#8991a5;--field:#f6f7fb;--border:#e8ebf2;--shadow:0 22px 55px rgba(35,45,71,.12);min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--page);color:var(--text);font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;transition:background .25s,color .25s}.login-page.dark{--page:#0e1323;--card:#171d30;--text:#f5f7ff;--muted:#98a1ba;--field:#20283c;--border:#2d3650;--shadow:0 24px 65px rgba(0,0,0,.35);background:radial-gradient(circle at 50% -10%,#2d386f 0%,#12182a 39%,#0e1323 75%)}
.theme-toggle{position:fixed;top:24px;right:28px;width:38px;height:38px;border:1px solid var(--border);border-radius:50%;background:var(--card);color:var(--text);font-size:18px;line-height:1;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.06);transition:.2s}.theme-toggle:hover{transform:translateY(-2px);border-color:#7b73eb}
.login-card{width:min(100%,380px);padding:44px 40px 40px;border:1px solid var(--border);border-radius:18px;background:var(--card);box-shadow:var(--shadow);text-align:center}.brand-mark{display:flex;align-items:flex-end;justify-content:center;gap:4px;height:28px;margin-bottom:14px}.brand-mark i{width:7px;border-radius:5px;background:linear-gradient(#7469ef,#4b95f0)}.brand-mark i:nth-child(1){height:13px}.brand-mark i:nth-child(2){height:21px}.brand-mark i:nth-child(3){height:28px}.brand{margin:0;color:#7971ed;font-size:10px;font-weight:700;letter-spacing:.19em}.login-card h1{margin:24px 0 7px;font-size:27px;letter-spacing:-.035em}.subtitle{margin:0;color:var(--muted);font-size:13px}.login-form{margin-top:32px}.login-form :deep(.el-form-item){margin-bottom:15px}.login-form :deep(.el-input__wrapper){min-height:47px;border-radius:9px;background:var(--field);box-shadow:0 0 0 1px var(--border) inset}.login-form :deep(.el-input__wrapper.is-focus){background:var(--card);box-shadow:0 0 0 2px #766cf1 inset}.submit{width:100%;height:47px;margin-top:5px;border:0;border-radius:9px;background:linear-gradient(105deg,#6559e8,#578cf0);font-weight:600;box-shadow:0 10px 18px rgba(92,91,227,.24)}.submit:hover{background:linear-gradient(105deg,#594cde,#487fe8)}
.mode-switch{margin-top:20px;padding:0;border:0;background:none;color:#756cea;font-size:13px;cursor:pointer}.mode-switch:hover{text-decoration:underline}
@media (max-width:480px){.login-page{padding:18px}.login-card{padding:40px 27px 32px}.theme-toggle{top:17px;right:18px}}
</style>
