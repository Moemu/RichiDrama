<template>
  <span class="node-title" :title="modelValue || placeholder" @dblclick.stop="begin">
    <input v-if="editing" ref="field" v-model="draft" class="nodrag nopan nowheel" maxlength="100" :placeholder="placeholder" @pointerdown.stop @keydown.stop @keydown.enter.prevent="commit" @keydown.esc.prevent="cancel" @blur="commit" />
    <template v-else>{{ modelValue || placeholder }}</template>
  </span>
</template>

<script setup>
import { nextTick, ref } from 'vue'
const props = defineProps({ modelValue: { type: String, default: '' }, placeholder: { type: String, default: '未命名' } })
const emit = defineEmits(['update:modelValue'])
const editing = ref(false), draft = ref(''), field = ref(null)
function begin() { if (editing.value) return; draft.value = props.modelValue || ''; editing.value = true; nextTick(() => field.value?.select()) }
function commit() {
  if (!editing.value) return
  editing.value = false
  const value = draft.value.trim()
  if (value !== (props.modelValue || '')) emit('update:modelValue', value)
}
function cancel() { editing.value = false }
</script>

<style scoped>
.node-title{display:block;min-width:0;overflow:hidden;color:#f0f4fa;text-overflow:ellipsis;white-space:nowrap;font-weight:600;cursor:text}
.node-title input{box-sizing:border-box;width:100%;min-width:90px;border:1px solid #5a6c8c;border-radius:5px;background:#0e1620;color:#edf2f9;padding:3px 5px;font:inherit;font-weight:600}
</style>
