/**
 * AutoHelper —— 可靠的 Electron BrowserView iframe 自动化模块
 *
 * 核心思路：
 *   1. 用 Electron 的 WebFrameMain.parent 链（Node 侧）遍历 frame 层级
 *   2. 在每层**父 frame** 内定位对应 <iframe> 元素的 getBoundingClientRect
 *   3. 逐层累加得到绝对视口坐标
 *   4. 用 webContents.sendInputEvent 发送真实鼠标事件（isTrusted = true）
 *
 * 这完全绕开了跨域 iframe 中 window.frameElement === null 的限制。
 */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

class AutoHelper {
  constructor(webContents) {
    this.wc = webContents
  }

  // ─── Frame 查找 ───

  /** 递归收集所有 WebFrameMain（含 mainFrame 自身） */
  getAllFrames() {
    const result = []
    const walk = (f) => {
      result.push(f)
      try { for (const c of f.frames) walk(c) } catch (e) {}
    }
    walk(this.wc.mainFrame)
    return result
  }

  /** 通过 URL 子串找到目标子 frame */
  findFrame(urlSubstring) {
    return this.getAllFrames().find(f => {
      try { return (f.url || '').includes(urlSubstring) } catch (e) { return false }
    })
  }

  // ─── 坐标计算（Node 侧，不依赖页面跨域访问） ───

  /**
   * 沿 WebFrameMain.parent 链，在每一级父 frame 中定位子 frame 对应的
   * <iframe> DOM 元素并读取 getBoundingClientRect，逐层累加。
   *
   * 匹配策略：先用 URL 精确/包含匹配，再按 src 中关键词匹配，
   * 最终如果父 frame 只有一个 iframe 则直接使用。
   */
  async getFrameOffset(frame) {
    if (frame === this.wc.mainFrame) return { x: 0, y: 0 }

    let totalX = 0, totalY = 0
    let current = frame

    while (current !== this.wc.mainFrame && current.parent) {
      const parent = current.parent
      const childUrl = current.url || ''

      const offset = await parent.executeJavaScript(`
        (function() {
          function norm(u) { return (u || '').replace(/^https?:/, '').replace(/^\\/\\//, '') }
          var target = norm(${JSON.stringify(childUrl)})
          if (!target) return null

          var iframes = document.querySelectorAll('iframe')
          var best = null

          for (var i = 0; i < iframes.length; i++) {
            var src = norm(iframes[i].src || '')
            if (!src) continue
            if (src === target || target.indexOf(src) >= 0 || src.indexOf(target) >= 0) {
              best = iframes[i]; break
            }
          }

          if (!best) {
            for (var i = 0; i < iframes.length; i++) {
              try {
                var p1 = new URL('https://' + norm(iframes[i].src || '')).pathname
                var p2 = new URL('https://' + target).pathname
                if (p1 && p1 === p2) { best = iframes[i]; break }
              } catch (e) {}
            }
          }

          if (!best && iframes.length === 1) best = iframes[0]
          if (!best) return null

          var r = best.getBoundingClientRect()
          return { x: r.left, y: r.top }
        })()
      `)

      if (!offset) {
        console.log('[AutoHelper] getFrameOffset 失败: 无法在父 frame 定位 <iframe>, childUrl=', childUrl)
        return null
      }
      totalX += offset.x
      totalY += offset.y
      current = parent
    }

    return { x: totalX, y: totalY }
  }

  // ─── 元素定位 ───

  /**
   * 在 frame 内定位元素中心。
   * @param {string} target - CSS 选择器，或含换行/分号的 JS 代码片段（需给 el 赋值）
   */
  async getElementCenter(frame, target) {
    const isSnippet = target.includes('\n') || target.includes(';')
    const body = isSnippet ? target : `el = document.querySelector(${JSON.stringify(target)})`

    return await frame.executeJavaScript(`
      (function() {
        try {
          var el
          ${body}
          if (!el) return null
          el.scrollIntoView({ block: 'center', inline: 'nearest' })
          var r = el.getBoundingClientRect()
          if (r.width >= 1 && r.height >= 1) {
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
          }
          var a = el.closest && el.closest('a.grade-item')
          if (a) {
            r = a.getBoundingClientRect()
            if (r.width >= 1 && r.height >= 1) {
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
            }
          }
          var sp = el.parentElement && el.parentElement.querySelector('.grade-name')
          if (sp) {
            r = sp.getBoundingClientRect()
            if (r.width >= 1 && r.height >= 1) {
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
            }
          }
          return null
        } catch (e) { return null }
      })()
    `)
  }

  // ─── 交互操作 ───

  /**
   * 在任意 frame（含跨域 iframe）中点击元素。
   * @param {WebFrameMain} frame
   * @param {string} target - CSS 选择器或 JS 片段
   * @returns {Promise<boolean>}
   */
  async click(frame, target) {
    const center = await this.getElementCenter(frame, target)
    if (!center) {
      console.log('[AutoHelper.click] 元素未找到:', target.slice(0, 80))
      return false
    }

    const offset = await this.getFrameOffset(frame)
    if (!offset) return false

    const x = Math.round(center.x + offset.x)
    const y = Math.round(center.y + offset.y)

    this.wc.focus()
    await sleep(50)
    this.wc.sendInputEvent({ type: 'mouseMove', x, y })
    await sleep(30)
    this.wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    await sleep(30)
    this.wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    console.log('[AutoHelper.click] (%d, %d)', x, y)
    return true
  }

  /** 在 frame 内执行 JS 并返回结果 */
  async evaluate(frame, expression) {
    return await frame.executeJavaScript(expression)
  }

  /** 轮询等待选择器出现 */
  async waitForSelector(frame, selector, timeout = 10000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      try {
        const ok = await frame.executeJavaScript(
          `!!document.querySelector(${JSON.stringify(selector)})`
        )
        if (ok) return true
      } catch (e) {}
      await sleep(500)
    }
    console.log('[AutoHelper.waitForSelector] 超时:', selector)
    return false
  }

  /** 在 frame 内用 JS 点击（isTrusted=false 兜底，部分场景仍有效） */
  async jsClick(frame, selector) {
    return await frame.executeJavaScript(`
      (function() {
        var el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return false
        el.click()
        return true
      })()
    `)
  }
}

module.exports = { AutoHelper, sleep }
