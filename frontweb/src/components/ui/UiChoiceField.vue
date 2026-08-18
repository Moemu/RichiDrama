<template>
  <section class="ui-choice-field" :class="{ 'is-open': open, 'is-disabled': disabled }">
    <span :id="labelId" class="ui-choice-field__label">{{ label }}</span>
    <button
      :id="triggerId"
      ref="trigger"
      class="ui-choice-field__trigger"
      type="button"
      :aria-controls="panelId"
      :aria-expanded="String(open)"
      :aria-labelledby="labelId"
      :disabled="disabled"
      @click="toggle"
      @keydown.down.prevent="openPanel"
      @keydown.up.prevent="openPanel"
      @keydown.esc.prevent="closePanel"
    >
      <span class="ui-choice-field__value">{{ selectedLabel }}</span>
      <span class="ui-choice-field__chevron" aria-hidden="true">⌄</span>
    </button>
    <Transition name="ui-choice-expand">
      <div v-if="open" :id="panelId" class="ui-choice-field__panel" role="listbox" :aria-labelledby="labelId">
        <button
          v-for="option in normalizedOptions"
          :key="String(option.value)"
          class="ui-choice-field__option"
          :class="{ 'is-selected': isSelected(option.value) }"
          type="button"
          role="option"
          :aria-selected="String(isSelected(option.value))"
          @click="select(option.value)"
        >
          <span class="ui-choice-field__option-copy"><b>{{ option.label }}</b><small v-if="option.description">{{ option.description }}</small></span>
          <span v-if="isSelected(option.value)" class="ui-choice-field__check" aria-hidden="true">✓</span>
        </button>
      </div>
    </Transition>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  modelValue: { type: [String, Number, Boolean, null], default: '' },
  options: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'change'])
const open = ref(false)
const trigger = ref(null)
const uid = `choice-${Math.random().toString(36).slice(2, 9)}`
const labelId = `${uid}-label`
const triggerId = `${uid}-trigger`
const panelId = `${uid}-panel`
const normalizedOptions = computed(() => props.options.map((option) => typeof option === 'object' ? option : { label: String(option), value: option }))
const selectedOption = computed(() => normalizedOptions.value.find((option) => isSelected(option.value)))
const selectedLabel = computed(() => selectedOption.value?.label || '请选择')

function isSelected(next) { return String(next ?? '') === String(props.modelValue ?? '') }
function toggle() { if (!props.disabled) open.value = !open.value }
function openPanel() { if (!props.disabled) open.value = true }
function closePanel() { open.value = false; trigger.value?.focus() }
function select(next) {
  emit('update:modelValue', next)
  emit('change', next)
  closePanel()
}
</script>

<style scoped>
.ui-choice-field{display:grid;gap:6px;min-width:0}.ui-choice-field__label{color:var(--ui-text-2);font-size:14px;font-weight:550;line-height:1.4}.ui-choice-field__trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;min-height:40px;padding:8px 10px;border:1px solid var(--ui-line-2);border-radius:var(--ui-radius-control);background:var(--ui-surface-2);color:var(--ui-text-1);text-align:left;cursor:pointer;transition:border-color var(--ui-motion-fast) var(--ui-ease-standard),background-color var(--ui-motion-fast) var(--ui-ease-standard)}.ui-choice-field__trigger:hover,.is-open .ui-choice-field__trigger{border-color:var(--ui-accent);background:var(--ui-surface-3)}.ui-choice-field__trigger:disabled{cursor:not-allowed;opacity:.55}.ui-choice-field__value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ui-choice-field__chevron{flex:0 0 auto;color:var(--ui-text-3);font-size:18px;line-height:1;transition:transform var(--ui-motion-fast) var(--ui-ease-standard)}.is-open .ui-choice-field__chevron{transform:rotate(180deg)}.ui-choice-field__panel{display:grid;gap:4px;max-height:292px;padding:4px;overflow:auto;border:1px solid var(--ui-line-1);border-radius:10px;background:var(--ui-surface-1)}.ui-choice-field__option{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:42px;padding:8px 10px;border:0;border-radius:7px;background:transparent;color:var(--ui-text-2);text-align:left;cursor:pointer}.ui-choice-field__option:hover,.ui-choice-field__option:focus-visible{background:var(--ui-surface-hover);color:var(--ui-text-1)}.ui-choice-field__option.is-selected{background:color-mix(in srgb,var(--ui-accent) 18%,var(--ui-surface-2));color:var(--ui-text-1)}.ui-choice-field__option-copy{display:grid;gap:2px;min-width:0}.ui-choice-field__option-copy b{font-size:14px;font-weight:550;line-height:1.35}.ui-choice-field__option-copy small{color:var(--ui-text-3);font-size:12px;line-height:1.35}.ui-choice-field__check{flex:0 0 auto;color:var(--ui-accent);font-weight:700}.ui-choice-expand-enter-active,.ui-choice-expand-leave-active{transition:opacity var(--ui-motion-fast) var(--ui-ease-standard),transform var(--ui-motion-fast) var(--ui-ease-standard)}.ui-choice-expand-enter-from,.ui-choice-expand-leave-to{opacity:0;transform:translateY(-4px)}
</style>
