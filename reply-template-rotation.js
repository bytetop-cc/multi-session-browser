// 排除门店上一次使用的文案后随机选择，不依赖使用次数。
function reserveReplyTemplates(templates, count, lastContent = null, random = Math.random) {
  const normalize = content => String(content || '').normalize('NFKC').replace(/\s+/gu, '')
  const unique = new Map()
  for (const template of templates) {
    const content = String(template.content || '').trim()
    const key = normalize(content)
    if (key && !unique.has(key)) unique.set(key, content)
  }
  const choices = [...unique.keys()]
  if (!choices.length) throw new Error('没有可用的好评回复文案')
  let lastKey = normalize(lastContent)
  const contents = []
  for (let i = 0; i < count; i++) {
    // 只有一条不同文案时允许继续使用，避免任务无法执行。
    const candidates = choices.length > 1 ? choices.filter(key => key !== lastKey) : choices
    lastKey = candidates[Math.floor(random() * candidates.length)]
    lastContent = unique.get(lastKey)
    contents.push(lastContent)
  }
  return { contents, lastContent }
}

module.exports = { reserveReplyTemplates }
