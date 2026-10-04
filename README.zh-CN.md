<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wombat-logo-dark.svg">
    <img src="assets/wombat-logo-light.svg" alt="Wombat" width="80" height="56">
  </picture>
</p>

# Wombat — Codex 用量与配置工具

中文 | [English](README.md)

**让 AI 工作更高效。**

Wombat 帮你发现 Codex 配置里值得改进的地方，让优化有据可查：哪些文件值得精简，哪里有格式问题或重复内容，修改后问题是否解决。

用量与配置建议默认展示，打开概览就能看到需要关注的地方。日志与配置都留在本机。

![Wombat 展示 Codex Token 用量、API 估算金额、相关任务和配置建议](assets/prototype-overview-zh.jpg)

界面预览，截取自设计原型。金额为 API 等价估算，不是订阅账单或剩余额度。

## Wombat 能帮你做什么

### 找出配置里值得改进的地方

配置建议会提示值得关注的问题，例如较大的 AGENTS.md、Skill 格式问题、相同的完整指令块，以及已声明副本之间的差异。查看依据后，你可以判断文件是否需要修改。

Skills 和 MCP 也可以统一盘点；文件读取记录与 MCP 调用尝试分别展示。

### 看清用量，知道该关注哪里

近期 Token 用量、API 估算金额和项目分布默认展示，无需先做筛选，就能看清消耗主要集中在哪里。

需要进一步核对用量变化时，再查看相关任务和轮次的记录。

### 改完以后，再确认一次

人工修改文件后，重新检查相关提醒是否解决。处理记录会保留，之后可以回看当时的决定。

<details>
<summary>查看示例：一份项目说明文件值得精简吗？</summary>

原型中，一份较大的 AGENTS.md 关联了两条读取记录，并提供相关任务轮次的入口。你可以先看当时做了什么，再判断是否要精简文件。

![Wombat AGENTS.md 建议详情：读取记录、相关轮次、Token 用量和 API 估算金额](assets/prototype-review-zh.jpg)

图中的 576K Token 是关联轮次的总用量，其中也包含其他操作。这项总量不能用来确定文件本身消耗了多少 Token，也不能预测精简后的节省。Wombat 不知道这份文件当时的内容。

</details>

## 开始使用

**产品尚未发布，计划通过 npm 安装。** 发布后，安装并启动：

```sh
npm install -g @wangyan9110/wombat
wombat web --open
```

浏览器会自动打开；如未打开，使用终端输出的完整链接。

需要 Node.js **22+**。npm 按平台安装预编译内核；使用已发布包无需 Rust、pnpm 或编译器。历史任务与用量依赖本机 Codex 记录；配置静态检查无需用量历史。

指定项目和自定义日志目录的方法见 [CLI 指南](docs/guides/cli.md)，平台支持情况见[支持矩阵](docs/reference/support-matrix.md)。

<details>
<summary>从源码运行，或使用 CLI</summary>

npm 发布前，可以克隆本仓库，准备 Node.js 26.4.0+、Corepack、pnpm，以及 `rust-toolchain.toml` 指定的 Rust 版本。

在仓库目录中执行：

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

## 隐私与费用

Wombat 读取本地 Codex 日志与已授权的配置，分析和存储都在本机完成。不上传对话，不修改来源日志或配置。当前分析无需 API Key 或模型调用。

金额根据已记录的 Token 用量和官方标准 API 单价估算，不代表订阅账单或 Codex 剩余额度。缺少单价时显示未知；数据不完整时，结果标为部分结果。

<details>
<summary>本机保存的信息与价表下载</summary>

本机用量索引不保存用户消息、模型回复正文、完整命令参数或工具输出，但可能保留任务标题、项目路径和工具名称。分享截图或 JSON 前，请先检查这些内容。

缺少模型单价时，Wombat 可能下载官方价格文档，请求不发送本机日志。如需关闭自动价表下载，使用：

```sh
WOMBAT_AUTO_PRICES=0 wombat web --open
```

更多信息见[隐私说明](docs/reference/privacy.md)与[价格说明](docs/reference/pricing.md)。

</details>

<details>
<summary>常见问题</summary>

**配置清单里出现了，就代表使用过吗？**

清单只说明 Wombat 找到了这个条目，不证明运行时加载或使用过。读过 Skill 文件不代表调用过 Skill；MCP 次数统计的是可识别的调用尝试，不代表调用成功。缺少使用依据时，保持未知。

**用量可以查看哪些明细？**

可以查看相关任务、已记录的轮次、操作和用量，不提供完整对话正文回放。

**会自动修复配置吗？**

是否修改由你决定，文件也由你手动编辑。Wombat 提供提醒依据、处理记录和修改后复查，不自动修改配置，也不预测节省。静态检查通过不保证运行时有效。MCP 当前支持盘点和调用尝试记录，不提供完整健康诊断。

**能解释 Codex 额度为什么突然下降吗？**

可以帮你找到本机记录中的高消耗任务，但不能确定 OpenAI 的订阅额度算法，也不能证明剩余额度变化的原因。

**为什么没有用量数据？**

先确认本机已有包含用量的 Codex 日志，再检查时间和项目筛选是否包含这些记录。默认读取 `CODEX_HOME` 或 `~/.codex`。自定义日志目录和项目范围的方法见 [CLI 指南](docs/guides/cli.md)。

</details>

## 一起完善 Wombat

目前支持 Codex，Claude Code、pi 等 Agent 在计划中。

你希望看清 AI 工作中的什么问题，或改善哪部分体验？欢迎在 [Issues](https://github.com/wangyan9110/wombat/issues) 分享具体场景、使用的工具和目前的处理办法，无需提供私人日志。

贡献方式见[贡献指南](CONTRIBUTING.zh-CN.md)。安全问题按[安全说明](SECURITY.zh-CN.md)反馈。

## 许可证

[MIT](LICENSE)。依赖许可见[第三方声明](THIRD_PARTY_NOTICES.md)。
