<template>
  <div class="ai-config">
    <header class="header">
      <div class="header-inner">
        <h1 class="logo" @click="goList">
          <span class="richi-brand-mark" aria-hidden="true"><img src="/brand/richi-logo-color.png" alt="" /></span>
          <span class="richi-brand-copy"><span class="logo-main">瑞池传媒短剧平台</span><span class="logo-sub">创作工作台</span></span>
        </h1>
        <span class="page-title">AI 配置</span>
        <AccountBalanceBadge />
        <el-button class="btn-back" @click="goList">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
      </div>
    </header>

    <main class="main">
      <AIConfigContent />
    </main>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import AIConfigContent from '@/components/AIConfigContent.vue'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'

const router = useRouter()

function goList() {
  router.push({ name: 'list' })
}
</script>

<style scoped>
.ai-config {
  min-height: 100vh;
  background: #0f0f12;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(120, 60, 220, 0.18) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(60, 100, 220, 0.12) 0%, transparent 60%);
}
html.light .ai-config {
  background: #f5f3ff;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(139, 92, 246, 0.12) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(99, 102, 241, 0.08) 0%, transparent 60%);
}
.header {
  background: rgba(18, 18, 22, 0.82);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(139, 92, 246, 0.18);
  box-shadow: 0 2px 20px rgba(0, 0, 0, 0.4);
  position: sticky;
  top: 0;
  z-index: 100;
}
html.light .header {
  background: rgba(255, 255, 255, 0.85);
  border-bottom-color: rgba(139, 92, 246, 0.2);
  box-shadow: 0 2px 16px rgba(139, 92, 246, 0.08);
}
.header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.logo {
  margin: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1;
  transition: filter 0.3s;
}
.logo:hover {
  filter: drop-shadow(0 0 10px rgba(139, 92, 246, 0.5));
}
.logo-main {
  font-size: 1.1rem;
  font-weight: 700;
  background: linear-gradient(135deg, #c4b5fd 0%, #818cf8 50%, #a78bfa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.logo-sub {
  font-size: 0.68rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: #6d6d7a;
  -webkit-text-fill-color: #6d6d7a;
}
html.light .logo-main {
  color: #3479ae;
  -webkit-text-fill-color: #3479ae;
}
html.light .logo-sub {
  color: #9ca3af;
  -webkit-text-fill-color: #9ca3af;
}
.page-title {
  flex: 1;
  font-size: 16px;
  color: #a1a1aa;
}
html.light .page-title { color: #6b7280; }
.main {
  max-width: 1200px;
  margin: 24px auto;
  background: rgba(24, 24, 27, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 16px;
  padding: 20px 24px;
  border: 1px solid rgba(63, 63, 70, 0.7);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
}
html.light .main {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(139, 92, 246, 0.15);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.08);
}
/* AI configuration is a studio control surface, not a generic settings sheet. */
.ai-config{background:var(--bg-page);background-image:radial-gradient(50% 42% at 6% -8%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 72%),radial-gradient(38% 32% at 96% 13%,color-mix(in srgb,var(--accent-teal) 10%,transparent),transparent 70%)}
.header{background:color-mix(in srgb,var(--bg-surface) 88%,transparent)!important;border-bottom-color:var(--border-subtle)!important;box-shadow:var(--shadow-sm)!important}.header-inner{width:100%;max-width:1340px;box-sizing:border-box;padding:13px 0;gap:12px}.logo{flex-direction:row;align-items:center;gap:8px}.logo-main{background:none;color:var(--text-primary);-webkit-text-fill-color:var(--text-primary)}.logo-sub{color:var(--text-muted);-webkit-text-fill-color:var(--text-muted)}.page-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;letter-spacing:0;color:var(--text-primary);text-transform:none}
.main{position:relative;width:100%;max-width:1340px;box-sizing:border-box;margin:clamp(1.5rem,3vw,3rem) auto 4rem;padding:clamp(1.25rem,2.6vw,2.25rem);border-color:var(--border-subtle);border-radius:20px;background:linear-gradient(145deg,color-mix(in srgb,var(--bg-surface) 96%,transparent),color-mix(in srgb,var(--bg-raised) 84%,transparent));box-shadow:var(--shadow-md),inset 0 1px 0 color-mix(in srgb,var(--text-primary) 7%,transparent)}.main::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(120deg,color-mix(in srgb,var(--accent) 9%,transparent),transparent 27%),radial-gradient(circle at 95% 0,color-mix(in srgb,var(--accent-teal) 12%,transparent),transparent 24%)}.main>:deep(*){position:relative;z-index:1}
@media(min-width:900px){.main{min-height:660px}.header-inner{min-height:54px}.btn-back{border-radius:10px!important}}
/* Configuration matrix owns the full viewport instead of floating as an Element-style card. */
.ai-config{display:grid;grid-template-rows:60px minmax(0,1fr);height:100vh;height:100dvh;min-height:0;overflow:hidden}.header{position:relative;top:auto}.header-inner{max-width:none;height:60px;padding:0 clamp(1.25rem,3vw,3.5rem)}.main{width:100%;max-width:none;height:100%;min-height:0;margin:0;padding:clamp(1.1rem,2vw,2rem) clamp(1.25rem,3vw,3.5rem) 1rem;overflow:hidden;border:0;border-radius:0;background:linear-gradient(110deg,color-mix(in srgb,var(--bg-surface) 72%,transparent),transparent 32%),var(--bg-page);box-shadow:none}.main::before{border-radius:0;background:radial-gradient(circle at 96% 0,color-mix(in srgb,var(--accent-teal) 11%,transparent),transparent 27%),linear-gradient(120deg,color-mix(in srgb,var(--accent) 7%,transparent),transparent 23%)}.main::after{right:clamp(1.25rem,3vw,3.5rem)!important;top:1.1rem!important}
.main :deep(.ai-config-content),.main :deep(.config-tabs){height:100%;min-width:0;min-height:0}.main :deep(.el-tabs){display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0}.main :deep(.el-tabs__header){margin:0}.main :deep(.el-tabs__nav-wrap::after){height:1px;background:var(--border-color)}.main :deep(.el-tabs__content),.main :deep(.el-tab-pane){height:100%;min-width:0;min-height:0}.main :deep(.tab-content){box-sizing:border-box;width:100%;height:100%;max-width:100%;max-height:none;padding-top:1.1rem;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}.main :deep(.content-actions){margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--border-color)}.main :deep(.default-tip){margin:0 0 .75rem;padding:.8rem 1rem;border:0;border-left:2px solid var(--accent);border-radius:0;background:color-mix(in srgb,var(--bg-raised) 58%,transparent)}.main :deep(.el-table){max-width:100%;--el-table-border-color:var(--border-subtle);--el-table-row-hover-bg-color:color-mix(in srgb,var(--accent) 7%,transparent);background:transparent}.main :deep(.el-table th.el-table__cell){height:3rem;background:color-mix(in srgb,var(--bg-raised) 70%,transparent);font-size:.65rem;letter-spacing:.08em;text-transform:uppercase}.main :deep(.el-table td.el-table__cell){height:4.2rem;background:transparent}.main :deep(.el-table__inner-wrapper::before){display:none}
@media(max-width:48rem){.ai-config{grid-template-rows:54px minmax(0,1fr)}.header-inner{height:54px;padding:0 .75rem}.richi-brand-copy{display:none}.main{padding:.8rem}.main::after{display:none}}
</style>
