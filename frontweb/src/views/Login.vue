<template>
  <main
    class="login-page"
    :class="{ 'is-light': !isDark }"
    :style="spotlightStyle"
    @pointermove="handlePointerMove"
    @pointerleave="resetSpotlight"
  >
    <a class="skip-link" href="#login-form">跳到登录表单</a>

    <div class="cinema-backdrop" aria-hidden="true">
      <div class="cinema-image"></div>
      <div class="cinema-wash"></div>
      <div class="cinema-grid"></div>
      <div class="cinema-grain"></div>
      <div class="pointer-glow"></div>
    </div>

    <header class="product-header">
      <a class="brand-lockup" href="/" aria-label="瑞池传媒短剧平台首页">
        <span class="richi-brand-mark" aria-hidden="true"><img src="/brand/richi-logo-color.png" alt="" /></span>
        <span>
          <strong>瑞池传媒短剧平台</strong>
          <small>RICH MEDIA · AI DRAMA</small>
        </span>
      </a>

      <button
        class="theme-toggle"
        type="button"
        :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
        :title="isDark ? '切换到浅色模式' : '切换到深色模式'"
        @click="toggleTheme"
      >
        <Sun v-if="isDark" aria-hidden="true" />
        <Moon v-else aria-hidden="true" />
      </button>
    </header>

    <section class="story-stage" aria-labelledby="story-title">
      <p class="story-kicker"><span></span> AI 原生短剧创作产品</p>
      <h1 id="story-title">本地短剧<br><em>制作平台</em></h1>

      <ol class="creation-track" aria-label="短剧创作流程">
        <li v-for="(step, index) in creationSteps" :key="step.label" :class="{ active: activeStep === index }">
          <button type="button" :aria-label="`查看${step.label}阶段`" @click="activeStep = index">
            <span class="track-index">0{{ index + 1 }}</span>
            <span class="track-copy">
              <strong>{{ step.label }}</strong>
              <small>{{ step.detail }}</small>
            </span>
          </button>
        </li>
      </ol>

      <p class="scene-status" aria-live="polite">
        <span class="record-dot" aria-hidden="true"></span>
        {{ creationSteps[activeStep].status }}
      </p>
    </section>

    <section id="login-form" class="access-panel" aria-labelledby="access-title">
      <div class="panel-glow" aria-hidden="true"></div>
      <div class="panel-content">
        <p class="panel-eyebrow">STUDIO ACCESS <span>·</span> 01</p>
        <h2 id="access-title">{{ mode === 'login' ? '登录' : '注册' }}</h2>

        <div class="mode-tabs" role="tablist" aria-label="账号操作">
          <button
            id="login-tab"
            type="button"
            role="tab"
            :aria-selected="mode === 'login'"
            aria-controls="account-form"
            :tabindex="mode === 'login' ? 0 : -1"
            @click="setMode('login')"
          >登录</button>
          <button
            id="register-tab"
            type="button"
            role="tab"
            :aria-selected="mode === 'register'"
            aria-controls="account-form"
            :tabindex="mode === 'register' ? 0 : -1"
            @click="setMode('register')"
          >注册</button>
          <span class="tab-indicator" :class="{ register: mode === 'register' }" aria-hidden="true"></span>
        </div>

        <form
          id="account-form"
          class="login-form"
          role="tabpanel"
          :aria-labelledby="mode === 'login' ? 'login-tab' : 'register-tab'"
          :aria-busy="loading"
          novalidate
          @submit.prevent="submit"
        >
          <div v-if="mode === 'register'" class="field-row field-enter">
            <label for="display-name">创作者昵称 <span>选填</span></label>
            <div class="field-shell">
              <UserRound aria-hidden="true" />
              <input
                id="display-name"
                v-model.trim="form.display_name"
                type="text"
                name="display_name"
                autocomplete="name"
                placeholder="希望我们怎样称呼你"
              >
            </div>
          </div>

          <div class="field-row">
            <label for="username">用户名</label>
            <div class="field-shell" :class="{ invalid: submitted && !form.username }">
              <AtSign aria-hidden="true" />
              <input
                id="username"
                v-model.trim="form.username"
                type="text"
                name="username"
                autocomplete="username"
                placeholder="输入你的用户名"
                required
                :aria-invalid="submitted && !form.username"
                :aria-describedby="submitted && !form.username ? 'username-error' : undefined"
              >
            </div>
            <p v-if="submitted && !form.username" id="username-error" class="field-error" role="alert">请输入用户名</p>
          </div>

          <div class="field-row">
            <label for="password">密码</label>
            <div class="field-shell" :class="{ invalid: submitted && !form.password }">
              <LockKeyhole aria-hidden="true" />
              <input
                id="password"
                v-model="form.password"
                :type="showPassword ? 'text' : 'password'"
                name="password"
                :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
                placeholder="输入你的密码"
                required
                :aria-invalid="submitted && !form.password"
                :aria-describedby="submitted && !form.password ? 'password-error' : undefined"
              >
              <button
                class="password-toggle"
                type="button"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                @click="showPassword = !showPassword"
              >
                <EyeOff v-if="showPassword" aria-hidden="true" />
                <Eye v-else aria-hidden="true" />
              </button>
            </div>
            <p v-if="submitted && !form.password" id="password-error" class="field-error" role="alert">请输入密码</p>
          </div>

          <button class="submit-button" type="submit">
            <span v-if="loading" class="loading-mark" aria-hidden="true"></span>
            <span>{{ loading ? '正在进入片场…' : (mode === 'login' ? '进入创作现场' : '开启第一幕') }}</span>
            <ArrowUpRight v-if="!loading" aria-hidden="true" />
          </button>

          <p class="form-status" aria-live="polite">{{ statusMessage }}</p>
        </form>

        <div class="trust-row" aria-label="产品能力">
          <span><Sparkles aria-hidden="true" /> 全流程 AI 协作</span>
          <span><ShieldCheck aria-hidden="true" /> 本地资产守护</span>
        </div>
      </div>
    </section>

    <footer class="page-footer">
      <span>© 2026 瑞池传媒</span>
      <span>从第一句灵感，到最后一个镜头。</span>
    </footer>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowRight as ArrowUpRight,
  CircleCheck as ShieldCheck,
  Hide as EyeOff,
  Lock as LockKeyhole,
  MagicStick as Sparkles,
  Moon,
  Position as AtSign,
  Sunny as Sun,
  User as UserRound,
  View as Eye,
} from '@element-plus/icons-vue'
import request from '@/utils/request'
import { useTheme } from '@/composables/useTheme'
import { safeRedirectPath } from '@/utils/routeRecovery'

