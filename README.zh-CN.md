<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wombat-logo-dark.svg">
    <img src="assets/wombat-logo-light.svg" alt="Wombat" width="80" height="56">
  </picture>
</p>

# Wombat — 让 AI 工作更高效

中文 | [English](README.md)

Wombat 是面向 Codex 用户的本机工具，用于查看 Token 用量和任务耗时、检查指令与扩展，并把有依据的建议交给 Codex 处理。

通过一个概览，可以找到高用量任务、查看 API 估算金额与账户额度、检查 AGENTS.md、Skills、MCP 和 Hooks，并在修改后重新核对结果。

Wombat 当前读取本机 Codex 记录，其他 Agent 尚在计划中。

## 开始使用

**正式版：[`v0.2.0`](https://github.com/wangyan9110/wombat/releases/tag/v0.2.0)。**

Wombat 支持 macOS、Linux 和 Windows，无需开发工具或 API Key。

1. 安装并打开 Wombat。在 macOS 或 Linux 中执行：

   ```sh
   curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh -s -- --open
   ```

   在 Windows PowerShell 中执行：

   ```powershell
   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1))) -Open
   ```

2. Wombat 会开始读取本机记录。终端会输出本机访问地址，并在浏览器中打开。首次读取完成前，可以先查看已发现的任务。

安装未完成时，重新执行安装命令；再次失败时，在 [Issues](https://github.com/wangyan9110/wombat/issues) 反馈问题。浏览器未自动打开时，使用终端输出的完整地址。没有出现任务时，先完成一项 Codex 任务，再选择「更新数据」。读取失败时，打开「数据来源」并选择「重试」。如需检查任务历史尚未包含的项目配置，可在「数据来源」中添加项目目录。

### 更新 Wombat

检查或安装最新稳定版：

```sh
wombat update --check
wombat update
```

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

发送建议需要兼容的本机 Codex。原生交接不可用时，可以自行处理建议，再回到 Wombat 复查。

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

## 兼容平台

发行包支持 macOS arm64/x64、Linux glibc arm64/x64 和 Windows x64。

本版本无法打开部分旧版本保存的数据。请保留原数据目录；启用独立的数据目录前，先查看[格式与恢复限制](cli/README.md)。

## 一起完善 Wombat

目前以 Codex 记录为分析来源，Claude Code、pi 等 Agent 在计划中。

用量看不清，配置难维护，或遇到反复检查的问题？欢迎在 [Issues](https://github.com/wangyan9110/wombat/issues) 分享具体场景、使用的工具和现在的处理办法，无需提供私人日志。也欢迎反馈希望支持的 Agent。

贡献方式见[贡献指南](CONTRIBUTING.zh-CN.md)。安全问题按[安全说明](SECURITY.zh-CN.md)反馈。

## 许可证

[MIT](LICENSE)。依赖许可见[第三方声明](THIRD_PARTY_NOTICES.md)。
