import React from 'react';
import {Alert,Table,Typography} from 'antd';
const numeric=value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});
const dateLabel=period=>!period?'--':period.start===period.end?period.start:`${period.start} 至 ${period.end}`;
function format(value,unit){if(value==null)return '--';return unit==='rate'?(value*100).toFixed(2)+'%':numeric(value)+(unit==='星'?' 星':' '+unit)}
function Difference({row}){
 if(row.delta==null)return <Typography.Text type="secondary">--</Typography.Text>;
 if(Math.abs(row.delta)<1e-10)return <Typography.Text type="secondary">持平</Typography.Text>;
 const sign=row.delta>0?'+':'',delta=row.unit==='rate'?`${sign}${numeric(row.delta*100)} 个百分点`:`${sign}${numeric(row.delta)} ${row.unit}`;
 const label=row.unit==='rate'||row.unit==='星'?delta:`${delta} / ${row.change_rate==null?'--':(row.change_rate>0?'+':'')+numeric(row.change_rate*100)+'%'}`;
 return <span className="comparison-change">{label}</span>;
}
export function PeriodComparison({comparison,print=false}){
 if(!comparison)return <Alert type="info" title="当前报表暂无周期对比数据，请重新查询。"/>;
 const rows=comparison.metrics.map((row,i,all)=>({...row,moduleSpan:i&&all[i-1].module===row.module?0:all.filter(r=>r.module===row.module).length}));
 const columns=[{title:'模块',dataIndex:'module',width:140,onCell:row=>({rowSpan:row.moduleSpan,className:'comparison-module'})},{title:'指标',dataIndex:'label',width:240},{title:<span className="comparison-period-heading"><span>上期</span><span>{dateLabel(comparison.previous_period)}</span></span>,dataIndex:'previous',align:'right',width:220,render:(value,row)=>format(value,row.unit)},{title:<span className="comparison-period-heading"><span>本期</span><span>{dateLabel(comparison.current_period)}</span></span>,dataIndex:'current',align:'right',width:220,render:(value,row)=><strong>{format(value,row.unit)}</strong>},{title:'变化',key:'change',align:'right',width:230,render:(_,row)=><Difference row={row}/>}];
 return <div className="period-comparison"><Table bordered size="small" rowKey="key" columns={print?columns.map((column,i)=>({...column,width:[75,185,145,145,150][i]})):columns} dataSource={rows} pagination={false} scroll={print?undefined:{x:1050}}/><Typography.Paragraph type="secondary" className="comparison-note">上期已同步 {comparison.previous_observed_days} 天，本期已同步 {comparison.current_observed_days} 天。缺失数据保持“--”；上期为零时不计算增幅。转化率按周期总量计算，变化以百分点表示；星级取周期内最近一次有效记录。核销可能来自往期下单，核销/下单券数为累计比值。</Typography.Paragraph></div>;
}
