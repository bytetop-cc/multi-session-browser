const test=require('node:test');
const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {periods}=require('../analysis-core');
const {comparePeriods}=require('../comparison-core');
const {createComparisonWorkbook,registerAnalysisExcel}=require('../analysis-excel');
function fixture(mode='daily'){
  const bins=periods(mode,'2026-11-08'),previous=bins.at(-2),current=bins.at(-1);
  const before=[{platform:'点评',stat_date:previous.end,exposure:100,visits:20,order_amount:0,star:4.6,new_good_reviews:2}];
  const after=[{platform:'点评',stat_date:current.end,exposure:200,visits:60,order_amount:100,star:4.8,new_good_reviews:0}];
  return {shop:{name:'测试店'},mode,period:current,comparison:comparePeriods(before,after,previous,current)};
}
test('Excel round trips all report periods with typed numbers, missing values and percentage points',async()=>{
  for(const mode of ['daily','weekly','monthly']){
    const report=fixture(mode),book=createComparisonWorkbook(report),loaded=new ExcelJS.Workbook();
    await loaded.xlsx.load(await book.xlsx.writeBuffer());
    const sheet=loaded.worksheets[0],metrics=report.comparison.metrics;
    assert.equal(sheet.getCell('A1').value,'测试店 · '+({daily:'日报',weekly:'周报',monthly:'月报'}[mode])+'对比');
    assert(sheet.getCell('A2').value.includes(report.comparison.previous_period.start));
    for(const [i,m] of metrics.entries()){
      const row=sheet.getRow(6+i),expected=value=>value==null?(m.kind==='snapshot'?'--':0):value;
      assert.equal(row.getCell(3).value,expected(m.previous));
      assert.equal(row.getCell(4).value,expected(m.current));
      if(m.key==='visit_rate')assert.equal(row.getCell(4).numFmt,'0.00%');
      continue;
      if(m.key==='visit_rate'){assert.equal(row.getCell(4).numFmt,'0.00%');assert(Math.abs(row.getCell(5).value-10)<1e-8);assert(row.getCell(5).numFmt.includes('个百分点'));}
      if(m.key==='order_amount'){assert.equal(row.getCell(3).value,0);assert.equal(row.getCell(6).value,'--');}
      if(m.key==='dp_good_reviews'){assert.equal(row.getCell(3).value,2);assert.equal(row.getCell(4).value,0);assert.equal(row.getCell(5).value,-2);}
      if(m.key==='mt_star')assert.equal(row.getCell(4).value,'--');
    }
    assert.equal(sheet.views[0].ySplit,5);
  }
});
test('Excel mirrors the page table: current column highlight, change column and danger rows',async()=>{
  const report=fixture('daily'),loaded=new ExcelJS.Workbook();
  await loaded.xlsx.load(await createComparisonWorkbook(report).xlsx.writeBuffer());
  const sheet=loaded.worksheets[0];
  const changeHead=sheet.getCell(5,5);
  assert.equal(changeHead.value,'变化');
  const currentHead=sheet.getCell(5,4);
  assert.equal(currentHead.fill.fgColor.argb,'FFFFF1B8');
  assert.equal(currentHead.border.top.style,'medium');
  assert(currentHead.value.richText.map(run=>run.text).join('').includes('本期'));
  assert(sheet.getCell(5,3).value.richText.map(run=>run.text).join('').includes('上期'));
  const current=sheet.getCell(6,4);
  assert.equal(current.fill.fgColor.argb,'FFFFFDF0');
  assert.equal(current.font.bold,true);assert.equal(current.font.size,12);
  const index=report.comparison.metrics.findIndex(metric=>metric.key==='dp_good_reviews'),row=6+index;
  assert.equal(sheet.getCell(row,5).value,'↓ 2 条 / 100%');
  assert.equal(sheet.getCell(row,5).font.color.argb,'FFCF1322');
  assert.equal(sheet.getCell(row,4).fill.fgColor.argb,'FFFFF1F0');
  assert.equal(sheet.getCell(row,2).border.left.style,'medium');
});
test('Excel IPC validates owner, handles cancel/failure and saves chosen xlsx path',async()=>{
  let handler,choice={canceled:true},dialogCalls=0;
  const owner={isDestroyed:()=>false,webContents:{id:7}};
  registerAnalysisExcel({ipcMain:{handle:(name,fn)=>{assert.equal(name,'analysis-export-excel');handler=fn;}},getWindow:()=>owner,dialog:{showSaveDialog:async()=>{dialogCalls++;return choice;}}});
  const event={sender:owner.webContents},args={report:fixture()};
  await assert.rejects(handler({sender:{id:8}},args),/AI 分析页/);
  await assert.rejects(handler(event,{report:{}}),/有效/);
  assert.equal(dialogCalls,0);
  assert.deepEqual(await handler(event,args),{canceled:true});
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'analysis-excel-'));
  try{
    choice={filePath:path.join(dir,'missing','report.xlsx')};await assert.rejects(handler(event,args));
    choice={filePath:path.join(dir,'report')};
    const saved=await handler(event,args);assert.equal(saved.success,true);assert.equal(saved.filePath,choice.filePath+'.xlsx');
    const loaded=new ExcelJS.Workbook();await loaded.xlsx.readFile(saved.filePath);assert.equal(loaded.worksheets[0].getCell('B6').value,'门店等级');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
