const assert = require('node:assert/strict')
const { test } = require('node:test')
const { reserveReplyTemplates } = require('./reply-template-rotation')
const templates = ['A', 'B', 'C'].map((content, id) => ({ id, content }))

test('each selection excludes the previous content including across runs', () => {
  const first = reserveReplyTemplates(templates, 5, 'A', () => 0)
  assert.deepEqual(first.contents, ['B', 'A', 'B', 'A', 'B'])
  const next = reserveReplyTemplates(templates, 1, first.lastContent, () => 0)
  assert.deepEqual(next.contents, ['A'])
})

test('new templates participate in random selection immediately', () => {
  const expanded = [...templates, { id: 4, content: 'D' }]
  assert.deepEqual(reserveReplyTemplates(expanded, 1, 'A', () => 0).contents, ['B'])
  assert.deepEqual(reserveReplyTemplates(expanded, 1, 'A', () => 0.99).contents, ['D'])
})

test('equivalent text is excluded even with different template ids', () => {
  const duplicated = [{ content: '谢谢支持' }, { content: ' 谢谢 支持 ' }, { content: '欢迎再来' }]
  assert.deepEqual(reserveReplyTemplates(duplicated, 1, '谢谢支持', () => 0).contents, ['欢迎再来'])
})

test('single template can repeat and removed previous template does not block selection', () => {
  assert.deepEqual(reserveReplyTemplates([templates[0]], 2, 'A').contents, ['A', 'A'])
  assert.deepEqual(reserveReplyTemplates(templates, 1, '已删除', () => 0).contents, ['A'])
})

test('empty batch preserves last content', () => {
  assert.deepEqual(reserveReplyTemplates(templates, 0, 'B'), { contents: [], lastContent: 'B' })
})
