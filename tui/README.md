# OpenTUI 终端界面

中文 | [English](README.en.md)

`@wombat/tui` 提供“用量 / 对话”两入口的中英交互界面。它经注入的 `UsageClient` 查询，不读取原始日志或启动内核；产品操作见[终端说明](../docs/terminal.md)。

## 公开入口

- `startTerminalApp(initial, client)` 启动终端界面，接收初始请求与类型化客户端。
- 页面维护导航、筛选草稿、展开、滚动和主题；来源、计量、计价及汇总仍由内核决定。
- 组件使用 OpenTUI 原生布局与输入；[样式规则](../docs/terminal-style-contract.md)记录已确认的视觉映射。

- 展示语言使用 `@wombat/client/locale`，详见[产品语言与文案](../docs/i18n/product.md)。

## 限制与验证

终端控制字体，浏览器原型像素不等于终端单元格。合成客户端、原生渲染和真实 PTY 各验证不同范围；按[终端约定](AGENTS.md)报告尚未覆盖的状态和平台。
