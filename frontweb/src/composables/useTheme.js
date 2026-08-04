import { ref, watchEffect } from 'vue'

const STORAGE_KEY = 'lmd-theme'
// The product has a single workbench design contract. Do not re-enable the
// legacy `html.light` branch through a stale preference or a fresh install.
const isDark = ref(true)

function apply() {
  document.documentElement.classList.remove('light')
  document.documentElement.classList.add('dark')
  localStorage.setItem(STORAGE_KEY, 'dark')
}

// 初始立即应用一次
apply()

watchEffect(apply)

export function useTheme() {
  function toggle() {
    // Kept for callers during the migration; the UI no longer exposes a
    // competing light theme.
    isDark.value = true
  }
  return { isDark, toggle }
}
