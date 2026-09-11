export async function loadAllProjects(list) {
  const items = []
  let page = 1
  let result
  do {
    result = await list({ page, page_size: 50 })
    const batch = result?.items || []
    items.push(...batch)
    if (!batch.length) break
    page++
  } while (items.length < Number(result?.pagination?.total || 0))
  return { items: [...new Map(items.map(item => [item.id, item])).values()], pagination: { total: result?.pagination?.total ?? items.length } }
}
