const { app, BrowserWindow, BrowserView, ipcMain, session, Notification } = require('electron')
const path = require('path')
const { initDatabase, shopService, templateService, settingService } = require('./db')
const { AutoHelper } = require('./auto-helper')
const { readReviewFilterDebug } = require('./iframe-bridge')

let mainWindow = null
let settingsWindow = null
let tabCounter = 0
const tabs = new Map() // tabId -> { view, partition }
/** 弹窗显示时曾从窗口摘下 BrowserView，关闭时需挂回 */
let shellModalHidingViews = false

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  mainWindow.loadFile('index.html')

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('resize', () => {
    const activeTab = [...tabs.values()].find(t => t.active)
    if (activeTab) {
      resizeView(activeTab.view)
    }
  })
}

function resizeView(view) {
  if (!mainWindow || !view) return
  const bounds = mainWindow.getBounds()
  // 顶部留出 80px 给标签栏和地址栏
  view.setBounds({ x: 0, y: 80, width: bounds.width, height: bounds.height - 80 })
}

// 创建新标签页（独立会话）
ipcMain.handle('new-tab', (event, url = 'https://e.dianping.com/app/merchant-platform/fe6031ae4f544c4?iUrl=Ly9lLmRpYW5waW5nLmNvbS9hcHAvbWVyY2hhbnQtd29ya2JlbmNoL2luZGV4Lmh0bWwjLw') => {
  tabCounter++
  const tabId = `tab-${tabCounter}`
  const partition = `persist:session-${tabCounter}-${Date.now()}`

  const view = new BrowserView({
    webPreferences: {
      partition: partition,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.addBrowserView(view)
  resizeView(view)

  view.webContents.loadURL(url)

  // 拦截新窗口，在当前标签页打开
  view.webContents.setWindowOpenHandler(({ url }) => {
    view.webContents.loadURL(url)
    return { action: 'deny' }
  })

  // 监听页面标题变化
  view.webContents.on('page-title-updated', (e, title) => {
    mainWindow.webContents.send('tab-title-updated', { tabId, title })
  })

  // 监听 URL 变化
  view.webContents.on('did-navigate', (e, url) => {
    mainWindow.webContents.send('tab-url-updated', { tabId, url })
  })
  view.webContents.on('did-navigate-in-page', (e, url) => {
    mainWindow.webContents.send('tab-url-updated', { tabId, url })
  })

  // 隐藏其他标签
  tabs.forEach((tab, id) => {
    tab.active = false
    tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  })

  tabs.set(tabId, { view, partition, active: true })

  return { tabId, partition }
})

// 切换标签页
ipcMain.handle('switch-tab', (event, tabId) => {
  tabs.forEach((tab, id) => {
    if (id === tabId) {
      tab.active = true
      resizeView(tab.view)
    } else {
      tab.active = false
      tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    }
  })
})

// 关闭标签页
ipcMain.handle('close-tab', (event, tabId) => {
  const tab = tabs.get(tabId)
  if (tab) {
    mainWindow.removeBrowserView(tab.view)
    tab.view.webContents.destroy()
    tabs.delete(tabId)
  }
})

// 导航到 URL
ipcMain.handle('navigate', (event, { tabId, url }) => {
  const tab = tabs.get(tabId)
  if (tab) {
    // 自动补全协议
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }
    tab.view.webContents.loadURL(url)
  }
})

// 后退
ipcMain.handle('go-back', (event, tabId) => {
  const tab = tabs.get(tabId)
  if (tab && tab.view.webContents.canGoBack()) {
    tab.view.webContents.goBack()
  }
})

// 前进
ipcMain.handle('go-forward', (event, tabId) => {
  const tab = tabs.get(tabId)
  if (tab && tab.view.webContents.canGoForward()) {
    tab.view.webContents.goForward()
  }
})

// 刷新
ipcMain.handle('reload', (event, tabId) => {
  const tab = tabs.get(tabId)
  if (tab) {
    tab.view.webContents.reload()
  }
})

// 打开开发者工具
ipcMain.handle('open-devtools', (event, tabId) => {
  const tab = tabs.get(tabId)
  if (tab) {
    tab.view.webContents.openDevTools()
  }
})

// 显示/隐藏自动化面板时调整 BrowserView
ipcMain.handle('toggle-auto-panel', (event, { tabId, show }) => {
  const tab = tabs.get(tabId)
  if (tab && tab.active) {
    const bounds = mainWindow.getBounds()
    if (show) {
      // 面板打开时，右侧留出 330px
      tab.view.setBounds({ x: 0, y: 80, width: bounds.width - 330, height: bounds.height - 80 })
    } else {
      // 面板关闭时恢复
      tab.view.setBounds({ x: 0, y: 80, width: bounds.width, height: bounds.height - 80 })
    }
  }
})

/**
 * 壳层 HTML（index.html）上的弹窗会被 BrowserView 压在下面看不见。
 * open=true：暂时从窗口移除所有 BrowserView；open=false：挂回并按 active 恢复尺寸。
 */
ipcMain.handle('shell-modal-set', (event, { open }) => {
  if (!mainWindow) return { ok: false }
  if (open) {
    if (shellModalHidingViews) return { ok: true }
    for (const [, t] of tabs) {
      try {
        mainWindow.removeBrowserView(t.view)
      } catch (e) {
        console.log('[shell-modal-set] removeBrowserView:', e.message)
      }
    }
    shellModalHidingViews = true
    return { ok: true }
  }
  if (!shellModalHidingViews) return { ok: true }
  for (const [, t] of tabs) {
    try {
      mainWindow.addBrowserView(t.view)
      if (t.active) {
        resizeView(t.view)
      } else {
        t.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      }
    } catch (e) {
      console.log('[shell-modal-set] addBrowserView:', e.message)
    }
  }
  shellModalHidingViews = false
  return { ok: true }
})

app.whenReady().then(() => {
  initDatabase()
  createMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow()
  }
})

// ========== 设置窗口 ==========

// 打开设置页面（独立窗口）
ipcMain.handle('open-settings', () => {
  if (settingsWindow) {
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 880,
    height: 640,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  settingsWindow.loadFile('settings.html')

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
})

// 关闭设置窗口
ipcMain.handle('close-settings', () => {
  if (settingsWindow) {
    settingsWindow.close()
  }
})

// ========== 全局设置 ==========

ipcMain.handle('setting-get', (event, key) => {
  return settingService.get(key)
})

ipcMain.handle('setting-set', (event, { key, value }) => {
  return settingService.set(key, value)
})

// ========== 门店 CRUD ==========

ipcMain.handle('shop-list', () => {
  return shopService.getAll()
})

ipcMain.handle('shop-get', (event, id) => {
  return shopService.getById(id)
})

ipcMain.handle('shop-create', (event, data) => {
  return shopService.create(data)
})

ipcMain.handle('shop-update', (event, { id, data }) => {
  return shopService.update(id, data)
})

ipcMain.handle('shop-delete', (event, id) => {
  return shopService.delete(id)
})

// ========== 好评模板 CRUD（按门店）==========

ipcMain.handle('shop-template-list', (event, shopId) => {
  return templateService.getByShopId(shopId)
})

ipcMain.handle('shop-template-create', (event, { shopId, content }) => {
  return templateService.createForShop(shopId, content)
})

ipcMain.handle('shop-template-update', (event, { id, content }) => {
  return templateService.update(id, content)
})

ipcMain.handle('shop-template-delete', (event, id) => {
  return templateService.delete(id)
})

// ========== 自动化任务 ==========

let taskAbortFlags = { bad: false, good: false }
ipcMain.handle('set-task-abort', (event, { mode, abort }) => {
  taskAbortFlags[mode] = abort
})

// 辅助函数：延时
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 辅助函数：随机延时
function randomSleep(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
  return sleep(ms)
}


async function executeReviewTask(tab, mode) {
  const taskName = mode === 'bad' ? '差评监控' : '好评回复';
  taskAbortFlags[mode] = false; // 开始前重置中止标志
  
  if (!tab) {
    console.log(`[${taskName}] 错误: 标签页不存在`)
    return { message: '标签页不存在' }
  }

  // 获取配置的门店列表
  const shops = shopService.getAll()
  console.log(`[${taskName}] 开始执行，配置门店数量:`, shops.length)

  // 清除上一次遗留的预警弹窗
  try {
    await tab.view.webContents.executeJavaScript(`
      (function() {
        var el = document.getElementById('bad-review-alert-popup');
        if (el) el.remove();
      })()
    `)
  } catch(e) {}

  if (shops.length === 0) {
    console.log(`[${taskName}] 错误: 未配置门店`)
    return { message: '请先在设置中添加门店' }
  }

  let templates = [];
  if (mode === 'good') {
      templates = templateService.getAllWithShop()
      if (templates.length === 0) {
         return { message: '请先在设置中为门店添加好评回复模板' }
      }
  }

  try {
    // Step 1: 点击左侧菜单「评价管理」
    console.log(`[${taskName}] Step 1: 点击「评价管理」菜单`)
    const step1 = await tab.view.webContents.executeJavaScript(`
      (function() {
        const menuItems = document.querySelectorAll('.menu-item-root')
        for (let item of menuItems) {
          const title = item.querySelector('.title')
          if (title && title.textContent.trim() === '评价管理') {
            item.querySelector('.main-container').click()
            return true
          }
        }
        return false
      })()
    `)
    console.log(`[${taskName}] Step 1 结果:`, step1)

    await sleep(1000)

    // Step 2: 点击「门店评价」
    console.log(`[${taskName}] Step 2: 点击「门店评价」`)
    const step2 = await tab.view.webContents.executeJavaScript(`
      (function() {
        const menuItems = document.querySelectorAll('.menu-item-root')
        for (let item of menuItems) {
          const title = item.querySelector('.title')
          if (title && title.textContent.trim() === '门店评价') {
            item.querySelector('.main-container').click()
            return true
          }
        }
        return false
      })()
    `)
    console.log(`[${taskName}] Step 2 结果:`, step2)

    await sleep(2000)

    // Step 3: 点击「点评评价」Tab
    console.log(`[${taskName}] Step 3: 点击「点评评价」Tab`)
    const step3 = await tab.view.webContents.executeJavaScript(`
      (function() {
        const tabItems = document.querySelectorAll('.mtd-tabs-item')
        for (let item of tabItems) {
          const label = item.querySelector('.mtd-tabs-item-label')
          if (label && label.textContent.trim() === '点评评价') {
            item.click()
            return true
          }
        }
        return false
      })()
    `)
    console.log(`[${taskName}] Step 3 结果:`, step3)

    await sleep(1500)

    // 打开门店下拉（主文档或与 Step 4 一致的 iframe）
    async function openShopSelectDropdown() {
      const wc = tab.view.webContents
      const pageInfo = await wc.executeJavaScript(`
        (function() {
          return {
            hasShopInput: !!(document.querySelector('.shop-select-input') || document.querySelector('#shopName') || document.querySelector('.shop-name')),
            iframeCount: document.querySelectorAll('iframe').length
          }
        })()
      `)
      if (!pageInfo.hasShopInput && pageInfo.iframeCount > 0) {
        for (const frame of wc.mainFrame.frames) {
          try {
            const result = await frame.executeJavaScript(`
              (function() {
                const shopInput = document.querySelector('.shop-select-input') || document.querySelector('#shopName') || document.querySelector('.shop-name')
                if (shopInput) {
                  shopInput.click()
                  return { found: true }
                }
                return { found: false }
              })()
            `)
            if (result.found) break
          } catch (e) {
            console.log(`[${taskName}] iframe 打开下拉失败:`, e.message)
          }
        }
      } else {
        await wc.executeJavaScript(`
          (function() {
            const shopInput = document.querySelector('.shop-select-input') || document.querySelector('#shopName') || document.querySelector('.shop-name')
            if (shopInput) shopInput.click()
          })()
        `)
      }
      await sleep(1500)
    }

    async function clickShopSelectConfirm() {
      const wc = tab.view.webContents
      const ok = await wc.executeJavaScript(`
        (function() {
          var el = document.querySelector(
            '.shop-select-panel-footer .shop-select-panel-footer-actions .mtdu-btn-primary'
          )
          if (el) {
            el.click()
            return true
          }
        }())
      `)
      if (ok) {
        console.log(`[${taskName}] 已点击门店选择「确定」`)
        await sleep(300)
        return true
      }
      return false
    }

    async function clickShopSelectCancel() {
      const wc = tab.view.webContents
      const ok = await wc.executeJavaScript(`
        (function() {
          var el = document.querySelector(
            '.shop-select-panel-footer .shop-select-panel-footer-actions .mtdu-btn-panel'
          )
          if (el) {
            el.click()
            return true
          }
        }())
      `)
      if (ok) {
        console.log(`[${taskName}] 已点击门店选择「取消」`)
        await sleep(300)
        return true
      }
      return false
    }

    // Step 4: 打开门店下拉选择框
    console.log(`[${taskName}] Step 4: 打开门店下拉选择框`)
    await openShopSelectDropdown()

    const shopNames = shops.map(s => s.name)
    console.log(`[${taskName}] Step 5: 本地配置的门店:`, shopNames)

    let totalBadReviews = 0
    let totalGoodReplies = 0
    const badReviewDetails = []
    const violationAlerts = [] 
    let totalShopRuns = 0
    let abortedEarly = false
    let abortMessage = ''

    const domShops = await tab.view.webContents.executeJavaScript(`
      (function() {
        const items = document.querySelectorAll('.shopFilter .shop-item')
        const results = []
        for (let i = 0; i < items.length; i++) {
          const nameEl = items[i].querySelector('.slot-item-name-text')
          if (nameEl) {
            results.push({ name: nameEl.textContent.trim(), index: i })
          }
        }
        return results
      })()
    `)

    if (domShops.length === 0) {
      console.log(`[${taskName}] 获取到的 DOM 门店列表为空，点击取消并结束本标签任务`)
      await clickShopSelectCancel()
      abortedEarly = true
      abortMessage = '门店列表为空，已取消'
    } else {
      console.log(`[${taskName}] DOM 中共有 ` + domShops.length + ` 个门店项，开始逐一匹配配置...`)
      
      for (let i = 0; i < domShops.length; i++) {
        const domShopName = domShops[i].name
        const originalIndex = domShops[i].index
        
        if (!domShopName || domShopName === '全部门店') continue

        const matchedShop = shops.find(cfg => domShopName.includes(cfg.name) || cfg.name.includes(domShopName))
        
        if (!matchedShop) {
           console.log(`[${taskName}] 跳过不在配置中的门店:`, domShopName)
           continue
        }

        console.log(`[${taskName}] 处理门店项: [` + domShopName + `] (位于列表第 ` + (i + 1) + ` 项)`)

        if (taskAbortFlags[mode]) return { message: '任务已被手动取消' }

        if (totalShopRuns > 0) {
          console.log(`[${taskName}] 重新打开门店选择框（下一项）`)
          await openShopSelectDropdown()
          await sleep(500)
        }

        let selectResult = { success: false }
        try {
          selectResult = await tab.view.webContents.executeJavaScript(`
            (function() {
              const matchIndex = ${originalIndex};
              const items = document.querySelectorAll('.shopFilter .shop-item');
              if (items[matchIndex]) {
                const radio = items[matchIndex].querySelector('.mtdu-radio, .mtdu-checkbox-input');
                if (radio) {
                  radio.click();
                } else {
                  items[matchIndex].click();
                }
                return { success: true, name: "${domShopName}" };
              }
              return { success: false };
            })()
          `)

          console.log(`[${taskName}] 选择门店结果:`, selectResult)

          if (!selectResult.success) {
            console.log(`[${taskName}] 未能选中 DOM 中的第`, i + 1, '项:', domShopName, '→ 点击取消关闭面板')
            await clickShopSelectCancel()
            continue
          }
        } catch (err) {
          console.log(`[${taskName}] 选择门店出错:`, err.message, '→ 点击取消关闭面板')
          await clickShopSelectCancel()
          continue
        }

        await sleep(500)

        try {
          console.log(`[${taskName}] 点击确定按钮`)
          const ok = await clickShopSelectConfirm()
        } catch (err) {}

        console.log(`[${taskName}] 正在加载门店:`, domShopName)
        await sleep(4000)

        const helper = new AutoHelper(tab.view.webContents)
        let reviewFrame = helper.findFrame('rating-management')
        if (!reviewFrame) reviewFrame = helper.findFrame('shop-comment')

        let filterSuccess = false

        if (reviewFrame) {
          console.log(`[${taskName}] 找到评价 iframe:`, reviewFrame.url)
          await helper.waitForSelector(reviewFrame, '.mtd-tabs-item-label', 10000).catch(() => {})

          for (const platform of ['点评', '美团']) {
            if (taskAbortFlags[mode]) return { message: '任务已被手动取消' }
            console.log(`[${taskName}] 正在切换并处理平台: ${platform}`)

            const platformTriggerOk = await reviewFrame.executeJavaScript(`
              (function() {
                var labels = document.querySelectorAll('.filter-label');
                for(var j=0; j<labels.length; j++) {
                  if(labels[j].textContent.trim() === '平台') {
                    var wrap = labels[j].nextElementSibling;
                    var trigger = wrap && (wrap.querySelector('.mtd-input') || wrap.querySelector('.mtd-select-input') || wrap);
                    if (trigger) { trigger.click(); return true; }
                  }
                }
                return false;
              })()
            `).catch(() => false)
            await sleep(800) 

            const itemClickOk = await reviewFrame.executeJavaScript(`
              (function() {
                var items = document.querySelectorAll('.mtd-dropdown-menu-item');
                for(var j=0; j<items.length; j++) {
                  if(items[j].textContent.trim() === '${platform}') {
                    items[j].click();
                    return true;
                  }
                }
                try {
                  var topItems = window.top.document.querySelectorAll('.mtd-dropdown-menu-item');
                  for(var k=0; k<topItems.length; k++) {
                    if(topItems[k].textContent.trim() === '${platform}') {
                      topItems[k].click();
                      return true;
                    }
                  }
                } catch(e) {}
                return false;
              })()
            `).catch(() => false)
            await sleep(3000)

            // Step A: 点击「评价明细」标签
            let tabOk = await helper.click(reviewFrame, `
              el = null;
              var labels = document.querySelectorAll('.mtd-tabs-item-label');
              for(var j=0; j<labels.length; j++) {
                 if(labels[j].textContent.indexOf('评价明细') >= 0) { el = labels[j]; break; }
              }
            `)
            await sleep(2000)

            // 如果是差评模式，提取违规预警
            if (mode === 'bad') {
              try {
                const violations = await reviewFrame.executeJavaScript(`
                  (function() {
                    var items = document.querySelectorAll('.shop-rating-overview__complaint-item');
                    var results = [];
                    for (var i = 0; i < items.length; i++) {
                      var titleEl = items[i].querySelector('.shop-rating-overview__complaint-title span');
                      var resultEl = items[i].querySelector('.shop-rating-overview__complaint-result');
                      var badgeEl = items[i].querySelector('.shop-rating-overview__complaint-badge');
                      var linkEl = items[i].querySelector('.shop-rating-overview__complaint-button');
                      results.push({
                        title: titleEl ? titleEl.textContent.trim() : '',
                        badge: badgeEl ? badgeEl.textContent.trim() : '',
                        desc: resultEl ? resultEl.textContent.trim().replace(/\s+/g, ' ') : '',
                        link: linkEl ? linkEl.href : ''
                      });
                    }
                    return results;
                  })()
                `)
                if (violations && violations.length > 0) {
                  for (const v of violations) {
                    if (v.title || v.desc) {
                      violationAlerts.push({ shop: domShopName + ' (' + platform + ')', ...v })
                    }
                  }
                }
              } catch (e) {}
            }

            // Step B: 点击「近30天」
            let timeOk = await helper.click(reviewFrame, `
              el = null;
              var btns = document.querySelectorAll('.shop-rating-overview__tab, .quick-filter-btn span, .quick-filter-btn');
              for(var j=0; j<btns.length; j++) {
                 if(btns[j].textContent.indexOf('近30天') >= 0) { el = btns[j]; break; }
              }
            `)
            await sleep(2000)

            // Step C: 点击星级
            const starTarget = mode === 'bad' ? '差评' : '好评';
            let gradeOk = await helper.click(reviewFrame, `
              el = null;
              var options = document.querySelectorAll('.review-filter__option');
              for(var j=0; j<options.length; j++) {
                 if(options[j].textContent.indexOf('${starTarget}') >= 0) { el = options[j]; break; }
              }
            `)
            await sleep(3000) 

            // Step D: 执行操作
            if (mode === 'bad') {
              let badReviewResult = null
              try {
                badReviewResult = await reviewFrame.executeJavaScript(`
                  (function() {
                    var items = document.querySelectorAll('.review-item, .comment-item, .comment-list-item');
                    if (items.length === 0) {
                      return { hasBadReviews: false, count: 0, message: '页面未发现任何差评元素', reviews: [] };
                    }
                    function parseTime(item) {
                      var el = item.querySelector('.review-item__time, .comment-time');
                      return el ? el.textContent.trim().replace('线上消费后评价', '').trim() : '';
                    }
                    function parseRating(item) {
                      var rateEl = item.querySelector('.mtd-rate[aria-valuenow]');
                      if (rateEl) return rateEl.getAttribute('aria-valuenow') + '星';
                      var el = item.querySelector('.comment-star');
                      if (!el) return '';
                      var match = el.className.match(/(?:comment-rank|star-)(\d+)/);
                      return match ? (parseInt(match[1]) / 10) + '星' : '';
                    }
                    function parseContent(item) {
                      var el = item.querySelector('.review-item__comment, .comment-text');
                      if (!el) return '';
                      var t = el.textContent.trim().replace(/\s+/g, ' ');
                      return t.length > 120 ? t.slice(0, 120) + '…' : t;
                    }
                    var reviews = [];
                    for (var j = 0; j < items.length; j++) {
                      var isReplied = items[j].querySelector('.review-item__reply-item, .reply-item') !== null
                                   || items[j].innerHTML.indexOf('商家回复') !== -1;
                      if (!isReplied) {
                        reviews.push({
                          reviewTime: parseTime(items[j]),
                          rating: parseRating(items[j]),
                          contentPreview: parseContent(items[j])
                        });
                      }
                    }
                    if (reviews.length === 0) {
                      return { hasBadReviews: false, count: 0, message: '找到 ' + items.length + ' 条差评，但已全部回复', reviews: [] };
                    }
                    return { hasBadReviews: true, count: reviews.length, message: '发现' + reviews.length + '条未回复差评 (共' + items.length + '条)', reviews: reviews };
                  })()
                `)
              } catch(e) {}

              if (badReviewResult && badReviewResult.hasBadReviews) {
                totalBadReviews += badReviewResult.count
                badReviewDetails.push({
                  shop: selectResult.name + ' (' + platform + ')',
                  count: badReviewResult.count,
                  reviews: badReviewResult.reviews || []
                })
              }
            } else if (mode === 'good') {
               const shopTemplates = templates.filter(t => t.shop_id === matchedShop.id);
               if (shopTemplates.length === 0) {
                 console.log(`[${taskName}] 当前门店无可用好评模板，跳过:`, domShopName);
                 continue;
               }
               // 执行好评回复
               const replyResult = await reviewFrame.executeJavaScript(`
                 (async function() {
                   // 将模板传入上下文
                   var templates = ${JSON.stringify(shopTemplates)};
                   function getRandomTemplate() {
                     var t = templates[Math.floor(Math.random() * templates.length)];
                     return t ? (t.content || t.text || t) : '感谢您的好评，我们会继续努力！';
                   }
                   
                   var repliedCount = 0;
                   var sleep = ms => new Promise(r => setTimeout(r, ms));
                   
                   var maxTries = 50;
                   var tries = 0;
                   var handledItemsTexts = new Set();
                   
                   while (tries < maxTries) {
                     tries++;
                     var items = document.querySelectorAll('.review-item, .comment-item, .comment-list-item');
                     var targetItem = null;
                     var targetCommentText = "";
                     
                     for (var j = 0; j < items.length; j++) {
                       var item = items[j];
                       var textContext = item.textContent || "";
                       var commentEl = item.querySelector('.review-item__comment, .comment-text');
                       var commentText = commentEl ? commentEl.textContent.trim() : textContext.trim().substring(0, 100);

                       var isReplied = item.querySelector('.review-item__reply-item, .reply-item, .merchant-reply, .review-item__reply-content') !== null
                                    || textContext.indexOf('商家回复') !== -1
                                    || textContext.indexOf('已回复') !== -1
                                    || item.dataset.skipReply === 'true'
                                    || handledItemsTexts.has(commentText); // 防死循环和重复回复标记

                       if (!isReplied) {
                         targetItem = item;
                         targetCommentText = commentText;
                         break;
                       }
                     }
                     
                     if (!targetItem) {
                       break; // 没有需要回复的了
                     }

                     // 寻找回复按钮
                     var buttons = Array.from(targetItem.querySelectorAll('button, a'));
                     var replyBtn = buttons.find(b => {
                       var t = b.textContent.trim();
                       return t === '回复' || t === '回复评价' || t === '去回复';
                     });

                     if (!replyBtn) {
                       targetItem.dataset.skipReply = 'true';
                       handledItemsTexts.add(targetCommentText);
                       continue;
                     }

                     replyBtn.click();
                     await sleep(1500);

                     // 寻找输入框 (有些页面的回复框是弹窗，挂在body下，所以也从全局兜底)
                     var textarea = targetItem.querySelector('textarea.mtd-textarea, textarea[placeholder*="回复"], textarea.reply-input') 
                                 || document.querySelector('textarea.mtd-textarea, textarea[placeholder*="回复"], textarea.reply-input');
                     
                     if (textarea) {
                        var text = getRandomTemplate();
                        textarea.focus();
                        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                        if (nativeSetter) {
                          nativeSetter.call(textarea, text);
                        } else {
                          textarea.value = text;
                        }
                        textarea.dispatchEvent(new Event('input', { bubbles: true }));
                        await sleep(800);
                        
                        // 点击发送/提交
                        var submitBtn = targetItem.querySelector('.review-item__reply-send') || document.querySelector('.review-item__reply-send');
                        if (!submitBtn) {
                          var allBtns = Array.from(document.querySelectorAll('button'));
                          submitBtn = allBtns.find(b => {
                            var t = b.textContent.trim();
                            return t === '发送' || t === '提交' || t === '确定';
                          });
                        }
                        
                        if (submitBtn) {
                          console.log('[好评回复] 找到发送按钮并点击:', submitBtn.textContent);
                          submitBtn.click();
                          repliedCount++;
                           targetItem.dataset.skipReply = 'true';
                           handledItemsTexts.add(targetCommentText);
                          await sleep(5000); // 提交后等待DOM刷新
                        } else {
                          targetItem.dataset.skipReply = 'true';
                           handledItemsTexts.add(targetCommentText);
                        }
                     } else {
                        targetItem.dataset.skipReply = 'true';
                         handledItemsTexts.add(targetCommentText);
                     }
                   }
                   return { count: repliedCount };
                 })()
               `).catch(e => { console.log('好评自动回复异常:', e.message); return { count: 0 }; });
               
               if (replyResult && replyResult.count > 0) {
                  totalGoodReplies += replyResult.count;
               }
            }
          }
          filterSuccess = true
        }
        totalShopRuns++
      }
    }

    if (mode === 'bad') {
        const hasViolations = violationAlerts.length > 0
        if (totalBadReviews > 0 || hasViolations) {
          mainWindow.webContents.send('bad-review-found', {
            tabId: tab.id,
            totalCount: totalBadReviews,
            details: badReviewDetails,
            violations: violationAlerts
          })
          if (Notification.isSupported()) {
            const notifParts = []
            if (totalBadReviews > 0) notifParts.push(`${totalBadReviews} 条未回复差评`)
            if (hasViolations) notifParts.push(`${violationAlerts.length} 条违规预警`)
            new Notification({
              title: hasViolations && totalBadReviews === 0 ? '违规预警' : '差评/违规提醒',
              body: `发现 ${notifParts.join('、')}，请及时处理！`
            }).show()
          }

          // 企微机器人推送
          try {
            const webhookUrl = settingService.get('wecom_webhook');
            if (webhookUrl) {
              const { net } = require('electron');
              let content = `⚠️ 发现差评或违规预警！\n`;
              if (totalBadReviews > 0) content += `\n未回复差评：${totalBadReviews} 条`;
              if (hasViolations) content += `\n违规预警：${violationAlerts.length} 条`;
              content += `\n\n详情:`;
              badReviewDetails.forEach(d => {
                content += `\n- ${d.shop}: ${d.count} 条`;
              });
              violationAlerts.forEach(v => {
                content += `\n- [违规] ${v.shop}: ${v.desc || v.title}`;
              });
              
              const request = net.request({
                method: 'POST',
                url: webhookUrl,
                headers: {
                  'Content-Type': 'application/json'
                }
              });
              request.on('error', (err) => console.log('企微推送错误:', err));
              request.write(JSON.stringify({
                msgtype: 'text',
                text: { content }
              }));
              request.end();
            }
          } catch (e) {
            console.log('企微机器人推送异常:', e.message);
          }
        } else {
          mainWindow.webContents.send('bad-review-cleared', { tabId: tab.id })
        }
        
        const msgParts = []
        if (totalBadReviews > 0) msgParts.push(`${totalBadReviews} 条差评`)
        if (hasViolations) msgParts.push(`${violationAlerts.length} 条违规预警`)
    
        return {
          message: msgParts.length > 0
            ? `发现 ${msgParts.join('、')}！`
            : abortedEarly
              ? (abortMessage || '已取消门店选择')
              : `已检查 ${totalShopRuns} 个门店实例，暂无异常`,
          totalBadReviews: totalBadReviews,
          details: badReviewDetails,
          violations: violationAlerts,
          abortedNoShop: abortedEarly
        }
    } else {
        return {
           message: `自动回复完成，共回复 ${totalGoodReplies} 条好评`,
           count: totalGoodReplies
        }
    }

  } catch (e) {
    console.log(`[${taskName}] 执行失败:`, e.message)
    return { message: '执行失败: ' + e.message }
  }
}

// 差评监控
ipcMain.handle('run-bad-review-monitor', async (event, tabId) => {
  return await executeReviewTask(tabs.get(tabId), 'bad');
});

// 好评自动回复
ipcMain.handle('run-good-review-reply', async (event, payload) => {
  const tabId = typeof payload === 'string' ? payload : payload?.tabId;
  return await executeReviewTask(tabs.get(tabId), 'good');
});

