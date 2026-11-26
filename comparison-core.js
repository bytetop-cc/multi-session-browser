// Pure period aggregation shared by the stored AI snapshot and the comparison table.
const valid=value=>value!=null&&String(value).trim()!==''&&Number.isFinite(Number(value));
const total=(rows,key)=>{const values=rows.map(row=>row[key]).filter(valid);return values.length?values.reduce((sum,value)=>sum+Number(value),0):null};
const ratio=(a,b)=>a==null||b==null||b<=0?null:a/b;
const storeKeys=['promo_pay_orders','promo_scan_favorites','call_total','booking_total','booking_consumed','booking_refunded'];
// 门店指标按门店 + 日期只记一次；平台行会重复携带同一份每日值，不能逐行累加。
function storeTotal(rows){
 const days=new Map();
 for(const row of rows){
  const key=JSON.stringify([row.shop_id||row.shop_name||'',row.stat_date||'']);
  const values=days.get(key)||{};
  for(const field of storeKeys)if(values[field]==null&&valid(row[field]))values[field]=Number(row[field]);
  days.set(key,values);
 }
 return Object.fromEntries(storeKeys.map(key=>{const values=[...days.values()].map(day=>day[key]).filter(value=>value!=null);return [key,values.length?values.reduce((sum,value)=>sum+value,0):null]}));
}
function periodMetrics(rows){
 const result={};
 for(const key of ['exposure','visits','orders','order_coupons','order_amount','verify_coupons','verify_amount','refund_coupons','refund_amount'])result[key]=total(rows,key);
 Object.assign(result,storeTotal(rows));
 result.visit_rate=ratio(result.visits,result.exposure);
 result.order_rate=ratio(result.order_coupons,result.visits);
 result.coupon_verify_rate=ratio(result.verify_coupons,result.order_coupons);
 for(const [platform,prefix] of [['点评','dp'],['美团','mt']]){
  const data=rows.filter(row=>row.platform===platform);
  const latest=[...data].filter(row=>valid(row.star)).sort((a,b)=>String(b.stat_date).localeCompare(String(a.stat_date)))[0];
  result[prefix+'_star']=latest?Number(latest.star):null;
  result[prefix+'_new_reviews']=total(data,'new_reviews');
  result[prefix+'_good_reviews']=total(data,'new_good_reviews');
  result[prefix+'_bad_reviews']=total(data,'new_bad_reviews');
 }
 result.new_reviews=total(rows,'new_reviews');result.good_reviews=total(rows,'new_good_reviews');result.bad_reviews=total(rows,'new_bad_reviews');
 result.good_review_rate=ratio(result.good_reviews,result.verify_coupons);
 return result;
}
// 等级/评分为门店快照：取时段内最后一条记录（周报/月报即当周/当月最后一条），不做平均。
function latestSnapshot(records){
 let latest=null;
 for(const row of records||[]){
  if(!row)continue;
  const date=String(row.stat_date||''),latestDate=latest?String(latest.stat_date||''):'';
  if(!latest||date>latestDate||(date===latestDate&&String(row.shop_name||'')<String(latest.shop_name||'')))latest=row;
 }
 return latest;
}
function snapshotMetrics(records){
 const latest=latestSnapshot(records),grade=latest?.grade_name;
 return {grade:grade!=null&&String(grade).trim()!==''?String(grade).trim():null,shop_score:latest&&valid(latest.score)?Number(latest.score):null};
}
const definitions=[
 ['等级 / 评分','grade','门店等级','等级','snapshot'],['等级 / 评分','shop_score','经营评分','分','snapshot'],
 ['流量数据','exposure','曝光人数','人'],['流量数据','visits','访问人数','人'],
 ['交易数据','order_coupons','下单券数','张'],['交易数据','verify_coupons','核销券数','张'],['交易数据','refund_coupons','退款券数','张'],
 ['转化参考','visit_rate','曝光 → 访问人数转化率','rate'],['转化参考','order_rate','访问 → 下单转化率（下单券数 / 访问人数）','rate'],['转化参考','coupon_verify_rate','核销 / 下单券数（累计比值）','rate'],
 ['优惠码','promo_pay_orders','优惠码支付订单','单'],
 ['扫码','promo_scan_favorites','扫码收藏','次'],
 ['虚拟话单','call_total','虚拟号话单总数','条'],
 ['预订订单','booking_total','预订订单','单'],['预订订单','booking_consumed','已消费','单'],['预订订单','booking_refunded','已退款','单'],
 ['星级 / 评价','dp_star','大众点评期末星级','星'],['星级 / 评价','mt_star','美团期末星级','星'],['星级 / 评价','dp_new_reviews','新增评价 · 点评','条'],['星级 / 评价','mt_new_reviews','新增评价 · 美团','条'],['星级 / 评价','new_reviews','新增评价合计','条'],['星级 / 评价','dp_good_reviews','新增好评 · 点评','条'],['星级 / 评价','mt_good_reviews','新增好评 · 美团','条'],['星级 / 评价','good_reviews','新增好评合计','条'],['星级 / 评价','good_review_rate','好评率（好评总数 / 核销券数）','rate'],['星级 / 评价','dp_bad_reviews','新增差评 · 点评','条'],['星级 / 评价','mt_bad_reviews','新增差评 · 美团','条'],['星级 / 评价','bad_reviews','新增差评合计','条']
];
function growthSnapshot(record){
 if(!record)return null;
 return {stat_date:record.stat_date||null,grade_name:record.grade_name==null?null:String(record.grade_name).trim()||null,score:valid(record.score)?Number(record.score):null};
}
function comparePeriods(previousRows,currentRows,previousPeriod,currentPeriod,growth={}){
 const previous={...periodMetrics(previousRows),...snapshotMetrics(growth.previous)},current={...periodMetrics(currentRows),...snapshotMetrics(growth.current)};
 return {previous_period:previousPeriod,current_period:currentPeriod,previous_observed_days:new Set(previousRows.map(r=>r.stat_date)).size,current_observed_days:new Set(currentRows.map(r=>r.stat_date)).size,growth_snapshot:growthSnapshot(latestSnapshot(growth.current)),
 metrics:definitions.map(([module,key,label,unit,kind])=>{const before=previous[key],after=current[key],numeric=typeof before==='number'&&typeof after==='number';return {key,module,label,unit,kind,previous:before,current:after,delta:numeric?after-before:null,change_rate:numeric&&before!==0?(after-before)/before:null}})};
}
function compareRangePeriods(rows,periods,growthRows=[]){
 const snapshotKeys=new Set(definitions.filter(([,key,,,kind])=>kind==='snapshot').map(([,key])=>key));
 const values=periods.map(period=>{const selected=rows.filter(row=>row.stat_date>=period.start&&row.stat_date<=period.end),metrics={...periodMetrics(selected),...snapshotMetrics(growthRows.filter(row=>row.stat_date<=period.end))};return {period,observed_days:new Set(selected.map(row=>row.stat_date)).size,metrics:Object.fromEntries(Object.entries(metrics).map(([key,value])=>[key,snapshotKeys.has(key)?value:value??0]))}});
 const lastPeriod=periods[periods.length-1];
 return {periods:values.map(item=>({...item.period,observed_days:item.observed_days})),growth_snapshot:lastPeriod?growthSnapshot(latestSnapshot(growthRows.filter(row=>row.stat_date<=lastPeriod.end))):null,metrics:definitions.map(([module,key,label,unit,kind])=>({key,module,label,unit,kind,values:values.map(item=>item.metrics[key])}))};
}
module.exports={comparePeriods,compareRangePeriods,periodMetrics};
