const Database = require('better-sqlite3')
const path = require('path') // db path definition
const { app } = require('electron')

// 数据库存放在用户数据目录
const dbPath = path.join(app.getPath('userData'), 'app-data.db')
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
      use_count INTEGER DEFAULT 0,
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

  migrateTemplatesShopId()
  purgeTemplatesWithoutShop()
  
  // 临时设置 wecom_webhook 地址
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value)
    VALUES ('wecom_webhook', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=f5dbd97e-eb01-406a-932e-b914b0f2f78a')
  `).run()
}

function migrateTemplatesShopId() {
  const cols = db.prepare('PRAGMA table_info(templates)').all()
  if (!cols.some(c => c.name === 'shop_id')) {
    db.exec('ALTER TABLE templates ADD COLUMN shop_id INTEGER REFERENCES shops(id)')
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

module.exports = {
  initDatabase,
  shopService,
  templateService,
  settingService,
  db
}
