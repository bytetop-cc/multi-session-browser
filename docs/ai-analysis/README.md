# 经营明细与单店 AI 分析

页面统一使用 Ant Design（按钮、Select、DatePicker/RangePicker、Segmented、Table、Form、Input、Modal、Alert、Progress、Collapse、Descriptions、Statistic）和官方图标，图表使用 ECharts。

- `analysis.html`、`dashboard.html` 是新版 React 页面的入口，旧控制器和样式已删除。
- `renderer/pages.jsx`：完整页面、日期查询、单店选择、生成/重试/历史和数据同步。
- `renderer/config-panel.jsx`：仅保留 AI 模型配置。没有门店组合或分组配置。
- `renderer/report-ui.jsx`：共享明细、图表和 HTML 报告组件。
- `renderer/report-data.js`：IPC、日期、明细聚合和 CSV。
- `npm run build:reports`：生成 `report-assets/pages.js` 和 CSS，启动/开发/打包前自动构建。运行不依赖 CDN。

## 单店入口与持久化

AI 页的门店下拉一次选择一家门店，各店独立查询和保存分析。点击经营明细的门店名称通过 `open-analysis({shopName})` 跳转；已打开的分析窗口接收 `analysis-context` 更新门店。日报/周报/月报位于页头。

本地 IPC `analysis-report` 和 `analysis-run` 使用 `{shopName,mode,anchor}`，历史用 `analysis-history(shopName)`。门店分组的读写 IPC 已移除。内部 `analysis_shop_scopes` 自动生成单店身份，无需人工配置；原 `analysis_runs` 字段保留兼容持久化，旧组合记录不删除也不混入单店历史，原快照只有一家门店的历史可继续查看。

AI 模型配置保存接口地址、模型、可选思考程度和系统加密 Key。Key 留空保留，保存失败保留输入，保存成功清空输入。重试沿用原快照。AI 请求协议不变，发送汇总、两期对比、趋势及逐日分平台经营明细，不发送 Key、电话或原始接口响应。AI 文本渲染为 HTML 报告，禁用原始 HTML 执行和外部图片。

明细同时显示美团、点评、每日汇总；门店指标只显示在汇总行并按店/日计入合计，null 与 0 区分。排序、固定列、横向滚动、CSV 导出继续支持。

## 验证

- `node test/analysis-ui.cjs`：临时 Chrome 与内存 IPC，验证 Ant 控件和日历、门店切换与历史隔离、周期、生成失败/重试、历史回看、HTML 标题/表格、内容安全、模型配置保存/失败/重新打开、960px 和 200% 缩放。
- `node test/report-details-ui.cjs`：临时 Chrome 与内存 IPC，验证明细合计去重、门店链接传参、排序、滚动、CSV、Ant 日期范围、同步成功/失败/进度与空态。
- `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test test/analysis-shops.test.js`：临时 SQLite 数据库，验证单店统计与历史隔离、无分组配置、旧历史保留和未知店报错。不调用真实供应商。

用户要求跳过 AI 页和配置页的视觉评审，本次仅进行必要功能检查，不报告视觉分数。截图保存在此目录，使用隔离测试门店与模拟数据，不代表真实经营成果。

## 参考图总览

AI 页总览参考用户提供的 `0e64a131932d70e40e2445c609d03c82.png`：黄色六项核心指标带、交易指标与趋势、流量指标与趋势。使用当前本地数据中的曝光人数、访问人数、下单/核销/退款券数与金额、下单人数、核销人次。指标点击切换图表，环比来自同类上一周期；前期缺失或为零显示 --。漏斗、AI 报告、明细和门店指标保留在总览下方。

## 对比、报告更新与漏斗口径

AI 页下方的原逐日明细已替换为上期/本期/变化对照表，独立经营明细页保留。日、周、月均先汇总对应完整周期总量，再计算比率与环比，星级取周期最近有效记录。

已完成的 AI 结果支持编辑与保存更新，更新当前记录而非新增记录；数据库新增 `updated_at`，保留生成时间、原快照及提示词。保存失败保留编辑内容，重新打开可读取修改后的报告。运行中或失败记录不允许人工覆盖。

获客漏斗仅使用曝光人数→访问人数→下单人数，宽度由真实值确定，缺失指标不补零绘制。核销人次、券数、金额及核销/下单券数单独展示；跨期核销不属于本期下单的用户级漏斗终点。AI 默认提示词同步说明该口径。

默认诊断提示词聚焦最多3项经营问题和2项下期跟踪指标，要求每项有本期/上期数值、平台或日期依据及具体动作，总输出不超过600字。AI输入包含白名单经营明细，门店日指标单独去重；已验证比较数据、零值保留和敏感字段剔除。

## PDF 下载

日报、周报、月报页右上角提供“下载 PDF 报告”。导出当前查询的门店/周期与已保存、同周期的 AI 结论，包含总览、交易和流量走势、经营转化分析、门店指标及两期对比。编辑中的内容须先保存；没有匹配结论时标明该周期暂无已保存分析。使用原生保存对话框，可取消和重试。

`analysis-pdf.js` 在隐藏的隔离窗口加载 `report-print.html`，经专用 React 打印排版和中文兼容字体输出 A4 PDF，包含页码，图表与文字保留清晰度。打印窗口和任务数据在成功或失败后均清理。

验证：`node test/analysis-ui.cjs` 覆盖下载按钮和成功/取消/失败反馈；`./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron test/report-pdf-electron.cjs` 实际生成日/周/月 PDF，覆盖长报告、保存取消及隐藏窗口清理。使用系统 PDFKit 提取中文与末尾标记并逐页渲染检查，测试文件位于 `tmp/pdfs/`，使用虚构门店，不是真实经营报告。