const router = useRouter()
const route = useRoute()
const loading = ref(false)
const submitted = ref(false)
const showPassword = ref(false)
const mode = ref('login')
const activeStep = ref(0)
const pointer = reactive({ x: 74, y: 48 })
const form = reactive({ username: '', password: '', display_name: '' })
const { isDark, toggle: toggleTheme } = useTheme()

const creationSteps = [
  { label: '灵感成形', detail: '一句话长成完整故事', status: '灵感引擎在线 · 等待你的第一句话' },
  { label: '世界建立', detail: '角色与场景保持一致', status: '角色与场景系统就绪 · 连续性已锁定' },
  { label: '镜头开拍', detail: '分镜自然流向成片', status: '生成片场就绪 · 下一镜由你决定' },
]

const spotlightStyle = computed(() => ({
  '--pointer-x': `${pointer.x}%`,
  '--pointer-y': `${pointer.y}%`,
}))

const statusMessage = computed(() => {
  if (loading.value) return mode.value === 'login' ? '正在验证账号并进入创作现场' : '正在创建账号并开启第一幕'
  if (submitted.value && (!form.username || !form.password)) return '请补全必填信息'
  return ''
})

let stepTimer

onMounted(() => {
  stepTimer = window.setInterval(() => {
    activeStep.value = (activeStep.value + 1) % creationSteps.length
  }, 5200)
})

onBeforeUnmount(() => window.clearInterval(stepTimer))

function setMode(nextMode) {
  mode.value = nextMode
  submitted.value = false
  showPassword.value = false
}

