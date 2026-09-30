# Wombat 进度与验证记录

中文 | [English](progress.en.md)

本页保留有用的交付结果、失败与证据边界；重复的实现说明已合并，失效命令已删除。当前状态见[实施状态](status.md)，功能以[支持矩阵](../reference/support-matrix.md)和源码为准。以下均是记录时构建的结果，不能证明后续工作树；同一证据文件后续重测可能更新，精确运行以其内部哈希和语料为准。

## 发行 Skill 与 npm 候选 · 2026-09-30

新增项目内 [wombat-release Skill](../../.agents/skills/wombat-release/SKILL.md)，覆盖发行基线、构建门禁、可转移包、npm 候选、认证、公开发布和发布后安装核验；根约定与开发流程提供入口。复用现有脚本，并修正 npm 候选安装自检：无缓存错误由 usage --cached 验证，普通实时空查询允许成功返回。

以已提交的 9ad9d47 加上述打包修正准备 @wangyan9110/wombat@0.3.0（macOS arm64 / Node ≥26.4.0），完整发行门禁、202 项产品测试、6 项仓库测试、原包及 scoped 包干净安装通过。最终终端证据为 20 条 PTY，全部 JS 和内核哈希与候选归档一致，见[候选清单](../benchmarks/npm-candidate-2026-09-30.json)。初次 PTY 失败定位为 node-pty 的 spawn-helper 缺执行权限，恢复后通过，前置条件已写入 Skill。未纳入并行开发中的自动补价及后续界面改动；未公开发布。

Skill 创建器校验通过（YAML 校验依赖仅安装在临时目录），新 Skill 与文档入口在隔离基线上通过 repo:check；共享工作区后续复核也通过仓库检查及 git diff --check。静态检查不替代并行产品改动的行为验证。

## 文档目录升级 · 2026-09-30

13 份原有说明按 guides/reference/development/project 归属迁移并补齐英文；首版规格删除迁移前文件盘点，实施状态只保留当前交付与缺口，进度合并重复经过并移除旧操作命令。独立计量和快照存储的长期取舍提炼为 2 份双语已实施决策，原始合成证据保留。同步更新入口、目录规则、篇幅清单、双语清单和发行文档路径。

本次 `corepack pnpm repo:check` 通过：29 对文档、0 份旧单语待办、6 份决策、3 个 Skill、10 项篇幅约束、模块/文案边界及 6 项检查器测试。本地链接检查与 `corepack pnpm public:check --package` 通过，发行清单包含中英指南与参考；`git diff --check` 通过。本次整理未重跑产品构建、业务测试或安装验收，未提交、推送或发行；并行任务的运行代码与依赖改动保持原状。

## 开发脚本迁移 · 2026-09-30

三个 `scripts/` Python 脚本已迁为 TypeScript：固定快照查询基准、实时索引基准和真实 PTY 终端旅程。终端模拟改用锁定的 Node 开发依赖；产品运行依赖不变。固定快照默认语料 500 个对话、10,000 笔计量及 20 次查询采样通过；实时索引默认语料 100,000 笔计量、12 次追加通过。两份语料哈希均与旧脚本证据一致，真实 PTY 的 19 条旅程通过。构建、类型与模块边界、授权生成及检查、仓库静态检查与公开包检查通过。性能数字对应本次构建与未严格控制的系统缓存，不据此宣称产品性能改善。运行命令见[开发约定](../development/workflow.md)。

## 国际化与治理 · 2026-09-30

国际化与决策目录迁移已提交并推送为 `e460db15384e66329e1147f9070ec01f0965b753`。发布候选隔离了其他任务的启动界面改动；构建、类型检查、client 11、CLI 8、集成 12、端到端 12 项通过。TUI 84 项中 83 项通过，1 项自动更新用例期望 fresh、实际 cached；在原基线应用文件上也复现，不能记为全绿。

[发布候选终端证据](../benchmarks/i18n-publish-terminal-2026-09-30.json)覆盖 19 条 PTY；此前[国际化终端证据](../benchmarks/i18n-terminal-2026-09-30.json)也覆盖 19 条。共享字典、语言优先级与 L 切换已交付；来源原文保留，语言偏好未持久化。当时静态检查为 14 对双语文档、13 份待配对旧文档；该数量是迁移前基线。

决策从 Agent 私有工作结构迁入公开 `docs/decisions/`，当时为 4 份有效记录。目录迁移验证过 6 项检查器测试及 325 个本地链接，未因纯文档迁移重跑业务测试。

## 实时同步与内存 · 2026-09-30

自动同步的基础链路已交付：追加游标、SQLite 事务、按需服务、fresh/cached/watch、固定版本、显式快照与 TUI 更新。完整资源与规模目标仍未交付，见[提案](../decisions/proposed/architecture/2026-09-30-live-usage.md)。

