# Rust 内核

中文 | [English](README.en.md)

`wombat-core` 读取本机 Agent 记录，生成不可变快照，并为用量与对话查询提供同一业务口径。当前生产来源为 Codex；具体支持范围见[支持矩阵](../docs/support-matrix.md)。

## 入口与职责

- `src/adapters/` 识别来源事实；`pricing.rs` 负责离线价格；`usage_store.rs` 保存与读取快照；`usage_app.rs` 执行共享查询。
- `usage_app_dto.rs` 定义请求和结果，生成 TypeScript 与 Schema；字段语义见[契约](../docs/contracts.md)。
- `src/main.rs` 通过 stdin 接收一条 JSON 请求，在 stdout 输出一条最终 JSON 结果；阶段进度走 stderr。

## 限制与验证

默认刷新只读来源日志，写入限于产品数据目录。无价、缺失、部分来源失败与资源上限需保持可见；详细责任和故障边界见[架构](../docs/architecture.md)与[内核约定](AGENTS.md)。修改算法或存储时运行对应合成真值、格式和 clippy 检查；跨语言测试先重建内核。
