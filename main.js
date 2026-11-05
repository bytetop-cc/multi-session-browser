const { app } = require('electron')
const path = require('path')

// 强制指定 userData 目录为 multi-session-browser，确保数据库和 Session 数据不会因为重命名而发生变化
app.setPath('userData', path.join(app.getPath('appData'), 'multi-session-browser'))

const { BrowserWindow, BrowserView, ipcMain, session, Notification } = require('electron')
const { initDatabase, shopService, templateService, settingService, metricService, db } = require('./db')
const { AutoHelper } = require('./auto-helper')
const { readReviewFilterDebug } = require('./iframe-bridge')

let mainWindow = null
let settingsWindow = null
let dashboardWindow = null
let tabCounter = 0
const tabs = new Map() // tabId -> { view, partition }
const {createTaskErrorReporter}=require('./task-error-notice');
const reportTaskError=createTaskErrorReporter({send:notice=>{
  for(const window of [mainWindow,dashboardWindow]){
    if(window&&!window.isDestroyed())window.webContents.send('task-api-error',notice);
  }
}});

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

  tabs.set(tabId, { id: tabId, view, partition, active: true })

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
  require('./analysis-main').registerAnalysis({ app, db, ipcMain, BrowserWindow, safeStorage: require('electron').safeStorage, metricService })
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

// ========== 数据备份与恢复 ==========

const fs = require('fs')
const { dialog } = require('electron')

