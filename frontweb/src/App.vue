<template>
  <div class="app">
    <section v-if="activeNotice" class="price-notice-banner" role="status" aria-live="polite">
      <div><strong>{{ activeNotice.title }}</strong><p>{{ activeNotice.body }}</p><small>生效时间：{{ formatChinaDateTime(activeNotice.effective_at) }}</small></div>
      <button type="button" :disabled="acknowledging" @click="acknowledge">{{ acknowledging ? '处理中…' : '我已了解' }}</button>
    </section>
    <div class="app-view"><router-view /></div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import request from '@/utils/request'
import { formatChinaDateTime } from '@/utils/time'

const route = useRoute()
const notices = ref([])
const acknowledging = ref(false)
const activeNotice = computed(() => notices.value[0] || null)

async function loadNotices() {
  if (route.meta.public || !localStorage.getItem('lmd_auth_token')) { notices.value = []; return }
  try { notices.value = await request.get('/notices/active') } catch (_) { notices.value = [] }
}
async function acknowledge() {
  if (!activeNotice.value) return
  const noticeId = activeNotice.value.id
  acknowledging.value = true
  try { await request.post(`/notices/${noticeId}/acknowledge`); notices.value = notices.value.filter((item) => item.id !== noticeId) }
  finally { acknowledging.value = false }
}

watch(() => route.fullPath, loadNotices)
onMounted(loadNotices)
</script>

<style>
* {
  box-sizing: border-box;
}
html, body, #app, .app {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-page);
  color: var(--text-primary);
}
.app-view{min-height:100vh;min-height:100dvh}
.price-notice-banner{position:relative;z-index:var(--ui-z-sticky,300);display:flex;align-items:flex-start;justify-content:space-between;gap:1.2rem;padding:.85rem clamp(1rem,4vw,3rem);border-bottom:1px solid color-mix(in srgb,var(--status-warning,#d97706) 28%,var(--border-subtle));background:color-mix(in srgb,var(--status-warning,#d97706) 10%,var(--bg-surface));color:var(--text-primary)}
.price-notice-banner div{min-width:0}.price-notice-banner strong{display:block;font-size:.92rem}.price-notice-banner p{max-width:90rem;margin:.25rem 0;white-space:pre-line;font-size:.82rem;line-height:1.45}.price-notice-banner small{color:var(--text-muted)}.price-notice-banner button{flex:0 0 auto;min-height:2.25rem;padding:.35rem .8rem;border:1px solid color-mix(in srgb,var(--status-warning,#d97706) 45%,var(--border-subtle));border-radius:.45rem;background:var(--bg-surface);color:var(--text-primary);cursor:pointer}.price-notice-banner button:disabled{cursor:wait;opacity:.6}
@media(max-width:48rem){.price-notice-banner{align-items:stretch;flex-direction:column;gap:.6rem}.price-notice-banner button{align-self:flex-start}}
.richi-brand-mark {
  display: inline-block;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  overflow: hidden;
  border-radius: 9px;
}
.richi-brand-mark img {
  display: block;
  width: 34px;
  height: auto;
}
.logo:has(.richi-brand-mark) {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding-left: 0 !important;
}
.logo:has(.richi-brand-mark)::before {
  display: none !important;
}
.richi-brand-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
</style>
