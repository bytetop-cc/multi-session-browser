import React from 'react';
import {ArrowUpOutlined,ArrowDownOutlined,MinusOutlined} from '@ant-design/icons';
import {num} from './report-data';
export function MetricChange({current,previous,rate=false,absolute=false,duration=false}){
 if(duration){const seconds=v=>{if(v==null)return null;if(Number.isFinite(Number(v)))return Number(v);const text=String(v).trim();const match=text.match(/^(?:(\d+(?:\.\d+)?)\s*(?:分钟|分|min))?\s*(?:(\d+(?:\.\d+)?)\s*(?:秒钟|秒|s))?$/i);return match&&(match[1]||match[2])?Number(match[1]||0)*60+Number(match[2]||0):null};current=seconds(current);previous=seconds(previous)}
 const valid=v=>v!=null&&String(v).trim()!==''&&Number.isFinite(Number(v));
 if(!valid(current)||!valid(previous))return <div className="metric-change metric-change-neutral">环比 --</div>;
 const delta=Number(current)-Number(previous);
 if(Math.abs(delta)<1e-10)return <div className="metric-change metric-change-neutral">环比 <MinusOutlined/> 0{rate?' 个百分点':absolute?'':'%'}</div>;
 const up=delta>0,Icon=up?ArrowUpOutlined:ArrowDownOutlined;
 const label=rate?num(Math.abs(delta)*100)+' 个百分点':absolute?num(Math.abs(delta)):Number(previous)===0?'上期为 0，变化 '+(up?'+':'−')+num(Math.abs(delta)):num(Math.abs(delta/Number(previous))*100)+'%';
 return <div className={`metric-change ${up?'metric-change-up':'metric-change-down'}`}><span className="metric-change-label">环比</span> <Icon aria-label={up?'上升':'下降'}/> <span>{label}</span></div>;
}
