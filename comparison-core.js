// Pure period aggregation shared by the stored AI snapshot and the comparison table.
const valid=value=>value!=null&&String(value).trim()!==''&&Number.isFinite(Number(value));
const total=(rows,key)=>{const values=rows.map(row=>row[key]).filter(valid);return values.length?values.reduce((sum,value)=>sum+Number(value),0):null};
const ratio=(a,b)=>a==null||b==null||b<=0?null:a/b;
function periodMetrics(rows){
 const result={};
 for(const key of ['exposure','visits','orders','order_coupons','order_amount','verify_coupons','verify_amount','refund_coupons','refund_amount'])result[key]=total(rows,key);
 result.visit_rate=ratio(result.visits,result.exposure);
 result.order_rate=ratio(result.orders,result.visits);
 result.coupon_verify_rate=ratio(result.verify_coupons,result.order_coupons);
 for(const [platform,prefix] of [['点评','dp'],['美团','mt']]){
  const data=rows.filter(row=>row.platform===platform);
  const latest=[...data].filter(row=>valid(row.star)).sort((a,b)=>String(b.stat_date).localeCompare(String(a.stat_date)))[0];
  result[prefix+'_star']=latest?Number(latest.star):null;
  result[prefix+'_reviews']=total(data,'new_reviews');
  result[prefix+'_good_reviews']=total(data,'new_good_reviews');
  result[prefix+'_bad_reviews']=total(data,'new_bad_reviews');
 }
 result.good_reviews=total(rows,'new_good_reviews');result.reviews=total(rows,'new_reviews');result.bad_reviews=total(rows,'new_bad_reviews');
 return result;
}
const definitions=[
 ['流量数据','exposure','曝光人数','人'],['流量数据','visits','访问人数','人'],
 ['交易数据','order_coupons','下单券数','张'],['交易数据','order_amount','下单金额（原价）','元'],['交易数据','verify_coupons','核销券数','张'],['交易数据','verify_amount','核销金额（原价）','元'],['交易数据','refund_coupons','退款券数','张'],['交易数据','refund_amount','退款金额（原价）','元'],
 ['转化参考','visit_rate','曝光 → 访问人数转化率','rate'],['转化参考','order_rate','访问 → 下单人数转化率','rate'],['转化参考','coupon_verify_rate','核销 / 下单券数（累计比值）','rate'],
 ['星级 / 评价','dp_star','大众点评期末星级','星'],['星级 / 评价','mt_star','美团期末星级','星'],['星级 / 评价','dp_reviews','新增评价 · 点评','条'],['星级 / 评价','mt_reviews','新增评价 · 美团','条'],['星级 / 评价','reviews','新增评价合计','条'],['星级 / 评价','dp_good_reviews','新增好评 · 点评','条'],['星级 / 评价','mt_good_reviews','新增好评 · 美团','条'],['星级 / 评价','good_reviews','新增好评合计','条'],['星级 / 评价','dp_bad_reviews','新增差评 · 点评','条'],['星级 / 评价','mt_bad_reviews','新增差评 · 美团','条'],['星级 / 评价','bad_reviews','新增差评合计','条']
];
function comparePeriods(previousRows,currentRows,previousPeriod,currentPeriod){
 const previous=periodMetrics(previousRows),current=periodMetrics(currentRows);
 return {previous_period:previousPeriod,current_period:currentPeriod,previous_observed_days:new Set(previousRows.map(r=>r.stat_date)).size,current_observed_days:new Set(currentRows.map(r=>r.stat_date)).size,
 metrics:definitions.map(([module,key,label,unit])=>{const before=previous[key],after=current[key];return {key,module,label,unit,previous:before,current:after,delta:before==null||after==null?null:after-before,change_rate:before==null||after==null||before===0?null:(after-before)/before}})};
}
module.exports={comparePeriods,periodMetrics};
