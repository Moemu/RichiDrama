import { createRouter, createWebHistory } from 'vue-router'
import { safeRedirectPath } from '@/utils/routeRecovery'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { public: true, title: '登录' } },
    { path: '/account', name: 'account', component: () => import('@/views/AccountCenter.vue'), meta: { title: '账户中心' } },
    { path: '/admin/operations', name: 'admin-operations', component: () => import('@/views/OperationsScale.vue'), meta: { title: '运营告警与报表', admin: true } },
    { path: '/admin', name: 'admin', component: () => import('@/views/AdminConsole.vue'), meta: { title: '后台管理', admin: true } },
    {
      path: '/',
      name: 'list',
      component: () => import('@/views/FilmList.vue'),
      meta: { title: '项目列表' }
    },
    {
      path: '/drama/:id',
      name: 'drama-detail',
      component: () => import('@/views/DramaDetail.vue'),
      meta: { title: '剧集管理' }
    },
    {
      path: '/film/:id',
      name: 'film',
      component: () => import('@/views/FilmCreate.vue'),
      meta: { title: 'AI 视频生成' }
    },
    {
      path: '/film/:id/canvas',
      name: 'film-canvas',
      component: () => import('@/views/DramaCanvas.vue'),
      meta: { title: '画布模式' }
    },
    {
      path: '/ai-config',
      name: 'ai-config',
      component: () => import('@/views/AiConfig.vue'),
      meta: { title: 'AI 配置', admin: true }
    },
    {
      path: '/free-create',
      name: 'free-create',
      component: () => import('@/views/FreeCreate.vue'),
      meta: { title: '全能视频' }
    },
    {
      path: '/media-library',
      name: 'media-library',
      component: () => import('@/views/MediaLibrary.vue'),
      meta: { title: '媒体素材库' }
    },
    {
      path: '/ai-tools',
      name: 'ai-tools',
      component: () => import('@/views/AITools.vue'),
      meta: { title: 'AI 工具箱' }
    },
    {
      path: '/ai-tools/:kind(script-analysis|script-analysis-stream|script-writing|reverse-prompt)',
      name: 'tool-workbench',
      component: () => import('@/views/ToolWorkbench.vue'),
      props: (route) => ({ kind: ({ 'script-analysis': 'script_analysis', 'script-analysis-stream': 'script_analysis_stream', 'script-writing': 'script_writing', 'reverse-prompt': 'reverse_prompt' })[route.params.kind] }),
      meta: { title: 'AI 工具工作台' }
    },
    {
      path: '/ai-tools/image-generation',
      name: 'tool-image-generation',
      component: () => import('@/views/ToolMediaGeneration.vue'),
      props: { media: 'image' },
      meta: { title: '图片生成工作台' }
    },
    {
      path: '/ai-tools/video-generation',
      name: 'tool-video-generation',
      component: () => import('@/views/ToolMediaGeneration.vue'),
      props: { media: 'video' },
      meta: { title: '视频生成工作台' }
    }
  ]
})

router.beforeEach((to) => {
  if (to.meta.title) {
    document.title = `${to.meta.title} - 瑞池传媒短剧平台`
  }
  const user = JSON.parse(localStorage.getItem('lmd_auth_user') || 'null')
  if (!to.meta.public && !localStorage.getItem('lmd_auth_token')) return { path: '/login', query: { redirect: to.fullPath } }
  if (to.meta.admin && user?.console_access !== true) return '/'
  if (to.path === '/login' && localStorage.getItem('lmd_auth_token')) {
    return safeRedirectPath(to.query.redirect, '/')
  }
  return true
})

export default router
