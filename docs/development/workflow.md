# 开发与交付约定

中文 | [English](workflow.en.md)

以[首版方案](../project/specification.md)及[架构](architecture.md)为依据。产品只有用量与对话，CLI/TUI 共用 Rust 操作、筛选、计量与价格。

## 实现边界

- 新能力同时交付终端操作与无需 TTY 的 JSON 入口。DTO 在 Rust 定义，生成 Schema、TS 和运行时校验器；字段不得在两端独立维护。
- Source adapter 归一化事实；计价、汇总、去重和项目归属不进入 Node。
- 不依赖 ccusage 运行、构建、类型或测试。通用库按功能需要锁定依赖，独立合成真值是计量验收依据。
- 原始来源只读，基础刷新离线。快照只保存白名单元数据；没有正文回放或任意执行接口。
- 缺失、零、部分计价、未知必须分别保留。输出金额为十进制字符串，列表仅做显示舍入。
- 日期范围包含 since、不包含 until；时区自然日、周一起始、跨天对话与轮次均按每条计量归日。
- 修改前保留现有用户工作；删除旧代码不删除用户数据目录、身份登记和恢复材料。
- 采用[独立模块边界](architecture.md#独立模块)：根目录并列 `core/`、`client/`、`tui/`、`cli/`。各模块独立声明依赖、构建和测试，只使用公开导出或协议；TUI 经注入的 `UsageClient` 访问业务。类型检查同时检查跨模块导入边界。
- 产品运行环境为 Node.js 26.4.0 或更新版本。OpenTUI 仅在交互进程加载，FFI 启动参数由 CLI 封装；不得让 JSON、帮助或契约生成依赖终端初始化。

## 验证

```sh
corepack pnpm build
corepack pnpm typecheck
corepack pnpm contracts:check
corepack pnpm test
~/.cargo/bin/cargo fmt --manifest-path core/Cargo.toml -- --check
~/.cargo/bin/cargo clippy --locked --manifest-path core/Cargo.toml --all-targets -- -D warnings
```

模块测试使用 `corepack pnpm --filter @wombat/client test`、`--filter @wombat/tui test` 和 `--filter @wombat/cli test`；先构建所需包。仅构建内核使用 `corepack pnpm build:core`；TUI 可在客户端构建后独立构建。

按改动选择对应测试，完整链路交付运行全部。跨语言测试调用 dist，必须先构建。独立真值覆盖 A01–A12；正确性不是“与旧输出一样”。终端用真实 PTY 验证 40 / 80 / 120 列与完整返回路径。性能须报告固定语料、release、冷暖查询、内核启动及峰值内存，不以局部解析代表整体。

依赖变化审查并执行 `corepack pnpm licenses:generate`、`licenses:check`。发行验收执行 `corepack pnpm public:check --package` 与干净目录安装；其他平台未经实测不能宣称支持。只有实际通过的项目进入进度完成记录。
