const test=require('node:test'),assert=require('node:assert/strict');
const {comparePeriods}=require('../comparison-core');
test('period comparison aggregates totals before ratios and uses latest valid platform stars',()=>{
 const previous=[{stat_date:'2026-10-26',platform:'点评',exposure:100,visits:50,orders:10,order_coupons:30,verify_coupons:20,order_amount:1000,star:4.2,new_reviews:2},{stat_date:'2026-11-01',platform:'点评',exposure:900,visits:90,orders:20,order_coupons:70,verify_coupons:30,order_amount:2000,star:4.6,new_reviews:3}];
 const current=[{stat_date:'2026-11-02',platform:'点评',exposure:1000,visits:200,orders:40,order_coupons:200,verify_coupons:120,order_amount:6000,star:4.8,new_reviews:8}];
 const result=comparePeriods(previous,current,{start:'2026-10-26',end:'2026-11-01'},{start:'2026-11-02',end:'2026-11-08'}),metrics=Object.fromEntries(result.metrics.map(r=>[r.key,r]));
 assert.equal(metrics.order_amount.previous,3000);assert.equal(metrics.order_amount.current,6000);assert.equal(metrics.order_amount.change_rate,1);
 assert.equal(metrics.visit_rate.previous,.14);assert.equal(metrics.visit_rate.current,.2);assert(Math.abs(metrics.visit_rate.delta-.06)<1e-10);
 assert.equal(metrics.coupon_verify_rate.previous,.5);assert.equal(metrics.coupon_verify_rate.current,.6);assert.equal(metrics.dp_star.previous,4.6);assert.equal(metrics.dp_reviews.previous,5);assert.equal(metrics.mt_star.previous,null);assert.equal(result.previous_observed_days,2);
});
test('missing periods and zero baselines are preserved',()=>{
 const result=comparePeriods([{exposure:0,visits:0,order_amount:0}],[{exposure:100,visits:0,order_amount:10}],{},{}),metrics=Object.fromEntries(result.metrics.map(r=>[r.key,r]));
 assert.equal(metrics.order_amount.delta,10);assert.equal(metrics.order_amount.change_rate,null);assert.equal(metrics.visit_rate.previous,null);assert.equal(metrics.visit_rate.delta,null);assert.equal(metrics.visit_rate.current,0);
 const missing=comparePeriods([],[],{},{});assert(missing.metrics.every(r=>r.previous===null&&r.current===null&&r.change_rate===null));
});
