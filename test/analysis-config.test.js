const test = require('node:test')
const assert = require('node:assert/strict')
const { analysisRequestBody } = require('../analysis-core')

test('reasoning is only sent when explicitly configured, regardless of model', () => {
  for (const model of ['gpt-6.1-sol', 'custom-model']) {
    const args = { model, prompt: '分析', snapshot: { summary: { count: 1 }, details: ['private-detail'] } }
    for (const reasoningEffort of [undefined, '']) {
      assert.equal(Object.hasOwn(analysisRequestBody({ ...args, reasoningEffort }), 'reasoning_effort'), false)
    }
    assert.equal(analysisRequestBody({ ...args, reasoningEffort: 'medium' }).reasoning_effort, 'medium')
    assert.equal(analysisRequestBody(args).messages[1].content.includes('private-detail'), false)
    assert.deepEqual(args.snapshot.details, ['private-detail'])
  }
})

test('reasoning config persists, clears, and validates before writing', () => {
  const db = new (require('better-sqlite3'))(':memory:')
  try {
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)')
    const { createAnalysisService } = require('../analysis-service')
    let service = createAnalysisService({ db })
    const args = { url: 'https://api.openai.com/v1', model: 'gpt-6.1-sol' }
    assert.equal(service.config().reasoningEffort, '')
    service.saveConfig({ ...args, reasoningEffort: 'medium' })
    service = createAnalysisService({ db })
    assert.equal(service.config().reasoningEffort, 'medium')
    assert.throws(() => service.saveConfig({ ...args, model: 'changed', reasoningEffort: 'invalid' }), /思考程度/)
    assert.equal(service.config().model, args.model)
    assert.equal(service.config().reasoningEffort, 'medium')
    service.saveConfig({ ...args, reasoningEffort: '' })
    assert.equal(service.config().reasoningEffort, '')
    assert.equal(Object.hasOwn(analysisRequestBody({ ...service.config(), snapshot: {}, prompt: '' }), 'reasoning_effort'), false)
  } finally { db.close() }
})

test('AI input includes comparison and operating details with shop-day metrics deduplicated',()=>{
 const row={shop_name:'测试店',stat_date:'2026-11-04',platform:'美团',exposure:10,visits:0,call_total:3,promo_pay_amount:100,phone:'private-phone',api_key:'private-key',response_json:'raw-response'};
 const snapshot={summary:{exposure:20},comparison:{metrics:[{key:'exposure',previous:10,current:20}]},details:[row,{...row,platform:'点评'}]};
 const content=analysisRequestBody({model:'test',prompt:'诊断',snapshot}).messages[1].content;
 const input=JSON.parse(content.slice(content.indexOf('\n')+1));
 assert.equal(input.details.length,2);assert.equal(input.details[0].visits,0);assert.deepEqual(input.comparison,snapshot.comparison);
 assert.equal(input.shop_daily_metrics.length,1);assert.equal(input.shop_daily_metrics[0].call_total,3);assert.equal(input.shop_daily_metrics[0].promo_pay_amount,100);
 assert.equal(input.details[0].call_total,undefined);for(const value of ['private-phone','private-key','raw-response'])assert(!content.includes(value));
 assert.equal(snapshot.details[0].call_total,3);
});
