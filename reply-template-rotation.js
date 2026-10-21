// 从使用次数最少的文案中随机选择；相同内容共用累计次数。
function reserveReplyTemplates(templates, count, random = Math.random) {
  const groups = new Map()
  for (const template of templates) {
    const content = String(template.content || '').trim()
    const key = content.normalize('NFKC').replace(/\s+/gu, '')
    if (!key) continue
    if (!groups.has(key)) groups.set(key, { content, used: 0, ids: [] })
    const group = groups.get(key)
    group.used += Number(template.use_count) || 0
    group.ids.push(template.id)
  }
  const choices = [...groups.values()]
  if (!choices.length) throw new Error('没有可用的好评回复文案')
  const contents = []
  const increments = new Map()
  for (let i = 0; i < count; i++) {
    const minimum = Math.min(...choices.map(t => t.used))
    const candidates = choices.filter(t => t.used === minimum)
    const selected = candidates[Math.floor(random() * candidates.length)]
    selected.used++
    const id = selected.ids[0]
    increments.set(id, (increments.get(id) || 0) + 1)
    contents.push(selected.content)
  }
  return { contents, increments }
}

module.exports = { reserveReplyTemplates }