| 迭代 | 实际结果 | 证据与限制 |
|---|---|---|
| 基础链路 | 构建后 174 项测试通过；100 文件 / 10,000 计量，初次 952ms、热查询 91–117ms、追加 131–169ms；峰值 RSS 176,996,352 字节 | [合成基准](../benchmarks/live-usage-2026-09-30.json)；1,100,000 基线 Token、追加 1,100 Token；缓存未严格控制 |
| 终端自动更新 | 16 条 PTY；120,000→240,000 Token 更新延迟 1,076.37ms，固定视图保持 120,000 | [构建终端](../benchmarks/live-usage-terminal-2026-09-30.json)、[全局终端](../benchmarks/live-usage-global-terminal-2026-09-30.json) |
| 共享事实与紧凑索引 | 500 文件 / 100,000 计量 / 100,000 操作 / 12 次追加；内核峰值 RSS 1,584,988,160→590,577,664 字节（下降 62.74%）；对话查询 1,934→387ms | [内存基准](../benchmarks/live-memory-2026-09-30.json)；追加中位数 1,015→744ms，热查询 356–374ms；初次 7.77→8.29s，没有改善 |
| 内存迭代回归 | 构建后 185 项通过（Rust 59 / client 11 / TUI 83 / CLI 8 / 集成 12 / 端到端 12）；构建 16、全局 19 条 PTY | [构建终端](../benchmarks/live-memory-terminal-2026-09-30.json)、[全局终端](../benchmarks/live-memory-global-terminal-2026-09-30.json)；空闲 5 秒约 0.6% CPU，最后调用后约 14.7 秒退出 |

计量真值每条 110 Token / $0.000265。内存数字只覆盖内核，缓存状态未严格控制，不是整机或恒定内存证明。真实源复核材料保留仓库外：初版曾约 1.6 GiB，优化后一次峰值约 700 MiB；语料动态变化，不作可比基准。256 MiB、持久 MVCC、数据库聚合、百万级和 24 小时目标仍未验收。

## 终端与命令迭代 · 2026-09-30

下表合并逐轮重复构建说明，保留功能、测试数量和可追溯证据。环境为 macOS arm64 / Node 26.4.0；PTY 证明操作路径与退出恢复，原生单元格测试证明指定布局/颜色，都不等于全页面视觉保真。

| 迭代 | 验证结果 | 证据或边界 |
|---|---|---|
| 完整模型价表 | 158 项；构建、隔离安装、全局各 14 条 PTY；表格/卡片、档位、来源展开 | [构建](../benchmarks/usage-v1-opentui-prices-view-built-2026-09-30.json)、[隔离安装](../benchmarks/usage-v1-opentui-prices-view-installed-2026-09-30.json)、[全局](../benchmarks/usage-v1-opentui-prices-view-global-2026-09-30.json) |
| 日/周/月默认范围 | 150 项；14 条 PTY；120,000 / 360,000 / 840,000 Token | [范围证据](../benchmarks/usage-v1-report-ranges-2026-09-30.json) |
| 汇总、费用与页尾 | 153 项；各入口 14 条 PTY；说明上限为可用高度 55% | [构建](../benchmarks/usage-v1-opentui-detail-layout-built-2026-09-30.json)、[隔离安装](../benchmarks/usage-v1-opentui-detail-layout-installed-2026-09-30.json)、[全局](../benchmarks/usage-v1-opentui-detail-layout-global-2026-09-30.json) |
| 原生筛选候选 | 138 项；各入口 13 条 PTY；超过 500 条时仍取完整范围候选 | [构建](../benchmarks/usage-v1-opentui-filter-options-built-2026-09-30.json)、[隔离安装](../benchmarks/usage-v1-opentui-filter-options-installed-2026-09-30.json)、[全局](../benchmarks/usage-v1-opentui-filter-options-global-2026-09-30.json)；包括无日期、未归属与失败回退 |
| 官方价表更新 | 131 项；12 条 PTY；新金额 $0.435→$0.4125，旧快照保持 $0.435、Token 不变 | [价表证据](../benchmarks/usage-v1-official-prices-2026-09-30.json)；曾解析 41 模型，未知模型保持未知，网页接口不承诺稳定 |
| 原生筛选表单 | 123 项；11 条 PTY；草稿、取消与文本输入 | [全局终端](../benchmarks/usage-v1-opentui-global-terminal-2026-09-30.json)；此文件后续迭代有更新 |
| CLI 黑盒回归 | 114 项；11 条 PTY；491,210 Token / $1.7382；18 类错误请求、SIGINT 130 与子进程清理 | [CLI 终端](../benchmarks/usage-v1-cli-selftest-terminal-2026-09-30.json)；当时旧全局安装仍有分页问题，随后并行筛选修改使类型复查失败，不能合并宣称全绿 |
| 页头/页尾与几何 | 页头轮次 109 项；几何轮次 102 项；各 11 条 PTY；80/120/160 列坐标及无色选择状态 | [原生预览清单](../benchmarks/usage-v1-opentui-preview-images.json)；字体/字号由终端控制，早期 9 色映射没有覆盖子元素继承 |
| 独立模块和 OpenTUI | 97 项；构建、隔离、全局各 11 条 PTY；JS 分块与内核哈希核对 | [构建](../benchmarks/usage-v1-opentui-terminal-2026-09-30.json)、[隔离安装](../benchmarks/usage-v1-opentui-installed-terminal-2026-09-30.json)、[全局](../benchmarks/usage-v1-opentui-global-terminal-2026-09-30.json) |
| 早期渲染器结构 | TS 21 / 集成 10 / 端到端 4；11 条 PTY | [结构证据](../benchmarks/usage-v1-tui-code-parity-2026-09-30.json)；160 列居中仅单元验证，离线 PNG 不是系统终端截图 |
| 早期主题与布局 | TS 11 / 集成 10 / 端到端 4；8 条 PTY | [主题证据](../benchmarks/usage-v1-tui-fidelity-2026-09-30.json)；旧渲染器证据不验收当前 OpenTUI |

