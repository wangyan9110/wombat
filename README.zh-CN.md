<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wombat-logo-dark.svg">
    <img src="assets/wombat-logo-light.svg" alt="Wombat" width="80" height="56">
  </picture>
</p>

# Wombat — 让 AI 工作更高效

中文 | [English](README.md)

Wombat 帮你看清 Codex 的 Token 用量和任务耗时，发现指令、扩展和工作方式中值得改进的问题，并把具体建议交给 Codex 处理。

用量、额度和优化建议集中展示。打开就能看到哪些工作需要关注；处理完成后，回到 Wombat 检查结果。

产品方向以本页为准；当前实现、平台支持和发行验收边界见[支持矩阵](docs/reference/support-matrix.md)。

## 开始使用

**产品尚未发布。** 首个 GitHub Release 创建后，可安装内置运行时、CLI、Web 和本机内核的独立发行包。当前还没有可供公开安装的 Release。

macOS 或 Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh
~/.local/bin/wombat web --open
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1 | iex
& "$HOME\.local\bin\wombat.cmd" web --open
```

默认安装位置是 `~/.local`。将对应的 `bin` 目录加入 `PATH` 后，可以直接启动；由安装器部署的版本也可以检查并安装更新：

```sh
wombat web --open
wombat update --check
wombat update
```

发行目标包括 macOS arm64/x64、Linux glibc arm64/x64 和 Windows x64。发行包无需另装 Node.js、npm、Rust、pnpm 或编译器；其他平台和实际验收边界见[支持矩阵](docs/reference/support-matrix.md)。浏览器未自动打开时，使用终端输出的完整链接。

首次使用时，确认读取位置并选择“读取本机记录”。首批结果可先查看；没有历史记录，也可以检查已授权的指令和扩展。

## 用 Wombat 改进 Codex 的日常使用

### 看清 Codex Token 用量

概览直接展示用量趋势、项目分布和 API 估算金额。遇到用量突增时，可以定位到相关任务和轮次，查看输入、缓存、输出及操作记录。

账户额度与重置时间帮助你安排接下来的工作。额度按账户显示，与本机记录的用量分开。

### 看清任务时长，以及时间花在哪

查看任务时长与耗时分布，了解时间主要花在哪些环节，帮助你确定需要进一步关注的工作。

这些时间来自可识别的任务和操作记录，用于回看工作经过，不用于判断任务变慢的原因。

### 找到有依据的优化建议

检查 AGENTS.md、Skills、MCP 和 Hooks，在文件或扩展旁直接查看相关建议。Wombat 根据可核对的文件和记录，提示格式问题、内容重复、文件过大和连续快速检查等情况。

每条建议说明处理位置、具体动作和需要保留的内容。你可以判断是否处理，也可以保留现状或反馈“不适用”。

### 交给 Codex 处理，再回来检查

选择一项建议，或批量选择当前范围内的建议。确认目标项目、文件和处理范围后，将它们发送给 Codex。

在 Codex 中查看处理过程和修改。完成后，回到 Wombat 重新检查：已解决的问题进入处理记录，仍有问题的建议继续保留。

你也可以自己修改文件，再回来复查。运行方式是否已采用，要等后续工作记录确认；文件检查通过不等于实际用量已经减少。

<details>
<summary>从源码运行，或使用 CLI</summary>

从源码运行需要 Node.js 26.4.0 或更新版本、Corepack、pnpm，以及 `rust-toolchain.toml` 指定的 Rust 版本。

克隆本仓库。在仓库目录中执行：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/wombat.js web
```

环境准备见[开发流程](docs/development/workflow.md)。

CLI 支持 JSON 输出，方便接入脚本：

```sh
wombat usage --json
wombat threads --sort tokens --json
wombat turns --thread THREAD_ID --sort tokens --json
wombat optimize inventory --project-root /path/to/project --json
wombat optimize list --project-root /path/to/project --json
```

</details>

本机查看和检查无需 API Key，也不调用模型。发送给 Codex 时，只提供所选对象所需的内容和检查结果；Codex 处理会产生模型用量。API 估算金额不是订阅账单，也不能换算成剩余额度。[隐私说明](docs/reference/privacy.md) · [计价说明](docs/reference/pricing.md)。

## 一起完善 Wombat

目前以 Codex 记录为分析来源，Claude Code、pi 等 Agent 在计划中。

用量看不清，配置难维护，或遇到反复检查的问题？欢迎在 [Issues](https://github.com/wangyan9110/wombat/issues) 分享具体场景、使用的工具和现在的处理办法，无需提供私人日志。也欢迎反馈希望支持的 Agent。

贡献方式见[贡献指南](CONTRIBUTING.zh-CN.md)。安全问题按[安全说明](SECURITY.zh-CN.md)反馈。

## 许可证

[MIT](LICENSE)。依赖许可见[第三方声明](THIRD_PARTY_NOTICES.md)。
