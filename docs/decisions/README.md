# Wombat 决策记录

中文 | [English](README.en.md)

决策记录保存代码和当前说明无法承载的理由：要解决的问题、选择的办法、真实考虑过的替代方案，以及代价和验证依据。它不是任务清单或产品现状的唯一来源；当前行为仍由源码、契约和[支持矩阵](../reference/support-matrix.md)确认。

## 创建与状态

项目决策统一放在 `docs/decisions/`，供所有维护者查阅；Agent 的可重复工作步骤放在 `.agents/skills/`，适用目录的长期约束放在 `AGENTS.md`。

- `proposed/<类别>/YYYY-MM-DD-主题.md` 记录尚未交付的决定，状态写 `Status: proposed`。
- `implemented/<类别>/YYYY-MM-DD-主题.md` 记录已交付的决定，状态写 `Status: implemented`，事实随代码更新。
- `rejected/<类别>/YYYY-MM-DD-主题.md` 保留仍能避免重复错误的被否决提案，状态写 `Status: rejected`。

类别限于 `architecture`、`product` 和 `process`。中文主文件同目录配对 `.en.md` 与 `.i18n.json`，按[双语流程](../i18n/README.md)确认。新建记录的标准是理由有长期价值；机械和局部改动无需记录。

## 内容与验证

标题和语言切换链接之后写状态。提案包含“问题、方案、考虑过的方案、验收条件”；已实施记录包含“问题、决定、考虑过的方案、影响与验证”；被否决记录保留提案正文，并在状态行写简短否决理由。替代方案只能写实际讨论过的选择，不补造理由。执行 `corepack pnpm notes:check` 检查路径、状态和结构，双语配对由 `corepack pnpm docs:i18n:check` 检查。

## 记录索引

| 状态 | 决策 |
|---|---|
| implemented | [独立计量与来源适配](implemented/architecture/2026-09-30-independent-accounting.md) |
| implemented | [不可变快照](implemented/architecture/2026-09-30-snapshot-storage.md) |
| implemented | [产品语言边界](implemented/architecture/2026-09-30-localization.md) |
| implemented | [日周月默认范围](implemented/product/2026-09-30-report-ranges.md) |
| implemented | [仓库规则与双语确认](implemented/process/2026-09-30-repository-guidance.md) |
| proposed | [实时用量完整方案（部分交付）](proposed/architecture/2026-09-30-live-usage.md) |
| proposed | [GUI 与 CLI 及 CLI+Web 技术路线调研](proposed/architecture/2026-10-01-gui-technical-routes.md) |
| implemented | [缺价触发官方价格检查](implemented/architecture/2026-09-30-automatic-prices.md) |
| implemented | [报表分布与完整范围查询](implemented/product/2026-09-30-report-distribution.md) |
| implemented | [跨平台 npm 与本地通信](implemented/architecture/2026-09-30-portable-npm.md) |
