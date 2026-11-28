const ExcelJS = require('exceljs');
const {date} = require('./analysis-core');
const labels = {daily:'日报', weekly:'周报', monthly:'月报'};
const validNumber = value => typeof value === 'number' && Number.isFinite(value);
const quote = String.fromCharCode(34);
const FONT = '微软雅黑';
// 与页面周期对比表保持一致的配色：模块列灰底、本期列浅黄、变化列浅蓝、变坏行整行标红。
const palette = {
  cardHead:'FFFFF8CB', head:'FFFFFCED', currentHead:'FFFFF1B8', accent:'FFE2BD17', headText:'FF7C6A1E',
  tagText:'FFA8A29E', currentTag:'FFA16207', module:'FFFAFBFC', current:'FFFFFDF0', change:'FFFBFCFE',
  danger:'FFFFF1F0', dangerAccent:'FFFF4D4F', grid:'FFE2E8F0', bodyText:'FF334155', currentText:'FF0F172A',
  title:'FF1F2937', subtle:'FF64748B', muted:'FF94A3B8', good:'FF389E0D', bad:'FFCF1322', neutral:'FF64748B'
};
// 与页面 ComparisonTable 一致：绿色=变好，红色=变坏，灰色=中性或持平。
const higherIsBetter = new Set(['exposure','visits','order_coupons','verify_coupons','visit_rate','order_rate','coupon_verify_rate','good_review_rate','promo_pay_orders','promo_scan_favorites','booking_total','booking_consumed','dp_star','mt_star','dp_good_reviews','mt_good_reviews','good_reviews']);
const lowerIsBetter = new Set(['refund_coupons','booking_refunded','dp_bad_reviews','mt_bad_reviews','bad_reviews']);
function metricEffect(key, delta) {
  if (delta == null || Math.abs(delta) < 1e-10) return 'flat';
  if (!higherIsBetter.has(key) && !lowerIsBetter.has(key)) return 'neutral';
  const up = delta > 0;
  return (higherIsBetter.has(key) ? up : !up) ? 'good' : 'bad';
}
const numberText = value => Number(value).toLocaleString('zh-CN', {maximumFractionDigits: 2});
const fill = argb => ({type:'pattern', pattern:'solid', fgColor:{argb}});
const gridBorder = () => ({top:{style:'thin',color:{argb:palette.grid}}, left:{style:'thin',color:{argb:palette.grid}}, bottom:{style:'thin',color:{argb:palette.grid}}, right:{style:'thin',color:{argb:palette.grid}}});
function changeText(metric, before, after) {
  if (metric.unit === '等级') {
    if (!before || !after) return {text:'--', color:palette.muted};
    return before === after ? {text:'— 持平', color:palette.muted} : {text:'— 变化', color:palette.neutral};
  }
  if (before == null || after == null) return {text:'--', color:palette.muted};
  const delta = after - before;
  if (Math.abs(delta) < 1e-10) return {text:'— 持平', color:palette.muted};
  const up = delta > 0, effect = metricEffect(metric.key, delta);
  const color = effect === 'good' ? palette.good : effect === 'bad' ? palette.bad : palette.neutral;
  const magnitude = metric.unit === 'rate' ? `${numberText(Math.abs(delta) * 100)} 个百分点` : `${numberText(Math.abs(delta))} ${metric.unit}`;
  const relative = metric.unit === 'rate' || metric.unit === '星' || before === 0 ? null : delta / before;
  const tail = metric.unit === 'rate' || metric.unit === '星' ? '' : ` / ${relative == null ? '--' : numberText(Math.abs(relative) * 100) + '%'}`;
  return {text:(up ? '↑ ' : '↓ ') + magnitude + tail, color};
}
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
const ranged=c=>c.periods?c:{periods:[{...c.previous_period,observed_days:c.previous_observed_days},{...c.current_period,observed_days:c.current_observed_days}],metrics:c.metrics.map(metric=>({...metric,values:[metric.previous??(metric.kind==='snapshot'||metric.module==='星级 / 评价'?null:0),metric.current??(metric.kind==='snapshot'||metric.module==='星级 / 评价'?null:0)]}))};
function createRangeWorkbook(report) {
  const c=ranged(report.comparison),periods=c.periods,last=periods.length-1,hasChange=last>=1;
  const columnCount=2+periods.length+(hasChange?1:0),changeColumn=columnCount;
  const periodLabel=period=>period.start===period.end?period.start:`${period.start} 至 ${period.end}`;
  const workbook=new ExcelJS.Workbook();
  workbook.creator='美团助手';
  const sheet=workbook.addWorksheet(labels[report.mode]+'对比',{views:[{state:'frozen',ySplit:5,xSplit:2}]});
  sheet.columns=[{width:14},{width:31},...periods.map(()=>({width:26})),...(hasChange?[{width:27}]:[])];
  sheet.mergeCells(1,1,1,columnCount);
  const title=sheet.getCell(1,1);
  title.value=report.shop.name+' · '+labels[report.mode]+'对比';
  title.font={name:FONT,size:16,bold:true,color:{argb:palette.title}};
  title.fill=fill(palette.cardHead);
  title.alignment={vertical:'middle',horizontal:'left'};
  title.border={bottom:{style:'medium',color:{argb:palette.accent}}};
  sheet.getRow(1).height=32;
  const meta=['对比时段：'+periods[0].start+' 至 '+periods[last].end,'已同步：'+periods.map(period=>periodLabel(period)+' '+(period.observed_days||0)+' 天').join('；')];
  meta.forEach((text,index)=>{const rowIndex=2+index,row=sheet.getRow(rowIndex);sheet.mergeCells(rowIndex,1,rowIndex,columnCount);const cell=sheet.getCell(rowIndex,1);cell.value=text;cell.font={name:FONT,size:10,color:{argb:palette.subtle}};cell.alignment={vertical:'middle'};row.height=20;});
  const head=sheet.getRow(5);
  head.height=46;
  for(const [col,text] of [[1,'模块'],[2,'指标']]){const cell=head.getCell(col);cell.value=text;cell.font={name:FONT,size:11,bold:true,color:{argb:palette.bodyText}};cell.fill=fill(palette.head);cell.alignment={vertical:'middle',horizontal:'left',wrapText:true};cell.border=gridBorder();}
  periods.forEach((period,index)=>{
    const isCurrent=index===last,isPrevious=index===last-1,tag=isCurrent?'本期':isPrevious?'上期':'';
    const cell=head.getCell(3+index);
    cell.value={richText:[
      {font:{name:FONT,size:10,bold:isCurrent,color:{argb:isCurrent?palette.currentTag:palette.tagText}},text:tag+'\n'},
      {font:{name:FONT,size:11,bold:isCurrent,color:{argb:palette.headText}},text:periodLabel(period)}
    ]};
    cell.fill=fill(isCurrent?palette.currentHead:palette.head);
    cell.alignment={vertical:'bottom',horizontal:'right',wrapText:true};
    cell.border={...gridBorder(),...(isCurrent?{top:{style:'medium',color:{argb:palette.accent}}}:{})};
  });
  if(hasChange){const cell=head.getCell(changeColumn);cell.value='变化';cell.font={name:FONT,size:11,bold:true,color:{argb:palette.bodyText}};cell.fill=fill(palette.head);cell.alignment={vertical:'middle',horizontal:'right'};cell.border=gridBorder();}
  const startRow=6;
  c.metrics.forEach((metric,index)=>{
    const row=sheet.getRow(startRow+index);
    const before=metric.values[last-1]??null,after=metric.values[last]??null;
    const effect=hasChange&&typeof before==='number'&&typeof after==='number'?metricEffect(metric.key,after-before):null;
    const danger=effect==='bad';
    const unit=String(metric.unit).replaceAll(quote,'');
    row.height=25;
    const moduleCell=row.getCell(1);
    moduleCell.value=metric.module;
    moduleCell.font={name:FONT,size:11,bold:true,color:{argb:palette.bodyText}};
    moduleCell.fill=fill(palette.module);
    moduleCell.alignment={vertical:'middle',horizontal:'left',wrapText:true};
    moduleCell.border=gridBorder();
    const labelCell=row.getCell(2);
    labelCell.value=metric.label;
    labelCell.font={name:FONT,size:11,color:{argb:palette.title}};
    labelCell.fill=fill(danger?palette.danger:'FFFFFFFF');
    labelCell.alignment={vertical:'middle',horizontal:'left',wrapText:true};
    labelCell.border={...gridBorder(),...(danger?{left:{style:'medium',color:{argb:palette.dangerAccent}}}:{})};
    metric.values.forEach((value,index)=>{
      const isCurrent=index===last,cell=row.getCell(3+index),snapshot=metric.kind==='snapshot';
      cell.value=snapshot?(value==null?'--':(typeof value==='number'?value:String(value))):(validNumber(value)?value:0);
      cell.numFmt=snapshot?(typeof value==='number'?'#,##0.##'+quote+' '+unit+quote:'@'):(metric.unit==='rate'?'0.00%':'#,##0.##'+quote+' '+unit+quote);
      cell.font={name:FONT,size:isCurrent?12:11,bold:true,color:{argb:isCurrent?palette.currentText:palette.bodyText}};
      cell.fill=fill(danger?palette.danger:isCurrent?palette.current:'FFFFFFFF');
      cell.alignment={vertical:'middle',horizontal:'right'};
      cell.border=gridBorder();
    });
    if(hasChange){
      const change=changeText(metric,before,after),cell=row.getCell(changeColumn);
      cell.value=change.text;
      cell.font={name:FONT,size:11,bold:true,color:{argb:change.color}};
      cell.fill=fill(danger?palette.danger:palette.change);
      cell.alignment={vertical:'middle',horizontal:'right',wrapText:true};
      cell.border=gridBorder();
    }
  });
  // 与页面一致：同一模块纵向合并单元格。
  let groupStart=0;
  for(let index=1;index<=c.metrics.length;index++){
    if(index===c.metrics.length||c.metrics[index].module!==c.metrics[groupStart].module){
      if(index-groupStart>1)sheet.mergeCells(startRow+groupStart,1,startRow+index-1,1);
      const cell=sheet.getCell(startRow+groupStart,1);
      cell.font={name:FONT,size:11,bold:true,color:{argb:palette.bodyText}};
      cell.fill=fill(palette.module);
      cell.alignment={vertical:'middle',horizontal:'left',wrapText:true};
      groupStart=index;
    }
  }
  sheet.autoFilter={from:{row:5,column:1},to:{row:5+c.metrics.length,column:columnCount}};
  const notes=['未同步的评价和星级显示为 --，其他未同步指标按 0 展示；转化率按各时段总量计算；星级取时段内最近一次有效记录；门店等级与经营评分取时段结束前最近一条快照（周/月即当周、当月最后一条）。'];
  if(hasChange)notes.push('变化列对比最后两个时段：'+periodLabel(periods[last-1])+' → '+periodLabel(periods[last])+'，箭头表示升降，颜色表示好坏，变坏的行整行标红。');
  const noteRow=sheet.rowCount+2;
  sheet.mergeCells(noteRow,1,noteRow,columnCount);
  const note=sheet.getCell(noteRow,1);
  note.value=notes.join('');
  note.font={name:FONT,size:10,color:{argb:palette.subtle}};
  note.alignment={wrapText:true,vertical:'middle'};
  sheet.getRow(noteRow).height=45;
  sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:5'};
  return workbook;
}
function createComparisonWorkbook(report) {
  validateReport(report);
  return createRangeWorkbook(report);
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
