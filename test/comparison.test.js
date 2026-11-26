const test=require('node:test'),assert=require('node:assert/strict');
const {comparePeriods,compareRangePeriods}=require('../comparison-core');
test('period comparison aggregates totals before ratios and uses latest valid platform stars',()=>{
 const previous=[{shop_id:'1',stat_date:'2026-10-26',platform:'点评',exposure:100,visits:50,orders:10,order_coupons:30,verify_coupons:20,order_amount:1000,star:4.2,new_reviews:2,new_good_reviews:3,promo_pay_orders:2,promo_scan_favorites:1,call_total:3,booking_total:4,booking_consumed:2,booking_refunded:1},{shop_id:'1',stat_date:'2026-10-26',platform:'美团',exposure:0,visits:0,orders:0,order_coupons:0,verify_coupons:0,order_amount:0,promo_pay_orders:2,promo_scan_favorites:1,call_total:3,booking_total:4,booking_consumed:2,booking_refunded:1},{shop_id:'1',stat_date:'2026-11-01',platform:'点评',exposure:900,visits:90,orders:20,order_coupons:70,verify_coupons:30,order_amount:2000,star:4.6,new_reviews:3}];
 const current=[{shop_id:'1',stat_date:'2026-11-02',platform:'点评',exposure:1000,visits:200,orders:40,order_coupons:200,verify_coupons:120,order_amount:6000,star:4.8,new_reviews:8,new_good_reviews:5,promo_pay_orders:5,promo_scan_favorites:2,call_total:6,booking_total:7,booking_consumed:3,booking_refunded:2}];
 const result=comparePeriods(previous,current,{start:'2026-10-26',end:'2026-11-01'},{start:'2026-11-02',end:'2026-11-08'}),metrics=Object.fromEntries(result.metrics.map(r=>[r.key,r]));
 assert.equal(metrics.order_amount,undefined);assert.equal(metrics.verify_amount,undefined);assert.equal(metrics.refund_amount,undefined);
 assert.equal(metrics.visit_rate.previous,.14);assert.equal(metrics.visit_rate.current,.2);assert(Math.abs(metrics.visit_rate.delta-.06)<1e-10);
 assert.equal(metrics.coupon_verify_rate.previous,.5);assert.equal(metrics.coupon_verify_rate.current,.6);assert.equal(metrics.dp_star.previous,4.6);assert.equal(metrics.mt_star.previous,null);assert.equal(result.previous_observed_days,2);
 assert.equal(metrics.good_review_rate.previous,.06);assert.equal(metrics.good_review_rate.current,5/120);
 // 新增评价与明细一致：按平台汇总并给出合计。
 assert.equal(metrics.new_reviews.previous,5);assert.equal(metrics.new_reviews.current,8);
 assert.equal(metrics.dp_new_reviews.previous,5);assert.equal(metrics.dp_new_reviews.current,8);
 assert.equal(metrics.mt_new_reviews.previous,null);
 // 门店指标按门店+日期去重，平台行不会重复累加。
 assert.equal(metrics.promo_pay_orders.previous,2);assert.equal(metrics.promo_pay_orders.current,5);assert.equal(metrics.promo_scan_favorites.previous,1);
 assert.equal(metrics.call_total.previous,3);assert.equal(metrics.booking_total.current,7);assert.equal(metrics.booking_consumed.current,3);assert.equal(metrics.booking_refunded.previous,1);
 assert(result.metrics.every(row=>!['dp_reviews','mt_reviews','reviews'].includes(row.key)));
});
test('missing periods and zero baselines are preserved',()=>{
 const result=comparePeriods([{exposure:0,visits:0,order_amount:0}],[{exposure:100,visits:0,order_amount:10}],{},{}),metrics=Object.fromEntries(result.metrics.map(r=>[r.key,r]));
 assert.equal(metrics.exposure.delta,100);assert.equal(metrics.exposure.change_rate,null);assert.equal(metrics.visit_rate.previous,null);assert.equal(metrics.visit_rate.delta,null);assert.equal(metrics.visit_rate.current,0);
 const missing=comparePeriods([],[],{},{});assert(missing.metrics.every(r=>r.previous===null&&r.current===null&&r.change_rate===null));
});
test('growth snapshots use the last record of each period instead of an average',()=>{
 const growth={previous:[{shop_name:'A',stat_date:'2026-10-27',grade_name:'铜牌',score:60},{shop_name:'A',stat_date:'2026-11-01',grade_name:'银牌',score:70}],current:[{shop_name:'A',stat_date:'2026-11-04',grade_name:'银牌',score:75},{shop_name:'A',stat_date:'2026-11-05',grade_name:'金牌',score:82}]};
 const result=comparePeriods([],[],{start:'2026-10-26',end:'2026-11-01'},{start:'2026-11-02',end:'2026-11-08'},growth),metrics=Object.fromEntries(result.metrics.map(r=>[r.key,r]));
 assert.equal(metrics.grade.previous,'银牌');assert.equal(metrics.grade.current,'金牌');assert.equal(metrics.grade.delta,null);
 assert.equal(metrics.shop_score.previous,70);assert.equal(metrics.shop_score.current,82);
 assert.equal(result.growth_snapshot.stat_date,'2026-11-05');assert.equal(result.growth_snapshot.grade_name,'金牌');
});
test('range comparison keeps the last snapshot per period and leaves missing periods empty',()=>{
 const periods=[{start:'2026-11-02',end:'2026-11-02'},{start:'2026-11-03',end:'2026-11-08'}];
 const growth=[{shop_name:'A',stat_date:'2026-11-01',grade_name:'铜牌',score:50},{shop_name:'A',stat_date:'2026-11-05',grade_name:'银牌',score:65},{shop_name:'A',stat_date:'2026-11-07',grade_name:'金牌',score:75}];
 const result=compareRangePeriods([],periods,growth),metrics=Object.fromEntries(result.metrics.map(r=>[r.key,r]));
 assert.deepEqual(metrics.grade.values,['铜牌','金牌']);
 assert.deepEqual(metrics.shop_score.values,[50,75]);
 assert.equal(result.growth_snapshot.stat_date,'2026-11-07');
 const empty=Object.fromEntries(compareRangePeriods([],periods,[]).metrics.map(r=>[r.key,r]));
 assert.deepEqual(empty.grade.values,[null,null]);assert.deepEqual(empty.shop_score.values,[null,null]);
});
