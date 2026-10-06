# 类型化客户端

中文 | [English](README.en.md)

`@wombat/client` 校验请求与结果，并向 CLI、Web 提供同一个 `UsageClient`。业务 DTO 来自 Rust 生成契约；[架构](../docs/development/architecture.md)说明跨模块数据流。

## 公开入口

- 包根入口导出 `createUsageClient({ query, ...transports })`、类型与 `CoreError`。可选传输使用命名字段，包括 `timing`、`account`、`handoff`；根入口不加载 Node 或终端库。
- `@wombat/client/node` 的 `createNodeClient` 管理本机内核子进程、取消、超时和响应上限。
- `UsageClient.live`提供auto/fresh/cached实时查询与新鲜度；Node宿主管理共用本地服务，`query`保留固定快照接口。
- 可选的 `UsageClient.timing` 通过 Rust 生成的契约提供整轮耗时摘要、固定快照证据页和离线能力查询。未指定快照时，Node 选择实时读取视图；显式指定已保存快照时保持固定。耗时查询不触发价表下载、Hook 采集、配置扫描或账户观察。
- `UsageClient.prices`提供离线查询、显式更新和 `auto_update` 缺价检查；Node实时客户端自动触发固定HTTPS下载，Rust负责资格、持久限流、校验、保存及计价。
- 生成文件位于 `src/generated/`；字段和版本以 Rust DTO 及[契约](../docs/development/contracts.md)为准。

- 展示语言使用 `@wombat/client/locale`，详见[产品语言与文案](../docs/i18n/product.md)。

## 限制与验证

客户端只允许生成请求联合类型中的操作，不提供任意 shell、文件写入或通用 dispatch。请求与返回值在跨进程边界校验；修改此包时按[客户端约定](AGENTS.md)构建并运行聚焦测试。

Node 客户端和本地服务使用协议 2，并隔离接口地址与服务锁；协议 1 会被拒绝。普通实时读取默认等待最多 12 秒；显式 `refresh` 还需写入并同步固定快照，默认等待最多 120 秒。`timeoutMs` 可覆盖这两项客户端期限，内核同步等待仍最多 10 秒。耗时响应校验操作、隐私档位、方法，以及本机目标和固定快照身份。分享输出省略本机身份，由 Rust 绑定目标。取消实时查询只关闭调用方连接并拒绝迟到结果，共用同步继续运行；连接断开尚不会取消服务端查询计算。

## HTTP 传输

`@wombat/client/http` 导出 `createHttpClient({ origin, token })`，实现同一 `UsageClient`，校验结果并保留进度、取消和错误。浏览器不直接访问内核；仅向本机宿主发送窄操作。

本地 Web 宿主已实现 `/api/timing`；范围和版本授权见 [Web 宿主](../web/README.md)。CLI 已提供耗时摘要、证据和能力查询，见[CLI 指南](../docs/guides/cli.md)；共享耗时 UI 已接入。真实内核与浏览器联调使用 `corepack pnpm verify:e2e`，验收结果只覆盖所选平台与范围。

`UsageClient.config` 提供配置测量和证据，`optimize` 提供静态建议、用户记录和人工复查，`preferences` 只读取/保存 zh/en。配置对象和后续观察携带共用的类型化 `useBasis`，保留固定范围、方法、来源完整性、五维覆盖，以及不可用与已知零次的区别。`@wombat/client/locale` 为 CLI/UI 解释这些字段，不重算次数或推断历史采用。三者由 Rust 生成 v1 契约，Node/HTTP 并列实现；详见[公共契约](../docs/development/contracts.md)。

`createNodeClient({automaticPrices:false})`只关闭客户端的自动补价装饰，显式prices操作仍可用。CLI实时查询默认保留原行为；Web使用此原始客户端并由宿主持有后台补价生命周期。
