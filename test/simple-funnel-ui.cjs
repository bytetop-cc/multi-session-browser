const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {install}=require('./report-fixture.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await install(page);
  await page.addInitScript(()=>{
   const original=window.require;
   window.require=(...args)=>{const module=original(...args),invoke=module.ipcRenderer.invoke;
    return {...module,ipcRenderer:{...module.ipcRenderer,invoke:async(name,args)=>{
     const r=await invoke(name,args);if(name!=='analysis-report')return r;
     const values={exposure:83,visits:11,orders:null,verify_uv:null,order_coupons:1,order_amount:248,verify_coupons:1,verify_amount:248,...window.__funnelValues};
     r.shop.name='玄舒康·推拿·盲人按摩(双井店)';
     r.summary=window.__core.summarize([values]);r.trend=r.trend.map(bin=>({...bin,...r.summary}));
     window.__funnelReport=r;return r;
    }}};
   };
  });
  await page.goto('file://'+process.cwd()+'/analysis.html');
  const funnel=page.locator('#funnel');await funnel.locator('svg').waitFor();
  assert.equal(await funnel.getByText('部分指标未同步，暂不绘制漏斗').count(),0);
  assert((await funnel.locator('.report-chart').textContent()).includes('曝光人数'));
  assert((await funnel.locator('.report-chart').textContent()).includes('访问人数'));
  assert(!(await funnel.locator('.report-chart').textContent()).includes('下单人数'));
  assert.equal(await funnel.locator('.report-rates').textContent(),'曝光 → 访问（累计比值）13.3%');
  assert((await funnel.textContent()).includes('下单券数'));assert((await funnel.textContent()).includes('¥248.00'));
  assert(!(await page.locator('.conversion-observations').textContent()).includes('访问到下单'));
  await funnel.screenshot({path:'/private/tmp/simple-funnel-shuangjing.png'});
  await page.setViewportSize({width:960,height:1080});await funnel.screenshot({path:'/private/tmp/simple-funnel-narrow.png'});
  await page.evaluate(()=>window.__funnelValues={orders:2,verify_uv:1});await page.locator('#queryReport').click();
  await funnel.locator('.report-chart').getByText('下单人数',{exact:true}).waitFor();
  assert((await funnel.locator('.report-rates').textContent()).includes('18.2%'));
  await page.evaluate(()=>window.__funnelValues={exposure:0,visits:0});await page.locator('#queryReport').click();
  await page.waitForFunction(()=>document.querySelector('#funnel .report-rates')?.textContent==='曝光 → 访问（累计比值）--');
  assert.equal(await funnel.locator('.report-chart svg').count(),1);
  await page.evaluate(()=>window.__funnelValues={exposure:null,visits:null});await page.locator('#queryReport').click();
  await funnel.getByText('暂无可展示的客流转化数据').waitFor();
  assert.equal(await funnel.locator('.report-chart').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS: simple and full funnels, correct units, no invented order rate, zero and absent traffic, narrow layout');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
