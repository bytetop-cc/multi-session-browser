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
module.exports = { parseSimpleBoard };
