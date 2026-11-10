const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const simpleBoard = require('../simple-board');
const { parseSimpleBoard, shanghaiYesterday, parseReviewOverviewStar, parseRecentReviewStats } = simpleBoard;
const main = fs.readFileSync(require.resolve('../main'), 'utf8');
test('simple board missing people metrics never produce zero conversion rates', () => {
  const {summarize}=require('../analysis-core');
  const summary=summarize([{exposure:83,visits:11,orders:null,verify_uv:null,order_coupons:1}]);
  assert.equal(summary.visit_rate,11/83);assert.equal(summary.order_rate,null);assert.equal(summary.verify_rate,null);
  assert.equal(summarize([{exposure:83,visits:null}]).visit_rate,null);
  assert.equal(summarize([{visits:11,orders:0}]).order_rate,0);
  assert.equal(summarize([{orders:1,verify_uv:null}]).verify_rate,null);
});
const fixture = () => ({code:200,success:true,data:[
  {componentId:'simpleDataBoardOverview',body:[
    {name:'曝光人数',value:'73'},{name:'访问人数',value:'14'},
    {name:'下单券数',value:'0'},{name:'下单金额（原价）',value:'0'},
    {name:'核销券数',value:'1'},{name:'核销金额（原价）',value:'240'}]},
  {componentId:'simpleDataBoardFlowSummaryPC',body:[{name:'曝光次数',value:'101'},{name:'访问次数',value:'30'}]},
  {componentId:'simpleDataBoardStarSummaryPC',body:[{name:'大众点评星级',value:'4.6星'},{name:'美团星级',value:'4.8星'}]}
]});
test('simple board maps people, coupons, original amounts and platform-specific stars', () => {
  assert.deepEqual(parseSimpleBoard(fixture(),'点评'),{exposure:73,visits:14,order_coupons:0,order_amount:0,verify_coupons:1,verify_amount:240,star:4.6});
  assert.equal(parseSimpleBoard(fixture(),'美团').star,4.8);
  const data=fixture();
  data.data[0].body=[{name:'曝光人数',value:'--'},{name:'访问人数',value:''},{name:'核销金额（原价）',value:'1,240.50'},{name:'下单券数',value:'12oops'}];
  data.data[2].success=false;
  assert.deepEqual(parseSimpleBoard(data,'点评'),{verify_amount:1240.5});
});
async function sync({status=401,businessCode=401,simpleStatus=200,empty=false,noRightsShop=false,date='2026-11-07',statsStatus=200,statsResponse={code:200,success:true,data:{newReviewCount:0,newGoodReviewCount:0,newBadReviewCount:0,badReviewReplyPercent:'0.00%'}},reviewStatus=200,reviewResponse={code:200,success:true,data:{star:'4.9',totalReviewCount:69}}}={}) {
  const requests=[],saved=[],details=[],refunds=[],notices=[];
  const context=vm.createContext({console:{log(){},error(){}},URLSearchParams,require:name=> {assert.equal(name,'./simple-board');return {...simpleBoard,shanghaiYesterday:()=> '2026-11-08'}},
    abortRangeSync:false,shopService:{getAll:()=> [{name:'测试店'}]},mainWindow:null,setTimeout:fn=> fn(),
    reportTaskError:(_,notice)=> notices.push(notice),
    metricService:{saveBookingTotal(){},savePromoMetrics(){},saveCallTotal(){},saveRefundMetrics:row=> refunds.push(row),saveDetails:row=> details.push(row),upsert:(row,options)=> saved.push({row,options})}});
  const tab={id:'test',view:{webContents:{executeJavaScript:async code=> {
    new vm.Script(code);
    if(code.includes('/gateway/merchant/general/shopinfo'))return [{shopId:42,shopName:'测试店'}];
    if(code.includes('/trade/order/orderlist.api'))return 0;
    if(code.includes('queryPromoCodeKPIsV2'))return {};
    if(code.includes('querycallrecordlist'))return 0;
    return vm.runInNewContext(code,{AbortSignal,fetch:async (url,options)=> {
      requests.push({url,options});
      if(url.startsWith('/gateway/merchant/review/recentStats?'))return {ok:statsStatus===200,json:async()=>statsResponse};
      if(url.startsWith('/gateway/merchant/review/overview?'))return {ok:reviewStatus===200,json:async()=>reviewResponse};
      const simple=url.startsWith('/gateway/adviser/data?');
      const response=simple?(noRightsShop?{code:10009,success:false,msg:'noRightsShop.132230855'}:empty?{code:200,success:true,data:[]}:fixture()):{code:businessCode,success:false,msg:'无权限'};
      const http=simple?simpleStatus:status;
      return {status:http,ok:http===200,json:async()=> response,text:async()=> http===401?'Unauthorized':JSON.stringify(response)};
    }});
  }}}};
  vm.runInContext(main.slice(main.indexOf('async function executeDataAnalysis'),main.indexOf('// 同步开始时固定')),context);
  return {result:await context.executeDataAnalysis(tab,date),requests,saved,details,refunds,notices};
}
test('HTTP and business 401 fall back per platform using current shop and date',async()=> {
  for(const status of [401,200]) {
    const r=await sync({status});
    assert.equal(r.result.success,true);assert.equal(r.saved.length,2);assert.equal(r.refunds.length,0);assert.equal(r.notices.length,0);
    const requests=r.requests.filter(r=> r.url.startsWith('/gateway/adviser/data?'));
    assert.equal(requests.length,2);
    for(const [i,request] of requests.entries()) {
      const url=new URL(request.url,'https://e.dianping.com');
      assert.equal(url.searchParams.get('platform'),String(i+1));
      assert.equal(url.searchParams.get('shopIds'),'42');
      assert.equal(url.searchParams.get('date'),'2026-11-07,2026-11-07');
      assert.equal(url.searchParams.get('pageType'),'simpleDataBoard');
      assert.equal(request.options.credentials,'include');
      assert.equal(r.saved[i].options.preserveMissing,true);
      assert.equal(r.saved[i].row.star,i===0?4.6:4.8);
      assert.equal(r.saved[i].row.orders,undefined);
      assert.equal(r.details[i].endpoint,'/gateway/adviser/data');
    }
    assert.match(r.result.message,/简版看板/);
  }
});
test('other failures do not fall back; invalid or denied simple boards never overwrite metrics',async()=> {
  for(const options of [{status:503,businessCode:503},{status:200,businessCode:403},{simpleStatus:401},{empty:true}]) {
    const r=await sync(options);assert.equal(r.result.success,false);assert.equal(r.saved.length,0);assert.equal(r.details.length,0);assert(r.notices.length>0);
    if(options.status)assert(!r.requests.some(r=> r.url.startsWith('/gateway/adviser/data?')));
  }
});
test('noRightsShop silently skips the unauthorized platform and continues remaining platforms',async()=>{
  const r=await sync({noRightsShop:true});
  assert.equal(r.result.success,true);assert.equal(r.result.errorsReported,false);
  assert.equal(r.result.skippedCount,0);assert.equal(r.saved.length,0);assert.equal(r.details.length,0);
  assert.equal(r.notices.length,0);
  assert.equal(r.requests.filter(request=>request.url.startsWith('/gateway/adviser/data?')).length,2);
  assert.equal(r.result.message.includes('noRightsShop'),false);
});

