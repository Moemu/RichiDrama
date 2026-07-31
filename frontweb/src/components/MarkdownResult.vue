<template>
  <article class="markdown-result" v-html="html"></article>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({ content: { type: String, default: '' } })
const escapeHtml = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const inline = (value) => escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
const html = computed(() => {
  const lines = String(props.content || '').replace(/\r\n/g, '\n').split('\n')
  const output = []; let list = null
  const closeList = () => { if (list) { output.push(`</${list}>`); list = null } }
  for (const raw of lines) {
    const heading = raw.match(/^(#{1,6})\s+(.+)$/)
    const bullet = raw.match(/^[-*+]\s+(.+)$/)
    const numbered = raw.match(/^\d+[.)]\s+(.+)$/)
    if (heading) { closeList(); const level = Math.min(4, heading[1].length); output.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue }
    if (bullet || numbered) { const next = bullet ? 'ul' : 'ol'; if (list && list !== next) closeList(); if (!list) { output.push(`<${next}>`); list = next } output.push(`<li>${inline((bullet || numbered)[1])}</li>`); continue }
    closeList(); if (!raw.trim()) continue; output.push(`<p>${inline(raw)}</p>`)
  }
  closeList(); return output.join('') || '<p>暂无可显示内容</p>'
})
</script>

<style scoped>
.markdown-result{flex:1;min-height:360px;max-height:calc(100vh - 220px);overflow:auto;padding:18px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-inner);color:var(--text-primary);font-size:14px;line-height:1.8}.markdown-result :deep(h1),.markdown-result :deep(h2),.markdown-result :deep(h3),.markdown-result :deep(h4){margin:18px 0 8px;color:var(--text-bright);line-height:1.35}.markdown-result :deep(h1){font-size:20px}.markdown-result :deep(h2){font-size:17px}.markdown-result :deep(h3){font-size:15px}.markdown-result :deep(p){margin:0 0 10px}.markdown-result :deep(ul),.markdown-result :deep(ol){margin:0 0 12px;padding-left:22px}.markdown-result :deep(code){padding:1px 5px;border-radius:4px;background:var(--bg-hover);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}
</style>
