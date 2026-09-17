<template>
  <div class="text-card" :class="{ selected, linked: data.linked }">
    <div class="card-heading">
      <NodeTitle v-model="data.title" placeholder="文本" @update:model-value="data.onChange?.()" />
      <small>{{ data.linked ? '提示词输入' : '备注' }}</small>
    </div>
    <textarea v-model="data.text" class="nodrag nopan nowheel" rows="5" maxlength="10000" placeholder="写备注，或连到生成节点作为提示词输入" @input="data.onChange?.()" />
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<script setup>
import { Handle, Position } from '@vue-flow/core'
import NodeTitle from './NodeTitle.vue'
defineProps({ id: { type: String, required: true }, data: { type: Object, required: true }, selected: Boolean })
</script>

<style scoped>
.text-card{width:240px;border:1px solid #4a5b74;border-radius:12px;background:#1a2432;color:#f0f4fa;box-shadow:0 9px 28px #0004}
.text-card.linked{border-color:#8f7fe0}
.text-card.selected{border-color:#a3b4ff;box-shadow:0 0 0 2px #829dff40}
.card-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;font-size:12px}
.card-heading small{white-space:nowrap;color:#93a6bf;font-size:10px}
textarea{box-sizing:border-box;width:100%;min-height:96px;max-height:260px;border:0;border-top:1px solid #2c3b50;border-radius:0 0 12px 12px;background:#131c28;color:#e7eef8;padding:10px 12px;font:inherit;font-size:12px;line-height:1.55;resize:vertical}
textarea:focus-visible{outline:2px solid #b6c3ff;outline-offset:-2px}
</style>
