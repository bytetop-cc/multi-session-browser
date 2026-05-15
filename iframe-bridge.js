/**
 * iframe 桥接（postMessage + 父页发消息）——当前「差评监控」已改为仅用 AutoHelper + executeJavaScript，
 * 本文件保留供其它场景复用；调试快照请用 readReviewFilterDebug。
 *
 * 历史说明：合成 click 易被 Vue 忽略，且 pm 成功会阻断真指针；根因还包括 0×0 的 i.grade-radio 需点 a.grade-item。
 */

const MSG_SOURCE = 'multi-session-browser'

/** 注入到目标 iframe 文档内（对目标 frame 调用一次即可，可重复调用幂等） */
function getBridgeInjectionSource() {
  return `
(function() {
  if (window.__MSB_IFRAME_BRIDGE__ >= 3) return;
  window.__MSB_IFRAME_BRIDGE__ = 3;
  window.addEventListener('message', function(ev) {
    var d = ev.data;
    if (!d || d.source !== '${MSG_SOURCE}') return;
    function q(sel) {
      try { return document.querySelector(sel); } catch (e) { return null; }
    }
    function qa(sel) {
      try { return document.querySelectorAll(sel); } catch (e) { return []; }
    }
    /** 若节点无可见盒（0×0），改点可命中的父级 a.grade-item 或带尺寸子节点 */
    function clickForHitTest(el) {
      if (!el) return { ok: false };
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      var r = el.getBoundingClientRect();
      if (r.width >= 1 && r.height >= 1) {
        el.click();
        return { ok: true, target: 'direct', tag: el.tagName };
      }
      var a = el.closest && el.closest('a.grade-item');
      if (a) {
        a.click();
        return { ok: true, target: 'a.grade-item-fallback', tag: 'A' };
      }
      var sp = el.parentElement && el.parentElement.querySelector('.grade-name');
      if (sp) {
        var rs = sp.getBoundingClientRect();
        if (rs.width >= 1 && rs.height >= 1) {
          sp.click();
          return { ok: true, target: 'grade-name-fallback', tag: 'SPAN' };
        }
      }
      el.click();
      return { ok: true, target: 'direct-zero-size', tag: el.tagName };
    }
    try {
      if (d.action === 'click') {
        var el = q(d.selector);
        var hit = el ? clickForHitTest(el) : { ok: false };
        window.__MSB_LAST_ACTION__ = {
          action: 'click',
          selector: d.selector,
          found: !!el,
          hitTest: hit,
          ts: Date.now()
        };
      } else if (d.action === 'clickFirstMatchText') {
        var nodes = qa(d.containerSelector || 'a.grade-item, .grade-item');
        var hit = false;
        for (var i = 0; i < nodes.length; i++) {
          var nm = nodes[i].querySelector(d.textSelector || '.grade-name');
          if (nm && nm.textContent.trim() === d.text) {
            var t = nodes[i].querySelector(d.targetSelector || '.grade-radio');
            var ht = t ? clickForHitTest(t) : clickForHitTest(nodes[i]);
            hit = true;
            window.__MSB_LAST_ACTION__ = {
              action: 'clickFirstMatchText',
              text: d.text,
              clicked: true,
              hitTest: ht,
              ts: Date.now()
            };
            break;
          }
        }
        if (!hit) {
          window.__MSB_LAST_ACTION__ = {
            action: 'clickFirstMatchText',
            text: d.text,
            clicked: false,
            ts: Date.now()
          };
        }
      }
    } catch (err) {
      window.__MSB_LAST_ACTION__ = { error: String(err), ts: Date.now() };
      console.warn('[MSB iframe-bridge]', err);
    }
  });
})();
`
}

/**
 * @param {Electron.WebFrameMain} targetFrame 子 frame（与注入为同一文档）
 */
async function ensureBridgeInjected(targetFrame) {
  await targetFrame.executeJavaScript(getBridgeInjectionSource())
}

/**
 * 在**主 frame** 里找到 src 含 urlPart 的 iframe，向其 contentWindow 发 postMessage
 * @param {Electron.WebContents} webContents
 * @param {string} urlPart 如 'shop-comment'
 * @param {object} payload action + 参数（会自动带 source）
 * @returns {Promise<boolean>} 是否找到 iframe 并已发送
 */
/**
 * @returns {Promise<{ ok: boolean, iframeIndex?: number, iframeSrc?: string, error?: string }>}
 */
async function postMessageToChildIframe(webContents, urlPart, payload) {
  const msg = JSON.stringify({ source: MSG_SOURCE, ...payload })
  const part = JSON.stringify(urlPart)
  return await webContents.mainFrame.executeJavaScript(`
    (function() {
      var msg = ${msg};
      var part = ${part};
      var iframes = document.querySelectorAll('iframe');
      var debug = { iframeCount: iframes.length, candidates: [] };
      for (var i = 0; i < iframes.length; i++) {
        var src = iframes[i].src || '';
        debug.candidates.push({ i: i, src: src.slice(0, 120) });
        if (src.indexOf(part) >= 0) {
          try {
            iframes[i].contentWindow.postMessage(msg, '*');
            return { ok: true, iframeIndex: i, iframeSrc: src };
          } catch (e) {
            return { ok: false, error: String(e), debug: debug };
          }
        }
      }
      return { ok: false, error: 'no_iframe_match', debug: debug };
    })()
  `)
}

/**
 * 读取 iframe 内星级筛选区与桥接最后一次动作（用于判断「显示成功」是否真生效）
 */
async function readReviewFilterDebug(frame) {
  return await frame.executeJavaScript(`
    (function() {
      function attrs(el) {
        if (!el) return null
        var o = {}
        for (var i = 0; i < el.attributes.length; i++) {
          var a = el.attributes[i]
          o[a.name] = a.value
        }
        return o
      }
      function snap(el, maxLen) {
        if (!el) return null
        var r = el.getBoundingClientRect()
        return {
          tag: el.tagName,
          attrs: attrs(el),
          outerHTML:
            el.outerHTML.length > maxLen
              ? el.outerHTML.slice(0, maxLen) + '…[truncated]'
              : el.outerHTML,
          rect: {
            left: Math.round(r.left),
            top: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height)
          }
        }
      }
      var r3 =
        document.querySelector('i.grade-radio[data-id="3"]') ||
        document.querySelector('.grade-radio[data-id="3"]')
      var items = document.querySelectorAll('a.grade-item, .grade-item')
      var rows = []
      var badReviewRowDetail = null
      for (var i = 0; i < items.length; i++) {
        var nm = items[i].querySelector('.grade-name')
        var radio = items[i].querySelector('.grade-radio')
        var label = nm ? nm.textContent.trim() : ''
        rows.push({
          label: label,
          dataId: radio ? radio.getAttribute('data-id') : null,
          nameClass: nm ? nm.className : ''
        })
        if (label === '差评') {
          badReviewRowDetail = {
            nameHasChoosed: !!(nm && String(nm.className || '').indexOf('choosed') >= 0),
            row: snap(items[i], 5000),
            radio: snap(radio, 2500),
            nameSpan: snap(nm, 1500)
          }
        }
      }
      return {
        href: location.href,
        gradeRadio3Exists: !!r3,
        gradeRadio3Direct: snap(r3, 2500),
        gradeRows: rows,
        badReviewRowDetail: badReviewRowDetail,
        lastBridge: window.__MSB_LAST_ACTION__ || null
      }
    })()
  `)
}

module.exports = {
  MSG_SOURCE,
  ensureBridgeInjected,
  postMessageToChildIframe,
  readReviewFilterDebug
}
