/**
 * 模型展示名。提交值永远是模型 id，这里只负责把目录里的 display_name 用于显示，
 * 避免出现"界面一个名、请求另一个名"的两套名字。
 */
export function collectDisplayNames(configs) {
  return (configs || []).reduce((names, config) => {
    for (const [model, display] of Object.entries(config?.display_names || {})) {
      if (display && display !== model) names[model] = String(display)
    }
    return names
  }, {})
}

export function modelLabel(names, model) {
  const id = String(model || '')
  if (!id) return '未选择'
  return names?.[id] || id
}
