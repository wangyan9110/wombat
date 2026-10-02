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

`@wombat/client` 导出生成的 `UsageRequest`、`UsageResult` 等类型，以及 `UsageClient.query(request, { signal, onProgress })`。`UsageClient.prices({action:"status"|"update"}, {signal,onProgress})` 返回生成的 `PricingResult`，含完整价表和版本/来源哈希。`UsageClient.live({query,mode,verify}, options)`为可选宿主能力；Node实现提供它，CLI默认使用，固定快照仍使用query。`createUsageClient(transport, pricingTransport, liveTransport, configTransport, optimizeTransport, preferencesTransport)` 包装受限传输并执行协议校验；其通用入口不包含 Node 或 React 依赖。

`@wombat/client/node` 提供 `createNodeClient({ binaryPath, timeoutMs, maxResponseBytes })`，负责本机子进程生命周期。调用方无需接触任意内核操作字符串。其他宿主可实现同一窄传输接口，并复用生成契约与校验器。

Node价表传输只下载固定官方HTTPS文档；内核`prices`操作的宿主请求在update时携带document，status不接受document。原始文档不出现在公共请求或响应类型中；Rust解析及发布，其他宿主需实现同一固定来源获取流程。

## 只读配置契约 v1

`core/src/config_dto.rs` 生成[请求](../schemas/config-request-v1.schema.json)与[响应](../schemas/config-response-v1.schema.json)，Node/HTTP 提供 `UsageClient.config`。list/detail/evidence/related_scopes/capabilities 不写来源；capabilities 不扫描。无 readView 时重采集。默认 UTC 近30天、截止日排他；`scope.allTime` 包含未知日期，不能同时给日期。配置范围不接受模型或强度；当前内容测量与日期无关。

readView 固定配置元数据和用量引用，全局最多8版、10分钟；淘汰、过期和重启返回 VIEW_EXPIRED。有效配置版本延长内核寿命并保留原用量，供返回任务轮次。续查 roots/projectRoots 必须与创建时一致；Web 仅接受本宿主发布的身份，启动根由宿主注入。

来源根盘点准确文件名 AGENTS.md、config.toml 顶层 MCP、skills 和 .agents/skills；默认 ~/.codex 还读 ~/.agents/skills。授权项目中有界递归发现 AGENTS.md，读取 .agents/skills 与 .codex/config.toml；不进入 .git、node_modules、target、dist、.codex、.agents 或符号链接目录。大小写不敏感的文件系统仍核验准确目录项名。只提供发现事实，不推断加载优先级或历史采用。扫描单文件10 MiB、总读64 MiB、检查条目和新配置各10,000、深度8、问题256，超限公开 resourceLimited。

完整 UTF-8 文件提供真实字节数、Unicode 码点数和内容哈希；Skill 包含 front matter。`estimate` 用固定 `tiktoken-rs-0.12.0/o200k_base/ordinary-v1` 普通文本编码，注明全文、指纹与 referenceEncodingOnly，不包含聊天包装或等同未知模型。估算单文件1 MiB、单轮8 MiB，缓存最多2,048个计数，键包含方法和哈希，不存正文。空内容为零；超限、无效编码、缺失及读取失败保持独立状态。可靠元数据字节数声明 filesystemMetadata，不配旧内容值；历史或 stale 测量始终标为旧值。MCP 缺模型可见完整定义，字符和 Token 未知，不执行服务获取定义。

Skill YAML 只解析 name/description，description 长度由成功字段产生；限制头部64 KiB、事件10,000、深度32，不解析 include。超出预算或不支持的扩展不报格式错误。文件读取仅为加载证据；AGENTS.md 使用次数缺失，Skill 显式调用和 MCP 资源读取尚无可靠适配，不能由读取次数冒充。带独立 server 身份的原生 MCP 工具尝试逐次计数，失败及独立重试计次，同一操作去重；工具前缀不能认定配置实例。未观察到时 usageCount 缺失。日期筛选作用于这些历史事件，lastRecordAt 为匹配范围内最后证据。

关联用量按可靠关联轮次中匹配范围的计量去重；不分摊配置独占成本，各行可能重叠，汇总用并集。没有关联保留缺失，完整轮次量另查原用量版本。每次证据查询仍遍历安全事实，增量关联索引、持久复合版本及协作取消未实现；取消断开传输并隔离迟到结果，扫描受资源预算约束。

currentItems 不计明确缺失的路径，清单仍公开缺失行；显式读取以准确路径证据关联，不因 cwd 为授权根的子目录丢弃。

派生 config-v1 原子 JSON 只存安全元数据，每范围最多20,000项，旧缓存读取16 MiB。不存配置正文、环境值、命令参数或工具输出；不联网扫描，不执行 MCP。它可重建，与不可重建的用户处理记录分开。

## 优化与偏好契约 v1

