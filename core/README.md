# Rust 内核

中文 | [English](README.en.md)

`wombat-core` 读取本机 Agent 记录，生成不可变快照，并为用量与对话查询提供同一业务口径。当前生产来源为 Codex；具体支持范围见[来源适配参考](../docs/development/adapters.md)。

## 入口与职责

- `src/adapters/` 识别来源事实；`pricing.rs` 负责离线价格；`usage_store.rs` 保存与读取快照；`usage_app.rs` 执行共享查询。
- `usage_app_dto.rs` 定义请求和结果，生成 TypeScript 与 Schema；字段语义见[契约](../docs/development/contracts.md)。
- `src/main.rs` 通过 stdin 接收一条 JSON 请求，在 stdout 输出一条最终 JSON 结果；阶段进度走 stderr。

## 内部业务模块

| 业务 | 代码职责 |
|---|---|
| Codex 来源 | `adapters/codex/`：读取和边界、事件解析、身份事实、直接/累计计量对账、索引标题；独立增量入口保留 |
| 用量查询 | `usage_app/`：范围校验、守恒汇总、日期/维度报表、任务/轮次/步骤；父入口装配查询缓存 |
| 快照 | `usage_store/`：持久代次、精确分片读取、共享内存视图；账本只有一个计量归属 |
| 实时服务 | `live/`：增量采集、读取版本选择、类型化查询、连接与服务生命周期 |
| 配置 | `config/`：盘点、范围、证据查询；扫描按文本/指令/扩展拆分，静态算法按完整块/声明关系/本地引用拆分 |
| 优化 | `optimize/`：确定性规则、逐规则结果、处理记录服务和持久数据库；用户决定与检查事实分别保存 |

拆分保持公开导出、协议版本、快照和用户记录格式。测试按同一业务分组，继续使用独立合成真值。

## 限制与验证

默认刷新只读来源日志，写入限于产品数据目录。无价、缺失、部分来源失败与资源上限需保持可见；详细责任和故障边界见[架构](../docs/development/architecture.md)与[内核约定](AGENTS.md)。修改算法或存储时运行对应合成真值、格式和 clippy 检查；跨语言测试先重建内核。

## 存储与服务生命周期

默认数据目录为 macOS `~/Library/Application Support/Wombat`、Windows `%LOCALAPPDATA%/Wombat`、Linux `XDG_DATA_HOME/wombat` 或 `~/.local/share/wombat`；`WOMBAT_DATA_HOME` 可覆盖。快照位于 `usage-v4/`，索引位于 `live-v2/`；不替换旧 `latest.json`。

刷新持有进程文件锁，先写私有 generation、分片与哈希，再提交 manifest 并原子更新 latest；取消不发布半份快照。单源失败保留独立回执，全部失败保留旧 latest。源日志按本次长度读取，多文件不声称原子一致。只支持当前格式，未知版本拒绝，不自动迁移或清空。

实时索引以整数键和 JSONB 同事务保存事实、游标和投影；相同投影及计价共享，边界见[索引决定](../docs/decisions/implemented/architecture/2026-10-02-compact-live-index.md)。截断/替换重建，文件消失保留贡献并标 partial；来源独立回滚，全部失败保留旧版。固定查询及缓存按版本/范围隔离；解析事实由已存事件重放恢复；读取投影仍是可重建缓存，checkpoint 保留解析上下文与来源诊断，标题仍来自外部会话索引。元数据未变时走快速路径，不读取日志正文；因此不能识别元数据未变但内容被改写后又恢复原时间戳的情况，显式 verify 会重验。变更或显式 verify 的文件使用 64 KiB 缓冲校验已提交前缀，并在解析前后校验本次捕获内容；观察期间来源变化则拒绝发布并重试。变更文件需完整读取两遍作校验并解析新增内容，时间为 O(捕获文件长度)，持续写入可能延迟到获得稳定读取机会；此完整性检查不构成性能提升。重放排序 E 个事件需要 O(E log E) 时间，内存仍保留全部事件。逐响应追加跳过累计归并，轮次借用事实。仍需全量遍历及重建，持久 MVCC、数据库聚合和长期规模目标未交付。

快照不含消息正文、完整命令参数或工具输出，来源数据不作为指令。本机内核按需服务仍使用私有 Unix socket / 所有者专用 Windows 命名管道，无有效配置读取版本时，最后调用后约15秒退出；HTTP 只存在于显式启动的 Web 宿主。尚无永久监控或 HTML 报告导出。
