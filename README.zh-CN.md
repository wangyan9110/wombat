<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wombat-logo-dark.svg">
    <img src="assets/wombat-logo-light.svg" alt="Wombat" width="80" height="56">
  </picture>
</p>

# Wombat — Codex Token 用量分析与配置检查

中文 | [English](README.md)

**看清 Codex 的 Token 用量与时间分布。**

Wombat 分析本机 Codex 记录，找出推高 Token 用量的任务，查看已记录的任务耗时与时间分布，发现重复工作。检查 AGENTS.md、Skills、MCP 和 Hooks，让 Codex 完成你授权的修改，再复查具体问题。

通过 Codex 插件直接提问；需要图表、时间线或详细依据时，打开本机 Web 面板查看。

## 开始使用

**正式版：[`v0.3.0`](https://github.com/wangyan9110/wombat/releases/tag/v0.3.0)。**

本机分析无需 API Key 或开发工具；使用插件前需先安装兼容的本机 Codex。

macOS / Linux 安装 Wombat 与 Codex 插件：

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/scripts/install/install.sh | sh -s -- --plugin
```

Windows PowerShell：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/scripts/install/install.ps1))) -Plugin
```

安装器会检查插件发现状态和运行时兼容性。在 Codex 中打开项目，**新建对话**，然后提问：

> $wombat:wombat 这周的 Token 用量增加在哪里？找出主要任务和轮次。

回答会列出主要贡献，以及输入、缓存和输出的变化。需要核对记录时，可以让 Skill 打开对应的 Web 详情。

<details>
<summary>已有插件、仅用 Web 和安装恢复</summary>

已启用的采集插件会保留原模式，调用 `$wombat-collection:wombat`。以项目实际发现的名称为准；存在多个实例时，明确选择其中一个。仅使用 Web 时，省略 `--plugin` 或 `-Plugin`，安装后执行 `wombat web --open`。发现、移除和独立副本的处理方式见[插件指南](plugin/README.md)。

插件安装失败时，Wombat 会保留。检查报错步骤后，按[安装指南](docs/guides/installation.md)仅重试插件；也可以先执行 `wombat web --open` 查看数据。Web 中的「接入与采集」提供发现状态和插件指引。安装仍然失败时，在 [Issues](https://github.com/wangyan9110/wombat/issues) 反馈问题。

</details>

## 从这些问题开始

| 可以直接提问 | 会得到什么结果 |
|---|---|
| 这周的 Token 用量增加在哪里？ | 比较时期，定位主要任务和轮次，查看输入、缓存和输出变化 |
| 这一轮用了多久，记录中的时间花在哪些操作上？ | 已记录的时长、操作活动区间、重叠和耗时覆盖缺口 |
| 哪些重复工作适合做成脚本或 Skill？ | 找出同一项目多个任务中反复出现的操作，提供任务与操作依据，供 Codex 判断流程是否稳定、值得整理成脚本或 Skill |
| 检查这个项目的 AGENTS.md、Skills、MCP 和 Hooks，哪些地方需要改？ | 指出具体位置和检查依据，覆盖格式、完全重复的指令块、文件大小、本机引用和 Hook 目标 |
| 修改配置后再复查，问题是否还在？ | 使用相同规则检查，列出剩余问题与处理记录；有原生记录时，提供内容版本匹配 |

### 任务统计与 Token 预算监控

- **比较任务用量。** 查询项目任务总体的平均值、中位数、P90，以及所选任务的分位排名。
- **拆解用量增长。** 区分任务数量变化和单任务用量变化的贡献，查看输入变化点与压缩前后的记录。
- **设置 Token 预算。** 保存日／周／月预算，复盘最近结束的周期。持续检查需要运行 `wombat monitor watch`，或在打开的 Web 预算面板中启用定期检查。

还可以查询资源记录、Skill 或 MCP 的使用次数与最后使用时间，以及配置内容版本观察。Codex 账户额度、重置时间和已保存的额度历史，与项目用量分开查询。查询方式和预算控制见 [CLI 指南](docs/guides/cli.md)。

## 为什么在 Codex 中使用 Wombat？

Wombat 将本机记录整理为可重复查询的统计、同一数据版本的证据，以及可跨对话使用的处理记录。分析多个任务的用量变化，或持续跟进项目配置时，Codex 可以直接使用这些结果。

- **减少重复整理。** 复用本机索引查询多个任务的用量、增长和操作记录，减少每次提问都从头梳理历史的工作。
- **让比较有共同依据。** 按相同项目、时期和数据版本查看汇总与明细，保留缺失数据，方便核对结论和确定修改目标。
- **让后续处理接得上。** 保存配置检查的决定和理由，修改后使用相同规则复查，新对话也能继续使用已有记录。

## 从检查到改进

在同一 Codex 对话中查看问题和依据，选择需要处理的内容，再让 Codex 完成授权修改。Wombat 提供本机查询和检查，Codex 负责解释、文件修改和恢复。

修改配置后，重新运行相同检查。已解决的问题进入处理记录，剩余问题继续保留。也可以说明理由后保留现状，或将建议标记为「不适用」；复查会保留这些用户决定。

调整工作方式后，可以在有后续记录时比较相关数据，评估实际结果。需要单独的 Codex 任务时，通过 [CLI 交接](docs/guides/cli.md)审阅并发送选定目标；队列接收成功不代表修改已完成或问题已解决。

## 查看图表与详细记录

Web 面板提供用量趋势、项目与模型分布、任务统计、轮次时间线、预算提醒、周期复盘、配置详情和处理记录。可以让 Skill 打开对应详情，也可以直接运行：

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

- 当前分析本机 Codex 记录，其他 Agent 尚在计划中。本机分析不上传日志；缺价时可能下载官方价表，详见[隐私说明](docs/reference/privacy.md)与[计价说明](docs/reference/pricing.md)。
- Token、API 等价估算金额和账户额度分别展示。估算金额不是订阅账单或剩余额度。缺失与未计价的数据会明确标出；不为操作单独分摊费用。
- 耗时描述已记录的时长与活动区间，保留重叠和覆盖缺口；不表示模型内部纯推理时间，也不能据此确定原因、浪费、质量或节省。当前文件不能证明历史加载或使用，配置被读取或加载不等于实际采用；观察缺失不能成为删除扩展的理由。
- 本机查询和检查不调用模型；Codex 对话与授权处理会产生模型用量。交接提供选定目标和必要检查结果；静态复查确认所检查的问题是否仍在。采集与使用方式见[插件指南](plugin/README.md)。

<details>
<summary>可选 Hook 采集</summary>

### 可选 Hook 采集

历史日志分析无需采集插件。如需原生事件观察，可打开 Web 中的「接入与采集」，或向 Skill 询问采集方式。[采集指南](docs/guides/cli.md)说明接收状态和暂停／恢复；[插件指南](plugin/README.md)说明安装方式。

安装插件、选择采集模式、在 Codex 中信任 Hook 声明，以及实际收到事件，是独立步骤。接收记录不会增加 Token 计量，也不代表完整覆盖。POSIX 桥接已实现；Windows Hook 采集尚未验证。

</details>

## 兼容平台

发行包支持 macOS arm64/x64、Linux glibc arm64/x64 和 Windows x64。

本版本无法打开部分旧版本保存的数据。请保留原数据目录及其中的用户决定；启用独立的数据目录前，先查看[格式与恢复限制](cli/README.md)。

## CLI 与源码开发

<details>
<summary>使用 JSON 查询，或从源码运行</summary>

CLI 支持 JSON 输出，方便 Agent 和脚本调用。用量、任务统计、预算监控、耗时、配置查询和交接见 [CLI 指南](docs/guides/cli.md)。

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
