const ExcelJS = require('exceljs');
const {date} = require('./analysis-core');
const labels = {daily:'日报', weekly:'周报', monthly:'月报'};
const validNumber = value => typeof value === 'number' && Number.isFinite(value);
function validateReport(report) {
  const c = report?.comparison;
  if (!report?.shop?.name || !labels[report.mode] || !c || !Array.isArray(c.metrics) || c.metrics.length > 500) throw Error('请先查询有效的周期对比报表');
  const rangePeriods=c.periods||[c.previous_period,c.current_period];
  if(!rangePeriods.length||rangePeriods.length>366)throw Error('对比时段数量无效');
  for (const period of rangePeriods) {
    if (!period) throw Error('缺少报表日期');
    date(period.start); date(period.end);
    if (period.start > period.end) throw Error('报表日期范围无效');
  }
  if(c.periods&&c.metrics.some(metric=>!Array.isArray(metric.values)||metric.values.length!==rangePeriods.length))throw Error('对比数据与时段不一致');
}
const ranged=c=>c.periods?c:{periods:[{...c.previous_period,observed_days:c.previous_observed_days},{...c.current_period,observed_days:c.current_observed_days}],metrics:c.metrics.map(metric=>({...metric,values:[metric.previous??0,metric.current??0]}))};
function createRangeWorkbook(report) {
  const c=ranged(report.comparison),workbook=new ExcelJS.Workbook(),columnCount=2+c.periods.length,quote=String.fromCharCode(34),periodLabel=period=>period.start===period.end?period.start:`${period.start} 至 ${period.end}`;
  workbook.creator='美团助手';
  const sheet=workbook.addWorksheet(labels[report.mode]+'对比',{views:[{state:'frozen',ySplit:5,xSplit:2}]});
  sheet.columns=[{width:20},{width:28},...c.periods.map(()=>({width:24}))];
  sheet.mergeCells(1,1,1,columnCount);sheet.getCell(1,1).value=report.shop.name+' · '+labels[report.mode]+'对比';sheet.getCell(1,1).font={name:'微软雅黑',size:16,bold:true,color:{argb:'FF1F2937'}};sheet.getRow(1).height=32;
  sheet.mergeCells(2,1,2,columnCount);sheet.getCell(2,1).value='对比时段：'+c.periods[0].start+' 至 '+c.periods.at(-1).end;
  sheet.mergeCells(3,1,3,columnCount);sheet.getCell(3,1).value='已同步：'+c.periods.map(period=>periodLabel(period)+' '+(period.observed_days||0)+' 天').join('；');
  sheet.getRow(5).values=['模块','指标',...c.periods.map(periodLabel)];sheet.getRow(5).height=28;sheet.getRow(5).eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1677FF'}};cell.alignment={vertical:'middle',horizontal:'center'};});
  for(const metric of c.metrics){const row=sheet.addRow([metric.module,metric.label,...metric.values.map(value=>validNumber(value)?value:0)]),unit=String(metric.unit).replaceAll(quote,'');for(let col=3;col<=columnCount;col++)row.getCell(col).numFmt=metric.unit==='rate'?'0.00%':'#,##0.##'+quote+' '+unit+quote;row.height=25;row.eachCell((cell,col)=>{cell.font={name:'微软雅黑',size:11};cell.alignment={vertical:'middle',horizontal:col>2?'right':'left'};cell.border={bottom:{style:'hair',color:{argb:'FFE2E8F0'}}};if(row.number%2)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F8FC'}};});}
  sheet.autoFilter={from:{row:5,column:1},to:{row:5+c.metrics.length,column:columnCount}};const noteRow=sheet.rowCount+2;sheet.mergeCells(noteRow,1,noteRow,columnCount);sheet.getCell(noteRow,1).value='未同步的时段按 0 展示；转化率按各时段总量计算；星级取时段内最近一次有效记录。';sheet.getCell(noteRow,1).alignment={wrapText:true,vertical:'middle'};sheet.getRow(noteRow).height=45;sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:5'};
  return workbook;
}
function createComparisonWorkbook(report) {
  validateReport(report);
  return createRangeWorkbook(report);
  /* Legacy layout retained below only for old serialized workbooks. */
  const c=report.comparison, workbook=new ExcelJS.Workbook();
  workbook.creator='美团助手';
  const sheet=workbook.addWorksheet(labels[report.mode]+'对比',{views:[{state:'frozen',ySplit:6}]});
  sheet.columns=[{width:20},{width:28},{width:25},{width:25},{width:23},{width:18}];
  sheet.mergeCells('A1:F1');sheet.getCell('A1').value=report.shop.name+' · '+labels[report.mode]+'对比';
  sheet.getCell('A1').font={name:'微软雅黑',size:16,bold:true,color:{argb:'FF1F2937'}};sheet.getRow(1).height=32;
  for(const [row,text] of [[2,'上期：'+c.previous_period.start+' 至 '+c.previous_period.end],[3,'本期：'+c.current_period.start+' 至 '+c.current_period.end],[4,'已同步：上期 '+c.previous_observed_days+' 天，本期 '+c.current_observed_days+' 天']]) {sheet.mergeCells(row,1,row,6);sheet.getCell(row,1).value=text;}
  sheet.getRow(6).values=['模块','指标','上期','本期','变化（本期－上期）','增幅'];sheet.getRow(6).height=28;
  sheet.getRow(6).eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1677FF'}};cell.alignment={vertical:'middle',horizontal:'center'};});
  const quote=String.fromCharCode(34);
  for(const metric of c.metrics) {
    const numeric=value=>validNumber(value)?value:'--';
    const delta=validNumber(metric.delta)?(metric.unit==='rate'?metric.delta*100:metric.delta):'--';
    const relative=metric.unit==='rate'||metric.unit==='星'||!validNumber(metric.previous)||metric.previous===0?'--':numeric(metric.change_rate);
    const row=sheet.addRow([metric.module,metric.label,numeric(metric.previous),numeric(metric.current),delta,relative]);
    const unit=String(metric.unit).replaceAll(quote,'');
    for(const col of [3,4])row.getCell(col).numFmt=metric.unit==='rate'?'0.00%':'#,##0.##'+quote+' '+unit+quote;
    const suffix=quote+' '+(metric.unit==='rate'?'个百分点':unit)+quote;
    row.getCell(5).numFmt='+#,##0.##'+suffix+';-#,##0.##'+suffix+';'+quote+'持平'+quote;
    row.getCell(6).numFmt='+0.00%;-0.00%;'+quote+'持平'+quote;row.height=25;
    row.eachCell((cell,col)=>{cell.font={name:'微软雅黑',size:11};cell.alignment={vertical:'middle',horizontal:col>2?'right':'left'};cell.border={bottom:{style:'hair',color:{argb:'FFE2E8F0'}}};if(row.number%2)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F8FC'}};});
  }
  sheet.autoFilter={from:{row:6,column:1},to:{row:6+c.metrics.length,column:6}};
  const noteRow=sheet.rowCount+2;sheet.mergeCells(noteRow,1,noteRow,6);
  sheet.getCell(noteRow,1).value='缺失数据保持“--”；上期为零时不计算增幅。转化率按周期总量计算，变化以百分点表示；星级取周期内最近一次有效记录。核销可能来自往期下单，核销/下单券数为累计比值。';
  sheet.getCell(noteRow,1).alignment={wrapText:true,vertical:'middle'};sheet.getRow(noteRow).height=45;
  sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:6'};
  return workbook;
}
function registerAnalysisExcel({ipcMain,dialog,getWindow}) {
  const active=new Set();
  ipcMain.handle('analysis-export-excel',async(event,args)=>{
    const owner=getWindow();
    if(!owner||owner.isDestroyed()||event.sender!==owner.webContents)throw Error('请从 AI 分析页导出报表');
    if(active.has(event.sender.id))throw Error('Excel 正在导出，请稍候');
    const report=args?.report;validateReport(report);
    if(JSON.stringify(report).length>20*1024*1024)throw Error('报表数据过大，请缩短统计周期');
    active.add(event.sender.id);
    try {
      const forbidden='<>:'+String.fromCharCode(34,47,92)+'|?*';
      const periods=ranged(report.comparison).periods;
      const name=Array.from(report.shop.name+'_'+labels[report.mode]+'对比_'+periods[0].start+'_'+periods.at(-1).end).map(c=>c.charCodeAt(0)<32||forbidden.includes(c)?'_':c).join('').slice(0,180);
      const destination=await dialog.showSaveDialog(owner,{title:'导出对比 Excel',defaultPath:name+'.xlsx',filters:[{name:'Excel 工作簿',extensions:['xlsx']}]});
      if(destination.canceled||!destination.filePath)return {canceled:true};
      const target=destination.filePath.toLowerCase().endsWith('.xlsx')?destination.filePath:destination.filePath+'.xlsx';
      await createComparisonWorkbook(report).xlsx.writeFile(target);
      return {success:true,filePath:target};
    }finally{active.delete(event.sender.id);}
  });
}
module.exports={createComparisonWorkbook,registerAnalysisExcel};
