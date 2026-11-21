import React,{useEffect,useState} from 'react';
import {Alert,App,Button,DatePicker,Form,Spin,Table,Typography} from 'antd';
import {ArrowDownOutlined,ArrowUpOutlined,MinusOutlined,SearchOutlined} from '@ant-design/icons';
import dayjs from 'dayjs';
import {invoke} from './report-data';
import {Chart} from './report-ui';
const numeric=value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});
const dateLabel=period=>!period?'--':period.start===period.end?period.start:`${period.start} 至 ${period.end}`;
function format(value,unit){if(value==null)return '--';return unit==='rate'?(value*100).toFixed(2)+'%':numeric(value)+(unit==='星'?' 星':' '+unit)}
function ranged(comparison){if(comparison.periods)return comparison;return {periods:[{...comparison.previous_period,observed_days:comparison.previous_observed_days},{...comparison.current_period,observed_days:comparison.current_observed_days}],metrics:comparison.metrics.map(row=>({...row,values:[row.previous??0,row.current??0]})),shop_name:comparison.shop_name,mode:comparison.mode}}
// 高低好坏方向：绿色=变好，红色=变坏，灰色=中性或持平。
const higherIsBetter=new Set(['exposure','visits','order_coupons','verify_coupons','visit_rate','order_rate','coupon_verify_rate','good_review_rate','promo_pay_orders','promo_scan_favorites','booking_total','booking_consumed','dp_star','mt_star','dp_good_reviews','mt_good_reviews','good_reviews']);
const lowerIsBetter=new Set(['refund_coupons','booking_refunded','dp_bad_reviews','mt_bad_reviews','bad_reviews']);
function metricEffect(key,delta){
 if(delta==null||Math.abs(delta)<1e-10)return 'flat';
 if(!higherIsBetter.has(key)&&!lowerIsBetter.has(key))return 'neutral';
 const up=delta>0;
 return (higherIsBetter.has(key)?up:!up)?'good':'bad';
}
const KPI_FIELDS=[['exposure','曝光人数','人'],['visits','访问人数','人'],['order_coupons','下单券数','张'],['verify_coupons','核销券数','张'],['refund_coupons','退款券数','张'],['good_review_rate','好评率','rate']];
function kpiText(value,unit){if(value==null)return '--';return unit==='rate'?(value*100).toFixed(2)+'%':numeric(value)+(unit==='星'?' 星':' '+unit)}
function shortPeriod(period,mode){if(!period)return '--';if(mode==='monthly')return period.start.slice(0,7);if(mode==='weekly')return period.start.slice(5)+' 起';return period.start===period.end?period.start.slice(5):period.start.slice(5,10)+'～'+period.end.slice(5,10)}
export function ComparisonOverview({comparison}){
 if(!comparison)return null;
 const data=ranged(comparison),periods=data.periods||[];if(periods.length<2)return null;
 const last=periods.length-1,before=last-1,mode=data.mode;
 const metric=key=>data.metrics.find(m=>m.key===key);
 const valueAt=(key,index)=>metric(key)?.values?.[index]??null;
 const kpis=KPI_FIELDS.map(([key,label,unit])=>{const current=valueAt(key,last),previous=valueAt(key,before);const delta=current==null||previous==null?null:current-previous;const change_rate=delta==null||previous===0?null:delta/previous;return {key,label,unit,current,effect:metricEffect(key,delta),row:{key,unit,delta,change_rate}}});
 const start=Math.max(0,periods.length-10);
 const labels=periods.slice(start).map(period=>shortPeriod(period,mode));
 const bars=periods.slice(start).map((_,index)=>valueAt('order_coupons',start+index));
 const rates=periods.slice(start).map((_,index)=>{const value=valueAt('order_rate',start+index);return value==null?null:Number((value*100).toFixed(1))});
 const comboOption={animation:false,aria:{enabled:true},color:['#1677ff','#e2bd17'],legend:{top:0,left:'center',textStyle:{fontSize:12,color:'#344256'}},grid:{left:10,right:16,top:38,bottom:6,containLabel:true},tooltip:{trigger:'axis',renderMode:'richText'},xAxis:{type:'category',data:labels,axisLabel:{fontSize:11,color:'#64748b',hideOverlap:true},axisLine:{lineStyle:{color:'#d9e1eb'}}},yAxis:[{type:'value',name:'张',nameTextStyle:{color:'#94a3b8',fontSize:11},axisLabel:{color:'#64748b',fontSize:11},splitLine:{lineStyle:{color:'#edf1f6'}}},{type:'value',name:'%',nameTextStyle:{color:'#94a3b8',fontSize:11},axisLabel:{color:'#64748b',fontSize:11,formatter:'{value}%'},splitLine:{show:false}}],series:[{name:'下单券数',type:'bar',barMaxWidth:26,itemStyle:{color:'#1677ff',borderRadius:[4,4,0,0]},data:bars},{name:'下单转化率',type:'line',yAxisIndex:1,connectNulls:false,symbolSize:7,lineStyle:{width:2.5,color:'#e2bd17'},itemStyle:{color:'#e2bd17'},data:rates}]};
 const total=valueAt('booking_total',last),consumed=valueAt('booking_consumed',last)??0,refunded=valueAt('booking_refunded',last)??0,pending=total==null?null:Math.max(total-consumed-refunded,0);
 const hasBooking=total!=null&&total>0&&(consumed+refunded+pending)>0;
 const pieOption={animation:false,aria:{enabled:true},color:['#1677ff','#e2bd17','#cbd5e1'],tooltip:{trigger:'item',renderMode:'richText',formatter:'{b}：{c} 单（{d}%）'},legend:{bottom:0,textStyle:{fontSize:11,color:'#64748b'}},series:[{type:'pie',radius:['52%','76%'],center:['50%','44%'],avoidLabelOverlap:true,itemStyle:{borderColor:'#fff',borderWidth:2},label:{fontSize:11,color:'#334155',formatter:'{b}\n{d}%'},data:[{name:'已消费',value:consumed},{name:'已退款',value:refunded},{name:'待消费',value:pending}]}]};
 return <section className="comparison-overview" aria-label="对比总览"><header className="comparison-overview-head"><span>本期 <b>{dateLabel(periods[last])}</b> · 对比上期 <b>{dateLabel(periods[before])}</b></span></header><div className="comparison-kpis">{kpis.map(item=><article key={item.key} className={`comparison-kpi${item.effect==='bad'?' is-bad':''}`}><span>{item.label}</span><strong>{kpiText(item.current,item.unit)}</strong><ChangeValue row={item.row}/></article>)}</div><div className="comparison-visuals"><figure><figcaption>近 {periods.length-start} 个时段：下单券数与下单转化率</figcaption><Chart option={comboOption} height={250}/></figure><figure><figcaption>本期预订订单构成</figcaption>{hasBooking?<Chart option={pieOption} height={250}/>:<div className="comparison-empty">本期暂无预订订单数据</div>}</figure></div></section>;
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
 const changeColumn={title:'变化',key:'change',align:'right',width:230,className:'comparison-change-col',render:(_,row)=>{const before=row.values[last-1]??null,after=row.values[last]??null;return <ChangeValue row={{...row,delta:before==null||after==null?null:after-before,change_rate:before==null||after==null||before===0?null:(after-before)/before}}/>}};
 const columns=[{title:'模块',dataIndex:'module',width:120,fixed:'left',onCell:row=>({rowSpan:row.moduleSpan,className:'comparison-module'})},{title:'指标',dataIndex:'label',width:236,fixed:'left',onCell:()=>({className:'comparison-metric-cell'})},...comparison.periods.map((period,index)=>{const isCurrent=index===last,isPrevious=index===last-1;return {title:<span className="comparison-period-heading"><span className={`comparison-period-tag${isCurrent?' is-current':''}`}>{isCurrent?'本期':isPrevious?'上期':''}</span><span>{dateLabel(period)}</span></span>,key:`period-${index}`,align:'right',width:190,className:isCurrent?'comparison-current-col':'',onHeaderCell:()=>({className:isCurrent?'comparison-current-head':''}),render:(_,row)=><strong className={isCurrent?'is-current':''}>{format(row.values[index],row.unit)}</strong>}}),...(last>=1?[changeColumn]:[])];
 const observed=comparison.periods.map(period=>`${dateLabel(period)} 已同步 ${period.observed_days} 天`).join('；');
 const changeNote=last>=1?`变化列对比最后两个时段：${dateLabel(comparison.periods[last-1])} → ${dateLabel(comparison.periods[last])}，箭头表示升降，颜色表示好坏，变坏的行整行标红。`:'';
 const rowEffect=row=>{const before=row.values[last-1]??null,after=row.values[last]??null;return before==null||after==null?null:metricEffect(row.key,after-before)};
 return <div className="period-comparison"><Table bordered size="small" rowKey="key" rowClassName={row=>rowEffect(row)==='bad'?'comparison-row-danger':''} columns={columns} dataSource={rows} pagination={false} scroll={print?undefined:{x:356+comparison.periods.length*190+230}}/><Typography.Paragraph type="secondary" className="comparison-note">{observed}。{changeNote}未同步的时段按 0 展示；转化率按各时段总量计算；星级取时段内最近一次有效记录。</Typography.Paragraph></div>;
}

export function MobilePeriodComparison({comparison}){
 if(!comparison)return <Typography.Paragraph>暂无上期对比数据。</Typography.Paragraph>;
 return <div className="mobile-comparison"><Typography.Paragraph type="secondary">本期：{dateLabel(comparison.current_period)}<br/>上期：{dateLabel(comparison.previous_period)}</Typography.Paragraph>{comparison.metrics.map(row=><section className="mobile-comparison-card" key={row.key}><h4>{row.label}</h4><div className="mobile-comparison-values"><div><span>本期</span><strong>{format(row.current,row.unit)}</strong></div><div><span>上期</span><strong>{format(row.previous,row.unit)}</strong></div></div><Difference row={row}/></section>)}<Typography.Paragraph type="secondary">缺失数据不补零；上期为零不计算增幅。转化率按周期总量计算，变化以百分点表示。</Typography.Paragraph></div>;
}
