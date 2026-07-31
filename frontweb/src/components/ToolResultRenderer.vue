<template>
  <section class="tool-result-renderer">
    <MarkdownResult v-if="markdownContent" :content="markdownContent" />
    <template v-else-if="sections.length">
      <article v-for="section in sections" :key="section.key" class="result-section">
        <h2>{{ section.title }}</h2>
        <p v-if="section.summary">{{ section.summary }}</p>
        <div v-if="section.items.length" class="result-items">
          <article v-for="(item, index) in section.items" :key="index" class="result-item">
            <h3 v-if="item.title">{{ item.title }}</h3>
            <dl><template v-for="entry in item.entries" :key="entry.key"><dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd></template></dl>
          </article>
        </div>
      </article>
    </template>
    <div v-else class="result-message">{{ fallback }}</div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import MarkdownResult from '@/components/MarkdownResult.vue'

const props = defineProps({ run: { type: Object, required: true } })
const labels = { overview: '项目概览', episodes: '剧集', characters: '角色', scenes: '场景', props: '道具', shots: '镜头建议', prompt: '完整提示词', raw_json: '原始输出', content: '内容', script: '剧本', description: '描述', suggestion: '建议', title: '标题', name: '名称', summary: '摘要', plotSummary: '剧情概述', details: '细节', suggestion: '建议' }
const output = computed(() => props.run.output || null)
const markdownContent = computed(() => {
  if (props.run.tool_type === 'reverse_prompt' && output.value?.prompt) return String(output.value.prompt)
  if (output.value?.raw_json && !looksJson(output.value.raw_json)) return String(output.value.raw_json)
  if (props.run.tool_type === 'script_analysis_stream' && !output.value && props.run.streamed_text) return String(props.run.streamed_text)
  return ''
})
const fallback = computed(() => props.run.error_msg || props.run.streamed_text || '正在等待模型输出…')
const sections = computed(() => {
  let value = output.value
  if (value?.raw_json && looksJson(value.raw_json)) { try { value = JSON.parse(value.raw_json) } catch (_) {} }
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).filter(([key]) => key !== 'prompt' && key !== 'raw_json').map(([key, value]) => makeSection(key, value)).filter(Boolean)
})
function looksJson(value) { try { JSON.parse(String(value)); return true } catch (_) { return false } }
function titleFor(key) { return labels[key] || String(key).replace(/_/g, ' ') }
function printable(value) { if (value == null) return ''; if (typeof value === 'string' || typeof value === 'number') return String(value); if (Array.isArray(value)) return value.map(printable).filter(Boolean).join('；'); return JSON.stringify(value) }
function makeItem(value, index) { const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : { content: value }; const title = obj.title || obj.name || obj.characterName || obj.sceneName || obj.propName || obj.shotType || `${index + 1}`; const entries = Object.entries(obj).filter(([key]) => !['title','name','characterName','sceneName','propName','shotType'].includes(key)).map(([key, item]) => ({ key, label: titleFor(key), value: printable(item) })).filter((entry) => entry.value); return { title, entries } }
function makeSection(key, value) { if (Array.isArray(value)) return { key, title: titleFor(key), summary: '', items: value.map(makeItem) }; if (value && typeof value === 'object') return { key, title: titleFor(key), summary: '', items: [makeItem(value, 0)] }; return { key, title: titleFor(key), summary: printable(value), items: [] } }
</script>

<style scoped>
.tool-result-renderer{flex:1;min-height:360px;max-height:calc(100vh - 220px);overflow:auto;padding:18px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-inner);color:var(--text-primary)}.result-section+.result-section{margin-top:24px;padding-top:20px;border-top:1px solid var(--border-color)}.result-section h2{margin:0 0 8px;color:var(--text-bright);font-size:17px}.result-section>p{margin:0;line-height:1.75}.result-items{display:grid;gap:10px}.result-item{padding:12px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-card)}.result-item h3{margin:0 0 8px;color:var(--text-primary);font-size:14px}.result-item dl{display:grid;grid-template-columns:96px minmax(0,1fr);gap:6px 10px;margin:0;font-size:13px;line-height:1.6}.result-item dt{color:var(--text-muted)}.result-item dd{margin:0;color:var(--text-primary);white-space:pre-wrap;word-break:break-word}.result-message{display:grid;min-height:260px;place-items:center;color:var(--text-muted);white-space:pre-wrap;word-break:break-word}
</style>
