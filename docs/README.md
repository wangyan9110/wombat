# Wombat 文档

中文 | [English](README.en.md)

按读者任务进入文档。当前行为以源码、技术参考和实现证据为准；未完成提案表达目标，历史结果只解释对应构建。

## 使用指南 · guides

- [CLI 与机器接口](guides/cli.md)：启动、刷新、查询、筛选、JSON 与错误。
- [Web 前端](../ui/README.md)：用量、对话、下钻与当前界面范围。
- 安装与构建从[项目首页](../README.zh-CN.md)开始。

## 技术参考 · reference

- [分发与公开简介](reference/distribution.md)：未发行状态、GitHub简介候选和README资产边界。
- [价格口径](reference/pricing.md)：官方依据、金额政策、未知值与显式更新。
- [隐私与数据边界](reference/privacy.md)：本地读写、正文白名单与公开材料。
- [生成 Schema](schemas/)与[依赖许可清单](dependency-licenses.json)是机器维护的参考材料。

## 开发文档 · development

- [架构](development/architecture.md)：模块、依赖、数据流、存储与故障。
- [多入口开发流程](development/workflow.md)：同一业务能力的交付与验证。
- [契约](development/contracts.md)：Rust 源头、生成类型、版本与格式。
- [来源适配验收](development/adapters.md)：独立真值、归属及故障用例。
- [贡献说明](../CONTRIBUTING.zh-CN.md)提供仓库操作入口。

## 决策与文档维护

未完成需求、方案和验收条件统一在 [proposed 决策](decisions/proposed/)；已交付行为查所属模块与技术参考，运行结果查测试、CI 或必要证据。

[决策目录](decisions/README.md)保存长期理由、替代方案和代价，并区分 proposed、implemented、rejected。已有文档整理时，有用的取舍提炼为决策；当前操作留在指南，过时和重复段落删除，验证结果保留日期与范围。

公开说明均按[双语流程](i18n/README.md)配对；规则文件、术语表和机器证据按清单豁免。维护前阅读[文档约定](AGENTS.md)。产品中英展示另见[语言契约](i18n/product.md)；文档翻译不改变协议值和来源原文。
