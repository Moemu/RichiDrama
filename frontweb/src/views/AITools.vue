<template>
  <main class="tools-page">
    <header><el-button text @click="$router.back()">返回</el-button><h1>AI 工具箱</h1><p>复用已有创作、素材与任务能力。</p></header>
    <section class="tool-grid">
      <article v-for="tool in tools" :key="tool.title" class="tool-card" @click="$router.push(tool.to)"><b>{{ tool.title }}</b><span>{{ tool.description }}</span></article>
    </section>
  </main>
</template>
<script setup>
const tools = [
  { title: '全能创作', description: '以镜头编排图片、视频、音频参考并生成成片。', to: '/free-create' },
  { title: '媒体素材库', description: '上传、重命名、管理素材与真人 SD2 认证。', to: '/media-library' },
  { title: '图片与视频创作', description: '进入项目列表后新建短剧或继续已有项目。', to: '/' },
  { title: '首尾帧提取', description: '在已完成成片的全能创作工作台中提取并复用。', to: '/free-create' },
  { title: '提示词引用修复', description: '在全能创作中粘贴提示词后自动恢复可识别的 @素材引用。', to: '/free-create' },
]
</script>
<style scoped>
.tools-page{min-height:100vh;padding:32px;background:#171d2d;color:#e7ebf5}.tools-page header{max-width:960px;margin:auto}.tools-page h1{margin:12px 0 6px}.tools-page p{color:#aab4c9}.tool-grid{max-width:960px;margin:28px auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.tool-card{display:grid;gap:10px;padding:22px;border:1px solid #3b4966;border-radius:12px;background:#20273a;cursor:pointer}.tool-card:hover{border-color:#7394ff}.tool-card span{font-size:13px;color:#aab4c9;line-height:1.6}
</style>
