<template>
  <button v-if="visible" class="account-balance" type="button" title="打开账户中心" @click="router.push('/account')">
    <span>可用余额</span>
    <strong>{{ displayCredits }}</strong>
    <small v-if="frozen > 0">冻结 {{ frozen }}</small>
  </button>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { accountAPI } from '@/api/account'

const route = useRoute()
const router = useRouter()
const account = ref(null)
const hasSession = ref(Boolean(localStorage.getItem('lmd_auth_token')))
let refreshTimer = null

const visible = computed(() => !route.meta.public && hasSession.value)
const available = computed(() => Number(account.value?.available ?? account.value?.balance ?? 0))
const frozen = computed(() => Number(account.value?.frozen ?? 0))
const displayCredits = computed(() => Number.isFinite(available.value) ? available.value.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) : '0')

async function refreshBalance() {
  hasSession.value = Boolean(localStorage.getItem('lmd_auth_token'))
  if (!hasSession.value) {
    account.value = null
    return
  }
  try {
    account.value = await accountAPI.me()
  } catch (_) {
    // The shared request interceptor handles expired sessions and user feedback.
  }
}

function onBalanceChanged() {
  refreshBalance()
}

watch(() => route.fullPath, refreshBalance)

onMounted(() => {
  refreshBalance()
  refreshTimer = window.setInterval(refreshBalance, 30000)
  window.addEventListener('focus', refreshBalance)
  window.addEventListener('lmd:balance-changed', onBalanceChanged)
})

onUnmounted(() => {
  window.clearInterval(refreshTimer)
  window.removeEventListener('focus', refreshBalance)
  window.removeEventListener('lmd:balance-changed', onBalanceChanged)
})
</script>

<style scoped>
.account-balance { position:fixed; z-index:3000; top:12px; right:104px; display:flex; align-items:baseline; gap:7px; min-height:34px; padding:6px 11px; border:1px solid var(--border-color); border-radius:9px; background:color-mix(in srgb, var(--bg-card) 92%, transparent); color:var(--text-primary); box-shadow:0 8px 24px rgba(0,0,0,.16); cursor:pointer; font:inherit; backdrop-filter:blur(10px); }
.account-balance:hover { border-color:var(--primary-color); }
.account-balance span,.account-balance small { color:var(--text-muted); font-size:12px; white-space:nowrap; }
.account-balance strong { color:var(--primary-color); font-size:15px; font-variant-numeric:tabular-nums; white-space:nowrap; }
@media (max-width: 720px) { .account-balance { top:8px; right:10px; } .account-balance small { display:none; } }
</style>