ipcMain.handle('export-database', async (event) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出数据',
      defaultPath: `meituan-helper-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'Database', extensions: ['db'] }]
    })

    if (canceled || !filePath) {
      return { canceled: true }
    }

    // 执行一次 checkpoint 确保内存/WAL的数据写回到主文件
    db.pragma('wal_checkpoint(TRUNCATE)')

    // 拷贝文件
    const sourcePath = path.join(app.getPath('userData'), 'app-data.db')
    fs.copyFileSync(sourcePath, filePath)

    return { success: true, path: filePath }
  } catch (error) {
    console.error('Export DB Error:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('import-database', async (event) => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '导入数据',
      properties: ['openFile'],
      filters: [{ name: 'Database', extensions: ['db'] }]
    })

    if (canceled || filePaths.length === 0) {
      return { canceled: true }
    }

    const sourcePath = filePaths[0]
    const targetPath = path.join(app.getPath('userData'), 'app-data.db')

    // 导入需要替换现有数据库
    // 最好关闭当前数据库连接，拷贝文件，然后重启应用
    db.close()

    // 删除旧的 wal 和 shm 文件以防冲突
    const walPath = targetPath + '-wal'
    const shmPath = targetPath + '-shm'
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)

    // 拷贝新的数据库文件
    fs.copyFileSync(sourcePath, targetPath)

    // 告诉前端成功了，并在稍微延迟后重启
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 1000)

    return { success: true }
  } catch (error) {
    console.error('Import DB Error:', error)
    return { success: false, error: error.message }
  }
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
  let currentEndpoint='/gateway/merchant/general/shopinfo';
  const taskErrors=[];
  function reportError(endpoint,message){taskErrors.push(message);reportTaskError(tab,{task:taskName,endpoint,message})}
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
      reportError(currentEndpoint,'无法获取商户门店列表，请确认登录状态');
      return { hasErrors:true, message: '无法获取点评商户门店列表，请确保已登录' };
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

        currentEndpoint='/gateway/merchant/review/list';
        const reviewData = await tab.view.webContents.executeJavaScript(`
          (async function() {
            // mode === 'bad' 时拉取 4 星以下：差评 tagId: 3 (1-2星) + 中评 tagId: 2 (3星)
            // mode === 'good' 时拉取好评 tagId: 1 (4-5星)
            const tagIds = ${mode === 'bad' ? '[3, 2]' : '[1]'};
            let allDetails = [];
            const errors = [];
            let totalSize = 0;
            const seenIds = new Set();
            for (const tId of tagIds) {
              try {
                const res = await fetch('/gateway/merchant/review/list', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    platform: ${platformVal},
                    shopIds: [${shopId}],
                    tagId: tId,
                    startTime: ${startTime},
                    endTime: ${endTime},
                    aiReply: false,
                    pageNo: 1,
                    pageSize: 10
                  })
                });
                const data = await res.json();
                if (data && data.code === 200 && data.data) {
                  totalSize += data.data.totalSize || 0;
                  const list = data.data.reviewDetails || [];
                  for (const item of list) {
                    const rId = item.reviewDetail && item.reviewDetail.reviewInfo && item.reviewDetail.reviewInfo.reviewId;
                    if (rId) {
                      if (!seenIds.has(rId)) {
                        seenIds.add(rId);
                        allDetails.push(item);
                      }
                    } else {
                      allDetails.push(item);
                    }
                  }
                } else {
                  errors.push('HTTP '+res.status+'，'+(data?.msg||data?.message||('业务码 '+data?.code)));
                }
              } catch (e) {
                errors.push(e.message);
                console.error('[API] 拉取评价异常:', e.message);
              }
              if (tagIds.length > 1) {
                await new Promise(r => setTimeout(r, 600));
              }
            }
            return { totalSize, reviewDetails: allDetails, errors };
          })()
        `);

        for(const error of reviewData?.errors||[])reportError(currentEndpoint,`[${displayName} · ${platformName}] ${error}`);

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

          if (mode === 'bad' && starLevel < 4 && !isReplied) {
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
          // 发送前保存最后使用的文案，后续任务和两平台共用当前门店的记录。
          const replyContents = templateService.reserveReplies(
            item.cfg.id,
            shopNeedReplyGoodReviews.filter(d => d.reviewDetail?.reviewInfo?.reviewId).length
          );
          const templatesBase64 = Buffer.from(JSON.stringify(replyContents)).toString('base64');

          currentEndpoint='/review/app/reply/ajax/reviewreply';
          const replyResult = await tab.view.webContents.executeJavaScript(`
            (async function() {
              const decodeUtf8Base64 = str => decodeURIComponent(escape(atob(str)));
              const replies = JSON.parse(decodeUtf8Base64("${repliesBase64}"));
              const templates = JSON.parse(decodeUtf8Base64("${templatesBase64}"));
              let successCount = 0;
              let debugLogs = [];
              
              let templateIdx = 0;
              function getNextTemplate() {
                return templates[templateIdx++];
              }
              
              const sleep = ms => new Promise(r => setTimeout(r, ms));
              
              for (const detail of replies) {
                const reviewInfo = detail.reviewDetail && detail.reviewDetail.reviewInfo;
                const reviewId = reviewInfo ? reviewInfo.reviewId : null;
                if (!reviewId) continue;
                
                const content = getNextTemplate();
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
                  if (res.ok && data && (data.code === 200 || data.success === true)) {
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

          if(replyResult?.error)reportError(currentEndpoint,`[${displayName} · ${platformName}] ${replyResult.error}`);
          const failedReplies=(replyResult?.debugLogs||[]).filter(log=>!log.success);
          if(failedReplies.length){
            const failure=failedReplies[0];let reason=failure.error;
            if(!reason){try{const data=JSON.parse(failure.text);reason=data.msg||data.message||('业务码 '+data.code)}catch(_){reason='响应不是有效 JSON'}}
            reportError(currentEndpoint,`[${displayName} · ${platformName}] ${failedReplies.length} 条回复失败，HTTP ${failure.status??'未知'}，${reason}`);
          }
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
      totalShopRuns++;
      await sleep(1000); // 门店之间加 1s 延迟防频率风控
    }

    // 6. 任务结束处理与通知推送
    if (mode === 'bad') {
      if (totalBadReviews > 0) {
        mainWindow.webContents.send('bad-review-found', {
          tabId: tab.id,
          totalCount: totalBadReviews,
          details: badReviewDetails
        });

        if (Notification.isSupported()) {
          new Notification({
            title: '差评提醒',
            body: `发现 ${totalBadReviews} 条未回复差评，请及时处理！`
          }).show();
        }

        // 企微机器人推送
        try {
          const webhookUrl = settingService.get('wecom_webhook');
          if (webhookUrl) {
            const { net } = require('electron');
            let content = `⚠️ 发现未回复差评！\n`;
            content += `\n未回复差评：${totalBadReviews} 条`;
            content += `\n\n详情:`;
            badReviewDetails.forEach(d => {
              content += `\n- ${d.shop}: ${d.count} 条`;
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
      } else if(taskErrors.length===0) {
        mainWindow.webContents.send('bad-review-cleared', { tabId: tab.id });
      }

      mainWindow.webContents.send('task-progress-update', {
        tabId: tab.id,
        mode,
        text: totalBadReviews > 0
          ? `🔴 差评:${totalBadReviews}条`
          : `✅ 无异常`
      });

      return {
        message: totalBadReviews > 0
          ? `发现 ${totalBadReviews} 条差评！`
          : `已检查 ${totalShopRuns} 个门店实例，暂无异常`,
        totalBadReviews: totalBadReviews,
        details: badReviewDetails,
        totalShopRuns: totalShopRuns
      };
    } else {
      mainWindow.webContents.send('task-progress-update', {
        tabId: tab.id,
        mode,
        text: `✅ 回复完成 (已回:${totalGoodReplies}条)`
      });

      return {
        hasErrors:taskErrors.length>0,
        message: `已检查 ${totalShopRuns} 个门店实例，共回复 ${totalGoodReplies} 条好评${taskErrors.length?'，部分接口报错，请查看标签页红点提示':''}`,
        count: totalGoodReplies,
        details: goodReplyDetails,
        totalShopRuns: totalShopRuns
      };
    }

  } catch (e) {
    reportError(currentEndpoint,e.message);
    console.log(`[${taskName}] 执行失败:`, e.message);
    mainWindow.webContents.send('task-progress-update', {
      tabId: tab.id,
      mode,
      text: `❌ 执行失败`
    });
    return { hasErrors:true, message: '执行失败: ' + e.message };
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

// 数据分析并写入本地 SQLite 数据库的任务
let isRangeSyncing = false;
let isSingleSyncing = false;
let abortRangeSync = false;

async function executeDataAnalysis(tab, customDateStr = null) {

  if (!tab) {
    return { success: false, message: '未找到可用标签页，请打开点评商户后台' };
  }

  if (abortRangeSync) {
    return { success: false, message: '同步任务已被中止' };
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
            method: 'POST', signal: AbortSignal.timeout(15000),
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

  // 确定目标统计日期 (格式为 YYYY-MM-DD，默认为昨天)
  let dateStr = customDateStr;
  if (!dateStr) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, '0');
    const day = String(yesterday.getDate()).padStart(2, '0');
    dateStr = `${year}-${month}-${day}`;
  }
  const dateParam = `${dateStr},${dateStr}`;

  let successCount = 0;
  let skippedCount = 0;
  let errorMessages = [];
  function addSyncError(message,endpoint){
    errorMessages.push(message);
    reportTaskError(tab,{task:'同步数据',endpoint,message,date:dateStr});
  }

  for (const item of matchedShops) {
    if (abortRangeSync) {
      console.log('[数据分析] 收到中止指令，停止当前拉取');
      break;
    }
    const shopId = item.api.shopId;
    const displayName = `${item.api.shopName}${item.api.branchName ? '(' + item.api.branchName + ')' : ''}`;

    // 预订订单状态按当日下单时间筛选，保存各状态当前快照。
    for (const [orderType, statusName] of [[0, '全部'], [3, '已消费'], [5, '已退款'], [1, '待消费']]) {
      if (abortRangeSync) break;
      try {
        const startTime = new Date(dateStr + 'T00:00:00+08:00').getTime();
        const query = new URLSearchParams({ shopid: String(shopId), shopidstr: String(shopId),
          bizname: 'commonbook', searchstring: '', orderstarttime: String(startTime),
          orderendtime: String(startTime + 86400000 - 1000), currordertype: String(orderType),
          limit: '10', start: '0', yodaReady: 'h5', csecplatform: '4', csecversion: '4.3.0' });
        const total = await tab.view.webContents.executeJavaScript(`
          (async () => {
            try {
              const response = await fetch(${JSON.stringify('/trade/order/orderlist.api?' + query.toString())}, {
                credentials: 'include', signal: AbortSignal.timeout(15000)
              });
              if (!response.ok) return null;
              const json = await response.json();
              return Number.isSafeInteger(json?.recordCount) && json.recordCount >= 0 ? json.recordCount : null;
            } catch (_) { return null; }
          })()
        `);
        if (total !== null) metricService.saveBookingTotal({ shopId, date: dateStr, orderType, total });
        else addSyncError(`[${displayName}] 预订${statusName}未获取，保留已有统计`, '/trade/order/orderlist.api');
      } catch (error) {
        addSyncError(`[${displayName}] 预订${statusName}同步失败，已跳过: ${error.message}`, '/trade/order/orderlist.api');
      }
    }

    // 优惠码只保存每日指标 amount，不保存环比或 pastValues。
    try {
      const startTime = new Date(dateStr + 'T00:00:00+08:00').getTime();
      const endTime = startTime + 24 * 60 * 60 * 1000;
      const promoValues = await tab.view.webContents.executeJavaScript(`
        (async () => {
          try {
            const response = await fetch('/gateway/qrcode/b/promocode/queryPromoCodeKPIsV2?yodaReady=h5&csecplatform=4&csecversion=4.3.0', {
              method: 'POST', credentials: 'include', signal: AbortSignal.timeout(15000),
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(${JSON.stringify({ codeType: 0, startTime, endTime, dpShopId: shopId })})
            });
            if (!response.ok) return null;
            const json = await response.json();
            if (json.code !== 200 || !Array.isArray(json.data?.promoDateOverview)) return null;
            const values = {};
            for (const group of json.data.promoDateOverview) {
              if (!Array.isArray(group?.modelDateOverview)) continue;
              for (const item of group.modelDateOverview) {
                if (item && [1, 2, 3, 7, 8, 9].includes(item.code) &&
                    item.amount !== null && item.amount !== '' && Number.isFinite(Number(item.amount))) {
                  values[item.code] = Number(item.amount);
                }
              }
            }
            return Object.keys(values).length ? values : null;
          } catch (_) { return null; }
        })()
      `);
      if (promoValues) metricService.savePromoMetrics({ shopId, shopName: displayName, date: dateStr, values: promoValues });
      else addSyncError(`[${displayName}] 优惠码数据未获取，保留已有记录`, '/gateway/qrcode/b/promocode/queryPromoCodeKPIsV2');
    } catch (error) {
      addSyncError(`[${displayName}] 优惠码同步失败，已跳过: ${error.message}`, '/gateway/qrcode/b/promocode/queryPromoCodeKPIsV2');
    }

    // 话单按门店统计一次，与经营数据平台无关；仅从页面返回总数。
    try {
      const callTotal = await tab.view.webContents.executeJavaScript(`
        (async () => {
          try {
            const response = await fetch('/api/dzphone/vn/merchant/pc/querycallrecordlist?yodaReady=h5&csecplatform=4&csecversion=4.3.0', {
              method: 'POST', signal: AbortSignal.timeout(15000), credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(${JSON.stringify({ shopId, pageNo: 1, pageSize: 20,
                virtualNum: null, aNum: null, beginTime: dateStr + ' 00:00:00', endTime: dateStr + ' 23:59:59' })})
            });
            if (!response.ok) return null;
            const json = await response.json();
            const total = json?.content?.totalCount;
            return json.success === true && json.code === 200 && Number.isSafeInteger(total) && total >= 0 ? total : null;
          } catch (_) { return null; }
        })()
      `);
      if (callTotal !== null) {
        metricService.saveCallTotal({ shopId, shopName: displayName, date: dateStr, total: callTotal });
      } else {
        addSyncError(`[${displayName}] 虚拟号话单未获取，已有统计保留`, '/api/dzphone/vn/merchant/pc/querycallrecordlist');
      }
    } catch (error) {
      addSyncError(`[${displayName}] 虚拟号话单同步失败: ${error.message}`, '/api/dzphone/vn/merchant/pc/querycallrecordlist');
    }

    for (const platformVal of [1, 2]) {
      if (abortRangeSync) break;
      const platformName = platformVal === 1 ? '点评' : '美团';
      try {

      // 退款单独采集，overview 无数据也不影响退款统计。
      try {
        const tradeBody = new URLSearchParams({ source: '1', device: 'pc', date: dateParam,
          platform: String(platformVal), pageType: 'v5Trade', optionType: 'v5Trade',
          shopIds: String(shopId), excludeShopIds: '', cityId: '',
          prdIds: '1,2,3,4,5,6,11,12,13,14,15,16,17,18,19,20',
          spuId: '', pageNum: '', pageSize: '', sign: '', fromPage: '', timeStamp: String(Date.now()) }).toString();
        const refund = await tab.view.webContents.executeJavaScript(`
          (async () => {
            try {
              const response = await fetch('/mda/v5/trade?yodaReady=h5&csecplatform=4&csecversion=4.3.0', {
                method: 'POST', credentials: 'include', signal: AbortSignal.timeout(15000),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: ${JSON.stringify(tradeBody)}
              });
              if (!response.ok) return null;
              const json = await response.json();
              if (!json.success || !Array.isArray(json.data)) return null;
              const items = json.data.find(c => c?.componentId === 'tradeOptionSummaryPC')?.body;
              if (!Array.isArray(items)) return null;
              const read = name => {
                const raw = items.find(it => it?.name === name)?.value;
                if (raw == null || String(raw).trim() === '' || String(raw).trim() === '--') return null;
                const text = String(raw).replace(/[￥¥,元张\\s]/g, '');
                if (!text) return null;
                const num = Number(text);
                return Number.isFinite(num) && num >= 0 ? num : null;
              };
              const coupons = read('退款券数'), amount = read('退款金额（原价）');
              return coupons === null && amount === null ? null : { coupons, amount };
            } catch (_) { return null; }
          })()
        `);
        if (refund) metricService.saveRefundMetrics({ shopId, platform: platformName, date: dateStr, ...refund });
        else addSyncError(`[${displayName} - ${platformName}] 退款数据未获取，保留已有记录`, '/mda/v5/trade');
      } catch (error) {
        addSyncError(`[${displayName} - ${platformName}] 退款同步失败，已跳过: ${error.message}`, '/mda/v5/trade');
      }

      // 延迟 2s 防频控
      await new Promise(r => setTimeout(r, 2000));

      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task-progress-update', { tabId: tab.id, mode: 'analysis', text: `📡 [${item.api.shopName}] 拉取${platformName} (${dateStr}) 经营数据...` });
      console.log(`[数据分析] 正在拉取门店 [${displayName}] 平台: ${platformName} 日期: ${dateStr} (shopId: ${shopId})`);

      const requestBody = `source=1&device=pc&date=${encodeURIComponent(dateParam)}&platform=${platformVal}&pageType=v5Home&optionType=v5Home&shopIds=${shopId}`;

      let mdaData = null;
      let overviewResponse = null;
      try {
        overviewResponse = await tab.view.webContents.executeJavaScript(`
          (async function() {
            try {
              const res = await fetch('/mda/v5/overview', {
                method: 'POST', signal: AbortSignal.timeout(15000),
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: '${requestBody}'
              });
              if (!res.ok) return null;
              const json = await res.json();
              if (json && json.success) {
                return json;
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

      if (overviewResponse) {
        try {
          metricService.saveDetails({ shopId, shopName: displayName, platform: platformName,
            date: dateStr, requestBody, response: overviewResponse });
        } catch (error) {
          addSyncError(`[${displayName} - ${platformName}] 明细保存失败: ${error.message}`, '/mda/v5/overview');
          continue;
        }
        mdaData = overviewResponse.data;
      }

      if (!Array.isArray(mdaData) || !mdaData.some(component =>
        component && ['trafficSummaryLineTrade', 'salesTabGraph', 'tradeTabGraph', 'reviewSummaryPC', 'starSummaryPC'].includes(component.componentId) &&
        Array.isArray(component.body) && component.body.some(it => it && it.value != null && String(it.value).trim() !== '' && Number.isFinite(parseFloat(String(it.value).replace(/,/g, ''))))
      )) {
        skippedCount++;
        addSyncError(`[${displayName} · ${platformName}] 经营数据请求失败或响应没有有效指标，已保留已有记录`, '/mda/v5/overview');
        console.log(`[数据分析] [${displayName}] [${platformName}] (${dateStr}) 无可用经营数据或接口调用失败，跳过并保留已有记录`);
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
        if (!component) continue;
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

      // 保存到本地 SQLite 数据库
      try {
        metricService.upsert({
          shop_id: String(shopId),
          shop_name: displayName,
          platform: platformName,
          stat_date: dateStr,
          exposure,
          visits,
          orders,
          order_amount: orderAmount,
          order_coupons: orderCoupons,
          verify_uv: verifyUv,
          verify_amount: verifyAmount,
          verify_coupons: verifyCoupons,
          star,
          new_reviews: newReviews,
          new_bad_reviews: newBadReviews,
          bad_reply_rate: badReplyRate
        });
        successCount++;
        console.log(`[数据分析] [${displayName}] [${platformName}] (${dateStr}) 经营数据已成功保存至本地数据库`);
      } catch (dbErr) {
        console.error(`[数据分析] [${displayName}] [${platformName}] 本地数据库保存失败:`, dbErr.message);
        addSyncError(`[${displayName} - ${platformName}] 本地保存失败: ${dbErr.message}`, '/mda/v5/overview');
      }
      } catch (error) {
        addSyncError(`[${displayName} - ${platformName}] 处理失败，已跳过: ${error.message}`, '/mda/v5/overview');
        console.error('[数据分析] 单个平台处理失败，继续后续任务:', error.message);
      }
    }
  }

  let finalMsg = `已将 ${successCount} 条门店平台经营数据（${dateStr}）保存至本地 SQLite 数据库`;
  if (skippedCount > 0) finalMsg += `，已跳过 ${skippedCount} 条无数据或接口异常的门店平台记录`;
  if (abortRangeSync) {
    finalMsg += '（同步已中止）';
  }
  if (errorMessages.length > 0) {
    finalMsg += `（部分数据未保存: ${errorMessages.join('; ')}）`;
  }

  return {
    success: !abortRangeSync && errorMessages.length === 0,
    skippedCount,
    errorsReported:errorMessages.length>0,
    savedCount:successCount,
    message: finalMsg,
    date: dateStr
  };
}
// 同步开始时固定标签页集合，各标签页并行，单个失败不影响其他标签页。
async function executeAllTabsDataAnalysis(syncTabs, date) {
  const results = await Promise.all(syncTabs.map(async (tab, index) => {
    try {
      const result=await executeDataAnalysis(tab,date);
      if(!result.success&&!result.errorsReported&&!abortRangeSync)reportTaskError(tab,{task:'同步数据',endpoint:result.endpoint||'/gateway/merchant/general/shopinfo',message:result.message,date});
      return {...result,tab:index+1,tabId:tab.id};
    } catch (error) {
      reportTaskError(tab,{task:'同步数据',endpoint:'同步任务执行',message:error.message,date});
      return {success:false,tab:index+1,tabId:tab.id,message:error.message};
    }
  }));
  return {
    success: results.every(result => result.success),
    date,
    skippedCount: results.reduce((sum, result) => sum + (result.skippedCount || 0), 0),
    results,
    savedCount:results.reduce((sum,result)=>sum+(result.savedCount||0),0),
    message: results.map(result => `[Tab ${result.tab}] ${result.message}`).join('\n')
  };
}

// 数据分析任务（支持传入指定日期）
ipcMain.handle('run-data-analysis', async (event, customDateStr = null) => {
  if (isSingleSyncing || isRangeSyncing) {
    return { success: false, message: '已有同步任务正在进行中，请稍候' };
  }
  const syncTabs = [...tabs.values()];
  if (!syncTabs.length) {
    return { success: false, message: '未找到可用标签页，请先打开并登录点评商户后台' };
  }
  isSingleSyncing = true;
  abortRangeSync = false;
  try {
    return await executeAllTabsDataAnalysis(syncTabs, customDateStr);
  } finally {
    isSingleSyncing = false;
  }
});

// 批量按天同步经营数据入本地
ipcMain.handle('sync-date-range', async (event, { startDate, endDate }) => {
  if (isRangeSyncing || isSingleSyncing) {
    return { success: false, message: '已有同步任务正在进行中，请稍候' };
  }

  const syncTabs = [...tabs.values()];
  if (!syncTabs.length) {
    return { success: false, message: '未找到可用标签页，请先打开并登录点评商户后台' };
  }

  const start = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return { success: false, message: '无效的起止日期范围' };
  }

  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }

  if (dates.length > 90) {
    return { success: false, message: '单次最多支持批量同步 90 天数据，以防商户后台接口频控' };
  }

  isRangeSyncing = true;
  abortRangeSync = false;

  let savedCount = 0;
  let successDays = 0;
  let failedDays = 0;
  const errorDetails = [];

  try {
    for (let i = 0; i < dates.length; i++) {
      if (abortRangeSync) {
        console.log('[批量按天同步] 用户中止了同步');
        break;
      }

      const currentDate = dates[i];
      const progressPayload = {
        current: i + 1,
        total: dates.length,
        date: currentDate,
        percent: Math.round(((i + 1) / dates.length) * 100),
        message: `正在按天同步 [${i + 1}/${dates.length}]: ${currentDate}（${syncTabs.length} 个 Tab 并行）...`
      };

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync-range-progress', progressPayload);
      }
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('sync-range-progress', progressPayload);
      }

      let dayResult;
      try {
        dayResult = await executeAllTabsDataAnalysis(syncTabs, currentDate);
      } catch (error) {
        dayResult = { success: false, message: `当日处理失败，继续后续日期: ${error.message}` };
        console.error('[批量按天同步]', dayResult.message);
      }
      savedCount+=dayResult.savedCount||0;
      if (dayResult.success) {
        successDays++;
      } else {
        failedDays++;
        errorDetails.push(`${currentDate}: ${dayResult.message}`);
      }

      // 每天之间增加 1.5s 缓冲以防商户后台频控
      if (i < dates.length - 1 && !abortRangeSync) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    const wasAborted = abortRangeSync;
    const finalMsg = wasAborted
      ? `已停止按天同步。已完成 ${successDays} 天入库，未完成 ${dates.length - successDays} 天`
      : `按天同步完成！已成功将 ${successDays} 天经营数据保存至本地数据库${failedDays > 0 ? `（${failedDays} 天拉取失败）` : ''}`;

    return {
      success: successDays > 0 && failedDays === 0 && !wasAborted,
      hasErrors: failedDays > 0,
      savedCount,
      aborted: wasAborted,
      totalDays: dates.length,
      successDays,
      failedDays,
      errorDetails,
      message: finalMsg
    };
  } finally {
    isRangeSyncing = false;
    abortRangeSync = false;
  }
});

// 停止批量按天同步
ipcMain.handle('abort-sync-date-range', () => {
  if (isRangeSyncing) {
    abortRangeSync = true;
    return { success: true, message: '正在停止同步任务...' };
  }
  return { success: false, message: '当前没有正在执行的按天同步任务' };
});

// ========== 经营数据看板 IPC ==========

// 打开数据看板窗口
ipcMain.handle('open-dashboard', (event, options = {}) => {
  const openSync = options && options.openSync;

  if (dashboardWindow) {
    dashboardWindow.focus();
    if (openSync) {
      dashboardWindow.webContents.send('open-sync-modal');
    }
    return;
  }

  dashboardWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1020,
    minHeight: 680,
    title: '门店经营数据看板 (日报 / 周报 / 月报)',
    icon: path.join(__dirname, 'build/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  dashboardWindow.loadFile('dashboard.html');

  if (openSync) {
    dashboardWindow.webContents.on('did-finish-load', () => {
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('open-sync-modal');
      }
    });
  }

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });
});

// 关闭数据看板窗口
ipcMain.handle('close-dashboard', () => {
  if (dashboardWindow) {
    dashboardWindow.close();
  }
});

// 查询日报数据
ipcMain.handle('metrics-get-daily', async (event, { date, shopName, platform }) => {
  return metricService.getDailyData({ date, shopName, platform });
});

// 查询周报数据
ipcMain.handle('metrics-get-weekly', async (event, { startDate, endDate, shopName, platform }) => {
  return metricService.getWeeklyData({ startDate, endDate, shopName, platform });
});

// 查询月报数据
ipcMain.handle('metrics-get-monthly', async (event, { yearMonth, shopName, platform }) => {
  return metricService.getMonthlyData({ yearMonth, shopName, platform });
});

// 查询趋势数据
ipcMain.handle('metrics-get-trend', async (event, { startDate, endDate, shopName, platform }) => {
  return metricService.getTrendData({ startDate, endDate, shopName, platform });
});

// 获取门店列表
ipcMain.handle('metrics-get-shops', async () => {
  return metricService.getDistinctShops();
});

// 获取有数据的日期列表
ipcMain.handle('metrics-get-dates', async () => {
  return metricService.getAvailableDates();
});

// 生成演示数据
ipcMain.handle('metrics-generate-mock', async (event, days = 14) => {
  return metricService.generateMockData(days);
});

// 清除演示数据
ipcMain.handle('metrics-clear-mock', async () => {
  return metricService.clearMockData();
});

// 导出 CSV 文件
ipcMain.handle('metrics-export-csv', async (event, { defaultFilename = '经营数据报表.csv', content = '' }) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出经营报表',
      defaultPath: defaultFilename,
      filters: [{ name: 'CSV 表格', extensions: ['csv'] }]
    });

    if (canceled || !filePath) return { canceled: true };

    const bom = '\uFEFF';
    fs.writeFileSync(filePath, bom + content, 'utf8');
    return { success: true, filePath };
  } catch (err) {
    console.error('Export CSV Error:', err);
    return { success: false, error: err.message };
  }
});


// 不接受平台参数：话单为门店维度，避免平台重复累计。
ipcMain.handle('metrics-get-call-totals', (event, { startDate, endDate, shopName }) => {
  return metricService.getCallTotals({ startDate, endDate, shopName });
});

ipcMain.handle('metrics-get-promo', (event, { startDate, endDate, shopName }) => {
  return metricService.getPromoMetrics({ startDate, endDate, shopName });
});
