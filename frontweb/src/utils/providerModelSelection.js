export function providerGroups(configs, type, sharedImages = false) {
  const groups = new Map()
  for (const config of configs) {
    if (!config.is_active || !(config.service_type === type || (sharedImages && type === 'storyboard_image' && config.service_type === 'image' && config.provider_connection_id))) continue
    const id = config.provider_connection_id ? `provider-${config.provider_connection_id}` : `config-${config.id}`
    if (!groups.has(id)) groups.set(id, { id, name: config.provider_connection_name || config.name, configs: [], models: [] })
    const group = groups.get(id)
    group.configs.push(config)
    group.models = [...new Set([...group.models, ...config.model])]
  }
  return [...groups.values()]
}

export function resolveProviderConfig(group, model, type, currentId) {
  const candidates = group.configs.filter(config => !model || config.model.includes(model))
  return candidates.find(config => config.id === currentId) || candidates.find(config => config.service_type === type) || candidates[0]
}
