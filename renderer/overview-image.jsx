import React,{useEffect,useState} from 'react';
import {ComparisonOverview} from './period-comparison';
import {invoke} from './report-data';
export function OverviewImagePage(){
 const [job,setJob]=useState(null),[error,setError]=useState('');
 useEffect(()=>{invoke('analysis-overview-data').then(setJob).catch(e=>setError(e.message||String(e)))},[]);
 useEffect(()=>{if(!job)return;let alive=true;(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(alive){window.__overviewImageReady=true;document.dispatchEvent(new Event('overview-image-ready'))}})();return()=>{alive=false}},[job]);
 return job?<div className="overview-image-page"><ComparisonOverview comparison={job.comparison}/></div>:<p className="overview-image-loading">{error||'正在生成对比总览图片…'}</p>;
}
