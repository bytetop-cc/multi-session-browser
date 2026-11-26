const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {registerWechatSend,sendToWeChat}=require('../wechat-send');
const report={shop:{name:'测试店'},mode:'weekly',period:{start:'2026-11-16',end:'2026-11-22'}};
const comparison={periods:[{start:'2026-11-09',end:'2026-11-15'},{start:'2026-11-16',end:'2026-11-22'}],metrics:[{key:'exposure',module:'流量数据',label:'曝光人数',unit:'人',values:[100,200]}]};
function setup({tempDir,deliver}={}){
 const settings=new Map(),handlers={},owner={isDestroyed:()=>false,webContents:{id:7}};
 let delivered=null,rendered=null;
 registerWechatSend({
  ipcMain:{handle:(name,fn)=>{handlers[name]=fn}},
  BrowserWindow:class{},
  getWindow:()=>owner,
  settingService:{get:key=>settings.get(key)||'',set:(key,value)=>settings.set(key,value)},
  clipboard:{writeText:()=>{},writeImage:()=>{}},
  nativeImage:{createFromBuffer:()=>({isEmpty:()=>false})},
  renderImage:async input=>{rendered=input.comparison;return Buffer.from('PNG-DATA')},
  deliver:deliver||(async payload=>{delivered=payload}),
  tempDir
 });
 return {handlers,owner,settings,delivered:()=>delivered,rendered:()=>rendered};
}
test('wechat send saves the shop group mapping, renders the image and delivers it',async()=>{
 const tempDir=await fs.mkdtemp(path.join(os.tmpdir(),'wechat-send-'));
 try{
  const {handlers,owner,settings,delivered,rendered}=setup({tempDir});
  assert.equal(await handlers['wechat-group-get']({sender:owner.webContents},{shopName:'测试店'}),'');
  const result=await handlers['wechat-send-overview']({sender:owner.webContents},{shopName:'测试店',groupName:' 测试微信群 ',report,comparison});
  assert.equal(result.success,true);assert.equal(result.groupName,'测试微信群');
  assert.equal(settings.get('wechat_group:测试店'),'测试微信群');
  assert.equal(await handlers['wechat-group-get']({sender:owner.webContents},{shopName:'测试店'}),'测试微信群');
  assert.equal(rendered(),comparison);
  assert.equal(delivered().groupName,'测试微信群');
  assert.equal(delivered().image.isEmpty(),false);
  const info=await fs.stat(result.filePath);assert(info.size>0);
 }finally{await fs.rm(tempDir,{recursive:true,force:true})}
});
test('wechat send validates input and keeps the mapping when delivery fails',async()=>{
 const tempDir=await fs.mkdtemp(path.join(os.tmpdir(),'wechat-send-'));
 try{
  const {handlers,owner,settings}=setup({tempDir,deliver:async()=>{throw Error('未能操作微信')}});
  await assert.rejects(handlers['wechat-send-overview']({sender:{id:8}},{shopName:'测试店',groupName:'群',report,comparison}),/AI 分析页/);
  await assert.rejects(handlers['wechat-send-overview']({sender:owner.webContents},{shopName:'测试店',groupName:' ',report,comparison}),/微信群名称/);
  await assert.rejects(handlers['wechat-send-overview']({sender:owner.webContents},{shopName:'测试店',groupName:'群',report,comparison:{}}),/有效的对比总览/);
  await assert.rejects(handlers['wechat-send-overview']({sender:owner.webContents},{shopName:'测试店',groupName:'新群',report,comparison}),/未能操作微信/);
  assert.equal(settings.get('wechat_group:测试店'),'新群');
 }finally{await fs.rm(tempDir,{recursive:true,force:true})}
});

test('wechat send supports macOS and Windows shortcuts and rejects other platforms',async()=>{
 await assert.rejects(sendToWeChat({groupName:'群',image:null,clipboard:{writeText:()=>{},writeImage:()=>{}},platform:'linux'}),/macOS 和 Windows/);
});
