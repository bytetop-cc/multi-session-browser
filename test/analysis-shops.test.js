const test=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
test('single-store report, independent history, legacy preservation and no group configuration',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'single-shop-analysis-')),original=Module._load;
 let data;
 try{Module._load=function(name,...args){if(name==='electron')return {app:{getPath:()=>dir}};return original.call(this,name,...args)};data=require('../db');data.initDatabase()}finally{Module._load=original}
 const {db,metricService}=data;
 try{
 const {createAnalysisService}=require('../analysis-service'),service=createAnalysisService({db});
 for(const [i,shop_name] of ['门店甲','门店乙'].entries())for(const platform of ['美团','点评'])metricService.upsert({shop_id:String(i+1),shop_name,platform,stat_date:'2026-11-04',exposure:(i+1)*10,visits:2,orders:1,order_amount:(i+1)*100,verify_uv:1,verify_amount:50,order_coupons:1,verify_coupons:1,star:4.2,new_reviews:0,new_bad_reviews:0,bad_reply_rate:0});
 const query={mode:'daily',anchor:'2026-11-04'},a=service.report({...query,shopName:'门店甲'}),b=service.report({...query,shopName:'门店乙'});
 assert.equal(a.shop.name,'门店甲');assert.equal(a.summary.order_amount,200);assert.equal(b.summary.order_amount,400);assert(a.details.every(r=>r.shop_name==='门店甲'));assert.notEqual(a.group.id,b.group.id);assert.equal(service.groups().length,0);
 const insert=db.prepare("INSERT INTO analysis_runs(group_id,group_name,mode,anchor,start_date,end_date,prompt,snapshot_json,model,status,result) VALUES(?,?,'daily','2026-11-04','2026-11-04','2026-11-04','x',?,'test','success','saved')");
 const aid=Number(insert.run(a.group.id,'门店甲',JSON.stringify(a)).lastInsertRowid);const bid=Number(insert.run(b.group.id,'门店乙',JSON.stringify(b)).lastInsertRowid);
 const legacy=Number(insert.run(99,'旧单店',JSON.stringify({...a,group:{id:99,name:'旧单店',shops:['门店甲']}})).lastInsertRowid);
 insert.run(100,'旧组合',JSON.stringify({...a,group:{id:100,name:'旧组合',shops:['门店甲','门店乙']}}));
 assert.deepEqual(service.history('门店甲').map(r=>r.id),[legacy,aid]);assert.deepEqual(service.history('门店乙').map(r=>r.id),[bid]);assert.equal(db.prepare('SELECT COUNT(*) n FROM analysis_runs').get().n,4);
 assert.throws(()=>service.report({...query,shopName:'未知店'}),/暂无/);assert.equal(service.runRecord(aid).result,'saved');
 const before=service.runRecord(aid),updated=service.updateResult({id:aid,result:'# 修改后的报告\n\n补充行动建议'});
 assert.equal(updated.id,aid);assert(updated.updated_at);assert.equal(updated.created_at,before.created_at);assert.deepEqual(updated.snapshot,before.snapshot);assert.equal(db.prepare('SELECT COUNT(*) n FROM analysis_runs').get().n,4);
 assert.throws(()=>service.updateResult({id:aid,result:'  '}),/分析内容/);assert.throws(()=>service.updateResult({id:-1,result:'x'}),/无效/);assert.throws(()=>service.updateResult({id:aid,result:'x'.repeat(200001)}),/分析内容/);
 db.prepare("UPDATE analysis_runs SET status='running' WHERE id=?").run(bid);assert.throws(()=>service.updateResult({id:bid,result:'x'}),/已完成/);
 db.prepare("UPDATE analysis_runs SET status='failed' WHERE id=?").run(bid);assert.throws(()=>service.updateResult({id:bid,result:'x'}),/已完成/);
 const Database=require('better-sqlite3'),reopened=new Database(db.name);try{const restored=createAnalysisService({db:reopened});assert.equal(restored.runRecord(aid).result,updated.result)}finally{reopened.close()}

 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
