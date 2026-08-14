import { ref, watchEffect } from 'vue'

const STORAGE_KEY = 'lmd-theme'
const isDark = ref(localStorage.getItem(STORAGE_KEY) !== 'light')

function apply() {
  document.documentElement.classList.toggle('dark', isDark.value)
  document.documentElement.classList.toggle('light', !isDark.value)
  document.documentElement.style.backgroundColor = isDark.value ? '#080b12' : '#f2f3f7'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark.value ? '#080b12' : '#f2f3f7')
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
