# 参与贡献

中文 | [English](CONTRIBUTING.md)

Wombat 使用共享 Rust 内核和 Node CLI/Web。开始前阅读 [AGENTS.md](AGENTS.md)、[架构](docs/development/architecture.md)、[开发约定](docs/development/workflow.md)及[首版方案](docs/project/specification.md)。

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

业务规则放在 Rust。适配器归一化来源事实；计价与查询使用 Wombat 类型。Web 和自动化共用同一契约。不要新增 ccusage 构建、运行或测试依赖。计量与金额使用独立合成预期值验证；重新生成快照不能充当真值。

不要提交真实消息、工具输出、凭据或未经审查的 raw 字段。保留用户改动和用户拥有的数据。只读采集不得修改来源文件。渲染接口不得拥有任意执行能力。

依赖变化需检查许可证，并执行 `licenses:generate` / `licenses:check`。打包前运行 `public:check`；它是防护检查，不代表发布或完整安全审计。记录实际验证的平台和限制，不把计划能力写成现状。详见[第三方声明](THIRD_PARTY_NOTICES.md)。

## 评审与自动化

问题报告提供最小合成复现、版本、平台、预期与实际行为。Pull Request 说明改动和实际验证，不附私人日志。疑似漏洞按[安全说明](SECURITY.zh-CN.md)处理。

CI 构建并检查五个原生目标，导出内核与内置 Node.js 运行时；仅在全部原生产物一致时汇总五份独立 GitHub Release 归档。最终归档在五个平台运行，不依赖系统 Node；源码工具使用Node26.4.0+。每个平台导出自身依赖许可库存和 Node 运行时许可；仓库内依赖库存是 macOS arm64 基线，其他平台先在 CI 重新生成再检查。CLI 与本机 Web 分别验收。标签工作流仅在完整矩阵通过后发布，普通 CI 不发布，也不改变仓库公开状态。

依赖变化后执行 `corepack pnpm audit --audit-level moderate`。当前 pnpm audit 可能把本地工作区目录 `cli` 识别为同名的无关 npm 包；将该低危条目视为发行依赖前，先核实锁文件路径。这不屏蔽真实漏洞。Rust 使用 cargo-audit 0.22.2 检查 `core/Cargo.lock`。