其他局部验证：临界宽度 33 项覆盖 68/80/110/120 列及多种高度；垂直布局/导航 28 项覆盖 80×24、120×32、160×40。当时启动草稿受类型错误阻塞，未形成新安装验收。原型还原 Skill 先以 2 项 Python 合成提取与 9 色映射验证，后改为独立 TypeScript 工具并通过 20 项合成测试；Python Skill 校验曾因缺少 PyYAML 未执行。上述工具不进入产品运行依赖，私有原型与提取结果保留仓库外。

Codex 嵌套历史设置解析修复保留模型、供应商和强度；当时离线价表修订为 `openai-standard-2026-09-30.2`。Rust 48 / TS 45 / 集成 11 / 端到端 4 项通过。没有公开标准价格或请求长度证据的计量继续未知/部分计价；真实源复核不向仓库写入私人汇总。

## 首版收敛 · 2026-09-30

独立账本、官方十进制计价、v3 分片快照、CLI/TUI 两入口与旧快照只读兼容落地；移除了额度、体检、修复、诊断、HTML 报告等旧链路，以及 ccusage、React/Vite 和旧报告资产。长期理由分别见[独立计量](../decisions/implemented/architecture/2026-09-30-independent-accounting.md)与[快照决策](../decisions/implemented/architecture/2026-09-30-snapshot-storage.md)。

- 构建后 67 项通过：Rust 46、TS 7、集成 10、CLI 端到端 4。覆盖独立真值、身份/政策、继承与去重、时区、未知日期、正文白名单、取消、故障、损坏及超限发布保护；构建、类型、契约、Rust fmt/clippy 通过。
- 40×14、80×24、120×32 PTY 及外部旧快照返回通过，见[首版终端](../benchmarks/usage-v1-terminal-2026-09-30.json)。
- 500 对话 / 5,000 轮次 / 10,000 计量，11,000,000 Token / $28.35 跨层及全部分页一致。含进程启动、I/O、序列化与 120 列渲染；文件缓存未清空，见[查询基准](../benchmarks/usage-v1-query-2026-09-30.json)。
- macOS arm64 空目录从本地 tgz 仅安装生产依赖，验证入口、执行权限、无 TTY 查询、原始来源不改写及 120,000 Token / $0.505 守恒，见[安装证据](../benchmarks/usage-v1-install-2026-09-30.json)。另以空 Rust target 离线锁定构建，未复用旧业务资产。
- 当时 51 个 Node / 114 个 Rust 包许可、公开资料和包检查通过。数量不是当前依赖清单；特定缺失授权的补充出处与哈希由[依赖库存](../dependency-licenses.json)维护。没有据此宣布跨平台兼容或公开发行。

## 已退出产品的历史 · 2026-09-28 至 2026-09-29

旧 0.3.0 预览曾包含 ccusage 闭包、React 报告、体检、额度与修复。它们已从当前范围移除，旧英文诊断或修复待办也不再是当前交付清单。保留以下材料用于回归研究，操作请使用[当前 CLI 指南](../guides/cli.md)。

| 历史范围 | 结果与限制 | 证据 |
|---|---|---|
| 2026-09-29 构建与安装 | 95 项（Rust 22 / TS 25 / 集成 24 / 端到端 24）；macOS arm64 | [体检安装](../benchmarks/checkup-install-2026-09-29.json)、[包安装](../benchmarks/public-package-install-2026-09-29.json) |
| 旧终端路径 | 中英 40/80/120 列、取消、材料审查与进程清理 | [体检](../benchmarks/checkup-review-terminal-2026-09-29.json)、[分析](../benchmarks/analysis-review-terminal-2026-09-29.json) |
| 2026-09-28 资源样本 | 大行完整性、固定查询和观察；局部解析不证明整条扫描加速 | [大行](../benchmarks/large-line-2026-09-28.json)、[查询](../benchmarks/layered-query-2026-09-28.json)、[观察](../benchmarks/analysis-observation-2026-09-28.json) |
| 2026-09-29 修复原型 | 104 项（22 / 27 / 24 / 31）；版本/指纹、ChangePlan、回执、撤销冲突、取消清理；PTY 只执行计划与取消 | [修复终端](../benchmarks/codex-repair-terminal-2026-09-29.json)；手动本机签名和账户查询不是产品自动能力，私人材料不入库 |

公开材料不含真实对话、工具正文或账户数据。历史证据按其日期、语料与哈希解释；用户试用、当前构建和目标平台各自验收。
