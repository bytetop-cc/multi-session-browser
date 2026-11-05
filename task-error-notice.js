// One error event feeds the existing tab red dot and both error overlays.
function createTaskErrorReporter({send}) {
 return function report(tab,{task,endpoint,message,date}) {
  if(!tab?.id)return;
  const notice={tabId:tab.id,task:String(task||'任务'),endpoint:String(endpoint||'任务执行').split('?')[0],message:String(message||'请求失败').slice(0,1200),date:date||null};
  send(notice);
  return notice;
 };
}
module.exports={createTaskErrorReporter};
