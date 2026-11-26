const path=require('node:path')
const fs=require('node:fs/promises')
const labels={daily:'日报',weekly:'周报',monthly:'月报'}
const WIDTH=1440
const jobs=new Map()
// 在隐藏窗口里按固定宽度渲染对比总览，再截取整块区域，返回 PNG Buffer。
async function captureOverview({BrowserWindow,comparison}){
 let imageWindow
 try{
  imageWindow=new BrowserWindow({show:false,width:WIDTH,height:1100,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}})
  jobs.set(imageWindow.webContents.id,{comparison})
  await imageWindow.loadFile(path.join(__dirname,'overview-image.html'))
  await imageWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{if(window.__overviewImageReady)return resolve();const timer=setTimeout(()=>{document.removeEventListener('overview-image-ready',ready);reject(new Error('图片排版超时，请重新导出'))},30000);function ready(){clearTimeout(timer);resolve()}document.addEventListener('overview-image-ready',ready,{once:true})})`)
  const measure=()=>imageWindow.webContents.executeJavaScript("(()=>{const el=document.querySelector('.comparison-overview');if(!el)return null;const rect=el.getBoundingClientRect();return {x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)}})()")
  let rect=await measure()
  if(!rect?.width||!rect?.height)throw Error('未能生成对比总览图片')
  // 总览可能比初始窗口高：先按整块内容调整窗口，再截图。
  const [contentWidth,contentHeight]=imageWindow.getContentSize()
  if(rect.y+rect.height+24>contentHeight){
   imageWindow.setContentSize(contentWidth,Math.ceil(rect.y+rect.height+24))
   await new Promise(resolve=>setTimeout(resolve,250))
   rect=await measure()
  }
  // 隐藏窗口的合成器可能晚一帧，等画面完成后再截图，避免截到加载态。
  await new Promise(resolve=>setTimeout(resolve,350))
  const image=await imageWindow.webContents.capturePage(rect,{stayHidden:true})
  return image.toPNG()
 }finally{
  if(imageWindow){jobs.delete(imageWindow.webContents.id);if(!imageWindow.isDestroyed())imageWindow.destroy()}
 }
}
function registerAnalysisImage({ipcMain,BrowserWindow,dialog,getWindow}){
 const active=new Set()
 ipcMain.handle('analysis-overview-data',event=>{
  const job=jobs.get(event.sender.id)
  if(!job)throw Error('无效的对比总览导出任务')
  return job
 })
 ipcMain.handle('analysis-export-overview-image',async(event,args)=>{
  const owner=getWindow()
  if(!owner||owner.isDestroyed()||event.sender!==owner.webContents)throw Error('请从 AI 分析页下载对比总览')
  if(active.has(event.sender.id))throw Error('图片正在生成，请稍候')
  const report=args?.report,comparison=args?.comparison
  if(!report?.shop?.name||!labels[report.mode]||!comparison||!Array.isArray(comparison.metrics))throw Error('请先查询有效的对比总览')
  if(JSON.stringify(comparison).length>20*1024*1024)throw Error('报表数据过大，请缩短统计周期')
  active.add(event.sender.id)
  try{
   const periods=comparison.periods||[comparison.previous_period,comparison.current_period]
   const start=periods[0]?.start||report.period?.start||'',end=periods.at(-1)?.end||report.period?.end||''
   const forbidden='<>:'+String.fromCharCode(34,47,92)+'|?*'
   const name=Array.from(report.shop.name+'_'+labels[report.mode]+'对比总览_'+start+'_'+end).map(c=>c.charCodeAt(0)<32||forbidden.includes(c)?'_':c).join('').slice(0,180)
   const destination=await dialog.showSaveDialog(owner,{title:'下载对比总览图片',defaultPath:name+'.png',filters:[{name:'PNG 图片',extensions:['png']}]})
   if(destination.canceled||!destination.filePath)return {canceled:true}
   const target=/\.png$/i.test(destination.filePath)?destination.filePath:destination.filePath+'.png'
   const png=await captureOverview({BrowserWindow,comparison})
   await fs.writeFile(target,png)
   return {success:true,filePath:target}
  }finally{active.delete(event.sender.id)}
 })
}
module.exports={registerAnalysisImage,captureOverview}
