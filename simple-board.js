function parseSimpleBoard(response, platform) {
  const metrics = {};
  const names = { '曝光人数': 'exposure', '访问人数': 'visits', '下单券数': 'order_coupons', '下单金额（原价）': 'order_amount', '核销券数': 'verify_coupons', '核销金额（原价）': 'verify_amount' };
  names[platform === '点评' ? '大众点评星级' : '美团星级'] = 'star';
  const allowed = ['simpleDataBoardOverview', 'simpleDataBoardTradeSummaryPC', 'simpleDataBoardFlowSummaryPC', 'simpleDataBoardStarSummaryPC'];
  for (const component of response?.data || []) {
    if (!allowed.includes(component?.componentId || component?.uniqueMarker) || component.success === false || component.canShow === false || component.noData === true || !Array.isArray(component.body)) continue;
    for (const item of component.body) {
      const field = names[item?.name];
      if (!field || item.value == null) continue;
      const value = String(item.value).trim().replace(/[,，\s]/g, '').replace(/星$/, '');
      if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) continue;
      if (Number.isFinite(Number(value))) metrics[field] = Number(value);
    }
  }
  return metrics;
}
function shanghaiYesterday(now = new Date()) {
  return new Date(now.getTime() - 16 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function parseReviewOverviewStar(response) {
  if (response?.success !== true || Number(response.code) !== 200) return null;
  const raw=response.data?.star;
  if (!['string','number'].includes(typeof raw) || String(raw).trim() === '') return null;
  const value=Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 5 ? value : null;
}
function parseRecentReviewStats(response) {
  const metrics={};
  if(response?.success !== true || Number(response.code) !== 200 || !response.data)return metrics;
  for(const [source,target] of [['newReviewCount','new_reviews'],['newGoodReviewCount','new_good_reviews'],['newBadReviewCount','new_bad_reviews']]){
    const raw=response.data[source];
    if(!['number','string'].includes(typeof raw)||String(raw).trim()==='')continue;
    const value=Number(raw);
    if(Number.isSafeInteger(value) && value >= 0)metrics[target]=value;
  }
  const raw=response.data.badReviewReplyPercent;
  if(typeof raw==='string' && raw.trim().endsWith('%')){
    const text=raw.trim().slice(0,-1).trim(),value=Number(text);
    if(text!=='' && Number.isFinite(value) && value >= 0 && value <= 100)metrics.bad_reply_rate=value/100;
  }
  return metrics;
}
module.exports = { parseSimpleBoard, shanghaiYesterday, parseReviewOverviewStar, parseRecentReviewStats };
