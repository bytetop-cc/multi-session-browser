import dayjs from 'dayjs';
export const labels={daily:'日报',weekly:'周报',monthly:'月报'};
export const storeKeys=['promo_pay_orders','promo_pay_amount','promo_verify_amount','promo_scan_users','promo_scan_favorites','promo_scan_reviews','call_total','booking_total','booking_consumed','booking_refunded','booking_pending'];
export const num=v=>v==null?'--':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
export const money=v=>v==null?'--':'¥'+Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
export const normalize=name=>String(name||'').replace(/[\s()（）]/g,'').toLowerCase();
export const ipc=()=>window.require('electron').ipcRenderer;
export const invoke=(...args)=>ipc().invoke(...args);
export function subscribe(channel,fn){const listener=(_,payload)=>fn(payload);ipc().on(channel,listener);return ()=>ipc().removeListener?.(channel,listener)}
export const today=()=>dayjs(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
export function defaultDate(mode){return mode==='weekly'?today().subtract(7,'day'):mode==='monthly'?today().subtract(1,'month').endOf('month'):today().subtract(1,'day')}
export function groupFor(name,groups){return groups.find(g=>g.shops.some(s=>normalize(s)===normalize(name)))}
export function latestPlatformMetrics(records){
 const latest=[...records].filter(row=>row.platform!=='汇总').sort((a,b)=>String(b.stat_date).localeCompare(String(a.stat_date)));
 return Object.fromEntries(['美团','点评'].map(platform=>[platform,Object.fromEntries(['star','bad_reply_rate','avg_reply_duration'].map(key=>[key,latest.find(row=>row.platform===platform&&row[key]!=null&&row[key]!=='--'&&String(row[key]).trim()!=='')?.[key]??null]))]));
}
export function detailRows(records,groups=[]){
 const blocks=new Map();for(const row of records){const key=JSON.stringify([row.stat_date,row.shop_id||row.shop_name]);if(!blocks.has(key))blocks.set(key,[]);blocks.get(key).push(row)}
 return [...blocks.values()].sort((a,b)=>String(b[0].stat_date).localeCompare(String(a[0].stat_date))||a[0].shop_name.localeCompare(b[0].shop_name,'zh-CN')).flatMap(rows=>{
  const group_name=groupFor(rows[0].shop_name,groups)?.name||'--';
  const total={...rows[0],group_name,platform:'汇总',star:null,bad_reply_rate:null,avg_reply_duration:null,platform_metrics:latestPlatformMetrics(rows)};
  for(const key of ['exposure','visits','orders','order_coupons','order_amount','verify_uv','verify_coupons','verify_amount','new_reviews','new_good_reviews','new_bad_reviews','refund_coupons','refund_amount','ask_user_cnt']){
    const values=rows.map(r=>r[key]).filter(v=>v!=null&&v!=='--'&&String(v).trim()!==''&&Number.isFinite(Number(v)));total[key]=values.length?values.reduce((a,b)=>a+Number(b),0):null;
  }
  return [...rows].sort((a,b)=>(a.platform==='美团'?0:1)-(b.platform==='美团'?0:1)).map(r=>({...r,group_name,...Object.fromEntries(storeKeys.map(k=>[k,null]))})).concat(total);
 });
}
export function exportCsv(records,groups){
 const cols=[['日期','stat_date'],['门店名称','shop_name'],['平台','platform'],['曝光人数','exposure'],['访问人数','visits'],['访问转化率','visit_rate'],['下单人数','orders'],['下单券数','order_coupons'],['下单金额（原价）','order_amount'],['核销人次','verify_uv'],['核销券数','verify_coupons'],['核销金额（原价）','verify_amount'],['核销金额 / 下单金额','verify_amount_rate'],['星级','star'],['新增评价','new_reviews'],['新增好评','new_good_reviews'],['新增差评','new_bad_reviews'],['差评回复率','bad_reply_rate'],['在线咨询人数','ask_user_cnt'],['平均响应时长','avg_reply_duration'],...['优惠码支付订单','优惠码支付金额','优惠码核销金额','扫码人数','扫码收藏数','扫码评价数','虚拟号话单总数','预订订单总数','已消费','已退款','待消费'].map((name,i)=>[name,storeKeys[i]]),['退款券数','refund_coupons'],['退款金额（原价）','refund_amount']];
 const quote=v=>'"'+String(v??'--').replace(/"/g,'""')+'"';
 return [cols.map(c=>quote(c[0])).join(','),...records.map(r=>{const row={...r,group_name:groupFor(r.shop_name,groups)?.name||'--',visit_rate:r.exposure>0&&r.visits!=null?(r.visits/r.exposure*100).toFixed(2)+'%':'--',verify_amount_rate:r.order_amount>0&&r.verify_amount!=null?(r.verify_amount/r.order_amount*100).toFixed(2)+'%':'--'};return cols.map(c=>quote(row[c[1]])).join(',')})].join('\n');
}
