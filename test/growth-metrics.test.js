const test=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const {parseGradeModule,parseScoreDetail}=require('../growth-metrics')

test('parse current grade and score snapshot',()=>{
 const gradeResponse={code:200,data:{code:200,data:{processNodeList:[
  {status:0,nodeText:'暂无等级',uniformGradeValue:0,gradeCard:{title:'已超越等级',gradeDTO:{gradeName:'暂无等级',gradeValue:0}}},
  {status:1,nodeText:'铜牌',uniformGradeValue:1,gradeCard:{title:'当前等级',disableTime:'有效期至 11月21日',gradeDTO:{gradeName:'铜牌',gradeValue:1}}},
  {status:2,nodeText:'银牌',uniformGradeValue:2,gradeCard:{title:'待获得等级',gradeDTO:{gradeName:'银牌',gradeValue:2}}}
 ]}}}
 assert.deepEqual(parseGradeModule(gradeResponse),{gradeName:'铜牌',gradeValue:1,gradeExpire:'有效期至 11月21日'})
 assert.deepEqual(parseGradeModule({data:{data:{processNodeList:[{status:1,gradeCard:{title:'当前等级',gradeDTO:{gradeName:'金牌'}}}]}}}),{gradeName:'金牌',gradeValue:null,gradeExpire:null})
 assert.equal(parseGradeModule({data:{data:{processNodeList:[]}}}),null)
 assert.equal(parseGradeModule(null),null)
 assert.equal(parseScoreDetail({code:200,data:{data:{score:64.7}}}),64.7)
 assert.equal(parseScoreDetail({data:{data:{score:'--'}}}),null)
 assert.equal(parseScoreDetail({data:{data:{score:-1}}}),null)
 assert.equal(parseScoreDetail(null),null)
})

test('growth snapshots keep latest per shop and do not reuse newer data',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'growth-test-'));const original=Module._load
 Module._load=function(name,...args){if(name==='electron')return {app:{getPath:()=>dir}};return original.call(this,name,...args)}
 let data
 try{data=require('../db');data.initDatabase()}finally{Module._load=original}
 const {metricService,db}=data
 metricService.saveGrowthMetrics({shopId:'101',shopName:'门店甲',date:'2026-11-04',gradeName:'铜牌',gradeValue:1,gradeExpire:'有效期至 11月21日',score:64.7})
 metricService.saveGrowthMetrics({shopId:'101',shopName:'门店甲',date:'2026-11-05',gradeName:'银牌',gradeValue:2,gradeExpire:null,score:70.2})
 // 同日重复同步时缺失字段不覆盖已采集值。
 metricService.saveGrowthMetrics({shopId:'101',shopName:'门店甲',date:'2026-11-05',gradeName:null,gradeValue:null,gradeExpire:null,score:71})
 assert.deepEqual(metricService.getGrowthSnapshot({shopNames:['门店甲'],endDate:'2026-11-05'}),[{shop_id:'101',shop_name:'门店甲',stat_date:'2026-11-05',grade_name:'银牌',grade_value:2,grade_expire:null,score:71}])
 assert.equal(metricService.getGrowthSnapshot({shopNames:['门店甲'],endDate:'2026-11-04'})[0].grade_name,'铜牌')
 assert.deepEqual(metricService.getGrowthSnapshot({shopNames:['门店甲'],endDate:'2026-11-03'}),[])
 assert.deepEqual(metricService.getGrowthSnapshot({shopNames:[],endDate:'2026-11-05'}),[])
 db.close();fs.rmSync(dir,{recursive:true,force:true})
})
