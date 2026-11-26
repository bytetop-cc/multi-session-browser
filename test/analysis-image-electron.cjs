const {app,BrowserWindow,ipcMain,nativeImage}=require('electron'),path=require('node:path'),fs=require('node:fs');
const {comparePeriods}=require('../comparison-core');
(async()=>{await app.whenReady();let owner;try{
 owner=new BrowserWindow({show:false,width:400,height:300,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
 await owner.loadURL('about:blank');
 const previousPeriod={start:'2026-11-09',end:'2026-11-15'},currentPeriod={start:'2026-11-16',end:'2026-11-22'};
 const before=[{platform:'点评',shop_id:'1',stat_date:'2026-11-15',exposure:200,visits:40,order_coupons:20,verify_coupons:15,refund_coupons:1,new_reviews:21,new_good_reviews:18,new_bad_reviews:0,star:4.5,promo_pay_orders:4,promo_scan_favorites:1,call_total:28,booking_total:15,booking_consumed:12,booking_refunded:3},{platform:'美团',shop_id:'1',stat_date:'2026-11-15',exposure:150,visits:30,order_coupons:10,verify_coupons:8,star:5,new_reviews:0,new_good_reviews:0,new_bad_reviews:0}];
 const after=[{platform:'点评',shop_id:'1',stat_date:'2026-11-22',exposure:300,visits:60,order_coupons:28,verify_coupons:24,refund_coupons:2,new_reviews:34,new_good_reviews:30,new_bad_reviews:1,star:4.5,promo_pay_orders:19,promo_scan_favorites:7,call_total:29,booking_total:15,booking_consumed:12,booking_refunded:3},{platform:'美团',shop_id:'1',stat_date:'2026-11-22',exposure:230,visits:44,order_coupons:12,verify_coupons:9,star:4.9,new_reviews:0,new_good_reviews:0,new_bad_reviews:0}];
 const growth={previous:[{shop_name:'江南里（滨江店）',stat_date:'2026-11-15',grade_name:'银牌',score:70.5}],current:[{shop_name:'江南里（滨江店）',stat_date:'2026-11-22',grade_name:'金牌',score:78}]};
 const comparison={...comparePeriods(before,after,previousPeriod,currentPeriod,growth),shop_name:'江南里（滨江店）',mode:'weekly'};
 const report={shop:{name:'江南里（滨江店）'},mode:'weekly',period:currentPeriod};
 const target=path.join(process.cwd(),'tmp/overview-image.png');
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.rmSync(target,{force:true});
 require('../analysis-image').registerAnalysisImage({ipcMain,BrowserWindow,dialog:{showSaveDialog:async()=>({canceled:false,filePath:target})},getWindow:()=>owner});
 const result=await owner.webContents.executeJavaScript(`window.require('electron').ipcRenderer.invoke('analysis-export-overview-image',${JSON.stringify({report,comparison})})`);
 if(!result.success||fs.statSync(target).size<50000)throw Error('overview image export failed');
 const size=nativeImage.createFromPath(target).getSize();
 if(size.width<1000||size.height<500)throw Error('overview image too small: '+JSON.stringify(size));
 if(BrowserWindow.getAllWindows().length!==1)throw Error('image window leaked');
 console.log('PASS overview image '+size.width+'x'+size.height+' '+fs.statSync(target).size+' bytes');
 }finally{if(owner&&!owner.isDestroyed())owner.destroy();app.quit()}
})().catch(e=>{console.error(e);app.exit(1)});
