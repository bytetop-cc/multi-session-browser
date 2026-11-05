const fs=require('fs');
exports.install=async page=>{
 const core=fs.readFileSync('analysis-core.js','utf8'),comparison=fs.readFileSync('comparison-core.js','utf8');
 await page.addInitScript({content:`window.__core=(()=>{const module={exports:{}};${core};return module.exports})();`});
 await page.addInitScript({content:`window.__comparison=(()=>{const module={exports:{}};${comparison};return module.exports})();`});
 await page.addInitScript(()=>{
 const shops=['江南里（滨江店）','江南里（万象城店）'];let cfg={url:'https://provider.invalid/v1/chat/completions',model:'report-model',hasKey:true,reasoningEffort:''};const history=[];let next=1;
 const events={};window.__requests=[];window.__history=history;window.__emit=(name,payload)=>events[name]?.forEach(fn=>fn(null,payload));
 function rows(date,shopName){return shops.flatMap((shop_name,i)=>shopName&&shop_name!==shopName?[]:['美团','点评'].map((platform,j)=>({shop_name,shop_id:String(i+1),stat_date:date,platform,exposure:100+i*100+j*20,visits:30+j,orders:10,order_coupons:12,order_amount:500+i*100,verify_uv:8,verify_coupons:9,verify_amount:400,refund_amount:20,refund_coupons:1,call_total:i+3,promo_pay_orders:i+1,promo_pay_amount:50,promo_verify_amount:30,promo_scan_users:10,promo_scan_favorites:2,promo_scan_reviews:1,booking_total:5,booking_consumed:2,booking_refunded:1,booking_pending:2,star:4.8,bad_reply_rate:0,new_reviews:1,new_bad_reviews:0,ask_user_cnt:'3',avg_reply_duration:'1分钟'})))}
 function report(args){const bins=window.__core.periods(args.mode,args.anchor),period=bins.at(-1),details=rows(period.end,args.shopName),summary=window.__core.summarize(details);return {shop:{name:args.shopName},group:{id:-(shops.indexOf(args.shopName)+1),name:args.shopName,shops:[args.shopName]},mode:args.mode,anchor:args.anchor,period,coverage:{expected_shop_days:args.mode==='daily'?1:args.mode==='weekly'?7:31,observed_shop_days:1,observed_platform_records:2,partial_period:false},summary,comparison:window.__comparison.comparePeriods(rows(bins.at(-2).end,args.shopName),details,bins.at(-2),period),trend:bins.map((b,i)=>({...b,...window.__core.summarize(i===1?[]:details.map(row=>({...row,order_amount:row.order_amount*(.7+i*.03)})))})),stores:[{shop_name:args.shopName,...summary,observed_days:1}],details,previous_details:details.map(r=>({...r,exposure:r.exposure*2,visits:r.visits/2,order_amount:r.order_amount/2})),shop_metrics:{shop_promo_metrics:{synced_records:1,pay_orders:3,pay_amount:298,verify_amount:199,scan_users:18,scan_favorites:2,scan_reviews:1},shop_call_totals:{synced_records:1,total:3},bookings:[{order_type:0,total:56},{order_type:3,total:18},{order_type:5,total:3},{order_type:1,total:35}]}}}
 window.require=()=>({ipcRenderer:{on:(name,fn)=>(events[name]??=[]).push(fn),removeListener:(name,fn)=>{events[name]=events[name]?.filter(x=>x!==fn)},invoke:async(name,args)=>{
 window.__requests.push({name,args});
 if(name==='analysis-shops'||name==='metrics-get-shops')return shops;
 if(name==='metrics-get-dates')return ['2026-11-04'];
 if(name==='metrics-get-weekly')return {records:window.__empty?[]:rows(args.endDate)};
 if(name==='metrics-export-csv')return {success:true};
 if(name==='analysis-export-pdf'){if(window.__pdfFailure)throw Error('导出失败，请重试');return window.__pdfCancel?{canceled:true}:{success:true,filePath:'/tmp/test.pdf'}}
 if(name==='analysis-default-prompt')return window.__core.DEFAULT_PROMPT;
 if(name==='analysis-config')return cfg;
 if(name==='analysis-save-config'){if(window.__saveFailure)throw Error('保存失败，请重试');cfg={...cfg,...args,hasKey:args.key?true:args.clearKey?false:cfg.hasKey};delete cfg.key;return cfg}
 if(name==='analysis-report'){if(window.__slowShop===args.shopName)await new Promise(r=>setTimeout(r,400));return report(args)}
 if(name==='analysis-history')return history.filter(r=>r.shop_name===args);
 if(name==='analysis-record')return history.find(r=>r.id===args);
 if(name==='analysis-update-record'){if(window.__resultSaveFailure)throw Error('保存失败，请重试');const i=history.findIndex(r=>r.id===args.id);history[i]={...history[i],result:args.result,updated_at:'2026-11-05 11:00:00'};return history[i]}
 if(name==='analysis-run'){const old=args.retryId?history.find(r=>r.id===args.retryId):null,snapshot=old?old.snapshot:report(args),id=next++;const run={id,shop_name:snapshot.shop.name,group_name:snapshot.shop.name,mode:snapshot.mode,anchor:snapshot.anchor,start_date:snapshot.period.start,end_date:snapshot.period.end,model:cfg.model,prompt:args.prompt,snapshot,status:window.__fail?'failed':'success',error:window.__fail?'AI 接口请求失败（HTTP 503）':null,result:window.__fail?null:'# 经营分析报告\n\n## 本期经营结论\n**下单金额**为 '+snapshot.summary.order_amount+' 元。\n\n| 指标 | 数值 |\n| --- | --- |\n| 曝光人数 | '+snapshot.summary.exposure+' |\n\n## 行动建议\n- 补齐缺失日期\n- 核对退款记录\n\n<script>window.__unsafe=true</script>\n![外部图片](https://example.invalid/tracker.png)',created_at:'2026-11-05 10:30:00',retry_of:old?.id};history.unshift(run);return run}
 if(name==='run-data-analysis')return {success:!window.__syncFailure,message:window.__syncFailure?'未登录商户后台':'同步完成'};
 if(name==='sync-date-range'){window.__emit('sync-range-progress',{current:1,total:2,date:args.startDate,percent:50,message:'已同步'});return {success:!window.__syncFailure,message:window.__syncFailure?'同步失败':'同步完成'}}
 return true;
 }}});
 });
};
