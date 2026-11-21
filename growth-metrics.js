// 解析门店等级与经营评分接口（不区分美团/点评，仅返回当前快照）。
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function parseGradeModule(response) {
  const nodes = response?.data?.data?.processNodeList
  if (!Array.isArray(nodes)) return null
  const node = nodes.find(item => item && item.status === 1) ||
    nodes.find(item => item?.gradeCard?.title === '当前等级')
  if (!node) return null
  const card = node.gradeCard || {}
  const gradeDTO = card.gradeDTO || {}
  const gradeName = text(node.nodeText) || text(gradeDTO.gradeName)
  if (!gradeName) return null
  const rawValue = Number(node.uniformGradeValue ?? gradeDTO.gradeValue)
  return {
    gradeName,
    gradeValue: Number.isFinite(rawValue) ? rawValue : null,
    gradeExpire: text(card.disableTime) || null
  }
}

function parseScoreDetail(response) {
  const raw = response?.data?.data?.score
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  const score = Number(raw)
  return Number.isFinite(score) && score >= 0 ? score : null
}

module.exports = { parseGradeModule, parseScoreDetail }
