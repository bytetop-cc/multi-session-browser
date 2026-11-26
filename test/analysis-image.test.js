const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {registerAnalysisImage}=require('../analysis-image');
const comparison={periods:[{start:'2026-11-09',end:'2026-11-15',observed_days:1},{start:'2026-11-16',end:'2026-11-22',observed_days:1}],metrics:[{key:'exposure',module:'流量数据',label:'曝光人数',unit:'人',values:[100,200]}]};
const report={shop:{name:'测试店'},mode:'weekly',period:{start:'2026-11-16',end:'2026-11-22'}};
function setup({canceled=false,filePath='/tmp/overview.png'}={}){
 const handlers={};let created=null;
 class FakeWindow{
  constructor(){created=this;this.destroyed=false;this.loadFile=async()=>{};this.getContentSize=()=>[1440,1100];this.setContentSize=()=>{};this.webContents={id:9,executeJavaScript:async code=>code.includes('comparison-overview')?{x:24,y:24,width:1392,height:800}:undefined,capturePage:async()=>({toPNG:()=>Buffer.from('PNG-DATA')})};}
  isDestroyed(){return this.destroyed}
  destroy(){this.destroyed=true}
 }
 const owner={isDestroyed:()=>false,webContents:{id:7}};
 registerAnalysisImage({ipcMain:{handle:(name,fn)=>{handlers[name]=fn}},BrowserWindow:FakeWindow,dialog:{showSaveDialog:async()=>({canceled,filePath})},getWindow:()=>owner});
 return {handlers,owner,created:()=>created};
}
test('overview image export captures the hidden page and writes the chosen png path',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'analysis-image-'));
 try{
  const {handlers,owner,created}=setup({filePath:path.join(dir,'overview')});
  const result=await handlers['analysis-export-overview-image']({sender:owner.webContents},{report,comparison});
  assert.equal(result.success,true);assert.equal(result.filePath,path.join(dir,'overview.png'));
  assert.equal(await fs.readFile(result.filePath,'utf8'),'PNG-DATA');
  assert.equal(created().destroyed,true);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
test('overview image export validates the owner, comparison and cancel path',async()=>{
 const {handlers,owner,created}=setup({canceled:true});
 await assert.rejects(handlers['analysis-export-overview-image']({sender:{id:8}},{report,comparison}),/AI 分析页/);
 await assert.rejects(handlers['analysis-export-overview-image']({sender:owner.webContents},{report,comparison:{}}),/有效的对比总览/);
 assert.equal(created(),null);
 assert.deepEqual(await handlers['analysis-export-overview-image']({sender:owner.webContents},{report,comparison}),{canceled:true});
 assert.equal(created(),null);
});
