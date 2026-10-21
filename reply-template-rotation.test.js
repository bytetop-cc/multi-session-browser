const assert = require('node:assert/strict')
const { test } = require('node:test')
const { reserveReplyTemplates } = require('./reply-template-rotation')

test('only least-used templates are selected, with random tie breaking', () => {
  const templates = [
    { id: 1, content: 'A', use_count: 5 },
    { id: 2, content: 'B', use_count: 1 },
    { id: 3, content: 'C', use_count: 1 }
  ]
  const result = reserveReplyTemplates(templates, 2, () => 0.99)
  assert.deepEqual(result.contents, ['C', 'B'])
  assert.deepEqual([...result.increments], [[3, 1], [2, 1]])
})

test('persisted increments keep subsequent runs balanced', () => {
  const templates = ['A', 'B', 'C'].map((content, id) => ({ id, content, use_count: 0 }))
  const first = reserveReplyTemplates(templates, 2, () => 0)
  for (const [id, amount] of first.increments) templates[id].use_count += amount
  assert.deepEqual(reserveReplyTemplates(templates, 1, () => 0).contents, ['C'])
})

test('identical text shares total usage instead of gaining extra selection weight', () => {
  const result = reserveReplyTemplates([
    { id: 1, content: '谢谢支持', use_count: 1 },
    { id: 2, content: ' 谢谢 支持 ', use_count: 1 },
    { id: 3, content: '欢迎再来', use_count: 1 }
  ], 1, () => 0)
  assert.deepEqual(result.contents, ['欢迎再来'])
})
