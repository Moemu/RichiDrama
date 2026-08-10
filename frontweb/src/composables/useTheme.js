import { ref, watchEffect } from 'vue'

const STORAGE_KEY = 'lmd-theme'
const isDark = ref(localStorage.getItem(STORAGE_KEY) !== 'light')

function apply() {
  document.documentElement.classList.toggle('dark', isDark.value)
  document.documentElement.classList.toggle('light', !isDark.value)
  localStorage.setItem(STORAGE_KEY, isDark.value ? 'dark' : 'light')
}

// 初始立即应用一次
apply()

watchEffect(apply)

export function useTheme() {
  function toggle() {
    isDark.value = !isDark.value
  }
  return { isDark, toggle }
}
