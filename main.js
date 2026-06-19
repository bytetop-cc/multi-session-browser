const { app } = require('electron')
const path = require('path')

// 强制指定 userData 目录为 multi-session-browser，确保数据库和 Session 数据不会因为重命名而发生变化
app.setPath('userData', path.join(app.getPath('appData'), 'multi-session-browser'))

const { BrowserWindow, BrowserView, ipcMain, session, Notification } = require('electron')
const { initDatabase, shopService, templateService, settingService } = require('./db')
const { AutoHelper } = require('./auto-helper')
const { readReviewFilterDebug } = require('./iframe-bridge')

let mainWindow = null
let settingsWindow = null
let tabCounter = 0
const tabs = new Map() // tabId -> { view, partition }
/** 弹窗显示时曾从窗口摘下 BrowserView，关闭时需挂回 */
let shellModalHidingViews = false

let activeRunIds = { bad: 0, good: 0 }
let isAutoPanelOpen = false

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, 'build/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  mainWindow.setMaxListeners(50) // 消除多个 BrowserView 添加 closed 监听器产生的超限警告
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
  const width = isAutoPanelOpen ? bounds.width - 330 : bounds.width
  // 顶部留出 96px 给标签栏和地址栏
  view.setBounds({ x: 0, y: 96, width: width, height: bounds.height - 96 })
}

