# 公共契约

中文 | [English](contracts.en.md)

Rust 的 `core/src/usage_app_dto.rs` 定义请求与响应，`adapters/contract.rs` 定义来源无关事实，`pricing.rs` 定义十进制金额与依据。

生成文件：

- [实时请求 Schema](../schemas/live-request-v1.schema.json)和[实时响应 Schema](../schemas/live-response-v1.schema.json)，源头为`core/src/live.rs`；`live`封装v3结果与独立新鲜度。
- [请求 Schema](../schemas/usage-request-v3.schema.json)
- [响应 Schema](../schemas/usage-app-v3.schema.json)
- [价表请求 Schema](../schemas/pricing-request-v1.schema.json)和[价表响应 Schema](../schemas/pricing-response-v1.schema.json)，源头为 `core/src/pricing_sync.rs`
- `client/src/generated/usage-request.ts`、`usage-app.ts` 和校验器

运行 `corepack pnpm contracts:generate` 重生，`contracts:check` 拒绝漂移。通用客户端校验请求与响应，不提供通用 shell、任意文件写入或任意操作分派。

`outputVersion=3` 是公共结果版本，`schemaVersion=3` 是内部快照版本；来源适配器和价格各有独立版本。内核通信封装为 `{op:"usage_app",args:Request}` → `{ok:true,value:Response}` 或 `{ok:false,error,code,details}`。用量操作为刷新、用量、对话、轮次、步骤；独立价表接口为 `prices`，提供 status/update，响应 `outputVersion=1`。

公开操作、枚举、分页和错误详见[CLI](../guides/cli.md)。计量整数不能超过 JavaScript 安全整数；金额始终为十进制字符串。新字段及规则必须同时检查生成类型、TUI、JSON 和旧快照只读兼容。

用量请求增加可选 `presentation`，默认明细，分布只保留时段小计；显式指定任一种 presentation 时 offset/limit/page.total 按时段计数，明细一页包含所选时段的全部模型行，不拆日期组；省略 presentation 维持原有逐行分页。`sort: cost` 与 Token 排序均由内核完成。响应 `distribution` 给出完整范围的最大值、并列峰值日期及准确筛选 Scope、未计价 Token 数；用量、轮次和计量的 `costShare` 以完整范围已计价金额为分母，未知或零分母返回缺失。对话排序使用 `threadUsage`，`matchedUsage` 仅描述所选范围；轮次及步骤始终完整。

## 客户端入口

`@wombat/client` 导出生成的 `UsageRequest`、`UsageResult` 等类型，以及 `UsageClient.query(request, { signal, onProgress })`。`UsageClient.prices({action:"status"|"update"}, {signal,onProgress})` 返回生成的 `PricingResult`，含完整价表和版本/来源哈希。`UsageClient.live({query,mode,verify}, options)`为可选宿主能力；Node实现提供它，CLI默认使用，固定快照仍使用query。`createUsageClient(transport, pricingTransport, liveTransport)` 包装受限传输并执行协议校验；其通用入口不包含 Node 或 OpenTUI 依赖。

`@wombat/client/node` 提供 `createNodeClient({ binaryPath, timeoutMs, maxResponseBytes })`，负责本机子进程生命周期。调用方无需接触任意内核操作字符串。其他宿主可实现同一窄传输接口，并复用生成契约与校验器。

Node价表传输只下载固定官方HTTPS文档；内核`prices`操作的宿主请求在update时携带document，status不接受document。原始文档不出现在公共请求或响应类型中；Rust解析及发布，其他宿主需实现同一固定来源获取流程。
