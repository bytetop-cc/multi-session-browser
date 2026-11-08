const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseSimpleBoard } = require('../simple-board');
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
async function sync({status=401,businessCode=401,simpleStatus=200,empty=false}={}) {
  const requests=[],saved=[],details=[],refunds=[],notices=[];
  const context=vm.createContext({console:{log(){},error(){}},URLSearchParams,require:name=> {assert.equal(name,'./simple-board');return {parseSimpleBoard}},
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
      const simple=url.startsWith('/gateway/adviser/data?');
      const response=simple?(empty?{code:200,success:true,data:[]}:fixture()):{code:businessCode,success:false,msg:'无权限'};
      const http=simple?simpleStatus:status;
      return {status:http,ok:http===200,json:async()=> response,text:async()=> http===401?'Unauthorized':JSON.stringify(response)};
    }});
  }}}};
  vm.runInContext(main.slice(main.indexOf('async function executeDataAnalysis'),main.indexOf('// 同步开始时固定')),context);
  return {result:await context.executeDataAnalysis(tab,'2026-11-07'),requests,saved,details,refunds,notices};
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
