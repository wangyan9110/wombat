# CLI 与自动化

中文 | [English](cli.en.md)

Wombat 默认增量同步本机 Codex 日志，查询与终端自动更新；显式 refresh 另外保存固定快照。首版只有用量与对话两个产品入口；所有子命令无需 TTY，JSON 与终端使用同一 Rust 查询。

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

## 语言

使用 `--lang zh` 或 `--lang en` 选择展示语言；也可设置 `WOMBAT_LANG`。JSON 字段与原始内容保持不变，完整优先级见[产品语言](../i18n/product.md)。

## 自动同步

- 普通查询默认同步，最多等2秒；有旧结果时返回并公开 `freshness`，尚无数据时返回 `SYNC_PENDING`。首次大目录建库可能需要更久。
- `--fresh` 等待本次同步，最长10秒；失败或超时明确报错。`--cached` 不触发来源扫描，返回已提交索引；没有索引时报错。
- `usage --watch --json` 输出逐行 JSON，版本、日期范围或状态改变时发出结果；Ctrl+C 退出130。普通 `--json` 仍只输出一个对象。
- `refresh --verify` 完整重读来源再保存快照，用于核验追加快速路径无法证明的历史前缀改写。正常 refresh 利用增量游标。
- `--snapshot ID` 保持固定读取，不自动同步。实时结果的 `live:…` 标识是短期读取版本，服务内最多保留8版、最长10分钟；过期或服务重启后旧版可能返回 `VIEW_EXPIRED`。需要长期固定数据时执行 refresh 并使用其快照ID。
- `--root` 可用于实时查询；每次省略时仍使用默认 Codex 来源，不会因为另一窗口指定根而改变。固定快照不能同时指定来源根。

同一数据目录共用按需 Rust 服务；文件通知加约2秒巡检，TUI/CLI watch约每秒查询。最后一个调用结束约15秒后退出。实时接口当前在macOS验收；Windows尚未实现，Linux未作安装验收。计量以完整日志记录为准，模型还未写入的Token无法即时显示。

## 官方价表

实时查询发现可补齐的缺价会自动检查官方价表；失败保留现有结果并返回 `priceUpdate`。失败15分钟、成功24小时内不重复下载；设置 `WOMBAT_AUTO_PRICES=0` 可关闭自动联网，`--cached` 和 `--snapshot` 始终不触发自动更新。手动 `prices update` 不受自动重试间隔限制。

`prices`（或 `prices status`）离线查看当前完整价表；`prices update` 从固定官方地址联网下载并校验，默认输出简要结果，`--json` 返回 `outputVersion:1`、action、origin、updated、source、sourceHash、catalogHash和完整catalog。价格响应/错误版本独立于用量v3；错误仍为`{outputVersion:1,error:{code,message}}`，退出码1或取消130。常见失败包括PRICE_FETCH_FAILED、PRICE_SOURCE_CHANGED、PRICE_CACHE_INVALID、OUTPUT_LIMIT、TIMEOUT和UPDATE_BUSY。

更新成功后，下一次实时同步按新价表生成完整读取版本；执行`refresh`可另存快照，旧快照金额保留。更新不支持自定义URL、导入路径或用量筛选。网络范围、代理、支持模型表与保存规则见[价格口径](../reference/pricing.md#联网更新价表)。

## 筛选与分页

- `usage --group day|week|month`：省略日期时，day 默认近30个自然日，week 默认本月及之前5个月，month 默认本月及之前11个月，均截止今天（响应 until 为明天，不包含）。显式 since/until 优先，切换分组不改变手动范围；限定对话且省略日期时展示该对话全部范围。周一起始；按事件时间及所选时区归日。
- `--since` 包含起日，`--until` 不包含截止日。缺省时区 UTC；终端使用系统时区。
- `--model`、`--effort`、`--project` 精确匹配；项目是已观察到的目录证据，不是路径子串。`--model-unknown`、`--effort-unknown`、`--undated` 分别筛选缺失模型、强度和日期，不能与对应具体值或日期范围同时指定。
- `threads --search TEXT` 搜索标题或项目，`--sort tokens|cost|recent`，按完整对话消耗排序；轮次与步骤使用 `tokens|cost|time`。
- `--snapshot ID` 固定快照；旧 v1/v2 可显式传文件。后续分页应继续传同一快照，不能重新查询 latest。外部旧文件的固定定位符返回在 snapshotRef.selector，优先于 snapshotId 用于续查。
- `usage --presentation distribution|details`：默认 details 保持分类明细；distribution 只返回时段小计。显式指定此参数时按日期组分页，limit 是时段数，明细保留该时段的全部模型行；省略时维持逐行分页。`--sort time|tokens|cost` 按日期倒序或消耗倒序；完整范围的 distribution 刻度、峰值筛选、未计价 Token 与金额占比在分页前计算，未知金额排在已知金额之后。
- `--limit 1..500 --offset N`，默认50。完整范围排序、金额、分类、占比均在分页前计算。

## JSON

`outputVersion: 3`。成功对象包含 action、snapshotRef、scope、availableRange、summary、items、page、quality。运行时对生成 Schema 校验，未知参数拒绝。普通查询 stdout 只有一个最终 JSON 对象，watch为NDJSON；状态说明写stderr。实时结果另有freshness，status区分current、syncing、stale、failed和fixed，checkedAt为最后成功检查时间；current只表示已处理本次观察到的日志范围。

金额为十进制字符串；Token 为安全整数或 null。`price.cost=null` 表示金额不完整，`knownCost` 为已知小计，status 区分 priced、partial、unknown。缺失不是零，reportedCost 不与标准折算相加。不能从已显示的两位金额重新求和。

对话返回 matchedUsage 与 threadUsage。进入对话后轮次仍是完整对话，matchedUsage 保留来处条件。轮次份额分母为完整对话，步骤份额分母为完整轮次。操作没有独占计量，不显示费用。`unassigned` 承载对话内未归轮记录。

退出码：0 成功或空范围；2 有结果但读取不完整或未确认同步完成；1 错误；130 取消。错误结构为 `{outputVersion:3,error:{code,message}}`，常见 code 包括 INVALID_ARGUMENT、NO_SNAPSHOT、SOURCE_UNREADABLE、SNAPSHOT_CORRUPT、UNSUPPORTED_VERSION、UPDATE_BUSY、CANCELLED、RESOURCE_LIMIT、DETAIL_UNAVAILABLE。部分结果仍可用返回的固定快照继续查询。

## 旧版迁移

保留 v1/v2 用量与对话的只读读取。缺轮次/强度不伪造，旧金额保留旧政策。执行 refresh 创建 v3，旧文件和恢复材料保持不变。原 scan/report/checkup/quota/codex/observe/compare 等命令及旧输出协议已退出当前产品；没有替代能力的命令不留占位入口。
