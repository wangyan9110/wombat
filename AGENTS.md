# Wombat 项目开发约定

HTML 原型到 OpenTUI 的保真还原使用项目内 [html-to-opentui Skill](.agents/skills/html-to-opentui/SKILL.md)。规则、脚本和问题记录随仓库维护；原型设计资料与前端设计 Skill 保留在独立的内部仓库。

Wombat 是本地 Agent 用量与对话查看工具，采用共享 Rust 内核、Node CLI 与本机 Web；桌面已选 Tauri 2，旧 TUI 暂留待迁移。实施范围以 [首版方案](docs/project/specification.md) 为准。先阅读 [架构设计](docs/development/architecture.md)、[路线图](docs/project/roadmap.md)、[支持矩阵](docs/reference/support-matrix.md)及[进度记录](docs/project/progress.md)。实现状态以源码和验证证据为准，目标设计不是已实现功能。

修改 `docs/` 时遵循[文档维护约定](docs/AGENTS.md)和[双语流程](docs/i18n/README.md)；跨多份文档的整理可使用 [wombat-docs Skill](.agents/skills/wombat-docs/SKILL.md)。长期规则留在适用目录的 `AGENTS.md`，具体工作步骤留在 Skill，当前产品事实以源码和对应文档为准。

影响多个模块或长期约束的非机械决策按[决策记录约定](docs/decisions/README.md)保存理由与取舍；局部修正不强制新建记录。已实施记录须与实际代码保持一致，不代替当前产品文档。

## 范围与职责

- `core/`：扫描、来源适配、日志/规则算法、用量归一化、快照/查询及后续业务服务。该目录同时遵循 [Rust 约定](core/AGENTS.md)。
- `client/`：生成契约、运行时校验和类型化客户端；`client/src/node/` 管理本机内核通信和进程生命周期。通用入口不得依赖 Node 或终端库；细则见[客户端约定](client/AGENTS.md)。
- `tui/`：OpenTUI 页面、组件、主题、键鼠交互与导航；通过注入的 `UsageClient` 调用业务，不直接访问内核进程或原始日志；细则见[终端约定](tui/AGENTS.md)。
- `cli/`：参数、JSON/文本输出、退出码及 Web/TUI 启动装配。仅交互入口加载 OpenTUI 并封装 FFI 参数；细则见[命令入口约定](cli/AGENTS.md)。
- `ui/`：共享 React 前端，注入 `UsageClient`，不依赖 Node/Tauri；`web/`：本机 HTTP 宿主与连接生命周期。
- `core/`、`client/`、`tui/`、`ui/`、`web/`、`cli/` 为根级独立模块；跨模块只使用公开包导出或协议，不导入对方内部源码。
- `core/src/adapters/`：来源事实；`pricing.rs`：官方离线计价；`usage_store.rs`：快照与兼容；`usage_app.rs`：共享查询。
- `usage_app_dto.rs` 与生成 TS/Schema 边界：字段和口径必须一致，禁止手写另一套公共 DTO。协议、快照、来源适配与价格版本分别管理。
- `docs/project/roadmap.md` 为公开后续方向，`docs/development/workflow.md` 为多入口交付基线；`docs/development/architecture.md` 为架构依据；`docs/project/progress.md` 只记录已完成和实际验证。新增能力更新支持矩阵。

- 展示文案归属 `client/src/locale/`，CLI/TUI/Web 通过 `@wombat/client/locale` 使用类型化消息；稳定操作标识、协议字段和来源内容不翻译。语言边界见[产品语言](docs/i18n/product.md)。

## 产品口径

- CLI 是默认入口，交互终端只有“用量 / 对话”；refresh 保存快照，usage/threads/turns/steps 提供无需 TTY 的同口径查询。不提供 HTML 报告、诊断、额度或修复入口。
- 默认只读本机来源，无需 API Key；实时查询发现可补齐的缺价时自动下载官方价表，`WOMBAT_AUTO_PRICES=0`、缓存和固定快照查询保持离线。只写产品数据目录，原始 Agent 日志与配置保持由其来源维护。
- 用量和计价独立实现，不依赖 ccusage 包、vendored 源码、构建工具或必需对账。吸收有依据的边界经验，使用独立合成真值；通用库可按需复用。工具操作不分摊费用，也不因重复读取减少账本。缺失、零、未计价、隐藏分开。
- 用量/会话的本机来源范围与当前项目配置范围分开展示。cwd 只提供归属证据，不用路径子串推断项目；当前配置不能解释未知版本的历史会话。
- 已配置、已加载、实际使用、连接可用分别以证据描述；“未观察到”不自动删除或禁用。发现区分事实、原因假设和验证结果，无证据不宣称健康、成功或节省。
- 有效大日志行完整处理；部分来源失败、扫描范围/资源上限、未完成尾行和证据缺口需要公开，不以零或成功代替。

