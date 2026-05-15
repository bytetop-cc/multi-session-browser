# Electron BrowserView 嵌入页自动化经验（美团经营宝 / 点评评价）

本文记录在本项目中对接 **iframe 内嵌业务页**（如 `shop-comment-dp`）时的踩坑与可行做法，便于后续扩展其它页面自动化。

---

## 1. 页面分层：壳子主文档 vs 业务 iframe

- **主文档（`webContents.mainFrame`）**：经营宝左侧菜单、顶部、**门店选择**（`.shop-select-input`、`.shop-item`、确定按钮等）通常渲染在这里。
- **子 iframe**（如 `src` 含 `shop-comment`）：**点评评价列表、时间筛选（近 30 天）、星级筛选（好评/中评/差评）** 在 **iframe 自己的 `document`** 里。

视觉上两块可能上下挨着，但 **DOM 不属于同一文档**。

**结论**：`webContents.executeJavaScript(...)` **默认只在主 frame 执行**，拿不到 iframe 里的节点；必须用 **`WebFrameMain.executeJavaScript`**（针对子 frame）或封装好的 **`AutoHelper`**。

---

## 2. 跨域 iframe 与坐标

- 在 **iframe 内页面脚本**里，`window.frameElement` 在 **跨域** 时往往为 **`null`**，无法沿父链把「子视口坐标」换算成顶层视口坐标。
- 主文档里用 `iframe.contentDocument` 访问 **跨域** 子页面也会被安全策略拦截。

**可行做法（本项目采用）**：在 **Electron 主进程**里用 **`WebFrameMain.parent`** 自底向上，在每一层 **父 frame** 的文档里找到对应 `<iframe>`，用 **`getBoundingClientRect()`** 累加偏移，再与目标元素在子 frame 内的坐标相加，最后用 **`webContents.sendInputEvent`** 发真实指针事件。见 `auto-helper.js` 中的 `getFrameOffset` + `click`。

---

## 3. 「找到了节点」≠「能点上」：0×0 装饰节点

实际案例：星级筛选里的 **`<i class="grade-radio" data-id="3">`** 在布局上常为 **`getBoundingClientRect()` 宽、高为 0**（样式用背景图等画在别处），**不是**有效点击区域。

- 对 **0×0** 元素做 `click()` 或把鼠标移到其「中心」，往往 **无效或不触发业务逻辑**。
- 同一行里 **`a.grade-item`**、**`.grade-name`** 常有正常尺寸，应作为 **点击目标**（整行或文案）。

`auto-helper.js` 的 `getElementCenter` 在检测到 0×0 时会尝试回退到 **`closest('a.grade-item')`** 或带尺寸的 **`.grade-name`**。

---

## 4. 合成点击 vs 真实指针

- **`element.click()`**、以及在 **`message` 监听器里再 `click()`**（postMessage 桥），在 Chromium 里多为 **非可信（synthetic）** 事件，**Vue/React 等框架可能直接忽略**。
- **`webContents.sendInputEvent`** 发送的鼠标事件更接近真实用户操作，**更容易被页面响应**。

**结论**：自动化交互优先 **`AutoHelper.click`（sendInputEvent）**，`jsClick` 仅作兜底。

---

## 5. postMessage 桥接方案为何在本场景被弃用

曾尝试：主文档向 iframe `postMessage`，iframe 内注入监听器执行 `querySelector` + `click()`。

**问题**：

1. 仍是 **合成 click**，Vue 可能不响应。
2. 日志上 **`postMessage` 发送成功** 易被当成「整步成功」，若再写 **`if (!ok) 才 AutoHelper`**，会导致 **真指针永远不会执行**。
3. 若仍点 **0×0 的 `i`**，即使桥逻辑执行了也 **选不中**。

当前 **差评监控** 已改为 **仅用 `AutoHelper` + 子 frame 的 `evaluate`**；`iframe-bridge.js` 中桥接代码保留作参考，`readReviewFilterDebug` 仍可用于 **DOM 快照调试**。

---

## 6. 推荐实践清单

| 事项 | 建议 |
|------|------|
| 判断控件在哪一层 | 开发者工具看节点属于 **top** 还是 **iframe** |
| 在 iframe 里点击 | 使用 **`AutoHelper`** 或 **`frame.executeJavaScript`**，不要只用主 `webContents` 默认脚本 |
| 选点击目标 | 优先 **有尺寸的节点**（如 `a.grade-item`），避免 0×0 图标 |
| 交互可靠性 | 优先 **`sendInputEvent`**，其次再 `click()` |
| 成功判定 | 不要只看「脚本返回 true」，尽量用 **DOM 状态**（如选中态 class、列表是否变化）校验 |
| 调试 | 使用 **`readReviewFilterDebug`**（`iframe-bridge.js`）或自建快照逻辑打印 `outerHTML` / `rect` |

---

## 7. 相关文件

- `auto-helper.js`：按 frame 链换算坐标 + 真实鼠标点击。
- `iframe-bridge.js`：`readReviewFilterDebug` 调试快照；postMessage 桥可选、当前监控默认不用。
- `main.js`：`run-bad-review-monitor` 中 Step 6（近 30 天）、Step 7（差评）、Step 8（列表解析）的实现。

---

*文档随项目实践更新，日期以仓库修改为准。*
