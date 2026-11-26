const path=require('node:path')
const fs=require('node:fs/promises')
const os=require('node:os')
const {execFile}=require('node:child_process')
const {captureOverview}=require('./analysis-image')
const labels={daily:'日报',weekly:'周报',monthly:'月报'}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const quote=value=>String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')
function friendlyError(error){
 const message=String(error?.message||error||'').trim()
 if(/-1728|assistive access|辅助访问/i.test(message))return Error('无法控制微信：请在 系统设置 → 隐私与安全性 → 辅助功能 中允许本应用控制电脑后重试')
 if(/-1743|not authorized|不允许/i.test(message))return Error('无法控制微信：请在 系统设置 → 隐私与安全性 → 自动化 中允许本应用控制“系统事件”后重试')
 if(/-600|isn't running|not running|不能获得/i.test(message))return Error('未能操作微信：请确认微信已安装并登录后重试')
 return Error('发送到微信群失败：'+message)
}
function runOsa(script,timeout=60000){
 return new Promise((resolve,reject)=>execFile('osascript',['-e',script],{timeout},(error,stdout,stderr)=>{
  if(error)return reject(friendlyError(stderr||error.message))
  resolve(String(stdout||'').trim())
 }))
}
function runPowerShell(script,timeout=40000){
 return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-STA','-Command',script],{timeout,env:{...process.env,PYTHONIOENCODING:'utf-8'}},(error,stdout,stderr)=>{
  if(error){
   const message=String(stderr||error.message||'').trim()
   if(/AppActivate|MainWindowHandle|Get-Process|未能找到微信|未能启动微信/i.test(message))return reject(Error('未能激活微信窗口：请确认微信已登录，且主窗口未最小化到托盘后重试'))
   if(/SendKeys|SendWait/i.test(message))return reject(Error('无法模拟微信快捷键：请确认微信窗口可以正常输入后重试'))
   return reject(Error('发送到微信群失败：'+message))
  }
  resolve(String(stdout||'').trim())
 }))
}
function openApp(name){
 return new Promise((resolve,reject)=>execFile('open',['-a',name],error=>error?reject(error):resolve()))
}
async function activateWeChat(){
 try{await openApp('WeChat')}catch{await openApp('微信').catch(()=>{throw Error('未能启动微信，请确认已安装微信后重试')})}
}
async function detectWeChatProcess(){
 for(let attempt=0;attempt<20;attempt++){
  try{
   const name=await runOsa('tell application "System Events" to get name of first process whose bundle identifier is "com.tencent.xinWeChat"')
   if(name)return name.split(',')[0].trim()
  }catch(_){}
  await sleep(300)
 }
 return 'WeChat'
}
const WIN_ACTIVATE=`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
function Find-WeChat {
 Get-Process -Name WeChat,Weixin -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}
$proc=Find-WeChat
if(-not $proc){
 $pf=[Environment]::GetFolderPath('ProgramFiles')
 $pf86=[Environment]::GetFolderPath('ProgramFilesX86')
 $candidates=@("$pf\Tencent\WeChat\WeChat.exe","$pf86\Tencent\WeChat\WeChat.exe","$pf\Tencent\Weixin\Weixin.exe","$pf86\Tencent\Weixin\Weixin.exe")
 $exe=$candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
 if(-not $exe){ throw '未能找到微信安装目录' }
 Start-Process -FilePath $exe
 for($i=0;$i -lt 40;$i++){ Start-Sleep -Milliseconds 300; $proc=Find-WeChat; if($proc){break} }
}
if(-not $proc){ throw '未能启动微信' }
[Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id)
Start-Sleep -Milliseconds 800
[System.Windows.Forms.SendKeys]::SendWait('^f')
Start-Sleep -Milliseconds 800
[System.Windows.Forms.SendKeys]::SendWait('^a')
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 1400
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
`
const WIN_PASTE=`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
$proc=Get-Process -Name WeChat,Weixin -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if(-not $proc){ throw '未能找到微信窗口' }
[Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id)
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 1200
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
`
async function sendWindows({groupName,image,clipboard}){
 clipboard.writeText(groupName)
 await runPowerShell(WIN_ACTIVATE)
 await sleep(1600)
 clipboard.writeImage(image)
 await runPowerShell(WIN_PASTE)
}
// 搜索群名 → 打开会话 → 粘贴图片 → 发送。
async function sendToWeChat({groupName,image,clipboard,platform=process.platform}){
 if(platform==='win32')return sendWindows({groupName,image,clipboard})
 if(platform!=='darwin')throw Error('发送微信群目前支持 macOS 和 Windows')
 const {systemPreferences}=require('electron')
 if(!systemPreferences.isTrustedAccessibilityClient(false)){
  systemPreferences.isTrustedAccessibilityClient(true)
  throw Error('请在 系统设置 → 隐私与安全性 → 辅助功能 中勾选本应用后重试')
 }
 await activateWeChat()
 const processName=quote(await detectWeChatProcess())
 clipboard.writeText(groupName)
 await runOsa(`tell application "System Events"
  tell process "${processName}"
   set frontmost to true
   delay 0.8
   keystroke "f" using command down
   delay 0.8
   keystroke "a" using command down
   keystroke "v" using command down
   delay 1.4
   key code 36
  end tell
 end tell`)
 await sleep(1600)
 clipboard.writeImage(image)
 await runOsa(`tell application "System Events"
  tell process "${processName}"
   delay 0.4
   keystroke "v" using command down
   delay 1.2
   key code 36
  end tell
 end tell`)
}
function sanitizeName(value){
 return Array.from(String(value||'')).map(c=>c.charCodeAt(0)<32||'<>:"/\\|?*'.includes(c)?'_':c).join('').slice(0,120)||'对比总览'
}
function registerWechatSend({ipcMain,BrowserWindow,getWindow,settingService,clipboard,nativeImage,renderImage=captureOverview,deliver=sendToWeChat,tempDir=os.tmpdir()}){
 const active=new Set()
 const groupKey=shopName=>'wechat_group:'+shopName
 ipcMain.handle('wechat-group-get',(event,args)=>{
  const owner=getWindow()
  if(!owner||owner.isDestroyed()||event.sender!==owner.webContents)throw Error('请从 AI 分析页发送微信群')
  const shopName=String(args?.shopName||'').trim()
  if(!shopName)return ''
  return settingService.get(groupKey(shopName))||''
 })
 ipcMain.handle('wechat-send-overview',async(event,args)=>{
  const owner=getWindow()
  if(!owner||owner.isDestroyed()||event.sender!==owner.webContents)throw Error('请从 AI 分析页发送微信群')
  if(active.has(event.sender.id))throw Error('正在发送微信群，请稍候')
  const shopName=String(args?.shopName||'').trim(),groupName=String(args?.groupName||'').trim(),comparison=args?.comparison,report=args?.report
  if(!shopName)throw Error('请先选择门店')
  if(!groupName)throw Error('请填写微信群名称')
  if(groupName.length>80)throw Error('微信群名称过长')
  if(!report?.shop?.name||!labels[report.mode]||!comparison||!Array.isArray(comparison.metrics))throw Error('请先查询有效的对比总览')
  if(JSON.stringify(comparison).length>20*1024*1024)throw Error('报表数据过大，请缩短统计周期')
  active.add(event.sender.id)
  try{
   // 先记住门店与微信群的映射，即使发送失败下次也能自动带出。
   settingService.set(groupKey(shopName),groupName)
   const png=await renderImage({BrowserWindow,comparison})
   if(!png?.length)throw Error('对比总览图片生成失败')
   const image=nativeImage.createFromBuffer(png)
   if(!image||image.isEmpty())throw Error('对比总览图片生成失败')
   const periods=comparison.periods||[comparison.previous_period,comparison.current_period]
   const filePath=path.join(tempDir,'meituan-helper-overview',`${sanitizeName(shopName)}_${labels[report.mode]}_${periods.at(-1)?.end||report.period?.end||Date.now()}.png`)
   await fs.mkdir(path.dirname(filePath),{recursive:true})
   await fs.writeFile(filePath,png)
   await deliver({groupName,image,clipboard})
   return {success:true,groupName,filePath}
  }catch(error){
   throw error instanceof Error?error:friendlyError(error)
  }finally{active.delete(event.sender.id)}
 })
}
module.exports={registerWechatSend,sendToWeChat}
