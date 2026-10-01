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

公开操作、枚举、分页和错误详见[CLI](../guides/cli.md)。计量整数不能超过 JavaScript 安全整数；金额始终为十进制字符串。新字段及规则必须同时检查生成类型、Web、JSON 和旧快照只读兼容。

用量请求增加可选 `presentation`，默认明细，分布只保留时段小计；显式指定任一种 presentation 时 offset/limit/page.total 按时段计数，明细一页包含所选时段的全部模型行，不拆日期组；省略 presentation 维持原有逐行分页。`sort: cost` 与 Token 排序均由内核完成。响应 `distribution` 给出完整范围的最大值、并列峰值日期及准确筛选 Scope、未计价 Token 数；用量、轮次和计量的 `costShare` 以完整范围已计价金额为分母，未知或零分母返回缺失。对话按 matchedUsage 或最近匹配计量排序，threadUsage 保留全量。轮次默认完整；仅 turns 接受 matchedOnly 与 locateTurnId，先筛选排序再定位分页。匹配轮次只改变 items/page，不改变全对话汇总和份额分母；步骤仍完整。

## 客户端入口

`@wombat/client` 导出生成的 `UsageRequest`、`UsageResult` 等类型，以及 `UsageClient.query(request, { signal, onProgress })`。`UsageClient.prices({action:"status"|"update"}, {signal,onProgress})` 返回生成的 `PricingResult`，含完整价表和版本/来源哈希。`UsageClient.live({query,mode,verify}, options)`为可选宿主能力；Node实现提供它，CLI默认使用，固定快照仍使用query。`createUsageClient(transport, pricingTransport, liveTransport, configTransport)` 包装受限传输并执行协议校验；其通用入口不包含 Node 或 React 依赖。

`@wombat/client/node` 提供 `createNodeClient({ binaryPath, timeoutMs, maxResponseBytes })`，负责本机子进程生命周期。调用方无需接触任意内核操作字符串。其他宿主可实现同一窄传输接口，并复用生成契约与校验器。

Node价表传输只下载固定官方HTTPS文档；内核`prices`操作的宿主请求在update时携带document，status不接受document。原始文档不出现在公共请求或响应类型中；Rust解析及发布，其他宿主需实现同一固定来源获取流程。

## 只读配置契约 v1

源头为 `core/src/config_dto.rs`，生成[请求](../schemas/config-request-v1.schema.json)与[响应](../schemas/config-response-v1.schema.json)。`UsageClient.config` 是可选宿主能力，经 createUsageClient 的第四个传输校验；Node 与 HTTP 均提供。操作为 list/detail/evidence/related_scopes/capabilities；不带 readView 的查询重新采集配置，capabilities 不扫描来源。日期截止日不包含当天，默认 UTC 近30天；仅支持日期、目录、Agent、来源、对话范围，暂不提供模型或强度配置归因。

配置响应独立 outputVersion=1。readView 同时固定配置元数据和用量引用，服务全局最多8个配置版本，保留10分钟；超额淘汰、过期或重启返回 VIEW_EXPIRED。配置版本保留其引用的用量，支持跳回原回合。读取版本的 roots/projectRoots 必须与创建时一致；新的项目授权需要创建新版本。Web 只接受该宿主已返回的版本，并从启动参数注入根。有效配置版本延长内核空闲寿命至其保留期结束。

当前扫描 Codex 根的 AGENTS.md / AGENTS.override.md、config.toml 顶层 MCP、skills 和 .agents/skills；默认 ~/.codex 来源还读取 ~/.agents/skills。显式项目根读取入口规则、.agents/skills、.codex/config.toml，不递归搜寻项目、不解析任意包含路径、不计算配置优先级或插件加载状态。单文件10 MiB、总读取64 MiB、最多10,000个检查条目及10,000项新配置、Skill深度8、问题最多256条；到达上限公开 resourceLimited。不存在的条目与不可读的条目分别处理，后者保留最近元数据并标 stale。

仅保留安全元数据于产品数据目录 config-v1，每授权范围最多20,000项，旧缓存读取上限16 MiB。内容哈希来自完整源文件；MCP多条定义共享所在文件哈希。配置原文、命令、环境值、工具Schema和恢复材料均不保存，不联网、不执行MCP。当前保存方式为原子JSON元数据与有界内存读取版本，完整方案的类型化SQLite表和持久复合版本尚未实施。

显式 read_file 与带独立 server 字段的原生 MCP 事件按来源和配置身份匹配；工具名前缀不作为配置身份。文件读取单列 loaded_only，不算 Skill显式调用。当前文件匹配不能证明历史内容版本，未知覆盖不输出未使用结论。关联回合按唯一计量记录求并集，汇总不将不同配置的同回合重复计费；无关联用量返回缺失。当前使用事件来自完整安全事实遍历，未实现增量关联索引与估算缓存。内容仅返回实际UTF-8字节数，Token估算和MCP Schema大小均不可用。取消关闭本次传输并隔离迟到结果；已开始的内核扫描由资源上限约束，尚无逐请求协作取消。
