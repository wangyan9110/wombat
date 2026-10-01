# CLI 命令入口

中文 | [English](README.en.md)

`@wombat/cli` 解析参数，输出文本或 JSON，并装配非交互查询与 OpenTUI 启动。命令和参数以[CLI 使用说明](../docs/guides/cli.md)为准。

## 公开入口

- 包根入口提供参数解析与 `runUsageCli`；`./format` 提供结果文本格式化。
- `refresh`、`usage`、`threads`、`turns`、`steps`、`prices` 经 `@wombat/client/node` 调用共享内核。
- 仅交互入口加载 `@wombat/tui`；帮助、版本、JSON 和非交互查询不初始化终端。

- 展示语言使用 `@wombat/client/locale`，详见[产品语言与文案](../docs/i18n/product.md)。

## 限制与验证

CLI 只负责参数、输出、进度与退出码，不计算费用或改变快照语义。JSON 进度写 stderr，结果写 stdout；按[命令入口约定](AGENTS.md)在构建后验证参数错误、部分结果与完整命令路径。

## Web 装配

`wombat web` 动态加载本机宿主，注入 Node 客户端并使用打包的 `dist/web/` 资产。启动链接和退出归 CLI 管理，不加载 OpenTUI；来源范围固定于启动参数。
