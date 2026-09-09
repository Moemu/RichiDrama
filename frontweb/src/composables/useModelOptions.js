// 每次进入工具重新读取目录，避免沿用已经下架的模型。
import { ref } from 'vue'
import { aiAPI } from '@/api/ai'

function configModels(configs) {
  return [...new Set((configs || []).filter((item) => item.is_active !== false).flatMap((item) => Array.isArray(item.model) ? item.model : item.model ? [item.model] : []).filter(Boolean))]
}

export function useModelOptions(serviceType) {
  const models = ref([])
  aiAPI.list(serviceType, { selectable: true })
    .then(configModels)
    .then((list) => { models.value = list })
    .catch(() => { models.value = [] })
  return models
}
