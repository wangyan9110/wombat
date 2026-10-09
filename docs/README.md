# Wombat 文档

中文 | [English](README.en.md)

按需要完成的任务选择文档。当前行为以源码、技术参考和实现证据为准；未完成提案描述目标，历史验证结果仅适用于当时的构建。

## 使用指南 · guides

- [安装与更新](guides/installation.md)：适用系统、一键安装、故障处理、更新与版本选择。
- [CLI 与机器接口](guides/cli.md)：启动、刷新、查询、筛选、JSON 与错误。
- [Web 前端](../ui/README.md)：用量、任务、详情查看与当前界面范围。
- 从[项目首页](../README.zh-CN.md)开始。

## 技术参考 · reference

- [价格口径](reference/pricing.md)：官方依据、金额政策、未知值与显式更新。
- [隐私与数据边界](reference/privacy.md)：本地读写、正文白名单与公开材料。
- [生成 Schema](schemas/) 与[依赖许可清单](dependency-licenses.json)由工具维护，供查阅使用。

## 开发文档 · development

- [架构](development/architecture.md)：模块、依赖、数据流、存储与故障。
- [多入口开发流程](development/workflow.md)：同一业务能力的交付与验证。
- [契约](development/contracts.md)：Rust 源头、生成类型、版本与格式。
- [来源适配验收](development/adapters.md)：独立真值、数据归属及故障用例。
- [GitHub 分发决策](decisions/implemented/architecture/2026-10-04-github-release-distribution.md)：长期有效的打包与渠道取舍。重复发行操作由[发行 Skill](../.agents/skills/wombat-release/SKILL.md)维护。
- [贡献说明](../.github/CONTRIBUTING.zh-CN.md)提供仓库操作入口。

## 决策与文档维护

未完成的需求、方案和验收条件统一保存在[提案决策](decisions/proposed/)中。已交付行为见对应模块说明与技术参考；运行结果见测试、CI 或必要的验证材料。

[决策目录](decisions/README.md)保存长期有效的理由、替代方案和代价，并区分 proposed、implemented、rejected。整理已有文档时，将有用的取舍理由提炼为决策；当前操作保留在指南中，删除过时或重复的段落，验证结果须注明日期与范围。

公开说明均按[双语流程](i18n/README.md)配对；规则文件、术语表和机器证据按清单豁免。维护前阅读[文档约定](AGENTS.md)。产品中英展示另见[语言契约](i18n/product.md)；文档翻译不改变协议值和来源原文。
