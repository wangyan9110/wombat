<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wombat-logo-dark.svg">
    <img src="assets/wombat-logo-light.svg" alt="Wombat" width="80" height="56">
  </picture>
</p>

# Wombat — Codex Token 用量分析与配置检查

中文 | [English](README.md)

**在 Codex 里看懂用量，改进项目配置。**

Wombat 把本机 Codex Token 用量分析和配置检查带进你的对话。找到用量增加的任务，查看输入增长和重复操作，检查 AGENTS.md、Skills、MCP 和 Hooks。通过 Codex 插件讨论检查结果，完成你授权的修改，再复查结果。

需要图表、任务时间线或配置详情时，可以打开同一项目、同一数据版本的本机 Web 面板，查看后回到 Codex 继续。

## 开始使用

**正式版：[`v0.3.0`](https://github.com/wangyan9110/wombat/releases/tag/v0.3.0)。**

Wombat 支持 macOS、Linux 和 Windows。本机分析无需 API Key 或开发工具；使用插件前需先安装兼容的本机 Codex。

macOS / Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/scripts/install/install.sh | sh -s -- --plugin --open
```

Windows PowerShell：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/scripts/install/install.ps1))) -Plugin -Open
```

安装器会安装 Wombat 与 Codex 插件，随后打开 Web 面板。首次读取期间，可以先查看已经发现的任务。

在 Codex 中打开项目并新建对话，调用 `$wombat:wombat`，然后提问：

> 这周的 Token 用量增加在哪里？找出主要任务和轮次。

> 检查这个项目的 AGENTS.md 和 Skills，保留原有目的，并提出值得修改的问题。

已启用的采集插件会保留原模式，调用 `$wombat-collection:wombat`。以项目实际发现的名称为准；存在多个实例时，明确选择其中一个。仅使用 Web 时，省略安装命令中的 `--plugin` 或 `-Plugin`。发现、移除和已有独立副本的处理方式见[插件指南](plugin/README.md)。

插件安装失败时，Wombat 会保留。确认 Codex 可用后，重新执行安装命令；也可以先执行 `wombat web --open` 查看数据。Skill 不可用时，打开 Web 中的「接入与采集」，查看发现状态和插件指引。安装仍然失败时，在 [Issues](https://github.com/wangyan9110/wombat/issues) 反馈问题。

## 从这些问题开始

| 想解决的问题 | Wombat 提供的分析 |
|---|---|
| 用量增加在哪里？ | 比较时期和任务，定位主要贡献，查看输入、缓存和输出 Token |
| 一个任务的输入在哪些地方增长？ | 查看输入轨迹、变化点和压缩前后的记录 |
| 哪些操作值得调整？ | 检查重复请求与读取、快速轮询、失败模式和耗时线索 |
| 哪些重复工作适合做成脚本或 Skill？ | 查找同一项目跨任务出现的重复操作，供 Codex 审阅和整理 |
| 项目配置有哪些具体问题？ | 检查格式、完全重复的指令块、文件大小、本机引用和 Hook 目标 |
| 修改后配置问题是否还在？ | 重新运行相同规则，查看剩余问题和处理记录 |

还可以查看已记录的任务与轮次耗时、操作区间、资源记录，以及 Skill 或 MCP 使用证据。Codex 账户额度、重置时间和已保存的额度历史，与项目用量分开查询。

## 从检查到改进

在同一 Codex 对话中查看问题和依据，选择需要处理的内容，再让 Codex 完成授权修改。Wombat 提供本机查询和检查，Codex 负责解释、文件修改和恢复。

修改配置后，重新运行相同检查。已解决的问题进入处理记录，剩余问题继续保留。也可以说明理由后保留现状，或将建议标记为「不适用」；复查会保留这些用户决定。

调整工作方式后，可以在有后续记录时比较相关数据，评估实际结果。需要单独的 Codex 任务时，通过 [CLI 交接](docs/guides/cli.md)审阅并发送选定目标；队列接收成功不代表修改已完成或问题已解决。

## 查看图表与详细记录

Web 面板提供用量趋势、项目与模型分布、任务列表、轮次时间线、配置详情和处理记录。可以让 Skill 打开对应详情，也可以直接运行：

```sh
wombat web --open
```

浏览器未自动打开时，使用终端输出的完整地址。没有出现任务时，完成一项 Codex 任务后选择「更新数据」。读取失败时，在「数据来源」中选择「重试」。如需检查任务历史尚未包含的项目配置，可在那里添加项目目录。

页头的「配合 Skill 使用」显示实际发现的调用名称和提问示例。Skill 已安装不代表首次读取已完成；读取期间仍可使用已有记录。

## 更新

重新执行上面的安装命令，可以更新 Wombat 与 Codex 插件。检查更新，或只更新 Wombat 运行时：

```sh
wombat update --check
wombat update
```

指定版本和自定义安装目录见[安装指南](docs/guides/installation.md)。

## 数据与使用范围

- 当前分析本机 Codex 记录，其他 Agent 尚在计划中。
- Token 用量、API 估算金额和账户额度分别展示。估算金额不是订阅账单，也不能换算成剩余额度。缺失或未计价的数据会明确标出；不会给操作单独分摊费用。
- 重复操作、输入变化和耗时提供调查线索。已记录的耗时可能不完整，这些线索不能证明浪费、原因、任务质量或节省。静态复查确认的是所检查的问题是否仍在；后续工作是否采用了修改，需要另外观察。
- 配置检查针对当前文件。当前内容不能证明历史加载或使用情况；证据缺失不能成为停用或删除扩展的理由。
- Wombat 的本机查询和检查不调用模型。Codex 对话与授权处理会产生模型用量；交接时向 Codex 提供选定目标和必要检查结果。
- 本机分析不上传日志。缺价时可能下载官方价表；联网行为和保留数据见[隐私说明](docs/reference/privacy.md)与[计价说明](docs/reference/pricing.md)。

### 可选 Hook 采集

历史日志分析无需采集插件。如需原生事件观察，可打开 Web 中的「接入与采集」，或向 Skill 询问采集方式。[采集指南](docs/guides/cli.md)说明接收状态和暂停／恢复；[插件指南](plugin/README.md)说明安装方式。

安装插件、选择采集模式、在 Codex 中信任 Hook 声明，以及实际收到事件，是独立步骤。接收记录不会增加 Token 计量，也不代表完整覆盖。POSIX 桥接已实现；Windows Hook 采集尚未验证。

## 兼容平台

发行包支持 macOS arm64/x64、Linux glibc arm64/x64 和 Windows x64。

本版本无法打开部分旧版本保存的数据。请保留原数据目录及其中的用户决定；启用独立的数据目录前，先查看[格式与恢复限制](cli/README.md)。

## CLI 与源码开发

<details>
<summary>使用 JSON 查询，或从源码运行</summary>

CLI 支持 JSON 输出，方便接入脚本。用量、比较、耗时、配置查询和交接见 [CLI 指南](docs/guides/cli.md)。

从源码运行需要 Node.js 26.4.0 或更新版本、Corepack、pnpm，以及 `rust-toolchain.toml` 指定的 Rust 版本。克隆本仓库后，在仓库目录中执行：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/wombat.js web
```

环境准备见[开发流程](docs/development/workflow.md)，本机插件试用方式见[插件指南](plugin/README.md)。

</details>

## 一起完善 Wombat

用量看不清、配置难维护，或遇到重复操作的问题？欢迎在 [Issues](https://github.com/wangyan9110/wombat/issues) 分享使用的工具、具体场景和现在的处理办法，无需提供私人日志。也欢迎反馈希望支持的 Agent。

贡献方式见[贡献指南](.github/CONTRIBUTING.zh-CN.md)。安全问题按[安全说明](.github/SECURITY.zh-CN.md)反馈。

## 许可证

[MIT](LICENSE)。依赖许可见[第三方声明](licenses/THIRD_PARTY_NOTICES.md)。