`core/src/optimize_dto.rs`生成[请求](../schemas/optimize-request-v1.schema.json)与[响应](../schemas/optimize-response-v1.schema.json)。Node/HTTP的UsageClient.optimize支持list/detail/history（group）、ignore/mark_edited/restore/recheck/capabilities；CLI操作见[指南](../guides/cli.md)。对象级规则以本页阈值修订为准。日期及模型不影响检查，检查时刻独立返回。支持项目/来源/类别、pending/history、最多200项分页，默认50。

建议身份绑定来源、对象、内容指纹、问题与项目范围。readView 固定事实，decisionRevision 固定用户记录；冲突返回 VIEW_EXPIRED。ignore/mark_edited 对已确认的同状态重试不重复追加，restore 只针对最新忽略记录。recheck 校验旧授权后重采集，返回 awaitingRecheck、stillNeedsReview、verified 或 recheckUnavailable；verified 只证明本次可观察静态检查通过，不证明采用或节省。历史条目保留独立 recordId。

用户记录在 `user-v1/reviews.sqlite3`，独立事务、最多20,000条，达到上限报错而不删除记录。配置索引重建不清除忽略和处理记录。闲置、MCP故障、空间清理、预览、执行和恢复能力明确 false，响应 partial；不提供任意写文件、shell 或 dispatch。

`core/src/preferences.rs` 生成[偏好请求](../schemas/preferences-request-v1.schema.json)与[响应](../schemas/preferences-response-v1.schema.json)，`UsageClient.preferences` 仅 get/set zh/en；私有原子文件为 `user-v1/language.json`，不接受任意路径或内容。Web 的语言优先级见[语言契约](../i18n/product.md)。

当前规则使用static-config-v4。bodyTokenEstimate独立分词精确正文，payload=skillBody，含tokenizerVersion、method/contentHash及referenceEncodingOnly，所在configRevision/readView固定快照。bodyEstimateStatus公开未知/解析/资源缺口，旧缓存默认unknown；解析失败不写零。全文/正文各≤1MiB，两者输入都计入单轮8MiB预算。AGENTS.md>16,384B为产品提醒，Skill正文≥5,000为参考提醒，description501—1,024为产品提醒，>1,024为规范问题且不重复500提醒。ruleOverrides只允许agentsBytes正安全整数及descriptionCharacters 0..1024，ruleParameters返回默认/覆盖/固定线及授权当前配置适用边界；记录保留原规则，recheckRuleParameters保存复查规则。规范约束不可覆盖，正文未知不能复查通过。加载预算诊断/闲置/空间能力仍关闭，边界见[升级规格](../project/config-upgrade.md)。

mark_edited额外保存reviewBaseline：标记版本的安全测量元数据，不保存正文。复查保留该原始基线并更新item，旧记录无基线默认为null；recheckRuleParameters独立指示复查。字节/码点需两端完整且非旧值；正文Token比较还须两端估算可用、方法/编码/载荷/分词器版本一致。只展示前后文本测量，不将阈值差额或关联用量解释为节省。Web相关用量复用config evidence及其usageRevision，日期不进入optimize规则身份，CLI/Agent经inventory evidence及turns读取同口径。

static-config-v4新增完整块与显式副本证据，公开文件版本、原文字节/行位置、声明哈希、方向和变换，不返回正文；声明与资源边界见[规格](../project/startup-rules.md)。config capabilities可返回启动授权根与宿主复制用重启命令；不是扫描成功事实，也不提供执行接口。live freshness.errorCode公开存储/迁移错误；facets.discoveredThreadCount只表示快照内已发现任务元数据，不是日期筛选后的计量数。

static-config-v4的声明依据绑定来源实例、授权项目、声明路径/哈希、关系ID及种类；每条关系只有所有成员完整且适用条件已确认时才完成。标题或相对引用条件未知、声明消失、成员超限均为recheckUnavailable；旧声明证据没有关系身份时可读但不判通过。相同声明文本不能替代其他项目的声明。

当前配置按本机规范路径、种类和原生键聚合物理对象，共享项目仅采集一次。authorizedProjects保留重叠根成员，project仅为展示归属；sourceContexts保留旧来源盘点身份、来源/版本及逐来源观察，sourceInstanceId兼容字段不是完整来源清单。来源筛选只计匹配事件；关联Token和金额仍用原账本并集。同一当前对象只产生一条建议，处理在所有匹配来源中一致，声明依据仍逐来源独立。旧来源身份用于授权旧缓存/处理记录，不合并账本身份；文件在采集间改变版本时公开configContentChangedDuringScan并保留分项。

reviews.sqlite3独立使用user_version=1：review_events保存逐次状态，review_parts共享安全依据、item及原始baseline，SQLite JSONB只用于内部布局。按授权对象/项目/类别先COUNT和LIMIT/OFFSET再解码页面；状态查询仅扫描轻量元数据，复查按物理对象选最新记录。旧decisions逐行事务迁移，保留序号/身份/依据，坏记录回滚、未知版本拒绝，提交后一次VACUUM；没有自动清除用户历史。4MiB页缓存、512页检查点和8MiB WAL保留目标不是硬上限。迁移耗时与常规分页分开，见[决定](../decisions/implemented/architecture/2026-10-02-rule-review-integrity.md)。
