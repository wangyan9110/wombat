# CLI 与自动化

中文 | [English](cli.en.md)

Wombat 默认增量同步本机 Codex 日志，查询增量更新；显式 refresh 另外保存固定快照。当前提供用量、任务、配置测量与人工处理查询；所有子命令无需 TTY，JSON 与 Web使用同一 Rust 查询。

```sh
wombat prices --json
wombat prices update --json
wombat refresh --root /path/to/codex-home --json
wombat usage --since 2026-09-23 --until 2026-09-30 --timezone Asia/Shanghai --json
wombat threads --sort tokens --json
wombat turns --thread THREAD_ID --sort tokens --json
wombat steps --thread THREAD_ID --turn TURN_ID --sort time --json
```

`--root` 可重复；省略时使用 CODEX_HOME 或 `~/.codex`。同时读取 sessions 与 archived_sessions，显示范围不限制历史采集。刷新不接受查询筛选。


`wombat web --open` 在启动后请求系统打开浏览器；失败时继续运行并输出链接，不影响查询。

Hook清单JSON与Web详情提供同口径的项目注册观察及插件身份，文本输出也标明插件。注册不代表运行；支持的声明形式与未知状态见[配置契约](../development/contracts.md)。

## Codex Skill

以下是技术草稿的试验安装方式，正式任务流程正在由产品重新设计；本机尚未安装，行为验收未完成。

从源码构建并安装本机 `$wombat`：

```sh
corepack pnpm build
corepack pnpm skills:install
```

默认安装到 `~/.agents/skills/wombat`，携带当前平台CLI、内核和Web资产，运行需要Node22+。安装工具需要Node26.4.0+。已有目录不覆盖；更新已安装版本用 `corepack pnpm skills:install -- --replace`。可用 `--skills-root /path/to/skills` 安装到其他目录；自定义同名Skill不会被replace覆盖。

在Codex输入 `$wombat 查看今天的用量并定位主要消耗任务` 或 `$wombat 检查当前项目的指令和扩展`。Skill按任务串联查询，配置改写经过具体方案审阅；[产品方案](../project/codex-skill.md)说明与Web的差异和边界。Codex通常自动发现新Skill，未出现时重启。卸载只移除安装的wombat目录，保留独立产品数据。当前仅本机Skill安装，不是公开插件或MCP发行。

## 语言

使用 `--lang zh` 或 `--lang en` 选择展示语言；也可设置 `WOMBAT_LANG`。JSON 字段与原始内容保持不变，完整优先级见[产品语言](../i18n/product.md)。

## 自动同步

- 普通查询默认同步，最多等2秒；有旧结果时返回并公开 `freshness`，尚无数据时返回 `SYNC_PENDING`。首次大目录建库可能需要更久。
- `--fresh` 等待本次同步，最长10秒；失败或超时明确报错。`--cached` 不触发来源扫描，返回已提交索引；没有索引时报错。
- `usage --watch --json` 输出逐行 JSON，版本、日期范围或状态改变时发出结果；Ctrl+C 退出130。普通 `--json` 仍只输出一个对象。
- `refresh --verify` 完整重读来源再保存快照，用于核验追加快速路径无法证明的历史前缀改写。正常 refresh 利用增量游标。
- `--snapshot ID`固定当前快照，后续分页继续传同一snapshotId，不能重新解析latest。未知格式明确拒绝。
- `--root` 可用于实时查询；每次省略时仍使用默认 Codex 来源，不会因为另一窗口指定根而改变。固定快照不能同时指定来源根。

同一数据目录共用按需 Rust 服务；文件通知加约2秒巡检，CLI watch约每秒查询。没有有效配置读取版本时，最后一个调用结束约15秒后退出；配置读取版本最长保留10分钟。实时接口当前在macOS验收；Windows/Linux 未作本机安装验收。计量以完整日志记录为准，模型还未写入的Token无法即时显示。

## 官方价表

