import React,{useEffect,useState} from 'react';
import {Alert,App,Button,DatePicker,Form,Spin,Table,Typography} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import dayjs from 'dayjs';
import {invoke} from './report-data';
const numeric=value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});
const dateLabel=period=>!period?'--':period.start===period.end?period.start:`${period.start} 至 ${period.end}`;
function format(value,unit){if(value==null)return '--';return unit==='rate'?(value*100).toFixed(2)+'%':numeric(value)+(unit==='星'?' 星':' '+unit)}
function ranged(comparison){if(comparison.periods)return comparison;return {periods:[{...comparison.previous_period,observed_days:comparison.previous_observed_days},{...comparison.current_period,observed_days:comparison.current_observed_days}],metrics:comparison.metrics.map(row=>({...row,values:[row.previous??0,row.current??0]})),shop_name:comparison.shop_name,mode:comparison.mode}}
function Difference({row}){
 if(row.delta==null)return <Typography.Text type="secondary">--</Typography.Text>;
 if(Math.abs(row.delta)<1e-10)return <Typography.Text type="secondary">持平</Typography.Text>;
 const sign=row.delta>0?'+':'',delta=row.unit==='rate'?`${sign}${numeric(row.delta*100)} 个百分点`:`${sign}${numeric(row.delta)} ${row.unit}`;
 const label=row.unit==='rate'||row.unit==='星'?delta:`${delta} / ${row.change_rate==null?'--':(row.change_rate>0?'+':'')+numeric(row.change_rate*100)+'%'}`;
 return <span className="comparison-change">{label}</span>;
}
export function PeriodComparison({comparison,print=false}){
 if(!comparison)return <Alert type="info" title="当前报表暂无周期对比数据，请重新查询。"/>;
 if(!print)return <InteractivePeriodComparison initial={comparison}/>;
 return <ComparisonTable comparison={ranged(comparison)} print/>;
}
function InteractivePeriodComparison({initial}){
 const {message}=App.useApp(),[comparison,setComparison]=useState(()=>ranged(initial)),[loading,setLoading]=useState(false);
 const initialRange=value=>{const data=ranged(value);return [dayjs(data.periods[0].start),dayjs(data.periods.at(-1).end)]};
 const [range,setRange]=useState(()=>initialRange(initial));
 useEffect(()=>{setComparison(ranged(initial));setRange(initialRange(initial))},[initial]);
 async function query(){if(!range?.[0]||!range?.[1]){message.error('请选择完整的对比日期范围');return}setLoading(true);try{const next=await invoke('analysis-comparison',{shopName:initial.shop_name,mode:initial.mode,startDate:range[0].format('YYYY-MM-DD'),endDate:range[1].format('YYYY-MM-DD')});Object.assign(initial,next);setComparison(next)}catch(error){message.error(error.message||String(error))}finally{setLoading(false)}}
 return <><Form className="comparison-filter" layout="inline" onFinish={query}><Form.Item label="对比时段"><DatePicker.RangePicker id="comparisonRange" aria-label="对比时段" value={range} onChange={setRange} allowClear={false}/></Form.Item><Form.Item><Button id="queryComparison" type="primary" htmlType="submit" icon={<SearchOutlined/>} loading={loading}>对比</Button></Form.Item></Form><Spin spinning={loading}><ComparisonTable comparison={comparison}/></Spin></>;
}
function ComparisonTable({comparison,print=false}){
 const rows=comparison.metrics.map((row,i,all)=>({...row,moduleSpan:i&&all[i-1].module===row.module?0:all.filter(r=>r.module===row.module).length}));
 const columns=[{title:'模块',dataIndex:'module',width:140,fixed:'left',onCell:row=>({rowSpan:row.moduleSpan,className:'comparison-module'})},{title:'指标',dataIndex:'label',width:240,fixed:'left'},...comparison.periods.map((period,index)=>({title:dateLabel(period),key:`period-${index}`,align:'right',width:190,render:(_,row)=><strong>{format(row.values[index],row.unit)}</strong>}))];
 const observed=comparison.periods.map(period=>`${dateLabel(period)} 已同步 ${period.observed_days} 天`).join('；');
 return <div className="period-comparison"><Table bordered size="small" rowKey="key" columns={columns} dataSource={rows} pagination={false} scroll={print?undefined:{x:380+comparison.periods.length*190}}/><Typography.Paragraph type="secondary" className="comparison-note">{observed}。未同步的时段按 0 展示；转化率按各时段总量计算；星级取时段内最近一次有效记录。</Typography.Paragraph></div>;
}

export function MobilePeriodComparison({comparison}){
 if(!comparison)return <Typography.Paragraph>暂无上期对比数据。</Typography.Paragraph>;
 return <div className="mobile-comparison"><Typography.Paragraph type="secondary">本期：{dateLabel(comparison.current_period)}<br/>上期：{dateLabel(comparison.previous_period)}</Typography.Paragraph>{comparison.metrics.map(row=><section className="mobile-comparison-card" key={row.key}><h4>{row.label}</h4><div className="mobile-comparison-values"><div><span>本期</span><strong>{format(row.current,row.unit)}</strong></div><div><span>上期</span><strong>{format(row.previous,row.unit)}</strong></div></div><Difference row={row}/></section>)}<Typography.Paragraph type="secondary">缺失数据不补零；上期为零不计算增幅。转化率按周期总量计算，变化以百分点表示。</Typography.Paragraph></div>;
}
