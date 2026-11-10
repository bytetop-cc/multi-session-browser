const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
test('partial board saves preserve full metrics, keep zeros, isolate platforms and store unknowns as null',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'simple-board-')),original=Module._load;
  let data;
  try {
    Module._load=function(name,...args){if(name==='electron')return {app:{getPath:()=>dir}};return original.call(this,name,...args)};
    data=require('../db');data.initDatabase();
  } finally {Module._load=original}
  const {db,metricService}=data;
  try {
    const base={shop_id:'42',shop_name:'测试店',platform:'点评',stat_date:'2026-11-07'};
    metricService.upsert({...base,orders:7,verify_uv:9,new_reviews:3,new_good_reviews:2,star:4.6,exposure:100});
    metricService.upsert({...base,exposure:73,order_amount:0},{preserveMissing:true});
    let row=db.prepare('SELECT * FROM daily_metrics WHERE platform = ?').get('点评');
    assert.equal(row.exposure,73);assert.equal(row.orders,7);assert.equal(row.verify_uv,9);assert.equal(row.new_reviews,3);assert.equal(row.new_good_reviews,2);assert.equal(row.order_amount,0);
    metricService.upsert({...base,platform:'美团',exposure:5},{preserveMissing:true});
    row=db.prepare('SELECT * FROM daily_metrics WHERE platform = ?').get('美团');
    assert.equal(row.exposure,5);assert.equal(row.new_good_reviews,null);assert.equal(row.orders,null);assert.equal(row.star,null);assert.equal(row.verify_uv,null);
    metricService.upsert({...base,new_reviews:0,new_good_reviews:0,new_bad_reviews:0,bad_reply_rate:0,star:4.9},{preserveMissing:true});
    row=db.prepare('SELECT * FROM daily_metrics WHERE platform = ?').get('点评');
    assert.equal(row.new_reviews,0);assert.equal(row.new_good_reviews,0);assert.equal(row.new_bad_reviews,0);assert.equal(row.bad_reply_rate,0);assert.equal(row.star,4.9);assert.equal(row.orders,7);
    metricService.saveDetails({shopId:'42',shopName:'测试店',platform:'点评',date:base.stat_date,requestBody:'pageType=simpleDataBoard',response:{data:[]},endpoint:'/gateway/adviser/data'});
    assert.equal(metricService.getDetails({shopId:'42',platform:'点评',startDate:base.stat_date,endDate:base.stat_date})[0].endpoint,'/gateway/adviser/data');
    metricService.upsert({...base,is_mock:1,orders:999});
    metricService.upsert({...base,exposure:73},{preserveMissing:true});
    row=db.prepare('SELECT * FROM daily_metrics WHERE platform = ?').get('点评');
    assert.equal(row.orders,null);assert.equal(row.is_mock,0);
    db.exec('ALTER TABLE daily_metrics DROP COLUMN new_good_reviews');
    data.initDatabase();
    row=db.prepare('SELECT * FROM daily_metrics WHERE platform = ?').get('点评');
    assert.equal(row.new_good_reviews,null);assert.equal(row.exposure,73);
    data.initDatabase();
  } finally {db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
