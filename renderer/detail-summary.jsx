import React from 'react';
import {MetricChange} from './metric-change';
import {detailRows,money,num} from './report-data';
const groups=[
 ['客流与下单',[['exposure','曝光人数'],['visits','访问人数'],['visit_rate','访问率'],['orders','下单人数'],['order_rate','访问到下单'],['order_coupons','下单券数'],['order_amount','下单金额（原价）']]],
 ['核销与退款',[['verify_uv','核销人次'],['verify_coupons','核销券数'],['verify_amount','核销金额（原价）'],['verify_rate','核销金额 / 下单金额'],['refund_coupons','退款券数'],['refund_amount','退款金额（原价）']]],
 ['评价与咨询',[['star','最近星级'],['new_reviews','新增评价'],['new_bad_reviews','新增差评'],['bad_reply_rate','最近差评回复率'],['ask_user_cnt','在线咨询人数'],['avg_reply_duration','最近平均响应时长']]]
];
const rates=['visit_rate','order_rate','verify_rate','bad_reply_rate'];
const valid=v=>v!=null&&v!=='--'&&String(v).trim()!==''&&Number.isFinite(Number(v));
function aggregate(rows,combined){
 const result={};
 for(const [,fields] of groups)for(const [key] of fields){const values=rows.map(r=>r[key]).filter(valid);result[key]=values.length?values.reduce((a,v)=>a+Number(v),0):null}
 const latest=[...rows].sort((a,b)=>String(b.stat_date).localeCompare(String(a.stat_date)));
 for(const key of ['star','bad_reply_rate','avg_reply_duration'])result[key]=combined?null:latest.find(r=>r[key]!=null&&r[key]!==''&&r[key]!=='--')?.[key]??null;
 for(const [key,a,b] of [['visit_rate','visits','exposure'],['order_rate','orders','visits'],['verify_rate','verify_amount','order_amount']])result[key]=result[a]!=null&&result[b]>0?result[a]/result[b]:null;
 return result;
}
function value(key,v){if(v==null)return '--';if(rates.includes(key))return num(v*100)+'%';return key.includes('amount')?money(v):key==='avg_reply_duration'?String(v):num(v)}
function Tiles({fields,data,previous={}}){return <div className="detail-summary-grid">{fields.map(([key,label])=><div className="detail-summary-metric" key={key}><span>{label}</span><strong>{value(key,data[key])}</strong><MetricChange current={data[key]} previous={previous[key]} rate={rates.includes(key)} absolute={key==='star'} duration={key==='avg_reply_duration'}/></div>)}</div>}
export function DetailSummary({report}){
 const rows=report.details||[],p=report.shop_metrics?.shop_promo_metrics||{},c=report.shop_metrics?.shop_call_totals||{};
 const shopFields=[['pay_orders','优惠码支付订单'],['pay_amount','优惠码支付金额'],['verify_amount','优惠码核销金额'],['scan_users','扫码人数'],['scan_favorites','扫码收藏'],['scan_reviews','扫码评价'],['call_total','虚拟号话单总数'],['booking_total','预订订单'],['booking_consumed','已消费'],['booking_refunded','已退款'],['booking_pending','待消费']];
 function shopValues(metrics){const result={...metrics?.shop_promo_metrics,call_total:metrics?.shop_call_totals?.total};for(const [key,type] of [['booking_total',0],['booking_consumed',3],['booking_refunded',5],['booking_pending',1]])result[key]=metrics?.bookings?.find(b=>b.order_type===type)?.total;return result}
 const shopData=shopValues(report.shop_metrics),previousShop=shopValues(report.previous_shop_metrics);
 const previousRows=report.previous_details||[];
 return <div className="detail-summary"><p className="detail-summary-note">{report.period.start} 至 {report.period.end} · 按所选周期累计，人数未跨日、跨平台去重。缺失值显示“--”；星级、回复率、响应时长取平台最近有效记录，汇总不相加。</p>{['美团','点评','汇总'].map(platform=>{const data=aggregate(platform==='汇总'?detailRows(rows).filter(r=>r.platform==='汇总'):rows.filter(r=>r.platform===platform),platform==='汇总');const previous=aggregate(platform==='汇总'?detailRows(previousRows).filter(r=>r.platform==='汇总'):previousRows.filter(r=>r.platform===platform),platform==='汇总');return <section className="detail-summary-platform" key={platform}><h3>{platform}</h3>{groups.map(([title,fields])=><section className="detail-summary-group" key={title}><h4>{title}</h4><Tiles fields={fields} data={data} previous={previous}/></section>)}</section>})}<section className="detail-summary-platform"><h3>门店经营指标</h3><p className="detail-summary-note">门店指标按所选周期汇总一次，不按平台重复累加。</p><Tiles fields={shopFields} data={shopData} previous={previousShop}/></section></div>;
}
