import { createApp, h } from 'vue'
// 初始化主题（必须在挂载前执行）
import './composables/useTheme.js'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import { ElConfigProvider } from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/theme.css'
import './styles/element-plus.css'
import './styles/overlays.css'
import './styles/workspaces.css'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import request from './utils/request'

const app = createApp({
  name: 'RootProvider',
  render() {
    return h(
      ElConfigProvider,
      {
        message: {
          duration: 5000,
          showClose: true,
          offset: 28,
        },
      },
      () => h(App)
    )
  },
})
const pinia = createPinia()

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(pinia)
app.use(router)
app.use(ElementPlus, { locale: zhCn })
async function mountApp() {
  // API calls use the bearer token, while <video>/<img> requests cannot add
  // that header. Restore the HttpOnly media cookie for sessions created before
  // static media was protected, then mount routes that render those elements.
  if (localStorage.getItem('lmd_auth_token')) {
    try { await request.post('/auth/session-cookie') } catch (_) { /* request interceptor handles expired sessions */ }
  }
  app.mount('#app')
}

mountApp()
