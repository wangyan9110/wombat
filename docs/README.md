# Wombat 文档

中文 | [English](README.en.md)

按读者任务进入文档。当前行为以源码、技术参考和实现证据为准；规格与提案表达目标，历史结果只解释对应构建。

## 使用指南 · guides

- [CLI 与机器接口](guides/cli.md)：启动、刷新、查询、筛选、JSON 与错误。
- [Web 前端](../ui/README.md)：用量、对话、下钻与当前界面范围。
- 安装与构建从[项目首页](../README.zh-CN.md)开始。

## 技术参考 · reference

- [支持矩阵](reference/support-matrix.md)：当前来源、平台、能力与限制。
- [分发与公开简介](reference/distribution.md)：未发行状态、GitHub简介候选和README资产边界。
- [价格口径](reference/pricing.md)：官方依据、金额政策、未知值与显式更新。
- [隐私与数据边界](reference/privacy.md)：本地读写、正文白名单与公开材料。
- [生成 Schema](schemas/)与[依赖许可清单](dependency-licenses.json)是机器维护的参考材料。

## 开发文档 · development

- [架构](development/architecture.md)：模块、依赖、数据流、存储与故障。
- [多入口开发流程](development/workflow.md)：同一业务能力的交付与验证。
- [契约](development/contracts.md)：Rust 源头、生成类型、版本与兼容。
- [来源适配验收](development/adapters.md)：独立真值、归属及故障用例。
- [四入口 Web 与配置分析提案](decisions/proposed/architecture/2026-10-01-config-analysis-web.md)：共享 Rust 契约、配置证据、版本与分期验收；部分交付，剩余阶段仍待验收。
- [贡献说明](../CONTRIBUTING.zh-CN.md)提供仓库操作入口。

## 项目状态 · project

- [首版规格](project/specification.md)维护需求与验收条件。
- [配置测量与人工处理升级](project/config-upgrade.md)维护追加规格与边界。
- [首次运行与确定性规则升级](project/startup-rules.md)维护尚未实施的启动状态、A/B开发拆分及新规则证据门槛。
- [实施状态](project/status.md)维护当前交付和剩余验收。
- [路线图](project/roadmap.md)维护后续候选方向。
- [进度与验证](project/progress.md)索引带日期的结果；原始合成证据在 [benchmarks](benchmarks/)。旧命令和旧截图不代表当前产品。

## 决策与文档维护

[决策目录](decisions/README.md)保存长期理由、替代方案和代价，并区分 proposed、implemented、rejected。已有文档整理时，有用的取舍提炼为决策；当前操作留在指南，过时和重复段落删除，验证结果保留日期与范围。

公开说明均按[双语流程](i18n/README.md)配对；规则文件、术语表和机器证据按清单豁免。维护前阅读[文档约定](AGENTS.md)。产品中英展示另见[语言契约](i18n/product.md)；文档翻译不改变协议值和来源原文。
