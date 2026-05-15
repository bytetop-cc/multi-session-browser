# 大众点评评价管理页面结构分析

## 1. 主页面结构 (`main.html`)
主页面为管理界面的外壳，包含顶部的商户/门店切换导航以及侧边栏。主要的内容区域通过 `iframe` 嵌入。

- **门店选择面板**: `.shop-select-panel` 或 `.shop-list-wrap`
  - 门店项: `.shop-item` 
  - 门店名称: `.shop-name`
  - 选择指定的门店时，可以通过遍历 `.shop-item`，提取其文本与目标门店名匹配，点击对应的 DOM 元素。
- **业务容器**: 页面主体部分包含一个嵌入的评价管理 `iframe`。
  - `iframe` 匹配条件：src 中包含 `shop-comment`（即评价模块）。

## 2. 评价管理 Iframe 结构 (`iframe.html`)
业务核心页面，在这个 `iframe` 中可以进行评价的筛选、查看、回复和投诉操作。

### 2.1 评价数据面板 (`.shop-rating-overview`)
包含昨日/近7天/近30天的评价数据概览，例如新增好评数、差评数、回复率等。

### 2.2 评价列表与筛选 (`.reviews-card`)
核心的评价操作区域。
- **筛选器列表**: `.review-filter` (通常存在多个，代表不同维度的筛选)
  - 星级筛选: 包含“全部”、“好评”、“中评”、“差评”
  - 回复状态筛选: 包含“全部”、“已回复”、“未回复”
  - 筛选点击逻辑: 遍历 `.review-filter__option`，匹配文本，例如点击“好评”和“未回复”。由于它们通常由 Vue 数据驱动，可以使用 `AutoHelper.click` 向其父级或元素本身发送事件。

- **评价列表容器**: `.reviews-list`
  - **单个评价项**: `.review-item`
    - 评价内容: `.review-item__comment`
    - 评价时间: `.review-item__time`
    - 星级评分: `.review-item__rating-row` (`.review-item__rate`)
    - 操作区域: `.review-item__actions`
      - 回复按钮: 包含 `<span>回复</span>` 的 `<button class="review-item__action-btn">` 元素。
      - 投诉按钮: 包含 `<span>投诉评价</span>` 的 `<button class="review-item__action-btn">` 元素。

### 2.3 自动回复逻辑思路
当需要在 `iframe` 中对好评进行回复时：
1. 定位到“好评”并点击。
2. 定位到“未回复”并点击。
3. 查找所有 `.review-item`，如果存在未回复的项，找到内部的“回复”按钮。
4. 点击“回复”按钮后，页面通常会展示一个 `textarea` 或对话框供输入内容。
5. 在文本框中填入好评回复模板，点击“提交”按钮完成回复（这一步的弹窗 DOM 结构会在点击后动态生成，需依据实际运行时结构进行选择器匹配，通常可查找到 `.reply-textarea`, `.submit-btn` 或类似元素）。

## 3. DOM 操作建议 (跨域与 Iframe)
- 由于 `iframe` 可能涉及跨域限制，使用 Electron `webContents.executeJavaScript` + `AutoHelper` 获取元素在视口中的绝对坐标，然后通过 `webContents.sendInputEvent` 发送底层的鼠标事件（`mouseDown` / `mouseUp`）以模拟真实点击，能够最大程度绕过 Vue 事件监听和框架拦截的问题。
