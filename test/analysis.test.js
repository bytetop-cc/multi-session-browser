const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),os=require('node:os'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const core=require('../analysis-core')
test('period boundaries and missing data',()=>{
 const weeks=core.periods('weekly','2026-01-01');assert.equal(weeks.length,7);assert.equal(weeks[6].start,'2025-12-29');assert.equal(weeks[6].end,'2026-01-04')
 const months=core.periods('monthly','2024-02-10');assert.equal(months.length,12);assert.equal(months[11].end,'2024-02-29');assert.equal(months[0].start,'2023-03-01')
 assert.equal(core.summarize([]).order_amount,null);assert.equal(core.summarize([{order_amount:0}]).order_amount,0)
 assert.throws(()=>core.periods('daily','2026-02-30'));assert.equal(core.endpoint('https://example.invalid/v1'),'https://example.invalid/v1/chat/completions')
})
test('groups, shop metrics dedupe, AI HTTP failure/retry, immutable snapshots and persistence',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'analysis-test-'));const original=Module._load
 Module._load=function(name,...args){if(name==='electron')return {app:{getPath:()=>dir}};return original.call(this,name,...args)}
 let data
 try{data=require('../db');data.initDatabase()}finally{Module._load=original}
 const {db,metricService}=data
 const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('encrypted:'+value),decryptString:value=>value.toString().slice(10)}
 const {createAnalysisService}=require('../analysis-service');let service=createAnalysisService({db,safeStorage});const groupId=service.saveGroup({name:'区域一',shops:['门店甲']})
 const metric={shop_id:'101',shop_name:'门店甲',stat_date:'2026-11-04',exposure:17,visits:2,orders:0,order_amount:0,verify_uv:0,verify_amount:0,order_coupons:0,verify_coupons:0,star:4.2,new_reviews:0,new_bad_reviews:0,bad_reply_rate:0}
 metricService.upsert({...metric,platform:'点评'});metricService.upsert({...metric,platform:'美团',exposure:61,visits:12,orders:5,order_amount:750,verify_uv:5,verify_amount:750})
 metricService.saveCallTotal({shopId:'101',shopName:'门店甲',date:metric.stat_date,total:3})
 metricService.saveRefundMetrics({shopId:'101',platform:'美团',date:metric.stat_date,coupons:0,amount:0})
 const aliasGroup=service.saveGroup({name:'括号映射',shops:['门店（甲）']});assert.equal(service.report({groupId:aliasGroup,mode:'daily',anchor:'2026-11-04'}).summary.exposure,78);
 const query={groupId,mode:'daily',anchor:'2026-11-04'},report=service.report(query)
 assert.equal(report.summary.exposure,78);assert.equal(report.shop_metrics.shop_call_totals.total,3);assert.equal(report.trend.length,7);assert.equal(report.trend.at(-1).order_amount,report.summary.order_amount);assert.equal(report.trend[0].order_amount,null);assert.equal(report.coverage.observed_shop_days,1)
 let mode='error',requests=[]
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({url:req.url,body:JSON.parse(body),authorization:req.headers.authorization});if(mode==='error'){res.writeHead(503);res.end('unavailable')}else if(mode==='empty'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[]}))}else if(mode==='slow'){setTimeout(()=>res.end('{}'),60)}else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'本期曝光 78 人次；建议核对门店转化。'}}]}))}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/v1/chat/completions'
 try{
 service.saveConfig({url,model:'local-fixture',key:'test-key'});assert.equal(service.config().hasKey,true);assert.equal(service.config().key,undefined);assert.equal(db.prepare('SELECT value FROM settings WHERE key=?').get('analysis_key_encrypted').value.includes('test-key'),false)
 const failed=await service.run({...query,prompt:'分析经营数据'});assert.equal(failed.status,'failed');assert.match(failed.error,/503/)
 metricService.upsert({...metric,platform:'美团',exposure:200});mode='success'
 const retry=await service.run({retryId:failed.id,prompt:'按原数据分析'});assert.equal(retry.status,'success');assert.equal(retry.retry_of,failed.id);assert.equal(retry.snapshot.summary.exposure,78);assert.equal(service.report(query).summary.exposure,217);assert.equal(service.history(groupId).length,2)
 assert.equal(requests[1].body.model,'local-fixture');assert.equal(requests[1].body.stream,false);assert.equal(requests[1].body.messages[0].content,'按原数据分析');assert(!requests[1].body.messages[1].content.includes('test-key'));assert(requests[1].body.messages[1].content.includes('details'))
 mode='empty';const invalid=await service.run(query);assert.equal(invalid.status,'failed');assert.match(invalid.error,/没有返回/)
 mode='slow';await assert.rejects(core.requestAnalysis({url,key:'test',model:'test',prompt:'test',snapshot:report,timeout:10}))
 db.prepare("INSERT INTO analysis_runs(group_id,group_name,mode,anchor,start_date,end_date,prompt,snapshot_json,model,status) VALUES(1,'组','daily','2026-11-04','2026-11-04','2026-11-04','x','{}','x','running')").run();service=createAnalysisService({db,safeStorage});assert.equal(service.history(groupId)[0].status,'failed')
 assert.equal(service.runRecord(retry.id).result,retry.result);assert.equal(requests.filter(r=>r.url==='/v1/chat/completions').length,4)
 }finally{await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(dir,{recursive:true,force:true})}
})
