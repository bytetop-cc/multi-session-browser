import React, { useEffect, useRef, useState } from 'react';
import { Table, Tag, Empty, Typography, Descriptions, Divider } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as echarts from 'echarts/core';
import { FunnelChart, LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, AriaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import './report-ui.css';
import {RobotOutlined,LoadingOutlined} from '@ant-design/icons';

echarts.use([FunnelChart, LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, SVGRenderer]);
const number = v => v == null || v === '--' ? '--' : Number.isFinite(Number(v)) ? Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : String(v);
const money = v => v == null ? '--' : '¥' + Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ratio = (a,b) => a == null || b == null || Number(b) <= 0 ? null : Number(a) / Number(b);
const percent = v => v == null ? '--' : (Number(v) * 100).toFixed(1) + '%';
const storeKeys = ['promo_pay_orders','promo_pay_amount','promo_verify_amount','promo_scan_users','promo_scan_favorites','promo_scan_reviews','call_total','booking_total','booking_consumed','booking_refunded','booking_pending'];
const sumKeys = ['exposure','visits','orders','order_coupons','order_amount','verify_uv','verify_coupons','verify_amount','new_reviews','new_bad_reviews','refund_coupons','refund_amount','ask_user_cnt',...storeKeys];
function Chart({option, height=300}) {
  const ref=useRef(null);
  useEffect(()=>{
    const chart=echarts.init(ref.current, null, {renderer:'svg'});
    chart.setOption(document.body.dataset.page==='print'?{...option,animation:false}:option);
    const observer=new ResizeObserver(()=>chart.resize()); observer.observe(ref.current);
    // The report container can be revealed immediately before React commits.
    chart.resize();
    return ()=>{observer.disconnect();chart.dispose()};
  },[option]);
  return <div className="report-chart" ref={ref} style={{height}} />;
}
function Funnel({summary:s,height=270}) {
  const stages=[['曝光人数',s.exposure],['访问人数',s.visits],['下单人数',s.orders]],complete=stages.every(([,value])=>value!=null&&Number.isFinite(Number(value)));
  const max=Math.max(1,...stages.map(([,value])=>Number(value)||0));
  const option={animationDuration:250,aria:{enabled:true},tooltip:{trigger:'item',renderMode:'richText',formatter:p=>`${p.name}\n${number(p.value)} 人`},series:[{type:'funnel',sort:'none',min:0,max,left:'3%',top:12,bottom:12,width:'62%',minSize:'0%',maxSize:'100%',gap:5,funnelAlign:'center',label:{position:'right',color:'#344256',fontSize:14,lineHeight:24,formatter:p=>`${p.name}\n${number(p.value)} 人`},labelLine:{length:12,lineStyle:{color:'#94a3b8'}},itemStyle:{borderWidth:0},data:stages.map(([name,value],i)=>({name,value,itemStyle:{color:['#69b1ff','#4096ff','#1677ff'][i]}}))}]};
  return <>{complete?<Chart option={option} height={height}/>:<><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="部分指标未同步，暂不绘制漏斗"/><Descriptions column={3} items={stages.map(([label,value])=>({key:label,label,children:number(value)}))}/></>}<div className="report-rates">{stages.slice(1).map(([name,value],i)=><div key={name}><span>{stages[i][0].replace('人数','')} → {name.replace('人数','')}（累计比值）</span><strong>{percent(ratio(value,stages[i][1]))}</strong></div>)}</div><Divider orientation="left">核销情况</Divider><Descriptions size="small" column={2} items={[{key:'uv',label:'核销人次',children:number(s.verify_uv)},{key:'coupons',label:'核销券数',children:number(s.verify_coupons)},{key:'amount',label:'核销金额（原价）',children:money(s.verify_amount)},{key:'ratio',label:'核销 / 下单券数',children:percent(ratio(s.verify_coupons,s.order_coupons))}]}/></>;
}
function Trend({bins,metric,color='#1677ff',height=260}) {
  const currency=metric.includes('amount');
  const option={animationDuration:250,aria:{enabled:true},color:[color],grid:{left:12,right:18,top:26,bottom:10,containLabel:true},tooltip:{trigger:'axis',renderMode:'richText',valueFormatter:v=>currency?money(v):number(v)},xAxis:{type:'category',data:bins.map(b=>b.label),axisLine:{lineStyle:{color:'#d9e1eb'}},axisLabel:{color:'#64748b',fontSize:12}},yAxis:{type:'value',axisLabel:{color:'#64748b'},splitLine:{lineStyle:{color:'#edf1f6'}}},series:[{name:currency?'金额（元）':metric.includes('coupons')?'券数（张）':metric==='verify_uv'?'核销人次':'人数',type:'line',smooth:false,connectNulls:false,symbolSize:7,lineStyle:{width:3},areaStyle:{color,opacity:.04},data:bins.map(b=>b[metric]??null)}]};
  return <Chart option={option} height={height}/>;
}
export const combinedTrendSeries=[['order_amount','下单金额'],['verify_amount','核销金额'],['refund_amount','退款金额'],['exposure','曝光人数'],['visits','访问人数'],['orders','下单人数']];
function ReportTrend({bins,series=combinedTrendSeries,partial=false,height=240,interactiveLegend=true}) {
 const data=bins||[],currency=series.some(([key])=>key.includes('amount'));
 const option={animation:false,aria:{enabled:true},color:['#c29b00','#1677ff','#cf1322','#722ed1','#13a8a8','#389e0d'],legend:{selectedMode:interactiveLegend,top:0,left:'center',textStyle:{fontSize:12,color:'#344256'}},grid:{left:12,right:18,top:series.length>6?(document.body.dataset.page==='print'?180:105):70,bottom:12,containLabel:true},tooltip:{trigger:'axis',renderMode:'richText'},xAxis:{type:'category',data:data.map((bin,i)=>bin.label+(partial&&i===data.length-1?'（未结束）':'')),axisLabel:{fontSize:11,color:'#64748b',hideOverlap:true},axisLine:{lineStyle:{color:'#d9e1eb'}}},yAxis:currency&&series.some(([key])=>!key.includes('amount'))?[{type:'value',name:'金额（元）',axisLabel:{color:'#64748b'},splitLine:{lineStyle:{color:'#edf1f6'}}},{type:'value',name:'数量',axisLabel:{color:'#64748b'},splitLine:{show:false}}]:{type:'value',name:currency?'金额（元）':'数量',axisLabel:{color:'#64748b'},splitLine:{lineStyle:{color:'#edf1f6'}}},series:series.map(([key,name])=>({name,type:'line',itemStyle:{color:({order_amount:'#c29b00',verify_amount:'#1677ff',refund_amount:'#cf1322',exposure:'#722ed1',visits:'#13a8a8',orders:'#389e0d',order_coupons:'#d46b08',verify_coupons:'#096dd9',refund_coupons:'#c41d7f',verify_uv:'#08979c'})[key]},yAxisIndex:currency&&series.some(([k])=>!k.includes('amount'))&&!key.includes('amount')?1:0,smooth:false,connectNulls:false,symbolSize:6,lineStyle:{width:2},data:data.map(bin=>bin[key]??null)}))};
 return <Chart option={option} height={height}/>;
}
function numericColumn(title,key,options={}) {
  return {title,dataIndex:key,key,width:key.includes('amount')?165:120,align:'right',sorter:(a,b)=>{const av=options.value?options.value(a):a[key],bv=options.value?options.value(b):b[key];return (Number(av)||0)-(Number(bv)||0)},render:(v,row)=>{const val=options.value?options.value(row):v;return <span className={key.includes('amount')?'report-amount':''}>{options.rate?percent(val):key.includes('amount')?money(val):number(val)}</span>}};
}
const group=(title,children)=>({title,children});
function detailColumns(withGroup,onShopClick) {
  return [group(withGroup?'日期 / 分组 / 门店 / 平台':'日期 / 门店 / 平台',[
    {title:'日期',dataIndex:'stat_date',key:'stat_date',width:116,fixed:'left'},
    ...(withGroup?[{title:'分组',dataIndex:'group_name',key:'group_name',width:160}]:[]),
    {title:'门店名称',dataIndex:'shop_name',key:'shop_name',width:220,fixed:'left',render:name=>onShopClick?<Typography.Link onClick={()=>onShopClick(name)}>{name}</Typography.Link>:name},
    {title:'平台',dataIndex:'platform',key:'platform',width:90,filters:['美团','点评','汇总'].map(value=>({text:value,value})),onFilter:(value,row)=>row.platform===value,render:value=><Tag color={value==='汇总'?'blue':value==='美团'?'gold':'orange'}>{value}</Tag>}
  ]),group('客流',[numericColumn('曝光人数','exposure'),numericColumn('访问人数','visits'),numericColumn('访问率','visit_rate',{rate:true,value:r=>ratio(r.visits,r.exposure)})]),
    group('下单',[numericColumn('下单人数','orders'),numericColumn('下单券数','order_coupons'),numericColumn('下单金额（原价）','order_amount')]),
    group('核销',[numericColumn('核销人次','verify_uv'),numericColumn('核销券数','verify_coupons'),numericColumn('核销金额（原价）','verify_amount'),numericColumn('核销金额 / 下单金额','verify_rate',{rate:true,value:r=>ratio(r.verify_amount,r.order_amount)})]),
    group('星级与评价',[numericColumn('星级','star'),numericColumn('新增评价','new_reviews'),numericColumn('新增差评','new_bad_reviews'),numericColumn('差评回复率','bad_reply_rate',{rate:true})]),
    group('在线咨询',[numericColumn('在线咨询人数','ask_user_cnt'),{title:'平均响应时长',dataIndex:'avg_reply_duration',width:145,render:v=>v??'--'}]),
    group('优惠码',[...['支付订单','支付金额','核销金额','扫码人数','扫码收藏数','扫码评价数'].map((title,i)=>numericColumn(title,storeKeys[i]))]),
    group('虚拟话单',[numericColumn('话单总数','call_total')]),group('预订订单',['订单总数','已消费','已退款','待消费'].map((title,i)=>numericColumn(title,storeKeys[i+7]))),
    group('退款',[numericColumn('退款券数','refund_coupons'),numericColumn('退款金额（原价）','refund_amount')])];
}
function addTotals(rows) {
  const total={};
  for (const key of sumKeys) {const values=rows.map(r=>r[key]).filter(v=>v!=null&&v!=='--'&&String(v).trim()!==''&&Number.isFinite(Number(v)));total[key]=values.length?values.reduce((a,b)=>a+Number(b),0):null;}
  return total;
}
function Details({records,withGroup=false,onShopClick}) {
  const [sort,setSort]=useState(null),[platforms,setPlatforms]=useState(null);
  const baseColumns=detailColumns(withGroup,onShopClick),baseLeaves=baseColumns.flatMap(c=>c.children);
  const blocks=new Map();
  for(const row of records){const key=JSON.stringify([row.stat_date,row.shop_id||row.shop_name]);if(!blocks.has(key))blocks.set(key,[]);blocks.get(key).push(row)}
  let ordered=[...blocks.values()];
  const comparator=sort?.order&&baseLeaves.find(c=>c.key===sort.columnKey)?.sorter;
  if(typeof comparator==='function')ordered.sort((a,b)=>comparator(a.find(r=>r.platform==='汇总')||a[0],b.find(r=>r.platform==='汇总')||b[0])*(sort.order==='ascend'?1:-1));
  const visibleRows=ordered.flatMap(block=>{const summary=block.find(r=>r.platform==='汇总');const shopMetrics=Object.fromEntries(storeKeys.map(key=>[key,summary?.[key]??block.find(r=>r[key]!=null)?.[key]??null]));const rows=block.filter(r=>!platforms?.length||platforms.includes(r.platform));return rows.map((r,i)=>({...r,_shopMetrics:shopMetrics,key:JSON.stringify([r.stat_date,r.shop_id||r.shop_name,r.platform,i]),_identitySpan:i===0?rows.length:0}))});
  const columns=baseColumns.map(section=>({...section,children:section.children.map(c=>({...c,
    ...(c.sorter?{sorter:true,sortOrder:sort?.columnKey===c.key?sort.order:null}:{}),
    ...(c.key==='platform'?{filteredValue:platforms}:{}),
    ...(storeKeys.includes(c.key)?{onCell:r=>({rowSpan:r._identitySpan,className:'report-merged-store'}),render:(value,row)=>c.render(row._shopMetrics?row._shopMetrics[c.key]:value,row)}:{}),
    ...(['stat_date','shop_name'].includes(c.key)?{onCell:r=>({rowSpan:r._identitySpan,className:'report-merged-identity'})}:{})
  }))})),leaves=columns.flatMap(c=>c.children);
  // One aggregate per shop/day is the only source for totals, including shop-only metrics.
  const totals=addTotals(records.filter(r=>r.platform==='汇总'));
  return <Table className="report-details" size="small" bordered columns={columns} dataSource={visibleRows} onChange={(_,filters,sorter)=>{setPlatforms(filters.platform||null);setSort(sorter.order?{columnKey:sorter.columnKey,order:sorter.order}:null)}} rowClassName={r=>r.platform==='汇总'?'report-summary-row':''} pagination={false} scroll={{x:leaves.reduce((n,c)=>n+c.width,0),y:520}} locale={{emptyText:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前范围暂无数据，请调整日期、门店或同步数据"/>}} summary={()=>records.length?<Table.Summary fixed><Table.Summary.Row>{leaves.map((c,i)=><Table.Summary.Cell key={c.key||c.dataIndex} index={i} align={i<2?'left':'right'}>{i===0?'所选范围合计':i===1?'':c.render?c.render(totals[c.dataIndex],totals):'--'}</Table.Summary.Cell>)}</Table.Summary.Row></Table.Summary>:null}/>;
}
function Stores({records}) {
  const columns=[{title:'门店',dataIndex:'shop_name',fixed:'left',width:220},numericColumn('已同步天数','observed_days'),numericColumn('下单金额（原价）','order_amount'),numericColumn('核销金额（原价）','verify_amount'),numericColumn('曝光人数','exposure'),numericColumn('访问人数','visits'),numericColumn('退款券数','refund_coupons'),numericColumn('退款金额（原价）','refund_amount')];
  return <Table size="small" columns={columns} dataSource={records} rowKey="shop_name" pagination={false} scroll={{x:1150}}/>;
}
function legacyMarkdown(text) {
  return text.replace(/^(一|二|三|四|五|六|七|八|九|十)[、．.][ \t]*(.+)$/gm,'## $1、$2');
}
function AIReport({text,status='empty'}) {
  if(status!=='success')return <div className={`report-placeholder ${status==='running'?'report-running':''}`} role="status"><div className="report-placeholder-mark">{status==='running'?<LoadingOutlined/>:<RobotOutlined/>}</div><strong>{status==='running'?'正在整理经营报告':status==='failed'?'此次分析未完成':'经营分析报告'}</strong><p>{text}</p></div>;
  return <article className="report-article"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{a:({children})=><span>{children}</span>,img:()=>null}}>{legacyMarkdown(text||'')}</ReactMarkdown></article>;
}


export { Details, Stores, Funnel, Trend, ReportTrend, AIReport };