test('review overview parses only valid star, not cumulative review counts',()=>{
  assert.equal(parseReviewOverviewStar({code:200,success:true,data:{star:'4.6',totalReviewCount:69}}),4.6);
  for(const star of [null,'','--','6','-1','4.6星',{},true])assert.equal(parseReviewOverviewStar({code:200,success:true,data:{star}}),null);
  assert.equal(parseReviewOverviewStar({code:401,success:false,data:{star:'4.6'}}),null);
  assert.equal(shanghaiYesterday(new Date('2026-11-08T16:01:00Z')),'2026-11-08');
  assert.equal(shanghaiYesterday(new Date('2026-11-08T15:59:00Z')),'2026-11-07');
});
test('simple board supplements yesterday star by shop and platform only',async()=>{
  const r=await sync({date:'2026-11-08'});
  const reviews=r.requests.filter(r=>r.url.startsWith('/gateway/merchant/review/overview?'));
  assert.equal(reviews.length,2);
  for(const [i,request] of reviews.entries()){
    assert.equal(request.options.method,'POST');assert.equal(request.options.credentials,'include');
    assert.deepEqual(JSON.parse(request.options.body),{platform:i+1,shopIds:[42]});
    assert.equal(r.saved[i].row.star,4.9);
    assert.equal(r.saved[i].row.new_reviews,0);
    assert.equal(r.saved[i].row.new_bad_reviews,0);
  }
  assert.equal(r.result.success,true);assert.equal(r.notices.length,0);
  for(const date of ['2026-11-07','2026-11-09']){
    const historical=await sync({date});
    assert.equal(historical.requests.filter(r=>r.url.startsWith('/gateway/merchant/review/overview?')).length,0);
    assert.equal(historical.saved[0].row.star,4.6);
  }
});
test('supplemental review failure keeps simple board star and does not interrupt sync',async()=>{
  for(const options of [{reviewStatus:401},{reviewResponse:{code:10009,success:false}},{reviewResponse:{code:200,success:true,data:{star:'--'}}}]){
    const r=await sync({date:'2026-11-08',...options});
    assert.equal(r.result.success,true);assert.equal(r.saved.length,2);assert.equal(r.notices.length,0);
    assert.equal(r.saved[0].row.star,4.6);assert.equal(r.saved[1].row.star,4.8);
  }
});