function handlePointerMove(event) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  pointer.x = Math.round((event.clientX / window.innerWidth) * 100)
  pointer.y = Math.round((event.clientY / window.innerHeight) * 100)
}

function resetSpotlight() {
  pointer.x = 74
  pointer.y = 48
}

async function submit() {
  submitted.value = true
  if (!form.username || !form.password || loading.value) return
  loading.value = true
  try {
    const data = await request.post(`/auth/${mode.value}`, form)
    localStorage.setItem('lmd_auth_token', data.token)
    localStorage.setItem('lmd_auth_user', JSON.stringify(data.user))
    await router.replace(safeRedirectPath(route.query.redirect, '/'))
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  --ink: #f7f2eb;
  --muted: rgba(235, 231, 226, .64);
  --faint: rgba(235, 231, 226, .4);
  --line: rgba(255, 255, 255, .13);
  --panel: rgba(6, 7, 9, .86);
  --field: rgba(255, 255, 255, .055);
  --accent-red: #ff4b37;
  --accent-warm: #f2aa68;
  --pointer-x: 74%;
  --pointer-y: 48%;
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  overflow: hidden;
  background: #050607;
  color: var(--ink);
  font-family: var(--font-sans);
  isolation: isolate;
}

.skip-link {
  position: fixed;
  inset-block-start: 12px;
  inset-inline-start: 12px;
  z-index: 30;
  padding: 10px 14px;
  border-radius: 999px;
  background: #fff;
  color: #111;
  font-weight: 700;
  transform: translateY(-160%);
  transition: transform .18s ease;
}

.skip-link:focus { transform: translateY(0); }

.cinema-backdrop,
.cinema-image,
.cinema-wash,
.cinema-grid,
.cinema-grain,
.pointer-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.cinema-backdrop { z-index: -2; overflow: hidden; background: #050607; }

.cinema-image {
  background: url('/images/login-cinematic-stage.png') 42% 50% / cover no-repeat;
  transform: scale(1.025);
  animation: camera-breathe 18s ease-in-out infinite alternate;
}

.cinema-wash {
  background:
    linear-gradient(90deg, rgba(4, 5, 6, .02) 0%, rgba(4, 5, 6, .13) 44%, rgba(4, 5, 6, .88) 69%, #050607 100%),
    linear-gradient(180deg, rgba(4, 5, 6, .5) 0%, transparent 25%, transparent 70%, rgba(4, 5, 6, .78) 100%);
}

.cinema-grid {
  opacity: .14;
  background-image:
    linear-gradient(rgba(255, 255, 255, .06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, .06) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: linear-gradient(90deg, transparent, #000 34%, #000 70%, transparent);
}

.cinema-grain {
  opacity: .1;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 220 220' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.88' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.62'/%3E%3C/svg%3E");
  animation: grain-shift .45s steps(2) infinite;
}

.pointer-glow {
  z-index: 2;
  opacity: .9;
  background: radial-gradient(360px circle at var(--pointer-x) var(--pointer-y), rgba(255, 95, 66, .12), transparent 68%);
  transition: opacity .35s ease;
}

.product-header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: clamp(22px, 3.2vw, 42px) clamp(22px, 4.4vw, 68px);
}

.brand-lockup {
  display: inline-flex;
  align-items: center;
  gap: 13px;
  min-height: 48px;
  color: var(--ink);
  text-decoration: none;
}

.brand-symbol {
  display: flex;
  align-items: center;
  gap: 3px;
  width: 42px;
  height: 42px;
  padding: 8px 7px;
  border: 1px solid rgba(255, 255, 255, .16);
  border-radius: 13px;
  background: rgba(7, 8, 10, .52);
  backdrop-filter: blur(12px);
}

.brand-symbol i { flex: 1; border-radius: 99px; background: linear-gradient(180deg, #fff5e8, #ff5d45); }
.brand-symbol i:nth-child(1), .brand-symbol i:nth-child(5) { height: 11px; }
.brand-symbol i:nth-child(2), .brand-symbol i:nth-child(4) { height: 20px; }
.brand-symbol i:nth-child(3) { height: 28px; }
.brand-lockup strong { display: block; font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 600; letter-spacing: .02em; }
.brand-lockup small { display: block; margin-top: 3px; color: var(--faint); font-size: 9px; font-weight: 700; letter-spacing: .27em; }

.theme-toggle {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: rgba(8, 9, 11, .52);
  color: var(--ink);
  cursor: pointer;
  backdrop-filter: blur(16px);
  transition: transform .22s ease, border-color .22s ease, background .22s ease;
}

.theme-toggle svg { width: 18px; }
.theme-toggle:hover { transform: rotate(10deg) scale(1.05); border-color: rgba(255, 255, 255, .38); background: rgba(22, 23, 26, .78); }

.story-stage {
  position: absolute;
  inset-inline-start: clamp(24px, 6vw, 92px);
  inset-block-start: 50%;
  z-index: 3;
  width: min(43vw, 650px);
  transform: translateY(-45%);
  animation: stage-enter .9s cubic-bezier(.16, 1, .3, 1) both;
}

.story-kicker,
.panel-eyebrow {
  margin: 0 0 19px;
  color: rgba(255, 255, 255, .65);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .2em;
  text-transform: uppercase;
}

.story-kicker { display: flex; align-items: center; gap: 10px; }
.story-kicker span { width: 34px; height: 1px; background: var(--accent-red); box-shadow: 0 0 16px rgba(255, 75, 55, .8); }
.story-stage h1 em { color: #ff654f; font-style: normal; text-shadow: 0 0 40px rgba(255, 75, 55, .22); }
.story-copy { max-width: 580px; margin: 26px 0 0; color: rgba(246, 241, 235, .72); font-size: clamp(15px, 1.2vw, 18px); line-height: 1.85; }

.creation-track {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 9px;
  margin: clamp(30px, 4.2vh, 48px) 0 0;
  padding: 0;
  list-style: none;
}

.creation-track li { position: relative; border-top: 1px solid rgba(255, 255, 255, .17); }
.creation-track li::before { content: ''; position: absolute; inset-block-start: -1px; inset-inline-start: 0; width: 0; height: 1px; background: #ff654f; box-shadow: 0 0 14px rgba(255, 75, 55, .8); transition: width .45s ease; }
.creation-track li.active::before { width: 100%; }
.creation-track button { width: 100%; min-height: 84px; padding: 15px 3px; border: 0; background: transparent; color: var(--muted); text-align: start; cursor: pointer; transition: color .25s ease, transform .25s ease; }
.creation-track button:hover, .creation-track button:focus-visible, .creation-track li.active button { color: #fff; transform: translateY(-2px); }
.track-index { display: block; margin-bottom: 8px; color: #ff806e; font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: .1em; }
.track-copy strong { display: block; font-size: 13px; font-weight: 650; }
.track-copy small { display: block; margin-top: 4px; color: var(--faint); font-size: 11px; line-height: 1.45; }
.scene-status { display: flex; align-items: center; gap: 9px; min-height: 22px; margin: 18px 0 0; color: rgba(255, 255, 255, .52); font-size: 11px; letter-spacing: .04em; }
.record-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-red); box-shadow: 0 0 0 5px rgba(255, 75, 55, .1), 0 0 15px rgba(255, 75, 55, .65); animation: record-pulse 2.2s ease-in-out infinite; }

.access-panel {
  position: absolute;
  inset: 0 0 0 auto;
  z-index: 4;
  display: grid;
  place-items: center;
  width: min(42vw, 600px);
  min-width: 460px;
  overflow: hidden;
  border-inline-start: 1px solid rgba(255, 255, 255, .08);
  background: linear-gradient(145deg, rgba(9, 10, 12, .9), rgba(4, 5, 6, .96));
  box-shadow: -48px 0 120px rgba(0, 0, 0, .42);
  backdrop-filter: blur(24px) saturate(115%);
  animation: panel-enter .9s .08s cubic-bezier(.16, 1, .3, 1) both;
}

.panel-glow { position: absolute; inset: 0; pointer-events: none; opacity: .85; background: radial-gradient(300px circle at var(--pointer-x) var(--pointer-y), rgba(255, 255, 255, .07), transparent 70%); transition: opacity .35s ease; }
.panel-content { position: relative; width: min(76%, 410px); padding: 44px 0; }
.panel-eyebrow { color: #ff715c; }
.panel-eyebrow span { color: var(--faint); }
.panel-subtitle { margin: 13px 0 0; color: var(--muted); font-size: 14px; line-height: 1.7; }

.mode-tabs { position: relative; display: grid; grid-template-columns: repeat(2, 1fr); margin-top: 38px; padding: 4px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255, 255, 255, .045); }
.mode-tabs button { position: relative; z-index: 2; min-height: 42px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 650; cursor: pointer; transition: color .28s ease; }
.mode-tabs button[aria-selected='true'] { color: #111; }
.tab-indicator { position: absolute; inset-block: 4px; inset-inline-start: 4px; z-index: 1; width: calc(50% - 4px); border-radius: 999px; background: #f7f3ee; box-shadow: 0 7px 24px rgba(255, 255, 255, .12); transition: transform .35s cubic-bezier(.16, 1, .3, 1); }
.tab-indicator.register { transform: translateX(100%); }

.login-form { margin-top: 29px; }
.field-row { margin-top: 19px; }
.field-row:first-child { margin-top: 0; }
.field-row label { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; color: rgba(255, 255, 255, .72); font-size: 12px; font-weight: 550; }
.field-row label span { color: var(--faint); font-size: 10px; font-weight: 500; }
.field-shell { display: flex; align-items: center; min-height: 54px; padding: 0 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--field); color: var(--faint); transition: border-color .22s ease, background .22s ease, box-shadow .22s ease, transform .22s ease; }
.field-shell:focus-within { border-color: rgba(255, 124, 99, .7); background: rgba(255, 255, 255, .075); box-shadow: 0 0 0 4px rgba(255, 75, 55, .08), 0 12px 34px rgba(0, 0, 0, .18); transform: translateY(-1px); }
.field-shell.invalid { border-color: #ff7665; box-shadow: 0 0 0 3px rgba(255, 75, 55, .08); }
.field-shell > svg { flex: 0 0 auto; width: 17px; }
.field-shell input { flex: 1; min-width: 0; min-height: 50px; padding: 0 12px; border: 0; outline: 0; background: transparent; color: #fff; font-size: 14px; }
.field-shell input::placeholder { color: rgba(255, 255, 255, .32); }
.password-toggle { display: grid; place-items: center; width: 44px; height: 44px; margin-inline-end: -10px; border: 0; background: transparent; color: var(--faint); cursor: pointer; transition: color .2s ease; }
.password-toggle:hover { color: #fff; }
.password-toggle svg { width: 17px; }
.field-error { margin: 7px 4px 0; color: #ff9587; font-size: 11px; line-height: 1.4; }
.field-enter { animation: field-enter .35s cubic-bezier(.16, 1, .3, 1) both; }

.submit-button { display: flex; align-items: center; justify-content: center; gap: 11px; width: 100%; min-height: 56px; margin-top: 26px; border: 0; border-radius: 14px; background: linear-gradient(112deg, #fff5ec, #fff 48%, #ffd6ca); color: #16100f; font-size: 14px; font-weight: 750; cursor: pointer; box-shadow: 0 14px 38px rgba(255, 89, 60, .14); transition: transform .22s ease, box-shadow .22s ease, filter .22s ease; }
.submit-button:hover { transform: translateY(-2px); filter: brightness(1.03); box-shadow: 0 18px 48px rgba(255, 89, 60, .24); }
.submit-button:active { transform: translateY(0) scale(.99); }
.submit-button svg { width: 18px; }
.loading-mark { width: 16px; height: 16px; border: 2px solid rgba(20, 14, 12, .2); border-top-color: #17100e; border-radius: 50%; animation: spin .8s linear infinite; }
.form-status { min-height: 18px; margin: 9px 0 0; color: var(--muted); font-size: 11px; text-align: center; }
.trust-row { display: flex; justify-content: center; gap: 24px; margin-top: 26px; padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, .08); color: var(--faint); font-size: 10px; }
.trust-row span { display: inline-flex; align-items: center; gap: 6px; }
.trust-row svg { width: 13px; color: #ff806e; }

.page-footer { position: absolute; inset-inline-start: clamp(24px, 6vw, 92px); inset-block-end: 27px; z-index: 6; display: flex; gap: 24px; color: rgba(255, 255, 255, .32); font-size: 10px; letter-spacing: .05em; }

.is-light { --panel: rgba(248, 243, 235, .9); }
.is-light .cinema-image { filter: saturate(.78) brightness(1.08); }
.is-light .cinema-wash { background: linear-gradient(90deg, rgba(244, 237, 227, .05), rgba(245, 239, 230, .16) 45%, rgba(244, 239, 232, .9) 70%, #f4efe8 100%), linear-gradient(180deg, rgba(255, 251, 245, .24), transparent 52%, rgba(24, 17, 14, .28)); }
.is-light .access-panel { border-color: rgba(35, 27, 23, .1); background: linear-gradient(145deg, rgba(250, 246, 240, .93), rgba(236, 229, 221, .97)); box-shadow: -48px 0 120px rgba(40, 24, 16, .16); }
.is-light .panel-subtitle, .is-light .mode-tabs button, .is-light .field-row label { color: rgba(29, 23, 20, .62); }
.is-light .panel-eyebrow { color: #b33526; }
.is-light .mode-tabs { border-color: rgba(29, 23, 20, .14); background: rgba(27, 20, 17, .05); }
.is-light .mode-tabs button[aria-selected='true'] { color: #fff; }
.is-light .tab-indicator { background: #1b1715; box-shadow: 0 7px 24px rgba(25, 17, 13, .15); }
.is-light .field-shell { border-color: rgba(29, 23, 20, .15); background: rgba(255, 255, 255, .52); color: rgba(29, 23, 20, .42); }
.is-light .field-shell input { color: #1c1714; }
.is-light .field-shell input::placeholder { color: rgba(29, 23, 20, .38); }
.is-light .password-toggle { color: rgba(29, 23, 20, .44); }
.is-light .password-toggle:hover { color: #1c1714; }
.is-light .submit-button { background: linear-gradient(112deg, #1d1815, #352520); color: #fff8f2; box-shadow: 0 14px 38px rgba(72, 35, 25, .18); }
.is-light .trust-row { border-color: rgba(29, 23, 20, .1); color: rgba(29, 23, 20, .48); }
.is-light .form-status { color: rgba(29, 23, 20, .55); }
.is-light .panel-glow { background: radial-gradient(300px circle at var(--pointer-x) var(--pointer-y), rgba(255, 94, 63, .12), transparent 70%); }

@keyframes camera-breathe { from { transform: scale(1.025) translate3d(0, 0, 0); } to { transform: scale(1.075) translate3d(-.7%, -.4%, 0); } }
@keyframes stage-enter { from { opacity: 0; transform: translateY(-40%) translateX(-28px); } to { opacity: 1; transform: translateY(-45%) translateX(0); } }
@keyframes panel-enter { from { opacity: 0; transform: translateX(42px); } to { opacity: 1; transform: translateX(0); } }
@keyframes field-enter { from { opacity: 0; transform: translateY(-9px); } to { opacity: 1; transform: translateY(0); } }
@keyframes record-pulse { 0%, 100% { opacity: .55; transform: scale(.86); } 50% { opacity: 1; transform: scale(1); } }
@keyframes grain-shift { 0% { transform: translate(0); } 25% { transform: translate(-1.5%, 1%); } 50% { transform: translate(1%, -1.2%); } 75% { transform: translate(.5%, 1.5%); } 100% { transform: translate(-1%, -.5%); } }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 980px) {
  .login-page { min-height: 100dvh; overflow-x: hidden; overflow-y: auto; }
  .cinema-image { background-position: 46% 50%; }
  .cinema-wash { background: linear-gradient(180deg, rgba(4, 5, 6, .2) 0%, rgba(4, 5, 6, .62) 42%, #050607 70%); }
  .product-header { position: relative; }
  .story-stage { position: relative; inset: auto; width: auto; margin: clamp(50px, 10vh, 110px) 24px 0; transform: none; animation-name: stage-enter-mobile; }
  .story-stage h1 { font-size: clamp(42px, 11vw, 68px); }
  .story-copy { max-width: 610px; }
  .creation-track { max-width: 610px; }
  .access-panel { position: relative; inset: auto; width: calc(100% - 32px); min-width: 0; margin: 52px 16px 80px; border: 1px solid rgba(255, 255, 255, .1); border-radius: 28px; box-shadow: 0 28px 90px rgba(0, 0, 0, .38); }
  .panel-content { width: min(84%, 480px); }
  .page-footer { position: relative; inset: auto; margin: -45px 24px 25px; }
}

@media (max-width: 560px) {
  .product-header { padding: 18px; }
  .brand-lockup strong { font-size: 15px; }
  .brand-lockup small { font-size: 8px; }
  .theme-toggle { width: 44px; height: 44px; }
  .story-stage { margin: 74px 18px 0; }
  .story-stage h1 { font-size: clamp(38px, 13.2vw, 58px); }
  .story-copy { font-size: 14px; line-height: 1.75; }
  .creation-track { grid-template-columns: 1fr; gap: 0; }
  .creation-track li { display: none; }
  .creation-track li.active { display: block; }
  .creation-track button { min-height: 68px; }
  .track-copy { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .access-panel { margin-top: 38px; border-radius: 23px; }
  .panel-content { width: calc(100% - 40px); padding: 36px 0 30px; }
  .panel-content h2 { font-size: 34px; }
  .mode-tabs { margin-top: 30px; }
  .trust-row { gap: 12px; justify-content: space-between; }
  .page-footer { display: block; line-height: 1.8; }
  .page-footer span { display: block; }
}

@media (prefers-reduced-motion: reduce) {
  .cinema-image, .cinema-grain, .record-dot { animation: none !important; }
  .pointer-glow, .panel-glow { display: none; }
}

@media (prefers-contrast: more) {
  .access-panel, .field-shell, .mode-tabs, .theme-toggle { border-width: 2px; }
  .panel-subtitle, .story-copy, .field-row label { color: #fff; }
  .is-light .panel-subtitle, .is-light .field-row label { color: #211a17; }
}

@media (forced-colors: active) {
  .cinema-backdrop { display: none; }
  .login-page, .access-panel, .field-shell, .mode-tabs, .submit-button { background: Canvas; color: CanvasText; border-color: CanvasText; }
  .story-stage h1, .panel-content h2, .field-shell input { color: CanvasText !important; }
}

@keyframes stage-enter-mobile { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: translateY(0); } }
</style>

<style>
/* The global visual system owns generic heading styles with an id selector.
   These product-entrance headings intentionally opt into a cinematic scale. */
html body #app .login-page .story-stage h1 {
  margin: 0;
  color: #fff !important;
  font-family: Georgia, "Songti SC", "STSong", serif !important;
  font-size: clamp(42px, 5.35vw, 82px) !important;
  font-weight: 500;
  line-height: 1.05;
  letter-spacing: -.055em;
}

html body #app .login-page .panel-content h2 {
  margin: 0;
  color: #fff !important;
  font-family: Georgia, "Songti SC", "STSong", serif !important;
  font-size: clamp(34px, 3vw, 46px) !important;
  font-weight: 500;
  letter-spacing: -.045em;
}

html body #app .login-page.is-light .panel-content h2 { color: #191513 !important; }

@media (max-width: 980px) {
  html body #app .login-page .story-stage h1 { font-size: clamp(42px, 11vw, 68px) !important; }
}

@media (max-width: 560px) {
  html body #app .login-page .story-stage h1 { font-size: clamp(38px, 13.2vw, 58px) !important; }
  html body #app .login-page .panel-content h2 { font-size: 34px !important; }
}

@media (forced-colors: active) {
  html body #app .login-page .story-stage h1,
  html body #app .login-page .panel-content h2 { color: CanvasText !important; }
}
</style>