function hideView(view) {
  if (!mainWindow || !view) return
  const bounds = mainWindow.getBounds()
  const width = isAutoPanelOpen ? bounds.width - 330 : bounds.width
  // 隐藏到屏幕外，保持原尺寸以便正常渲染和定位
  view.setBounds({ x: -2000, y: -2000, width: width, height: bounds.height - 96 })
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
    hideView(tab.view)
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
      hideView(tab.view)
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
  isAutoPanelOpen = show
  const tab = tabs.get(tabId)
  if (tab && tab.active) {
    resizeView(tab.view)
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
        hideView(t.view)
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
    icon: path.join(__dirname, 'build/icon.png'),
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

function shouldAbort(mode, runId) {
  if (runId !== undefined && runId !== null) {
    return runId !== activeRunIds[mode]
  }
  return taskAbortFlags[mode]
}

ipcMain.handle('start-task-run', (event, mode) => {
  activeRunIds[mode]++
  taskAbortFlags[mode] = false
  return activeRunIds[mode]
})

ipcMain.handle('set-task-abort', (event, { mode, abort }) => {
  taskAbortFlags[mode] = abort
  if (abort) {
    activeRunIds[mode]++
  }
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

async function executeReviewTask(tab, mode, runId) {
  const taskName = mode === 'bad' ? '差评监控' : '好评回复';
  taskAbortFlags[mode] = false; // 开始前重置中止标志

  if (!tab) {
    console.log(`[${taskName}] 错误: 标签页不存在`)
    return { message: '标签页不存在' }
  }

  // 获取本地配置的门店列表
  const shops = shopService.getAll()
  console.log(`[${taskName}] 开始执行 API 自动化，配置门店数量:`, shops.length)

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

  // 辅助函数：归一化门店名称
  function normalizeShopName(name) {
    if (!name) return '';
    return name.replace(/[\s\(\)（）]/g, '').toLowerCase();
  }

  // 辅助函数：门店匹配
  function isShopMatched(cfgName, apiShop) {
    const shopName = apiShop.shopName || '';
    const branchName = apiShop.branchName || '';
    const combined = branchName ? `${shopName}（${branchName}）` : shopName;

    const normCfg = normalizeShopName(cfgName);
    const normCombined = normalizeShopName(combined);

    return normCfg === normCombined || normCombined.includes(normCfg) || normCfg.includes(normCombined);
  }

  try {
    // 确保当前页面属于点评商户后台
    const currentUrl = tab.view.webContents.getURL();
    if (!currentUrl.includes('dianping.com')) {
      return { message: '当前未处于大众点评页面，请先登录并打开点评商户后台' };
    }

    if (shouldAbort(mode, runId)) return { message: '任务已被手动取消' };
    mainWindow.webContents.send('task-progress-update', { tabId: tab.id, mode, text: '🔍 获取门店列表中...' });

    // 1. 获取账号关联的全部门店列表 (API)
    console.log(`[${taskName}] Step 1: 正在通过 API 获取所有门店列表...`)
    const apiShopList = await tab.view.webContents.executeJavaScript(`
      (async function() {
        try {
          const res = await fetch('/gateway/merchant/general/shopinfo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bizType: "review_manage_checkbox",
              device: "pc",
              currentTab: "city",
              shopIds: "0"
            })
          });
          const data = await res.json();
          if (data && data.code === 200 && data.data) {
            return data.data.shopInfoList || [];
          }
        } catch (e) {
          console.error('[API] 获取门店列表异常:', e.message);
        }
        return [];
      })()
    `);

    if (shouldAbort(mode, runId)) return { message: '任务已被手动取消' };

    console.log(`[${taskName}] 接口返回门店总数:`, apiShopList.length);
    if (apiShopList.length === 0) {
      mainWindow.webContents.send('task-progress-update', { tabId: tab.id, mode, text: '❌ 门店列表获取失败' });
      return { message: '无法获取点评商户门店列表，请确保已登录' };
    }

    // 2. 匹配本地配置的门店
    const matchedShops = []; // [{ cfg, api }]
    for (const cfgShop of shops) {
      const matchedApiShop = apiShopList.find(apiShop => isShopMatched(cfgShop.name, apiShop));
      if (matchedApiShop) {
        matchedShops.push({
          cfg: cfgShop,
          api: matchedApiShop
        });
        console.log(`[${taskName}] 门店匹配成功: [配置: ${cfgShop.name}] <-> [API: ${matchedApiShop.shopName}${matchedApiShop.branchName ? '(' + matchedApiShop.branchName + ')' : ''}, ID: ${matchedApiShop.shopId}]`);
      } else {
        console.log(`[${taskName}] 门店未在 API 列表中匹配到: [配置: ${cfgShop.name}]`);
      }
    }

    if (shouldAbort(mode, runId)) return { message: '任务已被手动取消' };
    mainWindow.webContents.send('task-progress-update', { tabId: tab.id, mode, text: `👥 匹配成功 ${matchedShops.length} 个门店` });

    if (matchedShops.length === 0) {
      mainWindow.webContents.send('task-progress-update', { tabId: tab.id, mode, text: '⚠ 未匹配到配置的门店' });
      return { message: '未找到任何与配置相匹配的点评门店' };
    }

    // 3. 循环通过 API 拉取每个门店的评价列表
    console.log(`[${taskName}] Step 2: 遍历匹配门店并拉取点评...`);
    const now = Date.now();
    const startTime = now - 30 * 24 * 60 * 60 * 1000; // 30 天前
    const endTime = now;

    let totalBadReviews = 0;
    let totalGoodReplies = 0;
    const badReviewDetails = [];
    const goodReplyDetails = [];
    const violationAlerts = [];
    let totalShopRuns = 0;

    for (const item of matchedShops) {
      if (shouldAbort(mode, runId)) {
        mainWindow.webContents.send('task-progress-update', { tabId: tab.id, mode, text: '已取消' });
        return { message: '任务已被手动取消' };
      }

      const shopId = item.api.shopId;
      const displayName = `${item.api.shopName}${item.api.branchName ? '(' + item.api.branchName + ')' : ''}`;
      console.log(`[${taskName}] 正在拉取门店 [${displayName}] (ID: ${shopId}) 的数据...`);

      // 提取该店铺的点评 (同时查询平台 1 点评 和平台 2 美团)
      for (const platformVal of [1, 2]) {
        if (shouldAbort(mode, runId)) {
          mainWindow.webContents.send('task-progress-update', { tabId: tab.id, mode, text: '已取消' });
          return { message: '任务已被手动取消' };
        }
        const platformName = platformVal === 1 ? '点评' : '美团';
        await sleep(3000); // 接口调用前等待 3 秒防频限制
        mainWindow.webContents.send('task-progress-update', { tabId: tab.id, mode, text: `📡 [${item.api.shopName}] 拉取${platformName}点评...` });
        console.log(`[${taskName}] 拉取平台: ${platformName} (ID: ${platformVal})`);

        const reviewData = await tab.view.webContents.executeJavaScript(`
          (async function() {
            try {
              const res = await fetch('/gateway/merchant/review/list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  platform: ${platformVal},
                  shopIds: [${shopId}],
                  tagId: ${mode === 'bad' ? 3 : 1},
                  startTime: ${startTime},
                  endTime: ${endTime},
                  aiReply: false,
                  pageNo: 1,
                  pageSize: 10
                })
              });
              const data = await res.json();
              if (data && data.code === 200 && data.data) {
                return data.data;
              }
            } catch (e) {
              console.error('[API] 拉取评价异常:', e.message);
            }
            return null;
          })()
        `);

        if (shouldAbort(mode, runId)) {
          mainWindow.webContents.send('task-progress-update', { tabId: tab.id, mode, text: '已取消' });
          return { message: '任务已被手动取消' };
        }

        if (!reviewData || !reviewData.reviewDetails) {
          console.log(`[${taskName}] [${displayName}] [${platformName}] 无评价数据或接口异常`);
          continue;
        }

        const reviewDetails = reviewData.reviewDetails;
        console.log(`[${taskName}] [${displayName}] [${platformName}] 近30天评价总数:`, reviewData.totalSize || reviewDetails.length);

        const shopBadReviews = [];
        const shopNeedReplyGoodReviews = [];

        for (const detail of reviewDetails) {
          const reviewInfo = detail.reviewDetail && detail.reviewDetail.reviewInfo;
          if (!reviewInfo) continue;

          const rawStar = reviewInfo.star || 0;
          const starLevel = rawStar > 5 ? rawStar / 10 : rawStar;

          // 核心判定：replyList 不为空则不用回复，为空则需要回复
          const replyList = detail.reviewDetail && detail.reviewDetail.replyList;
          const isReplied = !!(replyList && replyList.length > 0);

          if (mode === 'bad' && !isReplied) {
            let contentPreview = reviewInfo.content || reviewInfo.comment || '';
            if (contentPreview.length > 120) {
              contentPreview = contentPreview.slice(0, 120) + '…';
            }
            let reviewTime = '';
            if (reviewInfo.addTime) {
              const t = new Date(reviewInfo.addTime);
              reviewTime = isNaN(t.getTime()) ? '' : t.toLocaleString('zh-CN');
            }

            shopBadReviews.push({
              reviewTime: reviewTime || '未知时间',
              rating: `${starLevel}星`,
              contentPreview: contentPreview
            });
          }

          if (mode === 'good' && !isReplied) {
            shopNeedReplyGoodReviews.push(detail);
          }
        }

        if (mode === 'bad' && shopBadReviews.length > 0) {
          totalBadReviews += shopBadReviews.length;
          badReviewDetails.push({
            shop: `${displayName} (${platformName})`,
            count: shopBadReviews.length,
            reviews: shopBadReviews
          });
        }

        // 4. 如果是好评回复，且有未回复的好评，我们直接通过 API 发起回复
        if (mode === 'good' && shopNeedReplyGoodReviews.length > 0) {
          if (shouldAbort(mode, runId)) {
            mainWindow.webContents.send('task-progress-update', { tabId: tab.id, mode, text: '已取消' });
            return { message: '任务已被手动取消' };
          }
          const shopTemplates = templates.filter(t => t.shop_id === item.cfg.id);
          if (shopTemplates.length === 0) {
            console.log(`[${taskName}] [${displayName}] 无可用好评模板，跳过回复`);
            continue;
          }

          mainWindow.webContents.send('task-progress-update', { tabId: tab.id, mode, text: `✍️ [${item.api.shopName}] 回复好评中...` });
          console.log(`[${taskName}] 发现 [${displayName}] (${platformName}) 有 ${shopNeedReplyGoodReviews.length} 条未回复好评，开始执行 API 回复...`);

          const repliesBase64 = Buffer.from(JSON.stringify(shopNeedReplyGoodReviews)).toString('base64');
          const templatesBase64 = Buffer.from(JSON.stringify(shopTemplates)).toString('base64');

          const replyResult = await tab.view.webContents.executeJavaScript(`
            (async function() {
              const decodeUtf8Base64 = str => decodeURIComponent(escape(atob(str)));
              const replies = JSON.parse(decodeUtf8Base64("${repliesBase64}"));
              const templates = JSON.parse(decodeUtf8Base64("${templatesBase64}"));
              let successCount = 0;
              let debugLogs = [];
              
              function getRandomTemplate() {
                const t = templates[Math.floor(Math.random() * templates.length)];
                return t ? (t.content || t.text || t) : '感谢您的好评，我们会继续努力！';
              }
              
              const sleep = ms => new Promise(r => setTimeout(r, ms));
              
              for (const detail of replies) {
                const reviewInfo = detail.reviewDetail && detail.reviewDetail.reviewInfo;
                const reviewId = reviewInfo ? reviewInfo.reviewId : null;
                if (!reviewId) continue;
                
                const content = getRandomTemplate();
                const targetUrl = window.location.origin + '/review/app/reply/ajax/reviewreply';
                
                // platform 映射：查询列表时的 platformVal = 1 (点评) / 2 (美团)
                // 对应回复 API 的 platform 值为 0 (点评) / 1 (美团)
                const replyPlatform = ${platformVal} === 1 ? 0 : 1;
                const userId = (reviewInfo && reviewInfo.userId) || (detail.userInfo && detail.userInfo.userId) || 0;
                
                let resText = "";
                let resStatus = null;
                try {
                  const res = await fetch(targetUrl, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: JSON.stringify({
                      clientType: 1,
                      platform: replyPlatform,
                      content: content,
                      replyId: 0,
                      shopIdStr: String(${shopId}),
                      reviewId: reviewId,
                      userId: userId
                    })
                  });
                  
                  resStatus = res.status;
                  const buffer = await res.arrayBuffer();
                  resText = new TextDecoder('utf-8').decode(buffer);
                  const data = JSON.parse(resText);
                  if (data && (data.code === 200 || data.success === true)) {
                    successCount++;
                    debugLogs.push({ reviewId, success: true, status: resStatus, text: resText });
                  } else {
                    debugLogs.push({ reviewId, success: false, status: resStatus, text: resText });
                  }
                } catch (e) {
                  debugLogs.push({ reviewId, success: false, status: resStatus, error: e.message, text: resText });
                }
                await sleep(3000);
              }
              return { count: successCount, debugLogs };
            })()
          `).catch(e => { console.log('好评自动回复异常:', e.message); return { count: 0, error: e.message }; });

          console.log(`[好评自动回复] 门店 [${displayName}] (${platformName}) API 回复结果:`, JSON.stringify(replyResult));
          if (replyResult && replyResult.debugLogs) {
            for (const log of replyResult.debugLogs) {
              if (log.success) {
                console.log(`[好评自动回复] [成功] 评价ID: ${log.reviewId}, 响应: ${log.text}`);
              } else {
                console.error(`[好评自动回复] [失败] 评价ID: ${log.reviewId}, HTTP状态: ${log.status}, 响应: ${log.text}, 错误: ${log.error || '无'}`);
              }
            }
          }

          if (replyResult && replyResult.count > 0) {
            totalGoodReplies += replyResult.count;
            goodReplyDetails.push({
              shop: `${displayName} (${platformName})`,
              count: replyResult.count
            });
          }
        }
      }

      // 5. 违规预警：如果是差评模式，在当前页面直接爬取
      if (mode === 'bad') {
        const helper = new AutoHelper(tab.view.webContents);
        let reviewFrame = helper.findFrame('rating-management') || helper.findFrame('shop-comment');
        if (reviewFrame) {
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
                    desc: resultEl ? resultEl.textContent.trim().replace(/\\s+/g, ' ') : '',
                    link: linkEl ? linkEl.href : ''
                  });
                }
                return results;
              })()
            `);
            if (violations && violations.length > 0) {
              for (const v of violations) {
                if (v.title || v.desc) {
                  violationAlerts.push({ shop: `${displayName}`, ...v });
                }
              }
            }
          } catch (e) {
            console.log(`[${taskName}] 提取违规预警异常:`, e.message);
          }
        }
      }

      totalShopRuns++;
      await sleep(1000); // 门店之间加 1s 延迟防频率风控
    }

    // 6. 任务结束处理与通知推送
    if (mode === 'bad') {
      const hasViolations = violationAlerts.length > 0;
      if (totalBadReviews > 0 || hasViolations) {
        mainWindow.webContents.send('bad-review-found', {
          tabId: tab.id,
          totalCount: totalBadReviews,
          details: badReviewDetails,
          violations: violationAlerts
        });

        if (Notification.isSupported()) {
          const notifParts = [];
          if (totalBadReviews > 0) notifParts.push(`${totalBadReviews} 条未回复差评`);
          if (hasViolations) notifParts.push(`${violationAlerts.length} 条违规预警`);
          new Notification({
            title: hasViolations && totalBadReviews === 0 ? '违规预警' : '差评/违规提醒',
            body: `发现 ${notifParts.join('、')}，请及时处理！`
          }).show();
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
        mainWindow.webContents.send('bad-review-cleared', { tabId: tab.id });
      }

      const msgParts = [];
      if (totalBadReviews > 0) msgParts.push(`${totalBadReviews} 条差评`);
      if (hasViolations) msgParts.push(`${violationAlerts.length} 条违规预警`);

      mainWindow.webContents.send('task-progress-update', {
        tabId: tab.id,
        mode,
        text: totalBadReviews > 0 || hasViolations
          ? `🔴 差评:${totalBadReviews}条${hasViolations ? ` 违规:${violationAlerts.length}条` : ''}`
          : `✅ 无异常`
      });

      return {
        message: msgParts.length > 0
          ? `发现 ${msgParts.join('、')}！`
          : `已检查 ${totalShopRuns} 个门店实例，暂无异常`,
        totalBadReviews: totalBadReviews,
        details: badReviewDetails,
        violations: violationAlerts,
        totalShopRuns: totalShopRuns
      };
    } else {
        mainWindow.webContents.send('task-progress-update', {
          tabId: tab.id,
          mode,
          text: `✅ 回复完成 (已回:${totalGoodReplies}条)`
        });

        return {
           message: `已检查 ${totalShopRuns} 个门店实例，自动回复完成，共回复 ${totalGoodReplies} 条好评`,
           count: totalGoodReplies,
           details: goodReplyDetails,
           totalShopRuns: totalShopRuns
        };
    }

  } catch (e) {
    console.log(`[${taskName}] 执行失败:`, e.message);
    mainWindow.webContents.send('task-progress-update', {
      tabId: tab.id,
      mode,
      text: `❌ 执行失败`
    });
    return { message: '执行失败: ' + e.message };
  }
}

// 差评监控
ipcMain.handle('run-bad-review-monitor', async (event, payload) => {
  const tabId = typeof payload === 'string' ? payload : payload?.tabId;
  const runId = payload?.runId;
  return await executeReviewTask(tabs.get(tabId), 'bad', runId);
});

// 好评自动回复
ipcMain.handle('run-good-review-reply', async (event, payload) => {
  const tabId = typeof payload === 'string' ? payload : payload?.tabId;
  const runId = payload?.runId;
  return await executeReviewTask(tabs.get(tabId), 'good', runId);
});

// 数据分析并写入腾讯智能表格的任务
async function executeDataAnalysis(tab) {
  if (!tab) {
    return { success: false, message: '未找到可用标签页，请打开点评商户后台' };
  }

  const shops = shopService.getAll();
  if (shops.length === 0) {
    return { success: false, message: '请先在设置中添加门店' };
  }

  // 1. 获取点评后台的所有门店列表以进行匹配
  let apiShopList = [];
  try {
    apiShopList = await tab.view.webContents.executeJavaScript(`
      (async function() {
        try {
          const res = await fetch('/gateway/merchant/general/shopinfo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bizType: "review_manage_checkbox",
              device: "pc",
              currentTab: "city",
              shopIds: "0"
            })
          });
          const data = await res.json();
          if (data && data.code === 200 && data.data) {
            return data.data.shopInfoList || [];
          }
        } catch (e) {
          console.error('[数据分析] 获取门店列表异常:', e.message);
        }
        return [];
      })()
    `);
  } catch (e) {
    console.error('[数据分析] executeJavaScript 获取门店列表失败:', e.message);
    return { success: false, message: '无法获取商户门店列表，请确保已登录' };
  }

  if (!apiShopList || apiShopList.length === 0) {
    return { success: false, message: '获取点评商户门店列表为空，请先登录' };
  }

  // 辅助匹配函数
  function normalizeShopName(name) {
    if (!name) return '';
    return name.replace(/[\s\(\)（）]/g, '').toLowerCase();
  }
  function isShopMatched(cfgName, apiShop) {
    const shopName = apiShop.shopName || '';
    const branchName = apiShop.branchName || '';
    const combined = branchName ? `${shopName}（${branchName}）` : shopName;
    const normCfg = normalizeShopName(cfgName);
    const normCombined = normalizeShopName(combined);
    return normCfg === normCombined || normCombined.includes(normCfg) || normCfg.includes(normCombined);
  }

  // 匹配门店
  const matchedShops = [];
  for (const cfgShop of shops) {
    const matchedApiShop = apiShopList.find(apiShop => isShopMatched(cfgShop.name, apiShop));
    if (matchedApiShop) {
      matchedShops.push({ cfg: cfgShop, api: matchedApiShop });
    }
  }

  if (matchedShops.length === 0) {
    return { success: false, message: '未匹配到任何点评后台门店，请检查门店名称设置' };
  }

  // 获取多维表格 Webhook 配置及列 ID 映射
  const tencentWebhook = settingService.get('tencent_webhook');
  const fieldIdDate = settingService.get('tencent_field_date') || 'f04Gwj';
  const fieldIdShop = settingService.get('tencent_field_shop') || 'f85uZN';
  const fieldIdPlatform = settingService.get('tencent_field_platform') || 'fPbfxp';
  const fieldIdExposure = settingService.get('tencent_field_exposure') || 'ftQMc5';
  const fieldIdVisits = settingService.get('tencent_field_visits') || 'fRUP1E';
  const fieldIdOrders = settingService.get('tencent_field_orders') || 'fBCtjw';
  const fieldIdOrderAmount = settingService.get('tencent_field_order_amount') || 'f1VE8Q';
  const fieldIdOrderCoupons = settingService.get('tencent_field_order_coupons') || 'fKBAl5';
  const fieldIdVerifyAmount = settingService.get('tencent_field_verify_amount') || 'fJBh3Y';
  const fieldIdVerifyCoupons = settingService.get('tencent_field_verify_coupons') || 'fGL8gW';
  const fieldIdStar = settingService.get('tencent_field_star') || 'ftk5Tx';
  const fieldIdNewReviews = settingService.get('tencent_field_new_reviews') || 'fw252u';
  const fieldIdNewBadReviews = settingService.get('tencent_field_new_bad_reviews') || 'fXQZGl';
  const fieldIdBadReplyRate = settingService.get('tencent_field_bad_reply_rate') || 'f3Wvet';

  // 计算昨天日期 (格式为 YYYY-MM-DD)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, '0');
  const day = String(yesterday.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  const dateParam = `${dateStr},${dateStr}`;
  
  // 以昨天开始时分秒为基准，转换为毫秒时间戳字符串，用于多维表格日期类型写入
  const yesterdayStart = new Date(yesterday.setHours(0, 0, 0, 0));
  const dateTimestampStr = String(yesterdayStart.getTime());

  let successCount = 0;
  let detailMessages = [];
  let errorMessages = [];

  for (const item of matchedShops) {
    const shopId = item.api.shopId;
    const displayName = `${item.api.shopName}${item.api.branchName ? '(' + item.api.branchName + ')' : ''}`;

    for (const platformVal of [1, 2]) {
      const platformName = platformVal === 1 ? '点评' : '美团';
      
      // 延迟 2s 防频控
      await new Promise(r => setTimeout(r, 2000));

      mainWindow.webContents.send('task-progress-update', { tabId: tab.id, mode: 'analysis', text: `📡 [${item.api.shopName}] 拉取${platformName}昨日经营数据...` });
      console.log(`[数据分析] 正在拉取门店 [${displayName}] 平台: ${platformName} (shopId: ${shopId})`);

      const requestBody = `source=1&device=pc&date=${encodeURIComponent(dateParam)}&platform=${platformVal}&pageType=v5Home&optionType=v5Home&shopIds=${shopId}`;

      let mdaData = null;
      try {
        mdaData = await tab.view.webContents.executeJavaScript(`
          (async function() {
            try {
              const res = await fetch('/mda/v5/overview', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: '${requestBody}'
              });
              const json = await res.json();
              if (json && json.success) {
                return json.data;
              }
            } catch (e) {
              console.error('[数据分析 API] 错误:', e.message);
            }
            return null;
          })()
        `);
      } catch (e) {
        console.error(`[数据分析] 调用 ${displayName} (${platformName}) overview 接口失败:`, e.message);
      }

      if (!mdaData) {
        console.log(`[数据分析] [${displayName}] [${platformName}] 接口返回空数据或调用失败，跳过`);
        continue;
      }

      // 解析各项组件指标
      let exposure = 0;
      let visits = 0;
      let orders = 0;
      let verifyUv = 0;
      let orderCoupons = 0;
      let orderAmount = 0;
      let verifyAmount = 0;
      let verifyCoupons = 0;
      let star = 0;
      let newReviews = 0;
      let newBadReviews = 0;
      let badReplyRate = 0;

      for (const component of mdaData) {
        const body = component.body;
        if (!body) continue;

        // 1. 客流分析 (trafficSummaryLineTrade)
        if (component.componentId === 'trafficSummaryLineTrade' && Array.isArray(body)) {
          for (const it of body) {
            const val = parseFloat(String(it.value).replace(/,/g, '')) || 0;
            if (it.variable === 'view_uv') exposure = val;
            if (it.variable === 'shop_uv') visits = val;
            if (it.variable === 'buy_uv') orders = val;
            if (it.variable === 'csm_uv') verifyUv = val;
          }
        }

        // 2. 下单分析 (salesTabGraph)
        if (component.componentId === 'salesTabGraph' && Array.isArray(body)) {
          for (const it of body) {
            const val = parseFloat(String(it.value).replace(/,/g, '')) || 0;
            if (it.variable === 'ind_buy_cnt') orderCoupons = val;
            if (it.variable === 'ind_buy_amt') orderAmount = val;
          }
        }

        // 3. 核销分析 (tradeTabGraph)
        if (component.componentId === 'tradeTabGraph' && Array.isArray(body)) {
          for (const it of body) {
            const val = parseFloat(String(it.value).replace(/,/g, '')) || 0;
            if (it.variable === 'csm_amt') verifyAmount = val;
            if (it.variable === 'csm_cnt') verifyCoupons = val;
          }
        }

        // 4. 评价分析 (reviewSummaryPC)
        if (component.componentId === 'reviewSummaryPC' && Array.isArray(body)) {
          for (const it of body) {
            const valStr = String(it.value);
            let val = 0;
            if (valStr.includes('%')) {
              val = parseFloat(valStr) / 100;
            } else {
              val = parseFloat(valStr.replace(/,/g, '')) || 0;
            }
            
            if (it.variable === 'review_new_cnt') newReviews = val;
            if (it.variable === 'bad_review_new_cnt') newBadReviews = val;
            if (it.variable === 'bad_review_reply_rate') {
              if (valStr === '--') {
                badReplyRate = 0;
              } else {
                badReplyRate = val;
              }
            }
          }
        }

        // 5. 星级分析 (starSummaryPC)
        if (component.componentId === 'starSummaryPC' && Array.isArray(body)) {
          for (const it of body) {
            const val = parseFloat(String(it.value).replace(/[^\d.]/g, '')) || 0;
            star = val;
          }
        }
      }

      // 组装多维表格 values
      const values = {};
      if (fieldIdDate) values[fieldIdDate] = dateTimestampStr;
      if (fieldIdShop) values[fieldIdShop] = [{ "text": displayName }];
      if (fieldIdPlatform) values[fieldIdPlatform] = [{ "text": platformName }];
      if (fieldIdExposure) values[fieldIdExposure] = exposure;
      if (fieldIdVisits) values[fieldIdVisits] = visits;
      if (fieldIdOrders) values[fieldIdOrders] = orders;
      if (fieldIdOrderAmount) values[fieldIdOrderAmount] = orderAmount;
      if (fieldIdOrderCoupons) values[fieldIdOrderCoupons] = orderCoupons;
      if (fieldIdVerifyAmount) values[fieldIdVerifyAmount] = verifyAmount;
      if (fieldIdVerifyCoupons) values[fieldIdVerifyCoupons] = verifyCoupons;
      if (fieldIdStar) values[fieldIdStar] = star;
      if (fieldIdNewReviews) values[fieldIdNewReviews] = newReviews;
      if (fieldIdNewBadReviews) values[fieldIdNewBadReviews] = newBadReviews;
      if (fieldIdBadReplyRate) values[fieldIdBadReplyRate] = badReplyRate;

      const payloadBody = {
        "add_records": [
          {
            "values": values
          }
        ]
      };

      console.log(`[数据分析] 准备上报多维表格数据 (${platformName}):`, JSON.stringify(payloadBody));

      if (tencentWebhook) {
        try {
          const sendWebhookPromise = new Promise((resolve, reject) => {
            const { net } = require('electron');
            const request = net.request({
              method: 'POST',
              url: tencentWebhook,
              headers: {
                'Content-Type': 'application/json; charset=utf-8'
              }
            });
            
            request.on('response', (response) => {
              let chunks = [];
              response.on('data', (chunk) => {
                chunks.push(chunk);
              });
              response.on('end', () => {
                const bodyStr = Buffer.concat(chunks).toString('utf-8');
                try {
                  const resData = JSON.parse(bodyStr);
                  if (resData.errcode === 0) {
                    resolve(resData);
                  } else {
                    reject(new Error(`企微错误: ${resData.errmsg} (code: ${resData.errcode})`));
                  }
                } catch (e) {
                  reject(new Error(`解析响应 JSON 失败: ${bodyStr}`));
                }
              });
            });
            
            request.on('error', (err) => {
              reject(err);
            });
            
            request.write(JSON.stringify(payloadBody));
            request.end();
          });
          
          await sendWebhookPromise;
          successCount++;
          console.log(`[数据分析] [${displayName}] [${platformName}] 腾讯多维表格数据写入成功`);
        } catch (webhookErr) {
          console.error(`[数据分析] [${displayName}] [${platformName}] 腾讯 Webhook 发送失败:`, webhookErr.message);
          errorMessages.push(`[${displayName} - ${platformName}] 同步失败: ${webhookErr.message}`);
        }
      } else {
        successCount++;
      }
    }
    detailMessages.push(displayName);
  }

  let finalMsg = `已成功抓取并分析 ${matchedShops.length} 个门店昨日的经营客流与评价数据`;
  if (tencentWebhook) {
    if (errorMessages.length > 0) {
      finalMsg += `，部分同步失败，错误: ${errorMessages.join('; ')}`;
    } else {
      finalMsg += `，并自动同步至腾讯智能多维表格。`;
    }
  } else {
    finalMsg += `，但未配置腾讯智能表格 Webhook，已在主进程日志打印数据详情。`;
  }

  return {
    success: errorMessages.length === 0,
    message: finalMsg
  };
}

// 数据分析任务
ipcMain.handle('run-data-analysis', async () => {
  const activeTab = [...tabs.values()].find(t => t.active) || [...tabs.values()][0];
  return await executeDataAnalysis(activeTab);
});

