// AI 工具箱共用：按服务类型拉取已启用模型列表（带缓存，避免每个工具重复请求）。
import { ref } from 'vue'
import { aiAPI } from '@/api/ai'

const cache = {}

function configModels(configs) {
  return [...new Set((configs || []).filter((item) => item.is_active !== false).flatMap((item) => Array.isArray(item.model) ? item.model : item.model ? [item.model] : []).filter(Boolean))]
}

export function useModelOptions(serviceType) {
  const models = ref([])
  if (!cache[serviceType]) {
    cache[serviceType] = aiAPI.list(serviceType)
      .then(configModels)
      .catch(() => [])
  }
  cache[serviceType].then((list) => { models.value = list })
  return models
}
