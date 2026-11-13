const path = require('path')
const { createAnalysisService } = require('./analysis-service')
function registerAnalysis({ app, db, ipcMain, BrowserWindow, safeStorage, metricService }) {
  const service = createAnalysisService({ db, safeStorage })
  let window = null
  ipcMain.handle('open-analysis', (event, options = {}) => {
    const context={shopName:options.shopName||'',configure:!!options.configure}
    if (window && !window.isDestroyed()) {
      window.show();window.focus();window.webContents.send('analysis-context',context);return
    }
    window = new BrowserWindow({ width:1440,height:960,minWidth:960,minHeight:680,title:'AI 经营分析',
      webPreferences:{ nodeIntegration:true,contextIsolation:false } })
    window.loadFile(path.join(__dirname,'analysis.html'),{query:{...(context.shopName?{shop:context.shopName}:{}),...(context.configure?{configure:'1'}:{})}} )
    if(context.configure)window.webContents.once('did-finish-load',()=>window?.webContents.send('analysis-context',context))
    window.on('closed',()=>{window=null})
  })
  require('./analysis-pdf').registerAnalysisPdf({ipcMain,BrowserWindow,dialog:require('electron').dialog,service,getWindow:()=>window})
  require('./analysis-excel').registerAnalysisExcel({ipcMain,dialog:require('electron').dialog,getWindow:()=>window})
  const handlers = {
    'analysis-shops':()=>{
      const observed=db.prepare('SELECT DISTINCT shop_name FROM daily_metrics WHERE is_mock=0 ORDER BY shop_name').all().map(row=>row.shop_name)
      const unique=new Map()
      for(const name of [...observed,...metricService.getDistinctShops()]){
        const key=name.replace(/[\s()（）]/g,'').toLowerCase()
        if(!unique.has(key))unique.set(key,name)
      }
      return [...unique.values()]
    },
    'analysis-config':()=>service.config(),
    'analysis-save-config':args=>service.saveConfig(args),
    'analysis-default-prompt':()=>service.defaultPrompt,
    'analysis-report':args=>{if(!args?.shopName)throw Error('请选择单个门店');return service.report({shopName:args.shopName,mode:args.mode,anchor:args.anchor})},
    'analysis-comparison':args=>service.comparison(args||{}),
    'analysis-history':id=>service.history(id),
    'analysis-record':id=>service.runRecord(id),
    'analysis-update-record':args=>service.updateResult({id:args?.id,result:args?.result}),
    'analysis-run':args=>service.run(args)
  }
  for(const [channel,handler] of Object.entries(handlers))ipcMain.handle(channel,async(event,args)=>{
    try{return await handler(args)}catch(error){throw new Error(error.message)}
  })
}
module.exports={registerAnalysis}
