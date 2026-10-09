<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wombat-logo-dark.svg">
    <img src="assets/wombat-logo-light.svg" alt="Wombat" width="80" height="56">
  </picture>
</p>

# Wombat — Codex Token 用量分析与配置检查

中文 | [English](README.md)

**看清 Codex 用量，让改进有依据。**

Wombat 是本机 Codex Token 用量分析与配置检查工具。定位高用量任务，回看任务耗时，检查重复操作和项目配置，再根据证据决定下一步调整什么。

通过 Codex Skill，在已有对话中提问、查看证据、授权修改并复查。例如：「这周的用量增加在哪里？」「哪些操作值得进一步检查？」「这个项目的 AGENTS.md 和 Skills 有什么问题？」需要图表、时间线或详细记录时，打开本机 Web 面板。

Wombat 当前读取本机 Codex 记录，其他 Agent 尚在计划中。

## 开始使用

**正式版：[`v0.2.0`](https://github.com/wangyan9110/wombat/releases/tag/v0.2.0)。**

Wombat 支持 macOS、Linux 和 Windows，本机查看和检查无需开发工具或 API Key。使用 Skill 需要兼容的本机 Codex。

1. 安装 Wombat。在 macOS 或 Linux 中执行：

   ```sh
   curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh -s -- --open
   ```

   在 Windows PowerShell 中执行：

   ```powershell
   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1))) -Open
   ```

   终端会输出本机访问地址，并打开 Web 面板。Wombat 开始读取本机记录；首次读取完成前，可以先查看已发现的任务。

2. 在新终端中进入项目目录，安装独立 Codex Skill：

   ```sh
   wombat skill install --json
   wombat skill status --cwd . --json
   ```

   如果已经使用 Wombat 插件，请保留原安装方式。使用该项目实际发现的调用名称；存在多个实例时，明确选择其中一个。插件安装与移除见 [Skill 指南](skill/README.md)。更新 Wombat 不会更新由 Codex 管理的插件。

3. 在 Codex 中调用实际发现的 Skill，并提出问题。独立安装的入口是 `$wombat`。例如：

   > 这周的 Token 用量增加在哪里？定位主要任务和轮次，并说明覆盖范围。

   > 检查这个项目的 AGENTS.md 和 Skills，保留原有目的，并提出修改建议。

   > 打开同一项目、同一数据版本的 Web 详情，然后回到这里继续。

   Codex 会通过 Wombat 的本机查询解释已有事实。Skill 发现状态与数据准备状态是独立的：Skill 已安装不代表首次读取已完成。Codex 对话会产生模型用量。

安装未完成时，重新执行安装命令；再次失败时，在 [Issues](https://github.com/wangyan9110/wombat/issues) 反馈问题。Skill 不可用时，打开 Web 中的「接入与采集」，查看项目发现状态与安装指引。处理 Skill 接入问题期间，仍可在 Web 中查看数据。

### 更新 Wombat

检查或安装最新稳定版：

```sh
wombat update --check
wombat update
```

## 用 Codex Skill 可以做什么

### 分析 Codex Token 用量与 API 估算金额

找到高用量任务，查看输入、缓存和输出 Token，并比较不同时期或任务。沿用量调查线索定位相关轮次和操作记录。输入轨迹、压缩前后比较、资源记录和周期复盘，可以为进一步检查提供上下文。

账户额度、重置时间和已保存的额度历史单独查询。API 估算金额不是订阅账单，也不能换算成剩余额度。调查线索不等于浪费结论，也不能证明原因。

### 查看任务耗时与操作记录

回看已记录的任务和轮次耗时、操作区间、重复调用与读取，以及 Skill 或 MCP 使用证据。需要详细查看时，打开 Web 时间线。

耗时来自可识别的记录及其顺序。缺失的时长或关联保持未知；不会推算操作费用。这些记录不用于判断任务变慢的原因。

### 检查 AGENTS.md、Skills、MCP 和 Hooks

让 Codex 解释配置证据与 Wombat 建议。检查包括格式问题、完全重复的指令块、文件过大、本机引用和 Hook 目标。轮次操作检查还可以提示连续快速检查等情况。

建议说明处理位置、证据、具体动作和需要保留的内容。当前配置不能证明历史加载或使用情况；证据缺失不能成为停用或删除扩展的理由。

### 授权修改，再核对结果

在同一 Codex 对话中审阅建议、授权选定修改，并重新运行相同检查。也可以保留现状，或将建议标记为「不适用」。

已解决的问题进入处理记录，仍有问题的建议继续保留。用户决定与检查结果分开记录。文件检查通过不等于 Token 用量已经减少；运行方式是否已采用，需要后续工作记录确认。

## 用 Web 面板查看图表与证据

Web 提供用量趋势、项目与模型分布、任务列表、轮次时间线、配置详情和建议处理记录。Skill 可以打开同一项目、同一数据版本的页面，方便查看证据后回到 Codex 继续。

直接打开 Web：

```sh
wombat web --open
```

浏览器未自动打开时，使用终端输出的完整地址。没有出现任务时，先完成一项 Codex 任务，再选择「更新数据」。读取失败时，打开「数据来源」并选择「重试」。如需检查任务历史尚未包含的项目配置，可在「数据来源」中添加项目目录。

Web 用于查看证据和复查，处理继续在当前 Codex 对话中完成。页头的「配合 Skill 使用」提供安装说明、实际调用方式和提问示例。需要单独的 Codex 任务时，可通过 [CLI 交接](docs/guides/cli.md)审阅并发送选定对象；队列接收成功不代表修改已完成或问题已解决。

## 可选 Hook 采集

读取历史日志无需安装采集插件。如需原生事件观察，可打开 Web 中的「接入与采集」，或向 Skill 询问采集方式。[采集指南](docs/guides/cli.md)说明模式、接收状态和暂停／恢复；[Skill 指南](skill/README.md)说明本机采集插件。

安装插件、选择 Hook 采集、在 Codex 中信任声明，以及实际收到事件，是独立步骤。Hook 接收记录不会增加 Token 计量，也不代表完整覆盖。POSIX 桥接已实现；Windows 采集尚未验证。

## CLI 与源码开发

<details>
<summary>使用 JSON 查询，或从源码运行</summary>

CLI 支持 JSON 输出，方便接入脚本。筛选、固定版本、比较、耗时和配置查询见 [CLI 指南](docs/guides/cli.md)：

```sh
wombat usage --json
wombat threads --sort tokens --json
wombat turns --thread THREAD_ID --sort tokens --json
wombat optimize inventory --project-root /path/to/project --json
wombat optimize list --project-root /path/to/project --json
```

从源码运行需要 Node.js 26.4.0 或更新版本、Corepack、pnpm，以及 `rust-toolchain.toml` 指定的 Rust 版本。

克隆本仓库。在仓库目录中执行：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/wombat.js web
```

环境准备见[开发流程](docs/development/workflow.md)，本机插件试用方式见 [Skill 指南](skill/README.md)。

</details>

Wombat 的本机查询和检查无需 API Key，也不调用模型。Skill 对话及交给 Codex 的处理会产生模型用量。发送给 Codex 时，只提供选定目标及必要的检查结果。[隐私说明](docs/reference/privacy.md) · [计价说明](docs/reference/pricing.md)。

## 兼容平台

发行包支持 macOS arm64/x64、Linux glibc arm64/x64 和 Windows x64。

本版本无法打开部分旧版本保存的数据。请保留原数据目录；启用独立的数据目录前，先查看[格式与恢复限制](cli/README.md)。

## 一起完善 Wombat

目前以 Codex 记录为分析来源，Claude Code、pi 等 Agent 在计划中。

用量看不清，配置难维护，或遇到反复检查的问题？欢迎在 [Issues](https://github.com/wangyan9110/wombat/issues) 分享具体场景、使用的工具和现在的处理办法，无需提供私人日志。也欢迎反馈希望支持的 Agent。

贡献方式见[贡献指南](CONTRIBUTING.zh-CN.md)。安全问题按[安全说明](SECURITY.zh-CN.md)反馈。

## 许可证

[MIT](LICENSE)。依赖许可见[第三方声明](THIRD_PARTY_NOTICES.md)。