test('yesterday review stats preserve zeros, parse percentages and reject missing or invalid values',()=>{
 assert.deepEqual(parseRecentReviewStats({code:200,success:true,data:{newReviewCount:0,newGoodReviewCount:0,newBadReviewCount:0,badReviewReplyPercent:'0.00%'}}),{new_reviews:0,new_good_reviews:0,new_bad_reviews:0,bad_reply_rate:0});
 assert.deepEqual(parseRecentReviewStats({code:200,success:true,data:{newReviewCount:7,newGoodReviewCount:5,newBadReviewCount:1,badReviewReplyPercent:'83.33%'}}),{new_reviews:7,new_good_reviews:5,new_bad_reviews:1,bad_reply_rate:83.33/100});
 for(const data of [{newReviewCount:null,newGoodReviewCount:'',newBadReviewCount:'--',badReviewReplyPercent:'--'},{newReviewCount:-1,newGoodReviewCount:1.5,newBadReviewCount:true,badReviewReplyPercent:'101%'},{newReviewCount:'bad',badReviewReplyPercent:'%'}])assert.deepEqual(parseRecentReviewStats({code:200,success:true,data}),{});
 assert.deepEqual(parseRecentReviewStats({code:401,success:false,data:{newReviewCount:1}}),{});
});
test('recentStats is platform-specific, uses dateScope 1, never fills historical dates and fails independently',async()=>{
 const r=await sync({date:'2026-11-08',reviewStatus:401});
 const requests=r.requests.filter(r=>r.url.startsWith('/gateway/merchant/review/recentStats?'));
 assert.equal(requests.length,2);
 for(const [i,request] of requests.entries()){assert.deepEqual(JSON.parse(request.options.body),{platform:i+1,dateScope:1,shopIds:[42]});assert.equal(r.saved[i].row.new_good_reviews,0);assert.equal(r.saved[i].row.bad_reply_rate,0);}
 assert.equal(r.saved[0].row.star,4.6);
 for(const date of ['2026-11-07','2026-11-09']){const historical=await sync({date});assert.equal(historical.requests.filter(r=>r.url.startsWith('/gateway/merchant/review/recentStats?')).length,0);assert.equal(historical.saved[0].row.new_reviews,undefined);}
 for(const options of [{statsStatus:401},{statsResponse:{code:10009,success:false}},{statsResponse:{code:200,success:true,data:{newReviewCount:'--'}}}]){
  const failed=await sync({date:'2026-11-08',...options});assert.equal(failed.result.success,true);assert.equal(failed.notices.length,0);assert.equal(failed.saved.length,2);assert.equal(failed.saved[0].row.new_reviews,undefined);assert.equal(failed.saved[0].row.star,4.9);
 }
});
