const {app,BrowserWindow,ipcMain}=require('electron'),path=require('node:path'),fs=require('node:fs');
const {periods,summarize}=require('../analysis-core'),{comparePeriods}=require('../comparison-core');
const records=new Map();let target='',canceled=false;
(async()=>{await app.whenReady();let owner;try{
 owner=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});await owner.loadURL('about:blank');
 require('../analysis-pdf').registerAnalysisPdf({ipcMain,BrowserWindow,dialog:{showSaveDialog:async()=>({canceled,filePath:target})},service:{runRecord:id=>records.get(id)},getWindow:()=>owner});
 for(const [i,mode] of ['daily','weekly','monthly'].entries()){
 const bins=periods(mode,'2026-11-04'),period=bins.at(-1),previous=bins.at(-2),rows=['美团','点评'].map(platform=>({platform,stat_date:period.end,shop_name:'江南里（滨江店）',exposure:320,visits:42,orders:8,order_coupons:10,order_amount:1580.5,verify_uv:9,verify_coupons:11,verify_amount:1650,refund_coupons:1,refund_amount:50,star:4.8,new_reviews:5,new_bad_reviews:1})),summary=summarize(rows);
 const report={shop:{name:'江南里（滨江店）'},mode,anchor:'2026-11-04',period,coverage:{observed_shop_days:1,expected_shop_days:mode==='daily'?1:mode==='weekly'?7:30,observed_platform_records:2,partial_period:false},summary,trend:bins.map((b,n)=>({...b,...summary,order_amount:n===1?null:summary.order_amount*(.7+n*.03)})),comparison:comparePeriods(rows.map(r=>({...r,stat_date:previous.end,order_amount:1000})),rows,previous,period),details:rows,shop_metrics:{shop_promo_metrics:{pay_orders:3,pay_amount:200,verify_amount:180},shop_call_totals:{total:8},bookings:[{order_type:0,total:5}]}};
 const id=i+1;records.set(id,{id,status:'success',mode,start_date:period.start,end_date:period.end,model:'PDF 校验模型',created_at:'2026-11-05 10:00:00',updated_at:'2026-11-05 10:30:00',snapshot:{shop:report.shop},result:'# 门店经营分析\n\n## 经营结论\n下单有所提升，重点核对退款。\n\n'+Array.from({length:mode==='monthly'?45:3},(_,n)=>`### 跟进 ${n+1}\n核对美团与点评的退款日期，结合访问和下单数据判断变化。\n\n| 指标 | 本期 |\n| --- | --- |\n| 曝光人数 | 640 |\n`).join('\n')+'\n报告内容结束标记'});
 target=path.join(process.cwd(),'tmp/pdfs',mode+'.pdf');
 const args={report,recordId:id,metric:'order_amount',observations:['访问到下单累计比值较上期下降，建议先核对平台和日期。']};
 const result=await owner.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke('analysis-export-pdf',${JSON.stringify(args)})`);
 if(!result.success||fs.readFileSync(target).subarray(0,4).toString()!=='%PDF')throw Error('PDF export failed: '+mode);
 console.log('PASS '+mode+' PDF '+fs.statSync(target).size+' bytes');
 canceled=true;const cancel=await owner.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke('analysis-export-pdf',${JSON.stringify(args)})`);if(!cancel.canceled)throw Error('cancel failed');canceled=false;
 }
 if(BrowserWindow.getAllWindows().length!==1)throw Error('print windows leaked');console.log('PASS cancel and print window cleanup');
 }finally{if(owner&&!owner.isDestroyed())owner.destroy();app.quit()}
})().catch(e=>{console.error(e);app.exit(1)});
