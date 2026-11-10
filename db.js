const Database = require('better-sqlite3')
const { reserveReplyTemplates } = require('./reply-template-rotation')
const path = require('path') // db path definition
const fs = require('fs')
const electron = require('electron')
const app = electron.app || (electron.remote && electron.remote.app)

// 数据库存放在用户数据目录
const userDataPath = app && typeof app.getPath === 'function' ? app.getPath('userData') : path.join(__dirname, 'userData')
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true })
}
const dbPath = path.join(userDataPath, 'app-data.db')
const db = new Database(dbPath)

// 初始化表结构
function initDatabase() {
  // 门店表
  db.exec(`
    CREATE TABLE IF NOT EXISTS shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      platform TEXT DEFAULT 'dianping',
      url TEXT,
      account TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 评论记录表（后续使用）
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER,
      review_id TEXT UNIQUE,
      rating INTEGER,
      content TEXT,
      reviewer TEXT,
      review_time TEXT,
      replied INTEGER DEFAULT 0,
      reply_content TEXT,
      reply_time TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shop_id) REFERENCES shops(id)
    )
  `)

  // 回复模板表（按门店归属，shop_id 见迁移）
  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 设置表（用于存储企微webhook等全局配置）
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `)

  // 经营数据指标表（每日按门店和平台保存）
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id TEXT,
      shop_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      stat_date TEXT NOT NULL,
      exposure INTEGER DEFAULT 0,
      visits INTEGER DEFAULT 0,
      orders INTEGER DEFAULT 0,
      order_amount REAL DEFAULT 0,
      order_coupons INTEGER DEFAULT 0,
      verify_uv INTEGER DEFAULT 0,
      verify_amount REAL DEFAULT 0,
      verify_coupons INTEGER DEFAULT 0,
      star REAL DEFAULT 0,
      new_reviews INTEGER DEFAULT 0,
      new_good_reviews INTEGER DEFAULT NULL,
      new_bad_reviews INTEGER DEFAULT 0,
      bad_reply_rate REAL DEFAULT 0,
      is_mock INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(shop_name, platform, stat_date)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(stat_date);
    CREATE INDEX IF NOT EXISTS idx_daily_metrics_shop ON daily_metrics(shop_name);
  `)

  db.exec(`CREATE TABLE IF NOT EXISTS shop_booking_totals (
    shop_id TEXT NOT NULL, stat_date TEXT NOT NULL, order_type INTEGER NOT NULL,
    total INTEGER NOT NULL CHECK(total >= 0), updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(shop_id, stat_date, order_type)
  )`)

  db.exec(`CREATE TABLE IF NOT EXISTS shop_refund_metrics (
    shop_id TEXT NOT NULL, platform TEXT NOT NULL, stat_date TEXT NOT NULL,
    refund_coupons INTEGER, refund_amount REAL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(shop_id, platform, stat_date)
  )`)

  db.exec(`CREATE TABLE IF NOT EXISTS shop_promo_metrics (
    shop_id TEXT NOT NULL, shop_name TEXT NOT NULL, stat_date TEXT NOT NULL,
    pay_orders REAL, pay_amount REAL, verify_amount REAL,
    scan_users REAL, scan_favorites REAL, scan_reviews REAL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(shop_id, stat_date)
  )`)

  // 话单仅保存门店每日总数，不持久化电话号码或通话明细。
  db.exec(`CREATE TABLE IF NOT EXISTS shop_call_totals (
    shop_id TEXT NOT NULL,
    shop_name TEXT NOT NULL,
    stat_date TEXT NOT NULL,
    total INTEGER NOT NULL CHECK(total >= 0),
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(shop_id, stat_date)
  )`)

  // 完整经营接口快照：按门店、平台、请求日期范围保存最新明细。
  db.exec(`
    CREATE TABLE IF NOT EXISTS metric_details (
      shop_id TEXT NOT NULL,
      shop_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      request_body TEXT NOT NULL,
      response_json TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(shop_id, platform, start_date, end_date)
    );
  `)

  if (!db.prepare('PRAGMA table_info(daily_metrics)').all().some(c => c.name === 'new_good_reviews')) {
    db.exec('ALTER TABLE daily_metrics ADD COLUMN new_good_reviews INTEGER DEFAULT NULL')
  }
  migrateTemplatesShopId()
  migrateRemoveTemplateUseCount()
  purgeTemplatesWithoutShop()

  // 仅首次初始化默认地址，保留用户保存的地址或主动清空的配置。
  db.prepare(`
    INSERT OR IGNORE INTO settings (key, value)
    VALUES ('wecom_webhook', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=f5dbd97e-eb01-406a-932e-b914b0f2f78a')
  `).run()
}

function migrateTemplatesShopId() {
  const cols = db.prepare('PRAGMA table_info(templates)').all()
  if (!cols.some(c => c.name === 'shop_id')) {
    db.exec('ALTER TABLE templates ADD COLUMN shop_id INTEGER REFERENCES shops(id)')
  }
}

