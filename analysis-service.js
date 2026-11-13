const { comparePeriods, compareRangePeriods } = require('./comparison-core')
const { DEFAULT_PROMPT, periods, summarize, date, shift, requestAnalysis, endpoint } = require('./analysis-core')
function createAnalysisService({ db, safeStorage }) {
  db.exec(`CREATE TABLE IF NOT EXISTS analysis_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, shops_json TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS analysis_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, group_name TEXT NOT NULL,
    mode TEXT NOT NULL, anchor TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
    prompt TEXT NOT NULL, snapshot_json TEXT NOT NULL, model TEXT NOT NULL,
    status TEXT NOT NULL, result TEXT, error TEXT, retry_of INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, finished_at TEXT);
    CREATE INDEX IF NOT EXISTS analysis_runs_group ON analysis_runs(group_id, id);`)
  db.prepare("UPDATE analysis_runs SET status='failed', error='应用关闭导致分析中断，可重试', finished_at=CURRENT_TIMESTAMP WHERE status='running'").run()
  if(!db.prepare('PRAGMA table_info(analysis_runs)').all().some(column=>column.name==='updated_at'))db.exec('ALTER TABLE analysis_runs ADD COLUMN updated_at TEXT')
  // Internal scope IDs keep the existing history schema without exposing store groups.
  db.exec('CREATE TABLE IF NOT EXISTS analysis_shop_scopes (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_name TEXT NOT NULL UNIQUE)')
  const getSetting = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || ''
  const setSetting = (key,value) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value)
  const groups = () => db.prepare('SELECT * FROM analysis_groups ORDER BY id').all().map(r => ({ id:r.id, name:r.name, shops:JSON.parse(r.shops_json) }))
  function saveGroup({id, name, shops}) {
    name = String(name || '').trim()
    if (!name || name.length > 80 || !Array.isArray(shops) || !shops.length || shops.some(s=>typeof s !== 'string' || !s.trim())) throw Error('请填写分组名称并至少选择一家门店')
    shops = [...new Set(shops)]
    const conflict = groups().find(group => group.id !== Number(id) && group.shops.some(shop => shops.includes(shop)))
    if (conflict) throw Error(`门店已关联其他分组：${conflict.name}，请先从原分组移除`)
    if (id) {
      const result = db.prepare('UPDATE analysis_groups SET name=?, shops_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, JSON.stringify(shops), id)
      if (!result.changes) throw Error('门店组不存在，请刷新')
    } else id = db.prepare('INSERT INTO analysis_groups(name,shops_json) VALUES(?,?)').run(name,JSON.stringify(shops)).lastInsertRowid
    return Number(id)
  }
  function config() { return { url:getSetting('analysis_url') || 'https://api.openai.com/v1/chat/completions', model:getSetting('analysis_model') || 'gpt-6.1-sol', reasoningEffort:getSetting('analysis_reasoning_effort'), hasKey:!!getSetting('analysis_key_encrypted') } }
  function saveConfig({url, model, key, clearKey, reasoningEffort = ''}) {
    url = endpoint(url); model = String(model || '').trim(); key = String(key || '').trim()
    if (!model) throw Error('请填写模型名称')
    reasoningEffort = String(reasoningEffort).trim()
    if (!['', 'low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)) throw Error('请选择有效的思考程度')
    // 检查所有字段后再写入，空白 Key 表示沿用现有值。
    let encrypted
    if (key) {
      if (!safeStorage.isEncryptionAvailable()) throw Error('系统密钥加密不可用，暂时无法保存 API Key')
      encrypted = safeStorage.encryptString(String(key).trim()).toString('base64')
    }
    db.transaction(()=>{setSetting('analysis_url',url);setSetting('analysis_model',model);setSetting('analysis_reasoning_effort',reasoningEffort)
      if (encrypted) setSetting('analysis_key_encrypted',encrypted)
      else if (clearKey) setSetting('analysis_key_encrypted','')
    })()
    return config()
  }
  const groupData = id => { const g=groups().find(g=>g.id===Number(id));if(!g)throw Error('请先配置并选择门店组');return g }
  function comparison({shopName, mode, startDate, endDate}) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||startDate>endDate)throw Error('请选择有效的对比日期范围')
    if(!['daily','weekly','monthly'].includes(mode))throw Error('无效报表周期')
    const name=String(shopName||'').trim(),normalize=value=>value.replace(/[\s()（）]/g,'').toLowerCase()
    const known=db.prepare('SELECT DISTINCT shop_name FROM daily_metrics WHERE is_mock=0').all().map(row=>row.shop_name)
    const canonical=known.find(actual=>normalize(actual)===normalize(name))
    if(!canonical)throw Error('该门店暂无已同步经营数据，请先同步')
    const rows=db.prepare(`SELECT m.*,r.refund_coupons,r.refund_amount FROM daily_metrics m
      LEFT JOIN shop_refund_metrics r ON r.shop_id=m.shop_id AND r.stat_date=m.stat_date AND r.platform=m.platform
      WHERE m.shop_name=? AND m.stat_date BETWEEN ? AND ? AND m.is_mock=0 ORDER BY m.stat_date,m.platform`).all(canonical,startDate,endDate)
    const result=[],cursor=new Date(startDate+'T00:00:00Z'),last=new Date(endDate+'T00:00:00Z')
    while(cursor<=last){const start=cursor.toISOString().slice(0,10);let bucketEnd=new Date(cursor);if(mode==='weekly')bucketEnd.setUTCDate(bucketEnd.getUTCDate()+(7-bucketEnd.getUTCDay())%7);else if(mode==='monthly')bucketEnd=new Date(Date.UTC(bucketEnd.getUTCFullYear(),bucketEnd.getUTCMonth()+1,0));if(bucketEnd>last)bucketEnd=last;result.push({start,end:bucketEnd.toISOString().slice(0,10)});cursor.setUTCDate(bucketEnd.getUTCDate()+1)}
    return {...compareRangePeriods(rows,result),shop_name:canonical,mode,start_date:startDate,end_date:endDate}
  }
  function report({shopName, groupId, mode, anchor}) {
    let configured
    if (shopName) {
      const name=String(shopName).trim()
      const normalize=value=>value.replace(/[\s()（）]/g,'').toLowerCase()
      const known=db.prepare('SELECT DISTINCT shop_name FROM daily_metrics WHERE is_mock=0').all().map(r=>r.shop_name)
      const canonical=known.find(actual=>normalize(actual)===normalize(name))
      if(!canonical)throw Error('该门店暂无已同步经营数据，请先同步')
      db.prepare('INSERT INTO analysis_shop_scopes(shop_name) VALUES(?) ON CONFLICT(shop_name) DO NOTHING').run(canonical)
      const scope=db.prepare('SELECT id FROM analysis_shop_scopes WHERE shop_name=?').get(canonical)
      configured={id:-scope.id,name:canonical,shops:[canonical]}
    } else configured=groupData(groupId)
    const bins = periods(mode,anchor)
    const normalize = value => value.replace(/[\s()（）]/g,'').toLowerCase()
    const known = db.prepare('SELECT DISTINCT shop_name FROM daily_metrics WHERE is_mock=0').all().map(r=>r.shop_name)
    const group = { ...configured, shops:[...new Set(configured.shops.map(name=>known.find(actual=>normalize(actual)===normalize(name)) || name))] }
    const start = bins[0].start, end = bins[bins.length-1].end, current=bins[bins.length-1]
    const marks = group.shops.map(()=>'?').join(',')
    const rows = db.prepare(`SELECT m.*, r.refund_coupons, r.refund_amount,
      p.pay_orders AS promo_pay_orders, p.pay_amount AS promo_pay_amount, p.verify_amount AS promo_verify_amount,
      p.scan_users AS promo_scan_users, p.scan_favorites AS promo_scan_favorites, p.scan_reviews AS promo_scan_reviews,
      c.total AS call_total, b0.total AS booking_total, b3.total AS booking_consumed,
      b5.total AS booking_refunded, b1.total AS booking_pending, md.response_json AS overview_json
      FROM daily_metrics m
      LEFT JOIN shop_refund_metrics r ON r.shop_id=m.shop_id AND r.stat_date=m.stat_date AND r.platform=m.platform
      LEFT JOIN shop_promo_metrics p ON p.shop_id=m.shop_id AND p.stat_date=m.stat_date
      LEFT JOIN shop_call_totals c ON c.shop_id=m.shop_id AND c.stat_date=m.stat_date
      LEFT JOIN shop_booking_totals b0 ON b0.shop_id=m.shop_id AND b0.stat_date=m.stat_date AND b0.order_type=0
      LEFT JOIN shop_booking_totals b3 ON b3.shop_id=m.shop_id AND b3.stat_date=m.stat_date AND b3.order_type=3
      LEFT JOIN shop_booking_totals b5 ON b5.shop_id=m.shop_id AND b5.stat_date=m.stat_date AND b5.order_type=5
      LEFT JOIN shop_booking_totals b1 ON b1.shop_id=m.shop_id AND b1.stat_date=m.stat_date AND b1.order_type=1
      LEFT JOIN metric_details md ON md.shop_id=m.shop_id AND md.platform=m.platform AND md.start_date=m.stat_date AND md.end_date=m.stat_date
      WHERE m.shop_name IN (${marks}) AND m.stat_date BETWEEN ? AND ? AND m.is_mock=0 ORDER BY m.stat_date, m.shop_name, m.platform`).all(...group.shops,start,end)
    for (const row of rows) {
      let consultation=[]
      try { const component=JSON.parse(row.overview_json || '{}').data?.find(c=>c?.componentId==='imSummaryPC');if(Array.isArray(component?.body))consultation=component.body } catch(_) {}
      row.ask_user_cnt=consultation.find(it=>it?.variable==='ask_user_cnt')?.value ?? null
      row.avg_reply_duration=consultation.find(it=>it?.variable==='avg_reply_duration')?.value ?? null
      delete row.overview_json
    }
    const selected = rows.filter(r=>r.stat_date>=current.start && r.stat_date<=current.end)
    const memberIds = [...new Set(db.prepare(`SELECT DISTINCT shop_id FROM daily_metrics WHERE shop_name IN (${marks}) AND shop_id IS NOT NULL AND shop_id <> ''`).all(...group.shops).map(r=>r.shop_id))]
    const ids = memberIds.length ? memberIds.map(()=>'?').join(',') : "''"
    function shopMetrics(period) {
    const extras = {}
    for (const [table, keys] of [['shop_promo_metrics',['pay_orders','pay_amount','verify_amount','scan_users','scan_favorites','scan_reviews']],['shop_call_totals',['total']]]) {
      const data = db.prepare(`SELECT * FROM ${table} WHERE shop_id IN (${ids}) AND stat_date BETWEEN ? AND ?`).all(...memberIds,period.start,period.end)
      extras[table] = { synced_records:data.length, ...Object.fromEntries(keys.map(key=>[key,data.some(r=>r[key]!=null)?data.reduce((sum,r)=>sum+(r[key]||0),0):null])) }
    }
    const booking = db.prepare(`SELECT order_type, SUM(total) total, COUNT(*) synced_records FROM shop_booking_totals WHERE shop_id IN (${ids}) AND stat_date BETWEEN ? AND ? GROUP BY order_type`).all(...memberIds,period.start,period.end)
    extras.bookings = booking
    return extras
    }
    const extras=shopMetrics(current)
    const previousPeriod=bins.at(-2)
    const days = Math.round((date(current.end)-date(current.start))/86400000)+1
    const observed=new Set(selected.map(r=>JSON.stringify([r.shop_name,r.stat_date])))
    const now = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
    return { shop:{name:group.shops[0]}, group, mode, anchor, period:current,
      coverage:{ expected_shop_days:group.shops.length*days, observed_shop_days:observed.size,
        observed_platform_records:selected.length, partial_period:current.end>=now,
        note:'缺失日期不补零；人数按门店和平台累加，未跨店去重；预订为按下单日期筛选的当前状态快照。' },
      summary:summarize(selected),
      comparison:{...comparePeriods(rows.filter(r=>r.stat_date>=bins.at(-2).start&&r.stat_date<=bins.at(-2).end),selected,bins.at(-2),current),shop_name:group.shops[0],mode},
      platforms:['美团','点评'].map(platform=>({ platform,...summarize(selected.filter(r=>r.platform===platform)) })),
      trend:bins.map(bin=>({...bin,...summarize(rows.filter(r=>r.stat_date>=bin.start&&r.stat_date<=bin.end))})),
      stores:group.shops.map(shop=>({shop_name:shop,...summarize(selected.filter(r=>r.shop_name===shop)), observed_days:new Set(selected.filter(r=>r.shop_name===shop).map(r=>r.stat_date)).size})),
      shop_metrics:extras, details:selected, previous_details:rows.filter(r=>r.stat_date>=previousPeriod.start&&r.stat_date<=previousPeriod.end), previous_shop_metrics:shopMetrics(previousPeriod) }
  }
  const history = value => {
    const columns='id,group_id,group_name,mode,anchor,start_date,end_date,model,status,error,retry_of,created_at,finished_at,updated_at'
    if(typeof value==='number')return db.prepare(`SELECT ${columns} FROM analysis_runs WHERE group_id=? ORDER BY id DESC LIMIT 100`).all(value)
    const name=String(value||'').trim()
    // Include legacy snapshots only when they contain exactly this one store.
    return db.prepare(`SELECT ${columns} FROM analysis_runs WHERE
      group_id=COALESCE((SELECT -id FROM analysis_shop_scopes WHERE shop_name=?),0)
      OR (json_array_length(snapshot_json,'$.group.shops')=1 AND json_extract(snapshot_json,'$.group.shops[0]')=?)
      ORDER BY id DESC LIMIT 100`).all(name,name)
  }
  function runRecord(id) {const r=db.prepare('SELECT * FROM analysis_runs WHERE id=?').get(id);if(!r)throw Error('分析记录不存在');const snapshot=JSON.parse(r.snapshot_json);delete r.snapshot_json;return {...r,snapshot}}
  function updateResult({id,result}) {
    if(!Number.isSafeInteger(id)||id<=0)throw Error('无效的分析记录')
    if(typeof result!=='string'||!result.trim()||result.length>200000)throw Error('分析内容需为 1～200000 字')
    const record=runRecord(id)
    if(record.status!=='success')throw Error('仅可编辑已完成的分析结果')
    db.prepare("UPDATE analysis_runs SET result=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='success'").run(result.trim(),id)
    return runRecord(id)
  }
  const pending=new Set()
  async function run(args) {
    const previous=args.retryId?runRecord(args.retryId):null
    const snapshot=previous?previous.snapshot:report(args)
    const prompt=String(args.prompt ?? previous?.prompt ?? DEFAULT_PROMPT).trim()
    if (!prompt || prompt.length>20000) throw Error('提示词需为 1～20000 字')
    const cfg=config()
    if(!cfg.url||!cfg.model||!cfg.hasKey)throw Error('请先在配置页保存 AI 接口地址、模型和 Key')
    if(!snapshot.summary.count)throw Error('当前统计周期没有已同步数据，请先同步后再分析')
    const lock=snapshot.group.id
    if(pending.has(lock))throw Error('该门店正在分析，请等待完成')
    let key
    try {key=safeStorage.decryptString(Buffer.from(getSetting('analysis_key_encrypted'),'base64'))}catch(_){throw Error('无法解密 API Key，请在此设备重新配置')}
    pending.add(lock)
    let id
    try {
      id=Number(db.prepare(`INSERT INTO analysis_runs(group_id,group_name,mode,anchor,start_date,end_date,prompt,snapshot_json,model,status,retry_of)
        VALUES(?,?,?,?,?,?,?,?,?,'running',?)`).run(lock,snapshot.group.name,snapshot.mode,snapshot.anchor,snapshot.period.start,snapshot.period.end,prompt,JSON.stringify(snapshot),cfg.model,previous?.id||null).lastInsertRowid)
      try {
        const result=await requestAnalysis({url:cfg.url,key,model:cfg.model,reasoningEffort:cfg.reasoningEffort,prompt,snapshot})
        db.prepare("UPDATE analysis_runs SET status='success', result=?, finished_at=CURRENT_TIMESTAMP WHERE id=?").run(result,id)
      } catch(error) {
        const message=error.name==='TimeoutError'?'AI 请求超过 90 秒，请稍后重试':error instanceof SyntaxError?'AI 接口返回格式不正确':error.message
        db.prepare("UPDATE analysis_runs SET status='failed', error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?").run(message,id)
      }
      return runRecord(id)
    } finally {pending.delete(lock)}
  }
  return { groups, saveGroup, deleteGroup:id=>db.prepare('DELETE FROM analysis_groups WHERE id=?').run(id), config, saveConfig, report, comparison, history, runRecord, updateResult, run, defaultPrompt:DEFAULT_PROMPT }
}
module.exports={createAnalysisService}
