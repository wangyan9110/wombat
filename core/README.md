# Rust 内核

中文 | [English](README.en.md)

`wombat-core` 读取本机 Agent 记录，生成不可变快照，并为用量与对话查询提供同一业务口径。当前生产来源为 Codex；具体支持范围见[支持矩阵](../docs/reference/support-matrix.md)。

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
