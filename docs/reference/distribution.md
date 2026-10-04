# 分发状态与公开简介

中文 | [English](distribution.en.md)

## 当前状态

Wombat 以 GitHub Releases 为唯一产品分发渠道，不发布 npm 包。根工作区保持 `private: true`，只用于源码开发。当前尚无公开 Release；README 中的一键安装命令在首个 Release 创建后生效。源码工具要求 Node.js 26.4.0 或更新版本，用户安装包已内置固定的 Node.js 26.4.0、CLI/Web 和本机 Rust 内核，无需另装 Node、npm、Rust、pnpm 或编译器。

## 一键安装与升级

macOS / Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1 | iex
```

安装器识别本机平台，下载对应的 `wombat-<target>.tar.gz` 和 `SHA256SUMS`，校验后安装到 `~/.local`。`WOMBAT_INSTALL_PREFIX` 或 `--prefix` 可改安装位置；`--version` 可安装指定版本；`--base-url` 供开发候选或受控镜像验收。安装器只替换带 Wombat 管理标记的目录和命令，不覆盖不明文件。

通过安装器部署后，执行 `wombat update` 下载并安装最新 Release；`wombat update --check` 只检查，`--version X.Y.Z` 安装指定版本。版本保存在并列目录，校验元数据、文件大小和 SHA-256 后原子切换 `current.txt`。正在运行的旧版本不会被覆盖，适用于 Windows 的占用规则；升级器保留当前和上一运行版本，并清理更早的受管版本。源码构建或手工解压副本不带安装指针，升级命令会明确拒绝。

## GitHub Release 结构

每个版本包含五个平台归档：macOS arm64/x64、Linux glibc arm64/x64、Windows x64。每份归档只包含对应平台的 Rust 内核、打包后的 CLI/Web、Node.js 26.4.0 运行时、Wombat 许可、依赖许可库存和 Node 运行时许可。`release-set.json` 绑定版本、源码提交、源码/构建指纹、平台、归档大小及 SHA-256；`SHA256SUMS` 供安装器和人工复核。

各平台在同一提交上运行发行门禁并导出原生产物。汇总作业拒绝版本、提交、内核、运行时或许可哈希不一致的输入；随后五个平台分别解压最终归档，在不依赖系统 Node 的条件下验证版本、实时用量、追加记录、固定快照、任务查询和 Web。`v<package version>` 标签通过全部验证后才创建 GitHub Release，并为平台归档生成构建来源证明。构建和候选准备本身不会上传或发布。

本机开发候选使用：

```sh
corepack pnpm build
corepack pnpm github:pack -- --current-platform --reuse-build --runtime-license /path/to/node/LICENSE
```

完整五平台候选使用 `--native-dir <artifacts>`。`--reuse-build` 仍校验源码与构建产物指纹，不能复用过期构建。平台边界和实际验收见[支持矩阵](support-matrix.md)，发行步骤见[发行 Skill](../../.agents/skills/wombat-release/SKILL.md)。

## GitHub 简介候选

以下内容待仓库公开时应用，不代表 About 或 Topics 已更新：

```json
{
  "about": "Review Codex tasks and token usage locally. Estimate API costs, check AGENTS.md and Skills, and view MCP entries and call attempts. Web app + CLI.",
  "topics": ["codex", "token-usage", "usage-tracker", "agent-skills", "agents-md", "mcp", "cli", "web"],
  "summaryZh": "在本机回看 Codex 任务、追踪 Token 用量与 API 估算金额，检查 AGENTS.md 和 Skill 文件，盘点 MCP 配置及调用尝试记录。"
}
```

当前能力不使用 Claude Code、pi、自动修复或订阅额度监控作为标签；其他 Agent 仍是计划。来源事实、静态文件检查、调用尝试和运行时有效性不能混用。准备候选不授权公开仓库或创建 Release。
