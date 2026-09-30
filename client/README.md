# 类型化客户端

中文 | [English](README.en.md)

`@wombat/client` 校验请求与结果，并向 CLI、TUI 提供同一个 `UsageClient`。业务 DTO 来自 Rust 生成契约；[架构](../docs/architecture.md)说明跨模块数据流。

## 公开入口

- 包根入口导出 `createUsageClient`、类型与 `CoreError`，通过注入的传输调用业务；不加载 Node 或终端库。
- `@wombat/client/node` 的 `createNodeClient` 管理本机内核子进程、取消、超时和响应上限。
- `UsageClient.live`提供auto/fresh/cached实时查询与新鲜度；Node宿主管理共用本地服务，`query`保留固定快照接口。
- `UsageClient.prices`提供离线查询和显式官方价格更新；Node宿主获取固定HTTPS文档，Rust校验、保存及计价。
- 生成文件位于 `src/generated/`；字段和版本以 Rust DTO 及[契约](../docs/contracts.md)为准。

- 展示语言使用 `@wombat/client/locale`，详见[产品语言与文案](../docs/i18n/product.md)。

## 限制与验证

客户端只允许生成请求联合类型中的操作，不提供任意 shell、文件写入或通用 dispatch。请求与返回值在跨进程边界校验；修改此包时按[客户端约定](AGENTS.md)构建并运行聚焦测试。
