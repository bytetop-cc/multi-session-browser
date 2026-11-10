const {chromium}=require('playwright'),assert=require('node:assert/strict'),{install}=require('./report-fixture.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await install(page);await page.goto('file://'+process.cwd()+'/analysis.html');
  const button=page.locator('#exportComparisonExcel');await button.waitFor();
  for(const mode of ['daily','weekly','monthly']){
   await page.locator('[data-mode='+mode+']').click();
   await page.waitForFunction(mode=>window.__requests.filter(r=>r.name==='analysis-report').at(-1).args.mode===mode,mode);
   await page.waitForFunction(()=>document.querySelectorAll('.ant-spin-spinning').length===0);
   await button.click();
   await page.waitForFunction(mode=>window.__requests.filter(r=>r.name==='analysis-export-excel').at(-1)?.args.report.mode===mode,mode);
   const exported=await page.evaluate(()=>window.__requests.filter(r=>r.name==='analysis-export-excel').at(-1).args.report);
   assert.equal(exported.mode,mode);assert.deepEqual(exported.period,exported.comparison.current_period);assert.equal(exported.shop.name,'江南里（滨江店）');
  }
  await page.evaluate(()=>window.__excelCancel=true);await button.click();await page.waitForTimeout(100);
  await page.evaluate(()=>{window.__excelCancel=false;window.__excelFailure=true;});await button.click();await page.getByText('Excel 导出失败，请重试',{exact:true}).waitFor();
  await page.evaluate(()=>window.__excelFailure=false);await button.click();
  await page.locator('.comparison-card').scrollIntoViewIfNeeded();await page.screenshot({path:'/private/tmp/analysis-excel-ui.png'});
  assert.deepEqual(errors,[]);console.log('PASS: comparison Excel exports daily/weekly/monthly report snapshots, cancel, error and retry');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
