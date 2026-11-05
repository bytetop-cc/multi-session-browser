const path=require('node:path')
const fs=require('node:fs/promises')
const {date}=require('./analysis-core')
const labels={daily:'日报',weekly:'周报',monthly:'月报'}
function registerAnalysisPdf({ipcMain,BrowserWindow,dialog,service,getWindow}){
 const jobs=new Map(),active=new Set()
 ipcMain.handle('analysis-pdf-data',event=>{const job=jobs.get(event.sender.id);if(!job)throw Error('无效的报告导出任务');return job})
 ipcMain.handle('analysis-export-pdf',async(event,args)=>{
  const owner=getWindow()
  if(!owner||owner.isDestroyed()||event.sender!==owner.webContents)throw Error('请从 AI 分析页导出报告')
  if(active.has(event.sender.id))throw Error('报告正在导出，请稍候')
  const report=args?.report
  if(!report?.shop?.name||!labels[report.mode]||!report.period)throw Error('请先查询有效报表')
  date(report.period.start);date(report.period.end)
  if(JSON.stringify(report).length>20*1024*1024)throw Error('报表数据过大，请缩短统计周期')
  active.add(event.sender.id)
  let printWindow
  try{
   const name=`${report.shop.name}_${labels[report.mode]}_${report.period.start}_${report.period.end}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,180)
   const destination=await dialog.showSaveDialog(owner,{title:'下载 PDF 报告',defaultPath:name+'.pdf',filters:[{name:'PDF 报告',extensions:['pdf']}]})
   if(destination.canceled||!destination.filePath)return {canceled:true}
   let record=null
   if(args.recordId){const candidate=service.runRecord(args.recordId),snapshot=candidate.snapshot;const shop=snapshot.shop?.name||(snapshot.group?.shops?.length===1?snapshot.group.shops[0]:null)
    if(candidate.status==='success'&&shop===report.shop.name&&candidate.mode===report.mode&&candidate.start_date===report.period.start&&candidate.end_date===report.period.end)record=candidate
   }
   printWindow=new BrowserWindow({show:false,width:420,height:840,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}})
   jobs.set(printWindow.webContents.id,{report,record,metric:args.metric||'order_amount',observations:Array.isArray(args.observations)?args.observations.filter(t=>typeof t==='string'):[],exportedAt:new Date().toISOString()})
   await printWindow.loadFile(path.join(__dirname,'report-print.html'))
   await printWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{if(window.__pdfReady)return resolve();const timer=setTimeout(()=>{document.removeEventListener('report-pdf-ready',ready);reject(new Error('报告排版超时，请重新导出'))},30000);function ready(){clearTimeout(timer);resolve()}document.addEventListener('report-pdf-ready',ready,{once:true})})`)
   const pdf=await printWindow.webContents.printToPDF({printBackground:true,pageSize:{width:108000,height:216000},preferCSSPageSize:true,margins:{top:.12,bottom:.2,left:.12,right:.12},displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-family:sans-serif;font-size:7px;color:#64748b;width:100%;text-align:center">门店经营报告 · <span class="pageNumber"></span> / <span class="totalPages"></span></div>'})
   const target=/\.pdf$/i.test(destination.filePath)?destination.filePath:destination.filePath+'.pdf'
   await fs.writeFile(target,pdf)
   return {success:true,filePath:target}
  }finally{
   if(printWindow){jobs.delete(printWindow.webContents.id);if(!printWindow.isDestroyed())printWindow.destroy()}
   active.delete(event.sender.id)
  }
 })
}
module.exports={registerAnalysisPdf}