实时查询发现可补齐的缺价会自动检查官方价表；失败保留现有结果并返回 `priceUpdate`。失败15分钟、成功24小时内不重复下载；设置 `WOMBAT_AUTO_PRICES=0` 可关闭自动联网，`--cached` 和 `--snapshot` 始终不触发自动更新。手动 `prices update` 不受自动重试间隔限制。

`prices`（或 `prices status`）离线查看当前完整价表；`prices update` 从固定官方地址联网下载并校验，默认输出简要结果，`--json` 返回 `outputVersion:1`、action、origin、updated、source、sourceHash、catalogHash和完整catalog。价格响应/错误版本独立于用量v3；错误仍为`{outputVersion:1,error:{code,message}}`，退出码1或取消130。常见失败包括PRICE_FETCH_FAILED、PRICE_SOURCE_CHANGED、PRICE_CACHE_INVALID、OUTPUT_LIMIT、TIMEOUT和UPDATE_BUSY。

更新成功后，下一次实时同步按新价表生成完整读取版本；执行`refresh`可另存快照，旧快照金额保留。更新不支持自定义URL、导入路径或用量筛选。网络范围、代理、支持模型表与保存规则见[价格口径](../reference/pricing.md#联网更新价表)。

## 筛选与分页

- `usage --group day|week|month`：省略日期时，day 默认近30个自然日，week 默认本月及之前5个月，month 默认本月及之前11个月，均截止今天（响应 until 为明天，不包含）。显式 since/until 优先，切换分组不改变手动范围；限定任务且省略日期时展示该任务全部范围。周一起始；按事件时间及所选时区归日。
- `--since` 包含起日，`--until` 不包含截止日；`--all-time` 包含日期未知，不能与日期或 --undated 同用。缺省时区 UTC；Web 使用系统时区。
- `--model`、`--effort`、`--project` 精确匹配；项目是已观察到的目录证据，不是路径子串。`--model-unknown`、`--effort-unknown`、`--undated` 分别筛选缺失模型、强度和日期，不能与对应具体值或日期范围同时指定。
- `threads --search TEXT` 搜索标题或项目，`--sort tokens|cost|recent`，按匹配用量或最近匹配计量排序；轮次与步骤使用 `tokens|cost|time`。
- `--snapshot ID`固定当前快照，后续分页继续传同一snapshotId，不能重新解析latest。未知格式明确拒绝。
- `usage --presentation distribution|details`：默认 details 保持分类明细；distribution 只返回时段小计。显式指定此参数时按日期组分页，limit 是时段数，明细保留该时段的全部模型行；省略时维持逐行分页。`--sort time|tokens|cost` 按日期倒序或消耗倒序；完整范围的 distribution 刻度、峰值筛选、未计价 Token 与金额占比在分页前计算，未知金额排在已知金额之后。
- `--limit 1..500 --offset N`，默认50。完整范围排序、金额、分类、占比均在分页前计算。

## JSON

`outputVersion: 3`。成功对象包含 action、snapshotRef、scope、availableRange、summary、items、page、quality。运行时对生成 Schema 校验，未知参数拒绝。普通查询 stdout 只有一个最终 JSON 对象，watch为NDJSON；状态说明写stderr。实时结果另有freshness，status区分current、syncing、stale、failed和fixed，checkedAt为最后成功检查时间；current只表示已处理本次观察到的日志范围。

金额为十进制字符串；Token 为安全整数或 null。`price.cost=null` 表示金额不完整，`knownCost` 为已知小计，status 区分 priced、partial、unknown。缺失不是零，reportedCost 不与标准折算相加。不能从已显示的两位金额重新求和。

任务返回 matchedUsage 与 threadUsage。轮次默认覆盖完整任务，matchedUsage 保留来处条件；turns 可加 --matched-only 仅返回有匹配计量的轮次，--locate-turn ID 定位其所在页（定位成功优先于 offset，否则使用 offset）。筛选轮次不改变完整任务汇总。轮次份额分母为完整任务，步骤份额分母为完整轮次。操作没有独占计量，不显示费用。`unassigned` 承载任务内未归轮记录。

退出码：0 成功或空范围；2 有结果但读取不完整或未确认同步完成；1 错误；130 取消。错误结构为 `{outputVersion:3,error:{code,message}}`，常见 code 包括 INVALID_ARGUMENT、NO_SNAPSHOT、SOURCE_UNREADABLE、SNAPSHOT_CORRUPT、UNSUPPORTED_VERSION、UPDATE_BUSY、CANCELLED、RESOURCE_LIMIT、DETAIL_UNAVAILABLE。部分结果仍可用返回的固定快照继续查询。

## 旧版迁移

仅读取当前v3快照，未知版本拒绝并保留已有文件和用户记录。不提供迁移或旧命令/输出兼容。已退出的scan/report/checkup/quota/codex/observe/compare命令不留占位入口。

## 本机 Web

执行 `wombat web` 并打开输出链接。`--port 0` 默认自动选端口；可重复 `--root <目录>` 限定来源，`--lang zh/en` 选择初始语言，`--json` 输出一行启动信息。Ctrl+C 关闭服务，关闭标签不退出 CLI。

仅本机可访问，重启后须打开新链接。页面提供用量、任务、轮次、来源与价表；日期、模型、强度、目录筛选同步写入地址。浏览器刷新会重新读取本机版本，过期版本可点更新数据恢复。既有业务接口已通过 HTTP 打通，原始日志仍只读；不支持远程部署。详情见[架构](../development/architecture.md)。

新增查询：`usage --presentation projects|models` 按历史目录或模型归组；`--project-unknown` 筛选无目录证据记录，`--agent` / `--source` 限定来源，`threads --locate-thread ID` 返回完整 ID 所在页。任务排序按当前筛选匹配量/最近匹配计量；完整任务量仍独立返回。

## 只读配置

`wombat web --project-root /path/to/project` 添加历史中未出现的配置目录，可重复；省略时保留当前启动目录。本机 Web 会把当前来源中可靠的历史cwd自动加入项目目录，直接CLI配置查询仍用 `--project-root` 明确范围。`--root` 仍指定Codex来源，与项目配置根分开。

`wombat optimize inventory --json` 提供同口径无TTY查询。使用 `--kind rule|skill|mcp`、`--observation used|loaded_only|unknown`、`--search`、`--sort tokens|activity|size|name|content_tokens|characters|recent` 筛选排序；`--limit` 默认50、最多200，`--offset` 从0开始。`--since` / `--until` 为包含起日、不含止日，`--timezone` 默认UTC。

详情和证据使用 `--action detail|evidence|related_scopes --item ID --read-view VERSION`；创建版本时可传 `--snapshot live:…` 固定用量。继续查询须保留相同来源根和项目根参数；版本过期时重新查询清单。`--thread ID` 只列出该任务有证据关联的配置。`--action capabilities` 不扫描配置。完整参数见 `wombat optimize inventory --help`。

返回配置v1 JSON；当前历史覆盖不完整时退出码2仍包含可用结果，参数/服务错误为1，取消为130。文件读取不算Skill调用，关联Token不是配置独占费用，全文内容Token使用固定基准，静态建议与人工复查已接入，来源修改仍关闭。范围和数据含义见[配置契约](../development/contracts.md)。

## 静态建议与人工复查

执行 `wombat optimize list --json`，传与配置相同的 `--root` / `--project-root`。建议已按对象合并，类别为 repair/trim/organize/space；后两类没有适配时明确不可用。检查不接受用量日期或模型，当前静态提醒不等于配置健康。

```sh
wombat optimize list --project-root /path/to/project --json
wombat optimize detail --suggestion SUGGESTION_ID --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize keep --reason necessary --suggestion SUGGESTION_ID --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize history --read-view READ_VIEW --json
wombat optimize redisplay --suggestion SUGGESTION_ID --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize not-applicable --reason incorrect_evidence --suggestion SUGGESTION_ID --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize recheck --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize capabilities --json
```

续查保留原授权根与项目/来源范围，每次使用返回的新decisionRevision；冲突重新读取。detail/keep/not-applicable/redisplay必须带建议身份，keep/not-applicable另需原因。列表支持category、offset及limit 1..200，默认50。在Wombat外修改后直接recheck，--suggestion可限制单项。复查不写来源或撤销用户决定，redisplay不恢复文件。配置/处理结果使用v1，证据不足退出2、错误1、取消130；能力查询不扫描，索引重建保留产品记录。

产品提醒值可用 `--agents-bytes 16384 --description-characters 500` 调整，后续操作保持相同参数。仅授权当前配置范围生效，记录保留参数。正文5,000参考线及description1,024规范上限不可修改；Web提醒值面板使用同一契约。全文/正文估算分别返回，见[规格](../project/config-upgrade.md)。

Web优化列表显示建议、价值和关键指标，详情可展开处理步骤与依据，相关记录次数、轮次Token和API估算金额同屏。关联记录日期不改变当前静态检查；查看准确轮次后可返回原建议及原筛选。无关联保持未知，不能按次数分摊金额。CLI/Agent先从optimize结果取得item.id/readView，再用inventory --action evidence --item ID --read-view VERSION和日期/时区参数；由返回usageRevision/threadId/turnId定位turns。保留授权根，不混用读取版本。人工标记与复查结果通过reviewBaseline/item提供文本测量前后值；未知或不同方法不可比较，变化不代表节省。

## 本机 Codex 交接与账户

需要本机可运行的 Codex；当前原生接口在0.160.0验证。登录、模型审阅、执行及恢复均由 Codex 管理。CLI 和 Web 使用同一清单；不会复制登录凭据。

```sh
wombat optimize handoff preview --project-root /path/to/project --json
wombat optimize handoff send --project-root /path/to/project --selection-version SELECTION_VERSION --read-view READ_VIEW --decision-revision REVISION --json
wombat account read --json
wombat account refresh --json
```

先审阅preview返回的项目工作目录、文件和依据，再使用返回的selectionVersion发送；保留相同来源、项目授权和筛选。省略`--suggestion`选全部待处理项，不受列表分页或类型限制；可重复指定该参数发送单项/子集。共享文件只出现一次，同文件规则合并；项目切换需要重新确认。发送前文件/依据变化明确拒绝。

发送返回accepted、failed或unknown及可用的Codex任务ID；accepted只表示接受请求。查看任务用`codex resume TASK_ID`。失联时先在Codex核对，再由用户决定重发；不会自动重发，不保存执行回执或遍历历史查重。重复手动发送可能产生新任务，关闭Wombat不取消已接受任务。处理后使用`optimize recheck`判断问题是否仍在。

确认窗口可刷新额度并保留文件选择。低额度只提醒；当前任务有可靠的原生限制时阻止发送，刷新后需再次确认。过期、未知或其他模型的限制不当作当前任务耗尽，也不会自动重发。发送会按实际任务重新核对；最终受阻可能留下没有请求内容的空Codex任务。

账户v1响应中的身份、额度和活动有独立状态与读取时间；仅显示脱敏邮箱。真实窗口名称、模型、周期和重置来自Codex，不固定五小时/七天，不回退旧单桶。失败保留先前数据和读取时间，换账户清除旧数据；已过重置时间不推定满额。余额和消费限额保留来源小数字符串，不猜单位；重置权益只读，未提供明细与空列表分开，明细上限128条且不替代来源总数。概览和账户详情共享读取结果，项目或日期不改变账户范围。额度不与项目Token/API估算金额相加或换算。部分读取及未确认交接退出2，错误1、取消130。近期轮次可用`turns --sort recent`，按可靠活动时间排序，未知时间置后。
