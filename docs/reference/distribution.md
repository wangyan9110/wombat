# 分发状态与公开简介

中文 | [English](distribution.en.md)

## 当前状态

Wombat 以 GitHub Releases 为唯一产品分发渠道，不发布 npm 包。根工作区的 npm 包保持 `private: true`，只用于源码开发。`v0.1.0-dev.2` 是首个公开 Development Preview；`v0.1.0-beta.1` 是当前 Beta 测试版，仍通过 GitHub Pre-release 分发。预发行版本可能调整功能、数据格式和命令。源码工具要求 Node.js 26.4.0 或更新版本，用户安装包已内置固定的 Node.js 26.4.0、CLI/Web 和本机 Rust 内核，无需另装 Node、npm、Rust、pnpm 或编译器。

发行自动化只使用 GitHub 的免费能力：仓库私有期间不启动 GitHub 托管构建，公开后 CI 和标签发行使用标准 GitHub 托管运行器，不使用收费的 larger runner。Actions 中间产物只保留 1 天，最终归档进入 GitHub Release。带预发行段的版本创建 Pre-release，不占用 `latest` 稳定版入口。

## 一键安装与升级

macOS / Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh
```

预发行版本须指定版本，例如：

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh -s -- --version 0.1.0-beta.1
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1 | iex
```

预发行版本：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1))) -Version 0.1.0-beta.1
```

安装器识别本机平台，下载对应的 `wombat-<target>.tar.gz` 和 `SHA256SUMS`，校验后安装到 `~/.local`。`WOMBAT_INSTALL_PREFIX` 或 `--prefix` 可改安装位置；`--version` 可安装指定版本；`--base-url` 供开发候选或受控镜像验收。安装器只替换带 Wombat 管理标记的目录和命令，不覆盖不明文件。

通过安装器部署后，执行 `wombat update` 下载并安装最新稳定 Release；`wombat update --check` 只检查，`--version X.Y.Z` 安装指定版本。预览版不会进入 `latest`，升级到后续预览版时须显式指定版本。版本保存在并列目录，校验元数据、文件大小和 SHA-256 后原子切换 `current.txt`。正在运行的旧版本不会被覆盖，适用于 Windows 的占用规则；升级器保留当前和上一运行版本，并清理更早的受管版本。源码构建或手工解压副本不带安装指针，升级命令会明确拒绝。

## GitHub Release 结构

每个版本包含五个平台归档：macOS arm64/x64、Linux glibc arm64/x64、Windows x64。每份归档只包含对应平台的 Rust 内核、打包后的 CLI/Web、Node.js 26.4.0 运行时、Wombat 许可、依赖许可库存和 Node 运行时许可。`release-set.json` 绑定版本、源码提交、源码/构建指纹、平台、归档大小及 SHA-256；`SHA256SUMS` 供安装器和人工复核。

各平台在同一提交上运行发行门禁并导出原生产物。汇总作业拒绝版本、提交、内核、运行时或许可哈希不一致的输入；随后五个平台分别解压最终归档，在不依赖系统 Node 的条件下验证版本、实时用量、追加记录、固定快照、任务查询和 Web。`v<package version>` 标签通过全部验证后才创建 GitHub Release，并为平台归档生成构建来源证明。构建和候选准备本身不会上传或发布。

本机开发候选使用：

```sh
corepack pnpm build
corepack pnpm github:pack -- --current-platform --reuse-build --runtime-license /path/to/node/LICENSE
```

完整五平台候选使用 `--native-dir <artifacts>`。`--reuse-build` 仍校验源码与构建产物指纹，不能复用过期构建。当前归档的实际验收以对应 Release/CI 结果为准，发行步骤见[发行 Skill](../../.agents/skills/wombat-release/SKILL.md)。

## GitHub 简介

About 描述已应用到 GitHub；仓库仍为私有。Topics 是公开前待应用的候选，当前 GitHub Topics 尚未同步：

```json
{
  "about": "Review Codex token usage and task timing locally. Estimate API costs, inspect AGENTS.md, Skills, MCP, and Hooks, and send evidence-backed recommendations to Codex.",
  "topicsCandidate": ["codex", "token-usage", "usage-tracker", "agent-skills", "agents-md", "mcp", "cli", "web"],
  "summaryZh": "在本机回看 Codex 任务、追踪 Token 用量与 API 估算金额，检查 AGENTS.md 和 Skill 文件，盘点 MCP 配置及调用尝试记录。"
}
```

当前能力不使用 Claude Code、pi、自动修复或订阅额度监控作为标签；其他 Agent 仍是计划。来源事实、静态文件检查、调用尝试和运行时有效性不能混用。准备候选不授权公开仓库或创建 Release。