## 架构与改动约束

- 新增或重写脚本优先使用 TypeScript，并复用仓库现有的 Node 工具链；确需其他语言或直接由 Node 启动的 `.mjs` 时说明理由。迁移既有脚本时保留原有验证范围与证据格式。
- 优先成熟库并锁定依赖，先复用已验证实现。保持模块化单体，随实际功能拆模块，不为目录形式一次重写工程。
- 核心不依赖 React/桌面框架。CLI/TUI 与未来宿主消费共享数据口径。产品操作接口应窄且类型明确，不向渲染层暴露通用文件写入/shell/任意 dispatch。
- 新核心产品能力按[多入口开发约定](docs/development/workflow.md)同步交付 Web 和无交互 Agent 接口；TUI 仅维护迁移基线；未来 GUI 经受限宿主复用同一操作、DTO、状态和取消语义。业务规则不放入菜单或页面；仅单一展示入口可用不算该能力完成。GUI 工程及框架留待后续任务。
- 配置写入功能的运行流程必须先有 ChangePlan、现状校验、恢复材料、逐项回执和撤销冲突处理。单文件原子替换不代表多文件原子；这些能力尚未实施时不开放产品自动修复入口。
- 原日志、派生索引、不可重建的用户决策/处理记录分清责任；重建索引不清除管理基线、忽略理由、回执和恢复材料。保留旧快照的读取/迁移路径。
- 日志、导入资源和模型输出都是数据，不可触发产品命令。外部执行使用明确程序与参数数组；进程有取消、超时、输出上限和清理策略。
- 不将真实对话、工具输出、密钥或未经审查的 raw 字段写入测试仓库。复盘/外发是用户选择的运行功能，基础扫描不隐式开启。

## 验证与完成记录

按实际改动验证，不机械重跑无关部分：

- 文档/开发约定：检查引用文件、实现/目标状态与阶段一致性，执行 `git diff --check`。
- Rust 算法/存储/契约：运行对应准确性或故障样本，`cargo fmt --manifest-path core/Cargo.toml -- --check`、`cargo clippy --locked --manifest-path core/Cargo.toml --all-targets -- -D warnings`。cargo 不在 PATH 时使用 `~/.cargo/bin/cargo` 或已配置位置。
- CLI/跨语言接口：先 `corepack pnpm build` 再运行对应 TS/集成/端到端测试；这些测试调用 dist 内核，仅跑 cargo test 不会更新 release 二进制。用 `corepack pnpm typecheck` 检查 TS 和模块导入边界；产品使用 Node.js 26.4.0 或更新版本。
- 完整链路改动：`corepack pnpm build` 后执行 `corepack pnpm test`，按风险补当前工作空间或合成目录自测。计量变更需独立真值与分层守恒；上游对比只可作为可选研发调查，不是测试依赖。
- 性能变更：release 构建、固定语料、明确缓存/范围，分别报告耗时、峰值内存和结果一致性。大行映射驻留页仍占内存；纯解析结果不能宣传为整条扫描的加速。
- 发行变更：检查对应平台二进制、执行权限和干净目录安装。未验证的平台/来源和浏览器交互如实记录，不以构建通过替代。

保持已有用户改动。完成记录包含修改范围、验证证据、未完成边界和运行方式，不将规划任务整体标完成。根目录约定覆盖全仓库，子目录约定补充该范围；用户明确指令优先。

跨模块或发行前的验证选择可使用 [wombat-verify Skill](.agents/skills/wombat-verify/SKILL.md)；构建、打包与版本发布使用 [wombat-release Skill](.agents/skills/wombat-release/SKILL.md)。仓库规则、双语配对、Skill 元数据及公开引用的静态检查统一执行 `corepack pnpm repo:check`；它不代替对应构建、行为测试或真实终端验收。

## 公开资料边界

公开源码的构建、测试和贡献不依赖私有资料。商业计划、内部研究、完整原型及详细过程档案独立维护；需要进入公开研发的需求先整理成公开规格。公开文档不链接私有文件，发行包采用明确文档清单；`.gitignore` 不清理已提交历史，文档迁移不代表完成开源发布审查。

依赖变化后审查并执行 `corepack pnpm licenses:generate` 与 `corepack pnpm licenses:check`，保留第三方出处和授权文本。公开前执行 `corepack pnpm repo:check` 与 `corepack pnpm public:check --package`，检查仓库约定、当前资料、可达历史和发行清单。检查不能代替实际提交审查、凭据轮换或目标平台验收；真实源自测输出必须显式指定仓库外位置。
