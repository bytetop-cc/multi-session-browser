import React,{useEffect,useState} from 'react';
import {Alert,App,Button,DatePicker,Form,Spin,Table,Typography} from 'antd';
import {ArrowDownOutlined,ArrowUpOutlined,MinusOutlined,SearchOutlined} from '@ant-design/icons';
import dayjs from 'dayjs';
import {invoke} from './report-data';
const numeric=value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});
const oneDecimal=value=>Number(value).toLocaleString('zh-CN',{minimumFractionDigits:1,maximumFractionDigits:1});
const dateLabel=period=>!period?'--':period.start===period.end?period.start:`${period.start} 至 ${period.end}`;
const modeLabels={daily:'日报',weekly:'周报',monthly:'月报'};
function format(value,unit){if(value==null||value==='')return '--';if(unit==='等级')return String(value);return unit==='rate'?(value*100).toFixed(2)+'%':numeric(value)+(unit==='星'?' 星':' '+unit)}
function ranged(comparison){if(comparison.periods)return comparison;return {periods:[{...comparison.previous_period,observed_days:comparison.previous_observed_days},{...comparison.current_period,observed_days:comparison.current_observed_days}],metrics:comparison.metrics.map(row=>({...row,values:[row.previous??(row.kind==='snapshot'?null:0),row.current??(row.kind==='snapshot'?null:0)]})),shop_name:comparison.shop_name,mode:comparison.mode,growth_snapshot:comparison.growth_snapshot}}
// 高低好坏方向：绿色=变好，红色=变坏，灰色=中性或持平。
const higherIsBetter=new Set(['exposure','visits','order_coupons','verify_coupons','visit_rate','order_rate','coupon_verify_rate','good_review_rate','promo_pay_orders','promo_scan_favorites','booking_total','booking_consumed','dp_star','mt_star','dp_good_reviews','mt_good_reviews','good_reviews']);
const lowerIsBetter=new Set(['refund_coupons','booking_refunded','dp_bad_reviews','mt_bad_reviews','bad_reviews']);
function metricEffect(key,delta){
 if(delta==null||Math.abs(delta)<1e-10)return 'flat';
 if(!higherIsBetter.has(key)&&!lowerIsBetter.has(key))return 'neutral';
 const up=delta>0;
 return (higherIsBetter.has(key)?up:!up)?'good':'bad';
}
// 总览按“上涨=改善、下降=回落”着色（退款/差评为反向），与图片一致。
function overviewEffect(key,delta){
 if(delta==null||Math.abs(delta)<1e-10)return 'flat';
 return (lowerIsBetter.has(key)?delta<0:delta>0)?'good':'bad';
}
function MiniBars({items,compact=false}){
 const max=Math.max(1,...items.flatMap(item=>[item.before,item.after].map(value=>Number.isFinite(Number(value))?Math.abs(Number(value)):0)));
 const barHeight=value=>value==null?0:value===0?2:Math.max(5,Math.round(Math.abs(value)/max*(compact?62:90)));
 return <div className={`co-bars${compact?' is-compact':''}`}>{items.map(item=>{
  const before=Number.isFinite(Number(item.before))?Number(item.before):null,after=Number.isFinite(Number(item.after))?Number(item.after):null;
  const delta=before==null||after==null?null:after-before,effect=overviewEffect(item.key,delta);
  const change=before==null||after==null?'--':after===before?'持平':before===0?'新增':(delta>0?'+':'')+oneDecimal(delta/Math.abs(before)*100)+'%';
  return <div className="co-bar" key={item.key}><span className="co-bar-number">{after==null?'--':numeric(after)}</span><div className="co-bar-pair" aria-hidden="true"><i className="co-bar-fill is-prev" style={{height:barHeight(before)}}/><i className="co-bar-fill is-curr" style={{height:barHeight(after)}}/></div><span className={`co-delta is-${effect}`}><i/>{change}</span><span className="co-bar-label">{item.label}</span></div>;
 })}</div>;
}
function ScoreRing({value}){
 const score=Number.isFinite(Number(value))&&value!==null&&value!==''?Number(value):null,pct=score==null?0:Math.max(0,Math.min(100,score)),radius=54,circumference=2*Math.PI*radius;
 return <div className="co-score"><svg viewBox="0 0 142 142" role="img" aria-label={score==null?'暂无经营评分':`经营评分 ${numeric(score)} 分`}><circle cx="71" cy="71" r={radius} fill="none" stroke="#ece8e4" strokeWidth="15"/>{score!=null&&<circle cx="71" cy="71" r={radius} fill="none" stroke="#a51f1f" strokeWidth="15" strokeLinecap="round" strokeDasharray={`${circumference*pct/100} ${circumference}`} transform="rotate(-90 71 71)"/>}<text x="71" y="70" textAnchor="middle" className="co-score-value">{score==null?'--':numeric(score)}</text><text x="71" y="92" textAnchor="middle" className="co-score-title">经营评分</text></svg><span className="co-score-note">{score==null?'暂无评分':'距满分 '+numeric(Math.max(0,100-score))+' 分'}</span></div>;
}
const FUNNEL_STAGES=[['verify_coupons','核销','张'],['order_coupons','下单','张'],['visits','访问','人'],['exposure','曝光','人']];
const FUNNEL_WIDTHS=[54,66,82,100];
function FunnelOverview({valueAt,before,last}){
 return <div className="co-funnel">{FUNNEL_STAGES.map(([key,label,unit],index)=>{const beforeValue=valueAt(key,before),afterValue=valueAt(key,last),width=FUNNEL_WIDTHS[index];return <div className="co-funnel-row" key={key}><span className="co-funnel-label">{label}</span><div className="co-funnel-track"><div className="co-funnel-shape is-prev" style={{width:width+'%'}}/><div className="co-funnel-shape is-curr" style={{width:width+'%'}}><b>{afterValue==null?'--':numeric(afterValue)}</b><small>{unit}</small></div></div></div>;})}</div>;
}
const CONVERSION_ROWS=[['visit_rate','曝光→访问'],['order_rate','访问→下单'],['coupon_verify_rate','核销/下单'],['good_review_rate','好评率']];
function ConversionList({valueAt,before,last}){
 const rows=CONVERSION_ROWS.map(([key,label])=>{const previous=valueAt(key,before),current=valueAt(key,last),delta=previous==null||current==null?null:current-previous;return {key,label,previous,current,delta,effect:metricEffect(key,delta)}});
 const falling=rows.filter(row=>row.effect==='bad').sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta))[0],rising=rows.filter(row=>row.effect==='good').sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta))[0];
 const note=falling?`${rising?rising.label+'提升，但':''}${falling.label}回落 ${numeric(Math.abs(falling.delta)*100)} 个百分点，是本期最大卡点。`:'本期关键转化整体平稳或改善。';
 return <div className="co-conversions">{rows.map(row=><div className="co-conversion" key={row.key}><span className="co-conversion-label">{row.label}</span><span className="co-conversion-values">{row.previous==null?'--':(row.previous*100).toFixed(2)+'%'} <i>→</i> <b>{row.current==null?'--':(row.current*100).toFixed(2)+'%'}</b></span><span className={`co-delta is-${row.effect}`}><i/>{row.delta==null?'--':(row.delta>0?'+':'')+numeric(row.delta*100)+' 个百分点'}</span></div>)}<p className="co-conversion-note">{note}</p></div>;
}
function ReputationCards({items}){
 return <div className="co-reputation">{items.map(item=>{
  const before=item.before,after=item.after;
  const delta=before==null||after==null?null:Number(after)-Number(before),effect=overviewEffect(item.key,delta);
  const change=delta==null?'--':Math.abs(delta)<1e-10?'持平':item.unit==='星'?(delta>0?'↑':'↓')+oneDecimal(Math.abs(delta))+' 星':`${delta>0?'+':''}${numeric(delta)} ${item.unit}${before===0?'':' / '+(delta>0?'+':'')+oneDecimal(delta/Math.abs(before)*100)+'%'}`;
  return <article className="co-reputation-card" key={item.key}><span className="co-reputation-label">{item.label}</span><strong className="co-reputation-value">{format(before,item.unit)} <i>→</i> {format(after,item.unit)}</strong><span className={`co-delta is-${effect}`}><i/>{change}</span></article>;
 })}</div>;
}
export function ComparisonOverview({comparison}){
 if(!comparison)return null;
 const data=ranged(comparison),periods=data.periods||[];if(periods.length<2)return null;
 const last=periods.length-1,before=last-1,mode=data.mode||comparison.mode;
 const metric=key=>data.metrics.find(item=>item.key===key);
 const valueAt=(key,index)=>metric(key)?.values?.[index]??null;
 const collect=(fields)=>fields.map(([key,label,unit])=>({key,label,unit,before:valueAt(key,before),after:valueAt(key,last)}));
 const flow=collect([['exposure','曝光人数','人'],['visits','访问人数','人'],['order_coupons','下单券','张'],['verify_coupons','核销券','张'],['refund_coupons','退款券','张']]);
 const actions=collect([['promo_pay_orders','优惠码订单','单'],['promo_scan_favorites','扫码收藏','次'],['call_total','虚拟话单','条'],['booking_total','预订订单','单'],['booking_consumed','预订已消费','单']]);
 const bookings=collect([['booking_total','预订下单','单'],['booking_consumed','已消费','单'],['booking_refunded','已退款','单']]);
 const reputation=[...collect([['new_reviews','新增评价','条'],['bad_reviews','新增差评','条']]),...collect([['dp_star','大众点评星级','星'],['mt_star','美团星级','星']])];
 const grade=valueAt('grade',last)||data.growth_snapshot?.grade_name||null,score=valueAt('shop_score',last)??data.growth_snapshot?.score??null,syncDate=data.growth_snapshot?.stat_date||'';
 return <section className="comparison-overview" aria-label="对比总览">
  <header className="co-head"><div className="co-head-main"><h3 className="co-title">{data.shop_name||''}{modeLabels[mode]?' · '+modeLabels[mode]:''}</h3><p className="co-sub">本期 <b>{dateLabel(periods[last])}</b> <span>vs</span> 上期 <b>{dateLabel(periods[before])}</b></p></div><div className="co-head-side"><div className="co-grade"><span>门店等级</span><strong>{grade||'--'}</strong></div>{syncDate&&<small>{syncDate} 同步</small>}</div></header>
  <div className="co-grid co-grid-top">
   <section className="co-section"><h4>流量与交易</h4><MiniBars items={flow}/><p className="co-caption">浅=上期 深=本期（单位：人 / 张）</p></section>
   <section className="co-section"><h4>获客动作</h4><MiniBars items={actions}/><p className="co-caption">浅=上期 深=本期（单位：单 / 次 / 条）</p></section>
   <section className="co-section"><h4>预订下单（累计）</h4><div className="co-booking"><ScoreRing value={score}/><MiniBars items={bookings} compact/></div><p className="co-caption">浅=上期 深=本期（单位：单）</p></section>
  </div>
  <div className="co-grid co-grid-bottom">
   <section className="co-section"><h4>流量 → 交易漏斗</h4><FunnelOverview valueAt={valueAt} before={before} last={last}/><p className="co-caption">上期 / 本期（浅 / 深）</p></section>
   <section className="co-section"><h4>关键转化对比</h4><ConversionList valueAt={valueAt} before={before} last={last}/></section>
   <section className="co-section"><h4>评价与口碑</h4><ReputationCards items={reputation}/></section>
  </div>
 </section>;
}
function Difference({row}){
 if(row.delta==null)return <Typography.Text type="secondary">--</Typography.Text>;
 if(Math.abs(row.delta)<1e-10)return <Typography.Text type="secondary">持平</Typography.Text>;
 const sign=row.delta>0?'+':'',delta=row.unit==='rate'?`${sign}${numeric(row.delta*100)} 个百分点`:`${sign}${numeric(row.delta)} ${row.unit}`;
 const label=row.unit==='rate'||row.unit==='星'?delta:`${delta} / ${row.change_rate==null?'--':(row.change_rate>0?'+':'')+numeric(row.change_rate*100)+'%'}`;
 return <span className="comparison-change">{label}</span>;
}
function ChangeValue({row}){
 if(row.delta==null)return <span className="comparison-change comparison-change-flat">--</span>;
 if(Math.abs(row.delta)<1e-10)return <span className="comparison-change comparison-change-flat"><MinusOutlined aria-hidden="true"/>持平</span>;
 const up=row.delta>0,Icon=up?ArrowUpOutlined:ArrowDownOutlined,effect=metricEffect(row.key,row.delta);
 const delta=row.unit==='rate'?`${numeric(Math.abs(row.delta)*100)} 个百分点`:`${numeric(Math.abs(row.delta))} ${row.unit}`;
 const label=row.unit==='rate'||row.unit==='星'?delta:`${delta} / ${row.change_rate==null?'--':numeric(Math.abs(row.change_rate)*100)+'%'}`;
 return <span className={`comparison-change comparison-change-${effect}`}><Icon aria-label={up?'上升':'下降'}/><span>{label}</span></span>;
}
function TextChange({before,after}){
 if(!before||!after)return <Typography.Text type="secondary">--</Typography.Text>;
 return <span className={`comparison-change comparison-change-${before===after?'flat':'neutral'}`}>{before===after?'— 持平':'— 变化'}</span>;
}
export function PeriodComparison({comparison,print=false,onChange}){
 if(!comparison)return <Alert type="info" title="当前报表暂无周期对比数据，请重新查询。"/>;
 if(!print)return <InteractivePeriodComparison initial={comparison} onChange={onChange}/>;
 return <ComparisonTable comparison={ranged(comparison)} print/>;
}
function InteractivePeriodComparison({initial,onChange}){
 const {message}=App.useApp(),[comparison,setComparison]=useState(()=>ranged(initial)),[loading,setLoading]=useState(false);
 const initialRange=value=>{const data=ranged(value);return [dayjs(data.periods[0].start),dayjs(data.periods.at(-1).end)]};
 const [range,setRange]=useState(()=>initialRange(initial));
 useEffect(()=>{const next=ranged(initial);setComparison(next);setRange(initialRange(initial));onChange?.(next)},[initial]);
 async function query(){if(!range?.[0]||!range?.[1]){message.error('请选择完整的对比日期范围');return}setLoading(true);try{const next=await invoke('analysis-comparison',{shopName:initial.shop_name,mode:initial.mode,startDate:range[0].format('YYYY-MM-DD'),endDate:range[1].format('YYYY-MM-DD')});Object.assign(initial,next);setComparison(next);onChange?.(next)}catch(error){message.error(error.message||String(error))}finally{setLoading(false)}}
 return <><Form className="comparison-filter" layout="inline" onFinish={query}><Form.Item label="对比时段"><DatePicker.RangePicker id="comparisonRange" aria-label="对比时段" value={range} onChange={setRange} allowClear={false}/></Form.Item><Form.Item><Button id="queryComparison" type="primary" htmlType="submit" icon={<SearchOutlined/>} loading={loading}>对比</Button></Form.Item></Form><Spin spinning={loading}><ComparisonTable comparison={comparison}/></Spin></>;
}
function ComparisonTable({comparison,print=false}){
 const rows=comparison.metrics.map((row,i,all)=>({...row,moduleSpan:i&&all[i-1].module===row.module?0:all.filter(r=>r.module===row.module).length}));
 const last=comparison.periods.length-1;
 const changeColumn={title:'变化',key:'change',align:'right',width:230,className:'comparison-change-col',render:(_,row)=>{const before=row.values[last-1]??null,after=row.values[last]??null;if(row.unit==='等级')return <TextChange before={before} after={after}/>;return <ChangeValue row={{...row,delta:before==null||after==null?null:after-before,change_rate:before==null||after==null||before===0?null:(after-before)/before}}/>}};
 const columns=[{title:'模块',dataIndex:'module',width:120,fixed:'left',onCell:row=>({rowSpan:row.moduleSpan,className:'comparison-module'})},{title:'指标',dataIndex:'label',width:236,fixed:'left',onCell:()=>({className:'comparison-metric-cell'})},...comparison.periods.map((period,index)=>{const isCurrent=index===last,isPrevious=index===last-1;return {title:<span className="comparison-period-heading"><span className={`comparison-period-tag${isCurrent?' is-current':''}`}>{isCurrent?'本期':isPrevious?'上期':''}</span><span>{dateLabel(period)}</span></span>,key:`period-${index}`,align:'right',width:190,className:isCurrent?'comparison-current-col':'',onHeaderCell:()=>({className:isCurrent?'comparison-current-head':''}),render:(_,row)=><strong className={isCurrent?'is-current':''}>{format(row.values[index],row.unit)}</strong>}}),...(last>=1?[changeColumn]:[])];
 const observed=comparison.periods.map(period=>`${dateLabel(period)} 已同步 ${period.observed_days} 天`).join('；');
 const changeNote=last>=1?`变化列对比最后两个时段：${dateLabel(comparison.periods[last-1])} → ${dateLabel(comparison.periods[last])}，箭头表示升降，颜色表示好坏，变坏的行整行标红。`:'';
 const rowEffect=row=>{if(row.unit==='等级')return null;const before=row.values[last-1]??null,after=row.values[last]??null;return before==null||after==null?null:metricEffect(row.key,after-before)};
 return <div className="period-comparison"><Table bordered size="small" rowKey="key" rowClassName={row=>rowEffect(row)==='bad'?'comparison-row-danger':''} columns={columns} dataSource={rows} pagination={false} scroll={print?undefined:{x:356+comparison.periods.length*190+230}}/><Typography.Paragraph type="secondary" className="comparison-note">{observed}。{changeNote}未同步的时段按 0 展示；转化率按各时段总量计算；星级取时段内最近一次有效记录；等级与评分取时段结束前最近一条快照（周/月即当周、当月最后一条）。</Typography.Paragraph></div>;
}

export function MobilePeriodComparison({comparison}){
 if(!comparison)return <Typography.Paragraph>暂无上期对比数据。</Typography.Paragraph>;
 return <div className="mobile-comparison"><Typography.Paragraph type="secondary">本期：{dateLabel(comparison.current_period)}<br/>上期：{dateLabel(comparison.previous_period)}</Typography.Paragraph>{comparison.metrics.map(row=><section className="mobile-comparison-card" key={row.key}><h4>{row.label}</h4><div className="mobile-comparison-values"><div><span>本期</span><strong>{format(row.current,row.unit)}</strong></div><div><span>上期</span><strong>{format(row.previous,row.unit)}</strong></div></div><Difference row={row}/></section>)}<Typography.Paragraph type="secondary">缺失数据不补零；上期为零不计算增幅。转化率按周期总量计算，变化以百分点表示。</Typography.Paragraph></div>;
}