// 旧数据库只删除已停用的计数字段，保留模板及其门店归属。
function migrateRemoveTemplateUseCount() {
  const cols = db.prepare('PRAGMA table_info(templates)').all()
  if (cols.some(c => c.name === 'use_count')) {
    db.exec('ALTER TABLE templates DROP COLUMN use_count')
  }
}

/** 删除迁移前遗留的、未归属任何门店的模板 */
function purgeTemplatesWithoutShop() {
  const cols = db.prepare('PRAGMA table_info(templates)').all()
  if (!cols.some(c => c.name === 'shop_id')) return
  db.prepare('DELETE FROM templates WHERE shop_id IS NULL').run()
}

// 门店 CRUD 操作
const shopService = {
  // 获取所有门店
  getAll() {
    return db.prepare('SELECT * FROM shops ORDER BY created_at DESC').all()
  },

  // 获取单个门店
  getById(id) {
    return db.prepare('SELECT * FROM shops WHERE id = ?').get(id)
  },

  // 添加门店
  create(shop) {
    const stmt = db.prepare(`
      INSERT INTO shops (name, platform, url, account, notes)
      VALUES (?, ?, ?, ?, ?)
    `)
    const result = stmt.run(shop.name, shop.platform || 'dianping', shop.url || '', shop.account || '', shop.notes || '')
    return { id: result.lastInsertRowid, ...shop }
  },

  // 更新门店
  update(id, shop) {
    const stmt = db.prepare(`
      UPDATE shops
      SET name = ?, platform = ?, url = ?, account = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(shop.name, shop.platform || 'dianping', shop.url || '', shop.account || '', shop.notes || '', id)
    return { id, ...shop }
  },

  // 删除门店（同时删除该门店下的好评模板）
  delete(id) {
    db.prepare('DELETE FROM templates WHERE shop_id = ?').run(id)
    db.prepare('DELETE FROM shops WHERE id = ?').run(id)
    return true
  }
}

// 好评模板 CRUD（按门店）
const templateService = {
  reserveReplies(shopId, count) {
    return db.transaction(() => {
      const templates = db.prepare('SELECT * FROM templates WHERE shop_id = ? ORDER BY id').all(shopId)
      const key = `good_reply_last_content:${shopId}`
      const { contents, lastContent } = reserveReplyTemplates(templates, count, settingService.get(key))
      if (contents.length) settingService.set(key, lastContent)
      return contents
    })()
  },
  getByShopId(shopId) {
    return db
      .prepare('SELECT * FROM templates WHERE shop_id = ? ORDER BY created_at DESC')
      .all(shopId)
  },

  /** 所有已归属门店的好评模板（自动化随机选用） */
  getAllWithShop() {
    return db
      .prepare('SELECT * FROM templates WHERE shop_id IS NOT NULL ORDER BY created_at DESC')
      .all()
  },

  getById(id) {
    return db.prepare('SELECT * FROM templates WHERE id = ?').get(id)
  },

  createForShop(shopId, content) {
    const stmt = db.prepare('INSERT INTO templates (content, shop_id) VALUES (?, ?)')
    const result = stmt.run(content, shopId)
    return { id: result.lastInsertRowid, content, shop_id: shopId }
  },

  update(id, content) {
    db.prepare('UPDATE templates SET content = ? WHERE id = ?').run(content, id)
    return { id, content }
  },

  delete(id) {
    db.prepare('DELETE FROM templates WHERE id = ?').run(id)
    return true
  }
}

// 全局设置
const settingService = {
  get(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
    return row ? row.value : null
  },
  set(key, value) {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }
}

// 辅助计算函数
function calculateRates(row) {
  const exposure = row.total_exposure ?? row.exposure ?? 0
  const visits = row.total_visits ?? row.visits ?? 0
  const orders = row.total_orders ?? row.orders ?? 0
  const orderAmount = row.total_order_amount ?? row.order_amount ?? 0
  const verifyAmount = row.total_verify_amount ?? row.verify_amount ?? 0

  return {
    visit_rate: exposure > 0 ? Number(((visits / exposure) * 100).toFixed(2)) : 0, // 进店率 %
    order_rate: visits > 0 ? Number(((orders / visits) * 100).toFixed(2)) : 0,     // 下单转化率 %
    verify_rate: orderAmount > 0 ? Number(((verifyAmount / orderAmount) * 100).toFixed(2)) : 0, // 核销率 %
    aov: orders > 0 ? Number((orderAmount / orders).toFixed(2)) : 0 // 客单价
  }
}

function calculateDeltas(current, prev) {
  if (!prev) return null
  const calcPercent = (currVal, prevVal) => {
    if (!prevVal || prevVal === 0) {
      return currVal > 0 ? 100 : 0
    }
    return Number((((currVal - prevVal) / prevVal) * 100).toFixed(1))
  }

  return {
    order_amount_growth: calcPercent(current.total_order_amount, prev.total_order_amount),
    verify_amount_growth: calcPercent(current.total_verify_amount, prev.total_verify_amount),
    exposure_growth: calcPercent(current.total_exposure, prev.total_exposure),
    visits_growth: calcPercent(current.total_visits, prev.total_visits),
    orders_growth: calcPercent(current.total_orders, prev.total_orders),
    reviews_growth: calcPercent(current.total_new_reviews, prev.total_new_reviews)
  }
}

function getPreviousDate(dateStr, offsetDays = 1) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() - offsetDays)
  return d.toISOString().split('T')[0]
}

function getPreviousMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  const prevY = d.getFullYear()
  const prevM = String(d.getMonth() + 1).padStart(2, '0')
  return `${prevY}-${prevM}`
}

// 咨询指标保留接口原值（响应时长可能带单位，缺失值保持 --）。
function consultationDetails(record) {
  const snapshot = db.prepare(`SELECT response_json FROM metric_details
    WHERE shop_id = ? AND platform = ? AND start_date = ? AND end_date = ?`)
    .get(String(record.shop_id), record.platform, record.stat_date, record.stat_date)
  let items = []
  if (snapshot) {
    try {
      const response = JSON.parse(snapshot.response_json)
      const component = response.data?.find(c => c?.componentId === 'imSummaryPC')
      if (Array.isArray(component?.body)) items = component.body
    } catch (_) { /* 老快照格式异常时显示缺失值 */ }
  }
  const value = variable => items.find(it => it?.variable === variable)?.value ?? '--'
  const promo = db.prepare(`SELECT pay_orders, pay_amount, verify_amount, scan_users, scan_favorites, scan_reviews
    FROM shop_promo_metrics WHERE shop_id = ? AND stat_date = ?`).get(String(record.shop_id), record.stat_date)
  const promoFields = {}
  for (const key of ['pay_orders', 'pay_amount', 'verify_amount', 'scan_users', 'scan_favorites', 'scan_reviews']) {
    promoFields['promo_' + key] = promo?.[key] ?? null
  }
  const call = db.prepare('SELECT total FROM shop_call_totals WHERE shop_id = ? AND stat_date = ?')
    .get(String(record.shop_id), record.stat_date)
  const refund = db.prepare('SELECT refund_coupons, refund_amount FROM shop_refund_metrics WHERE shop_id = ? AND platform = ? AND stat_date = ?')
    .get(String(record.shop_id), record.platform, record.stat_date)
  const booking = db.prepare('SELECT order_type, total FROM shop_booking_totals WHERE shop_id = ? AND stat_date = ?')
    .all(String(record.shop_id), record.stat_date)
  const bookingValues = Object.fromEntries(booking.map(row => [row.order_type, row.total]))
  return { booking_total: bookingValues[0] ?? null, booking_consumed: bookingValues[3] ?? null,
    booking_refunded: bookingValues[5] ?? null, booking_pending: bookingValues[1] ?? null,
    ...promoFields, refund_coupons: refund?.refund_coupons ?? null,
    refund_amount: refund?.refund_amount ?? null, call_total: call?.total ?? null,
    ask_user_cnt: value('ask_user_cnt'), avg_reply_duration: value('avg_reply_duration') }
}

// 门店经营指标服务
const metricService = {
  saveBookingTotal({ shopId, date, orderType, total }) {
    if (![0, 1, 3, 5].includes(orderType) || !Number.isSafeInteger(total) || total < 0) throw new Error('无效的预订统计')
    return db.prepare(`INSERT INTO shop_booking_totals (shop_id, stat_date, order_type, total)
      VALUES (?, ?, ?, ?) ON CONFLICT(shop_id, stat_date, order_type) DO UPDATE SET
      total = excluded.total, updated_at = CURRENT_TIMESTAMP`).run(String(shopId), date, orderType, total)
  },

  saveRefundMetrics({ shopId, platform, date, coupons, amount }) {
    return db.prepare(`INSERT INTO shop_refund_metrics (shop_id, platform, stat_date, refund_coupons, refund_amount)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(shop_id, platform, stat_date) DO UPDATE SET
      refund_coupons = excluded.refund_coupons, refund_amount = excluded.refund_amount,
      updated_at = CURRENT_TIMESTAMP`).run(String(shopId), platform, date, coupons, amount)
  },

  savePromoMetrics({ shopId, shopName, date, values }) {
    return db.prepare(`INSERT INTO shop_promo_metrics
      (shop_id, shop_name, stat_date, pay_orders, pay_amount, verify_amount, scan_users, scan_favorites, scan_reviews)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(shop_id, stat_date) DO UPDATE SET
      shop_name = excluded.shop_name, pay_orders = excluded.pay_orders, pay_amount = excluded.pay_amount,
      verify_amount = excluded.verify_amount, scan_users = excluded.scan_users,
      scan_favorites = excluded.scan_favorites, scan_reviews = excluded.scan_reviews, updated_at = CURRENT_TIMESTAMP`)
      .run(String(shopId), shopName, date, ...[1, 2, 3, 7, 8, 9].map(code => values[code] ?? null))
  },
  getPromoMetrics({ startDate, endDate, shopName }) {
    return db.prepare(`SELECT shop_id, shop_name, stat_date, pay_orders, pay_amount, verify_amount,
      scan_users, scan_favorites, scan_reviews FROM shop_promo_metrics
      WHERE stat_date BETWEEN ? AND ? AND (? IS NULL OR shop_name = ?)
      ORDER BY stat_date DESC, shop_name`).all(startDate, endDate,
        shopName && shopName !== 'all' ? shopName : null, shopName && shopName !== 'all' ? shopName : null)
  },

  saveCallTotal({ shopId, shopName, date, total }) {
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('无效的话单总数')
    return db.prepare(`INSERT INTO shop_call_totals (shop_id, shop_name, stat_date, total)
      VALUES (?, ?, ?, ?) ON CONFLICT(shop_id, stat_date) DO UPDATE SET
      shop_name = excluded.shop_name, total = excluded.total, updated_at = CURRENT_TIMESTAMP`)
      .run(String(shopId), shopName, date, total)
  },
  getCallTotals({ startDate, endDate, shopName }) {
    return db.prepare(`SELECT shop_id, shop_name, SUM(total) AS total, COUNT(*) AS synced_days
      FROM shop_call_totals WHERE stat_date BETWEEN ? AND ?
      AND (? IS NULL OR shop_name = ?) GROUP BY shop_id, shop_name ORDER BY total DESC`)
      .all(startDate, endDate, shopName && shopName !== 'all' ? shopName : null,
        shopName && shopName !== 'all' ? shopName : null)
  },

  saveDetails({ shopId, shopName, platform, date, requestBody, response, endpoint = '/mda/v5/overview' }) {
    return db.prepare(`
      INSERT INTO metric_details
        (shop_id, shop_name, platform, start_date, end_date, endpoint, request_body, response_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop_id, platform, start_date, end_date) DO UPDATE SET
        shop_name = excluded.shop_name,
        endpoint = excluded.endpoint,
        request_body = excluded.request_body,
        response_json = excluded.response_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(String(shopId), shopName, platform, date, date,
      endpoint, requestBody, JSON.stringify(response))
  },

  getDetails({ shopId, platform, startDate, endDate }) {
    return db.prepare(`SELECT * FROM metric_details
      WHERE shop_id = ? AND platform = ? AND start_date >= ? AND end_date <= ?
      ORDER BY start_date`).all(String(shopId), platform, startDate, endDate)
      .map(row => ({ ...row, response: JSON.parse(row.response_json) }))
  },

  // 按门店、日期和平台替换每日数据前，清除对应平台的旧记录。
  clearShopDatePlatform(shopName, statDate, platform) {
    return db.prepare('DELETE FROM daily_metrics WHERE shop_name = ? AND stat_date = ? AND platform = ?').run(shopName, statDate, platform)
  },

  // 单条写入/更新
  upsert(metric, { preserveMissing = false } = {}) {
    if (preserveMissing) {
      const existing = db.prepare('SELECT * FROM daily_metrics WHERE shop_name = ? AND platform = ? AND stat_date = ?')
        .get(metric.shop_name, metric.platform, metric.stat_date);
      metric = { ...(existing?.is_mock ? {} : existing), ...metric };
    }
    const numeric = value => preserveMissing && value == null ? null : Number(value) || 0;
    const stmt = db.prepare(`
      INSERT INTO daily_metrics (
        shop_id, shop_name, platform, stat_date,
        exposure, visits, orders, order_amount, order_coupons,
        verify_uv, verify_amount, verify_coupons,
        star, new_reviews, new_good_reviews, new_bad_reviews, bad_reply_rate,
        is_mock, updated_at
      ) VALUES (
        @shop_id, @shop_name, @platform, @stat_date,
        @exposure, @visits, @orders, @order_amount, @order_coupons,
        @verify_uv, @verify_amount, @verify_coupons,
        @star, @new_reviews, @new_good_reviews, @new_bad_reviews, @bad_reply_rate,
        @is_mock, CURRENT_TIMESTAMP
      )
      ON CONFLICT(shop_name, platform, stat_date) DO UPDATE SET
        shop_id = excluded.shop_id,
        exposure = excluded.exposure,
        visits = excluded.visits,
        orders = excluded.orders,
        order_amount = excluded.order_amount,
        order_coupons = excluded.order_coupons,
        verify_uv = excluded.verify_uv,
        verify_amount = excluded.verify_amount,
        verify_coupons = excluded.verify_coupons,
        star = excluded.star,
        new_reviews = excluded.new_reviews,
        new_good_reviews = excluded.new_good_reviews,
        new_bad_reviews = excluded.new_bad_reviews,
        bad_reply_rate = excluded.bad_reply_rate,
        is_mock = excluded.is_mock,
        updated_at = CURRENT_TIMESTAMP
    `)

    return stmt.run({
      shop_id: metric.shop_id ? String(metric.shop_id) : '',
      shop_name: metric.shop_name,
      platform: metric.platform,
      stat_date: metric.stat_date,
      exposure: numeric(metric.exposure),
      visits: numeric(metric.visits),
      orders: numeric(metric.orders),
      order_amount: numeric(metric.order_amount),
      order_coupons: numeric(metric.order_coupons),
      verify_uv: numeric(metric.verify_uv),
      verify_amount: numeric(metric.verify_amount),
      verify_coupons: numeric(metric.verify_coupons),
      star: numeric(metric.star),
      new_reviews: numeric(metric.new_reviews),
      new_good_reviews: metric.new_good_reviews == null ? null : numeric(metric.new_good_reviews),
      new_bad_reviews: numeric(metric.new_bad_reviews),
      bad_reply_rate: numeric(metric.bad_reply_rate),
      is_mock: metric.is_mock ? 1 : 0
    })
  },

  // 获取所有出现过的门店名称
  getDistinctShops() {
    const fromMetrics = db.prepare('SELECT DISTINCT shop_name FROM daily_metrics ORDER BY shop_name ASC').all().map(r => r.shop_name)
    const fromShops = shopService.getAll().map(s => s.name)
    const set = new Set([...fromShops, ...fromMetrics])
    return Array.from(set).filter(Boolean)
  },

  // 获取所有可用的日期列表（倒序）
  getAvailableDates() {
    return db.prepare('SELECT DISTINCT stat_date FROM daily_metrics ORDER BY stat_date DESC').all().map(r => r.stat_date)
  },

  // 日报数据查询
  getDailyData({ date, shopName = 'all', platform = 'all' }) {
    let where = 'WHERE stat_date = ?'
    const params = [date]

    if (shopName && shopName !== 'all') {
      where += ' AND shop_name = ?'
      params.push(shopName)
    }
    if (platform && platform !== 'all') {
      where += ' AND platform = ?'
      params.push(platform)
    }

    const records = db.prepare(`SELECT * FROM daily_metrics ${where} ORDER BY order_amount DESC, exposure DESC`).all(...params)

    const summaryStmt = `
      SELECT
        COUNT(*) as record_count,
        COALESCE(SUM(exposure), 0) as total_exposure,
        COALESCE(SUM(visits), 0) as total_visits,
        COALESCE(SUM(orders), 0) as total_orders,
        COALESCE(SUM(order_amount), 0) as total_order_amount,
        COALESCE(SUM(order_coupons), 0) as total_order_coupons,
        COALESCE(SUM(verify_uv), 0) as total_verify_uv,
        COALESCE(SUM(verify_amount), 0) as total_verify_amount,
        COALESCE(SUM(verify_coupons), 0) as total_verify_coupons,
        COALESCE(AVG(CASE WHEN star > 0 THEN star ELSE NULL END), 0) as avg_star,
        COALESCE(SUM(new_reviews), 0) as total_new_reviews,
        COALESCE(SUM(new_bad_reviews), 0) as total_new_bad_reviews,
        COALESCE(AVG(CASE WHEN bad_reply_rate IS NOT NULL THEN bad_reply_rate ELSE NULL END), 0) as avg_bad_reply_rate
      FROM daily_metrics
      ${where}
    `
    const summary = db.prepare(summaryStmt).get(...params)
    summary.rates = calculateRates(summary)

    // 前一日环比
    const prevDate = getPreviousDate(date, 1)
    const prevParams = [prevDate]
    let prevWhere = 'WHERE stat_date = ?'
    if (shopName && shopName !== 'all') {
      prevWhere += ' AND shop_name = ?'
      prevParams.push(shopName)
    }
    if (platform && platform !== 'all') {
      prevWhere += ' AND platform = ?'
      prevParams.push(platform)
    }
    const prevSummary = db.prepare(`
      SELECT
        COALESCE(SUM(exposure), 0) as total_exposure,
        COALESCE(SUM(visits), 0) as total_visits,
        COALESCE(SUM(orders), 0) as total_orders,
        COALESCE(SUM(order_amount), 0) as total_order_amount,
        COALESCE(SUM(verify_amount), 0) as total_verify_amount,
        COALESCE(SUM(new_reviews), 0) as total_new_reviews
      FROM daily_metrics
      ${prevWhere}
    `).get(...prevParams)

    const deltas = calculateDeltas(summary, prevSummary)

    // 平台分布对比
    const platformBreakdown = db.prepare(`
      SELECT platform,
             COALESCE(SUM(order_amount), 0) as order_amount,
             COALESCE(SUM(orders), 0) as orders,
             COALESCE(SUM(visits), 0) as visits,
             COALESCE(SUM(exposure), 0) as exposure,
             COALESCE(SUM(verify_amount), 0) as verify_amount
      FROM daily_metrics
      ${where}
      GROUP BY platform
    `).all(...params)

    return {
      date,
      records: records.map(r => ({ ...r, ...consultationDetails(r), rates: calculateRates(r) })),
      summary,
      deltas,
      platformBreakdown
    }
  },

  // 周报数据查询
  getWeeklyData({ startDate, endDate, shopName = 'all', platform = 'all' }) {
    let where = 'WHERE stat_date BETWEEN ? AND ?'
    const params = [startDate, endDate]

    if (shopName && shopName !== 'all') {
      where += ' AND shop_name = ?'
      params.push(shopName)
    }
    if (platform && platform !== 'all') {
      where += ' AND platform = ?'
      params.push(platform)
    }

    const records = db.prepare(`SELECT * FROM daily_metrics ${where} ORDER BY stat_date DESC, order_amount DESC`).all(...params)

    const summary = db.prepare(`
      SELECT
        COUNT(DISTINCT stat_date) as active_days,
        COALESCE(SUM(exposure), 0) as total_exposure,
        COALESCE(SUM(visits), 0) as total_visits,
        COALESCE(SUM(orders), 0) as total_orders,
        COALESCE(SUM(order_amount), 0) as total_order_amount,
        COALESCE(SUM(order_coupons), 0) as total_order_coupons,
        COALESCE(SUM(verify_uv), 0) as total_verify_uv,
        COALESCE(SUM(verify_amount), 0) as total_verify_amount,
        COALESCE(SUM(verify_coupons), 0) as total_verify_coupons,
        COALESCE(AVG(CASE WHEN star > 0 THEN star ELSE NULL END), 0) as avg_star,
        COALESCE(SUM(new_reviews), 0) as total_new_reviews,
        COALESCE(SUM(new_bad_reviews), 0) as total_new_bad_reviews,
        COALESCE(AVG(CASE WHEN bad_reply_rate IS NOT NULL THEN bad_reply_rate ELSE NULL END), 0) as avg_bad_reply_rate
      FROM daily_metrics
      ${where}
    `).get(...params)
    summary.rates = calculateRates(summary)

    // 每日经营走势（周一至周日）
    const dailyTrend = db.prepare(`
      SELECT
        stat_date as date,
        COALESCE(SUM(exposure), 0) as exposure,
        COALESCE(SUM(visits), 0) as visits,
        COALESCE(SUM(orders), 0) as orders,
        COALESCE(SUM(order_amount), 0) as order_amount,
        COALESCE(SUM(verify_amount), 0) as verify_amount,
        COALESCE(SUM(new_reviews), 0) as new_reviews
      FROM daily_metrics
      ${where}
      GROUP BY stat_date
      ORDER BY stat_date ASC
    `).all(...params)

    // 各门店排行
    const shopRanking = db.prepare(`
      SELECT
        shop_name,
        COALESCE(SUM(order_amount), 0) as total_order_amount,
        COALESCE(SUM(verify_amount), 0) as total_verify_amount,
        COALESCE(SUM(orders), 0) as total_orders,
        COALESCE(SUM(visits), 0) as total_visits,
        COALESCE(SUM(exposure), 0) as total_exposure,
        COALESCE(AVG(CASE WHEN star > 0 THEN star ELSE NULL END), 0) as avg_star,
        COALESCE(SUM(new_reviews), 0) as total_new_reviews,
        COALESCE(SUM(new_bad_reviews), 0) as total_new_bad_reviews
      FROM daily_metrics
      ${where}
      GROUP BY shop_name
      ORDER BY total_order_amount DESC
    `).all(...params)

    // 平台占比
    const platformBreakdown = db.prepare(`
      SELECT platform,
             COALESCE(SUM(order_amount), 0) as order_amount,
             COALESCE(SUM(orders), 0) as orders,
             COALESCE(SUM(visits), 0) as visits,
             COALESCE(SUM(exposure), 0) as exposure,
             COALESCE(SUM(verify_amount), 0) as verify_amount
      FROM daily_metrics
      ${where}
      GROUP BY platform
    `).all(...params)

    // 上周环比
    const daysDiff = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1)
    const prevStartDate = getPreviousDate(startDate, daysDiff)
    const prevEndDate = getPreviousDate(endDate, daysDiff)
    const prevParams = [prevStartDate, prevEndDate]
    let prevWhere = 'WHERE stat_date BETWEEN ? AND ?'
    if (shopName && shopName !== 'all') {
      prevWhere += ' AND shop_name = ?'
      prevParams.push(shopName)
    }
    if (platform && platform !== 'all') {
      prevWhere += ' AND platform = ?'
      prevParams.push(platform)
    }
    const prevSummary = db.prepare(`
      SELECT
        COALESCE(SUM(exposure), 0) as total_exposure,
        COALESCE(SUM(visits), 0) as total_visits,
        COALESCE(SUM(orders), 0) as total_orders,
        COALESCE(SUM(order_amount), 0) as total_order_amount,
        COALESCE(SUM(verify_amount), 0) as total_verify_amount,
        COALESCE(SUM(new_reviews), 0) as total_new_reviews
      FROM daily_metrics
      ${prevWhere}
    `).get(...prevParams)

    const deltas = calculateDeltas(summary, prevSummary)

    return {
      startDate,
      endDate,
      records: records.map(r => ({ ...r, ...consultationDetails(r), rates: calculateRates(r) })),
      summary,
      deltas,
      dailyTrend,
      shopRanking: shopRanking.map(r => ({ ...r, ...consultationDetails(r), rates: calculateRates(r) })),
      platformBreakdown
    }
  },

  // 月报数据查询
  getMonthlyData({ yearMonth, shopName = 'all', platform = 'all' }) {
    const startDate = `${yearMonth}-01`
    const [y, m] = yearMonth.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    const endDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`

    let where = 'WHERE stat_date BETWEEN ? AND ?'
    const params = [startDate, endDate]

    if (shopName && shopName !== 'all') {
      where += ' AND shop_name = ?'
      params.push(shopName)
    }
    if (platform && platform !== 'all') {
      where += ' AND platform = ?'
      params.push(platform)
    }

    const records = db.prepare(`SELECT * FROM daily_metrics ${where} ORDER BY stat_date DESC, order_amount DESC`).all(...params)

    const summary = db.prepare(`
      SELECT
        COUNT(DISTINCT stat_date) as active_days,
        COALESCE(SUM(exposure), 0) as total_exposure,
        COALESCE(SUM(visits), 0) as total_visits,
        COALESCE(SUM(orders), 0) as total_orders,
        COALESCE(SUM(order_amount), 0) as total_order_amount,
        COALESCE(SUM(order_coupons), 0) as total_order_coupons,
        COALESCE(SUM(verify_uv), 0) as total_verify_uv,
        COALESCE(SUM(verify_amount), 0) as total_verify_amount,
        COALESCE(SUM(verify_coupons), 0) as total_verify_coupons,
        COALESCE(AVG(CASE WHEN star > 0 THEN star ELSE NULL END), 0) as avg_star,
        COALESCE(SUM(new_reviews), 0) as total_new_reviews,
        COALESCE(SUM(new_bad_reviews), 0) as total_new_bad_reviews,
        COALESCE(AVG(CASE WHEN bad_reply_rate IS NOT NULL THEN bad_reply_rate ELSE NULL END), 0) as avg_bad_reply_rate
      FROM daily_metrics
      ${where}
    `).get(...params)
    summary.rates = calculateRates(summary)

    // 月度每日趋势
    const dailyTrend = db.prepare(`
      SELECT
        stat_date as date,
        COALESCE(SUM(exposure), 0) as exposure,
        COALESCE(SUM(visits), 0) as visits,
        COALESCE(SUM(orders), 0) as orders,
        COALESCE(SUM(order_amount), 0) as order_amount,
        COALESCE(SUM(verify_amount), 0) as verify_amount,
        COALESCE(SUM(new_reviews), 0) as new_reviews
      FROM daily_metrics
      ${where}
      GROUP BY stat_date
      ORDER BY stat_date ASC
    `).all(...params)

    // 门店月度排行
    const shopRanking = db.prepare(`
      SELECT
        shop_name,
        COALESCE(SUM(order_amount), 0) as total_order_amount,
        COALESCE(SUM(verify_amount), 0) as total_verify_amount,
        COALESCE(SUM(orders), 0) as total_orders,
        COALESCE(SUM(visits), 0) as total_visits,
        COALESCE(SUM(exposure), 0) as total_exposure,
        COALESCE(AVG(CASE WHEN star > 0 THEN star ELSE NULL END), 0) as avg_star,
        COALESCE(SUM(new_reviews), 0) as total_new_reviews,
        COALESCE(SUM(new_bad_reviews), 0) as total_new_bad_reviews
      FROM daily_metrics
      ${where}
      GROUP BY shop_name
      ORDER BY total_order_amount DESC
    `).all(...params)

    // 平台占比
    const platformBreakdown = db.prepare(`
      SELECT platform,
             COALESCE(SUM(order_amount), 0) as order_amount,
             COALESCE(SUM(orders), 0) as orders,
             COALESCE(SUM(visits), 0) as visits,
             COALESCE(SUM(exposure), 0) as exposure,
             COALESCE(SUM(verify_amount), 0) as verify_amount
      FROM daily_metrics
      ${where}
      GROUP BY platform
    `).all(...params)

    // 上月环比
    const prevYearMonth = getPreviousMonth(yearMonth)
    const [py, pm] = prevYearMonth.split('-').map(Number)
    const prevLastDay = new Date(py, pm, 0).getDate()
    const prevStartDate = `${prevYearMonth}-01`
    const prevEndDate = `${prevYearMonth}-${String(prevLastDay).padStart(2, '0')}`
    const prevParams = [prevStartDate, prevEndDate]
    let prevWhere = 'WHERE stat_date BETWEEN ? AND ?'
    if (shopName && shopName !== 'all') {
      prevWhere += ' AND shop_name = ?'
      prevParams.push(shopName)
    }
    if (platform && platform !== 'all') {
      prevWhere += ' AND platform = ?'
      prevParams.push(platform)
    }
    const prevSummary = db.prepare(`
      SELECT
        COALESCE(SUM(exposure), 0) as total_exposure,
        COALESCE(SUM(visits), 0) as total_visits,
        COALESCE(SUM(orders), 0) as total_orders,
        COALESCE(SUM(order_amount), 0) as total_order_amount,
        COALESCE(SUM(verify_amount), 0) as total_verify_amount,
        COALESCE(SUM(new_reviews), 0) as total_new_reviews
      FROM daily_metrics
      ${prevWhere}
    `).get(...prevParams)

    const deltas = calculateDeltas(summary, prevSummary)

    return {
      yearMonth,
      startDate,
      endDate,
      records: records.map(r => ({ ...r, ...consultationDetails(r), rates: calculateRates(r) })),
      summary,
      deltas,
      dailyTrend,
      shopRanking: shopRanking.map(r => ({ ...r, ...consultationDetails(r), rates: calculateRates(r) })),
      platformBreakdown
    }
  },

  // 趋势多维分析
  getTrendData({ startDate, endDate, shopName = 'all', platform = 'all' }) {
    let where = 'WHERE stat_date BETWEEN ? AND ?'
    const params = [startDate, endDate]
    if (shopName && shopName !== 'all') {
      where += ' AND shop_name = ?'
      params.push(shopName)
    }
    if (platform && platform !== 'all') {
      where += ' AND platform = ?'
      params.push(platform)
    }
    return db.prepare(`
      SELECT
        stat_date as date,
        COALESCE(SUM(exposure), 0) as exposure,
        COALESCE(SUM(visits), 0) as visits,
        COALESCE(SUM(orders), 0) as orders,
        COALESCE(SUM(order_amount), 0) as order_amount,
        COALESCE(SUM(order_coupons), 0) as order_coupons,
        COALESCE(SUM(verify_uv), 0) as verify_uv,
        COALESCE(SUM(verify_amount), 0) as verify_amount,
        COALESCE(SUM(verify_coupons), 0) as verify_coupons,
        COALESCE(AVG(CASE WHEN star > 0 THEN star ELSE NULL END), 0) as star,
        COALESCE(SUM(new_reviews), 0) as new_reviews,
        COALESCE(SUM(new_bad_reviews), 0) as new_bad_reviews
      FROM daily_metrics
      ${where}
      GROUP BY stat_date
      ORDER BY stat_date ASC
    `).all(...params)
  },

  // 生成演示数据（方便无历史数据时立即体验看板）
  generateMockData(days = 14) {
    const existingShops = shopService.getAll()
    const shopNames = existingShops.length > 0
      ? existingShops.map(s => s.name)
      : ['潮牛火锅（万达旗舰店）', '潮牛火锅（大悦城店）']

    const today = new Date()
    const insertStmt = db.prepare(`
      INSERT INTO daily_metrics (
        shop_id, shop_name, platform, stat_date,
        exposure, visits, orders, order_amount, order_coupons,
        verify_uv, verify_amount, verify_coupons,
        star, new_reviews, new_bad_reviews, bad_reply_rate,
        is_mock, updated_at
      ) VALUES (
        @shop_id, @shop_name, @platform, @stat_date,
        @exposure, @visits, @orders, @order_amount, @order_coupons,
        @verify_uv, @verify_amount, @verify_coupons,
        @star, @new_reviews, @new_bad_reviews, @bad_reply_rate,
        1, CURRENT_TIMESTAMP
      )
      ON CONFLICT(shop_name, platform, stat_date) DO UPDATE SET
        exposure = excluded.exposure,
        visits = excluded.visits,
        orders = excluded.orders,
        order_amount = excluded.order_amount,
        order_coupons = excluded.order_coupons,
        verify_uv = excluded.verify_uv,
        verify_amount = excluded.verify_amount,
        verify_coupons = excluded.verify_coupons,
        star = excluded.star,
        new_reviews = excluded.new_reviews,
        new_bad_reviews = excluded.new_bad_reviews,
        bad_reply_rate = excluded.bad_reply_rate,
        is_mock = 1,
        updated_at = CURRENT_TIMESTAMP
    `)

    const runTx = db.transaction(() => {
      for (let i = 1; i <= days; i++) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        const dateStr = d.toISOString().split('T')[0]

        for (const shopName of shopNames) {
          for (const platform of ['美团', '点评']) {
            const baseExposure = Math.floor(1200 + Math.random() * 1500)
            const baseVisits = Math.floor(baseExposure * (0.12 + Math.random() * 0.08))
            const baseOrders = Math.floor(baseVisits * (0.1 + Math.random() * 0.08))
            const baseAmount = Number((baseOrders * (75 + Math.random() * 50)).toFixed(2))
            const verifyCoupons = Math.floor(baseOrders * (0.8 + Math.random() * 0.18))
            const verifyAmount = Number((baseAmount * (0.8 + Math.random() * 0.18)).toFixed(2))
            const newReviews = Math.floor(Math.random() * 5)
            const newBadReviews = Math.random() < 0.15 ? 1 : 0

            insertStmt.run({
              shop_id: 'mock',
              shop_name: shopName,
              platform: platform,
              stat_date: dateStr,
              exposure: baseExposure,
              visits: baseVisits,
              orders: baseOrders,
              order_amount: baseAmount,
              order_coupons: Math.floor(baseOrders * 1.15),
              verify_uv: Math.floor(verifyCoupons * 0.95),
              verify_amount: verifyAmount,
              verify_coupons: verifyCoupons,
              star: Number((4.6 + Math.random() * 0.3).toFixed(1)),
              new_reviews: newReviews,
              new_bad_reviews: newBadReviews,
              bad_reply_rate: newBadReviews > 0 ? (Math.random() > 0.2 ? 1.0 : 0) : 1.0
            })
          }
        }
      }
    })

    runTx()
    return { success: true, count: days * shopNames.length * 2 }
  },

  // 清空演示数据
  clearMockData() {
    const res = db.prepare('DELETE FROM daily_metrics WHERE is_mock = 1').run()
    return { success: true, deleted: res.changes }
  },

  // 删除单条记录
  deleteRecord(id) {
    db.prepare('DELETE FROM daily_metrics WHERE id = ?').run(id)
    return true
  }
}

module.exports = {
  initDatabase,
  shopService,
  templateService,
  settingService,
  metricService,
  db
}
