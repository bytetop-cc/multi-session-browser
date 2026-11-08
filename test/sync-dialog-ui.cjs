const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {install}=require('./report-fixture.cjs');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await install(page);
    await page.addInitScript(()=>{
      const original=window.require;
      window.require=(...args)=>{const module=original(...args),invoke=module.ipcRenderer.invoke;
        return {...module,ipcRenderer:{...module.ipcRenderer,invoke:(name,args)=>{
          if(name!=='run-data-analysis')return invoke(name,args);
          if(window.__syncMode==='reject')return Promise.reject(new Error('连接失败'));
          if(window.__syncMode==='failure')return Promise.resolve({success:false,message:'同步失败'});
          return new Promise(resolve=>{window.__finishSync=resolve});
        }}};
      };
    });
    await page.goto('file://'+process.cwd()+'/dashboard.html');
    const open=()=>page.getByRole('button',{name:/同步数据/}).click();
    const close=page.locator('#closeSync');
    await open();await page.getByRole('button',{name:/开始同步/}).click();
    await page.waitForFunction(()=>typeof window.__finishSync==='function');
    assert.equal(await close.isDisabled(),true);
    await page.evaluate(()=>window.__emit('task-api-error',{task:'同步数据',tabId:'tab-1',endpoint:'/mda/v5/overview',message:'HTTP 401'}));
    await page.getByRole('button',{name:'知道了',exact:true}).click();
    await close.waitFor();assert.equal(await close.isEnabled(),true);
    await page.getByText('关闭弹窗后，同步任务仍会继续；如需中止批量同步，请点击停止同步。').waitFor();
    await close.click();await close.waitFor({state:'hidden'});
    await page.evaluate(()=>{window.__emit('task-api-error',{task:'同步数据',tabId:'tab-2',endpoint:'/mda/v5/trade',message:'HTTP 500'});window.__finishSync({success:false,message:'部分同步失败'})});
    await page.locator('.ant-modal-confirm').waitFor({state:'hidden'});
    for(const mode of ['failure','reject']){
      await page.evaluate(mode=>window.__syncMode=mode,mode);
      await open();await page.getByRole('button',{name:/开始同步/}).click();
      await page.getByRole('button',{name:'知道了',exact:true}).click();
      assert.equal(await close.isEnabled(),true);
      await close.click();await close.waitFor({state:'hidden'});
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: close on interface error while pending, no late popup, close after returned failure and thrown error');
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
