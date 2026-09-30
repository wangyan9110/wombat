# 参与贡献

中文 | [English](CONTRIBUTING.md)

Wombat 使用共享 Rust 内核和 Node CLI/TUI。开始前阅读 [AGENTS.md](AGENTS.md)、[架构](docs/development/architecture.md)、[开发约定](docs/development/workflow.md)及[首版方案](docs/project/specification.md)。

安装锁定依赖，构建后执行类型检查、生成契约检查和测试。跨语言测试使用 `dist`，必须在构建后运行。Rust 改动还需检查格式，并以警告视为错误运行 clippy。

修改文档或 Skill 时，对已配对页面同步更新两种语言，并执行 `corepack pnpm docs:check`。

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm typecheck
corepack pnpm contracts:check
corepack pnpm repo:check
corepack pnpm test
```

业务规则放在 Rust。适配器归一化来源事实；计价与查询使用 Wombat 类型。TUI 和自动化共用同一契约。不要新增 ccusage 构建、运行或测试依赖。计量与金额使用独立合成预期值验证；重新生成快照不能充当真值。

不要提交真实消息、工具输出、凭据或未经审查的 raw 字段。保留用户改动和用户拥有的数据。只读采集不得修改来源文件。渲染接口不得拥有任意执行能力。

依赖变化需检查许可证，并执行 `licenses:generate` / `licenses:check`。打包前运行 `public:check --package`；它是防护检查，不代表发布或完整安全审计。记录实际验证的平台和限制，不把计划能力写成现状。详见[第三方声明](THIRD_PARTY_NOTICES.md)。
