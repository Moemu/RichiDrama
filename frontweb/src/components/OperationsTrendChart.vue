<template>
  <figure class="operations-trend" aria-labelledby="operations-trend-title">
    <figcaption><div><p>近七日生产</p><h3 id="operations-trend-title">创建与完成趋势</h3></div><span>{{ totalCompleted }} 已完成</span></figcaption>
    <div ref="chartElement" class="operations-echart" role="img" :aria-label="description"></div>
    <div class="trend-legend" aria-hidden="true"><span><i class="created"></i>创建</span><span><i class="completed"></i>完成</span></div>
  </figure>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])
const props = defineProps({ trend: { type: Array, default: () => [] } })
const chartElement = ref(null); let chart; let resizeObserver
const items = computed(() => (props.trend || []).slice(-7).map((item, index) => ({ key: item.date || item.day || index, label: String(item.date || item.day || '').slice(5) || `第${index + 1}日`, created: Number(item.created ?? item.total ?? 0), completed: Number(item.completed ?? 0) })))
const totalCompleted = computed(() => items.value.reduce((total, item) => total + item.completed, 0))
const description = computed(() => `近七日生产趋势：累计创建 ${items.value.reduce((total, item) => total + item.created, 0)} 条，完成 ${totalCompleted.value} 条。`)
function renderChart() {
  if (!chartElement.value) return
  if (!chart) chart = echarts.init(chartElement.value, null, { renderer: 'canvas' })
  chart.setOption({ animationDuration: 260, animationEasing: 'cubicOut', grid: { top: 14, right: 12, bottom: 26, left: 8, containLabel: true }, tooltip: { trigger: 'axis', backgroundColor: '#121820', borderColor: '#314052', textStyle: { color: '#eff5fb' }, padding: [8, 10], axisPointer: { type: 'line', lineStyle: { color: '#71849a' } } }, xAxis: { type: 'category', boundaryGap: false, data: items.value.map((item) => item.label), axisLine: { lineStyle: { color: '#3b4858' } }, axisTick: { show: false }, axisLabel: { color: '#aab7c5', fontSize: 11, margin: 10 } }, yAxis: { type: 'value', minInterval: 1, splitNumber: 3, axisLabel: { color: '#8493a3', fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: 'rgba(143, 163, 183, .18)' } } }, series: [{ name: '创建', type: 'line', smooth: .35, data: items.value.map((item) => item.created), symbol: 'circle', symbolSize: 6, lineStyle: { width: 2, color: '#7895d3' }, itemStyle: { color: '#7895d3' }, areaStyle: { color: 'rgba(120,149,211,.16)' } }, { name: '完成', type: 'line', smooth: .35, data: items.value.map((item) => item.completed), symbol: 'circle', symbolSize: 6, lineStyle: { width: 2.5, color: '#55c6b8' }, itemStyle: { color: '#55c6b8' }, areaStyle: { color: 'rgba(85,198,184,.08)' } }] }, true)
}
onMounted(async () => { await nextTick(); renderChart(); resizeObserver = new ResizeObserver(() => chart?.resize()); resizeObserver.observe(chartElement.value) })
watch(items, async () => { await nextTick(); renderChart() }, { deep: true })
onBeforeUnmount(() => { resizeObserver?.disconnect(); chart?.dispose(); chart = null })
</script>

<style scoped>
.operations-trend{display:grid;min-width:0;gap:.75rem;margin:0}.operations-trend figcaption{display:flex;align-items:end;justify-content:space-between;gap:1rem}.operations-trend p{margin:0;color:var(--text-muted);font-size:.72rem;font-weight:700;letter-spacing:.08em}.operations-trend h3{margin:.2rem 0 0;color:var(--text-primary);font-size:1.2rem}.operations-trend figcaption>span{color:var(--text-muted);font-size:.78rem;font-variant-numeric:tabular-nums}.operations-echart{width:100%;height:clamp(10rem,19vh,14rem);min-height:10rem}.trend-legend{display:flex;gap:1rem;color:var(--text-muted);font-size:.74rem}.trend-legend span{display:inline-flex;align-items:center;gap:.35rem}.trend-legend i{width:.55rem;height:.55rem;border-radius:50%}.trend-legend .created{background:#7895d3}.trend-legend .completed{background:#55c6b8}
</style>
