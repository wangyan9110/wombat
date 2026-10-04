---
name: wombat-release
description: 构建和发行 Wombat，准备 GitHub Release 独立归档，执行发行门禁、干净安装、升级及发布后核验；用于打包、版本发布和发行失败处理。
---

# Wombat 构建与发行

遵循[仓库约定](../../../AGENTS.md)、[开发流程](../../../docs/development/workflow.md)和[分发说明](../../../docs/reference/distribution.md)。本 Skill 编排现有脚本，不另建产品契约。

## 确定范围

- 区分本机构建、开发候选、五平台候选和公开 GitHub Release。准备候选不等于授权创建标签、Release 或修改仓库可见性。已有明确发布授权时继续；缺少授权时先完成候选和验证，再让用户确认具体版本、提交和归档。
- 查看分支、提交、暂存区和未提交改动。共享工作区仍在变化时使用隔离工作区，记录候选基线和额外补丁。不要清空用户工作，也不要混入真实日志、凭据或私有资料。
- 源码工具的 Node 版本读取根 `engines.node`；归档内置运行时版本读取 `scripts/github-release.ts`；Rust 读取 `rust-toolchain.toml`。使用锁文件安装依赖。
- 版本变化使用 `release:prepare` 同步清单、当前发布文档、双语记录与许可证清单。准备、提交、标签、GitHub Release 与仓库公开是不同动作。

## 使用现有入口

| 目标 | 入口 | 证明范围 |
|---|---|---|
| 准备版本 | `corepack pnpm release:prepare -- --version <version>` | 同步版本和当前发布文档，重录明确的双语配对并刷新许可证清单；不提交、不打标签、不发布 |
| 检查准备结果 | `corepack pnpm release:prepare -- --check` | 快速检查版本、双语记录、许可证清单和补丁格式；不替代完整发行门禁 |
| 本机开发构建 | `corepack pnpm build` | 编译内核、客户端、Web 和 CLI；不代表发行验收 |
| 无扫描启动探针 | `corepack pnpm release:probe` | 用不存在的来源目录启动共享服务并只读取能力声明，快速验证进程、套接字和 CLI 协议；要求已构建 `dist/` |
| 完整发行检查 | `corepack pnpm release:check` | 格式、Rust lint、构建、类型、契约、产品测试、许可、仓库规则和公开源码 |
| 本机开发候选 | `corepack pnpm github:pack -- --current-platform` | 生成并解压验证本机独立归档、校验和及 release-set；不上传 |
| 五平台候选 | `corepack pnpm github:pack -- --native-dir <artifacts>` | 校验同版本/提交的五个平台内核、运行时和许可，组装全部归档；不上传 |
| 平台导出 | `corepack pnpm native:export` | 导出本机内核、Node 运行时、许可证、版本、提交和哈希 |

`github:pack` 默认先调用 `release:check`。已经对完全相同源码执行门禁时，可在构建后使用 `--reuse-build`；它仍校验源码和产物指纹。源码、锁文件、发行脚本或清单变化后重新构建并验证，旧绿色结果不能覆盖新内容。

本地系统 Node 缺少随发行版安装的 LICENSE 时，`native:export` 或 `github:pack --current-platform` 使用 `--runtime-license <Node 26.4.0 官方 LICENSE>`。CI 的 setup-node 分发目录应自动提供该文件。不能用项目 MIT 许可证代替 Node 运行时许可证。

## 验证候选

1. 在隔离目录锁定安装依赖，运行对应入口。失败时记录准确阶段并修复，不跳过失败门禁。
2. 检查 `dist/github/release-set.json`、`SHA256SUMS` 和平台归档。每份归档必须只包含本机 Rust 内核、CLI/Web、Node 26.4.0 运行时、Wombat/依赖/运行时许可证及 `release.json`。
3. `scripts/verify-github-release.ts` 使用归档内运行时执行版本、空快照、实时用量、追加、固定快照、任务和 Web 端到端测试；应用 PATH 为空，不能意外使用系统 Node。测试使用合成来源和临时数据目录。
4. 用 `install.sh --base-url file://<dist/github>` 在仓库外前缀走一次真实一键安装，确认受管标记、版本目录、`current.txt`、命令入口和空 PATH 运行。Windows 使用 `install.ps1 -BaseUrl <URL>` 在目标机器验证。
5. `cli/tests/update.test.ts` 用本地模拟 Release 验证只检查、大小/SHA-256、归档安全检查和原子切换。实际 GitHub Release 创建后，再用 `wombat update --check` 与一次跨版本升级验收远端路径。
6. 报告实际归档路径、大小、SHA-256、来源提交、已通过平台和未验证范围。更换归档或重新构建后，原哈希和安装证据失效。

## GitHub Release

公开发布使用与 `package.json` 版本一致的 `v<version>` 标签。`.github/workflows/release.yml` 在五个平台分别运行发行门禁并导出原生载荷，汇总独立归档，再回到五个平台验证最终文件。全部通过后生成归档构建来源证明，并创建包含五份 tar.gz、`SHA256SUMS`、`release-set.json` 和安装器的 GitHub Release。

发布前呈现版本、标签、提交、五份归档及校验值、验证结果和未覆盖边界。没有发布授权时停在候选。不要手工重打通过验证的归档；Release 必须上传同一份文件。标签工作流失败时不创建替代标签来绕过问题，先修复并用新版本重新发行；已公开版本不覆盖。

发布后从 GitHub Release 重新下载归档，核对 SHA-256，在新的隔离前缀运行公开的一键安装命令，再验证版本、CLI、Web 和 `wombat update --check`。确认安装器原始地址无需登录访问。若远端状态不明，先查询 Release 和资产哈希，不重复上传。

## Development Preview 流程

首个公开预览从 `0.1.0-dev.1` 开始，后续候选递增 `dev.N`；进入 beta、RC 或稳定版必须由用户明确决定，不自行改变阶段。预览版使用 GitHub Pre-release，不占用稳定版 `latest`：README、安装验收和升级验收均显式传入版本。

1. 确认工作树和远端基线，选择唯一候选版本与标签 `v<version>`，执行 `corepack pnpm release:prepare -- --version <version>`。脚本先确认所有旧版本面一致，再统一更新根、`client`、`ui`、`web`、`cli`、Rust crate/锁文件、README、分发状态和实施状态，随后重录这三组双语配对并刷新许可证清单；任何预期文件缺失旧版本时停止，不提交、不打标签、不发布。
2. 人工审阅脚本产生的补丁，尤其是版本阶段、当前状态、平台边界和中英文语义；版本断言从根清单读取，不在测试中复制当前版本字符串。审阅后执行 `corepack pnpm release:prepare -- --check`。发行工作流根据标签中的预发行段设置 Pre-release；稳定版仍使用同一工作流。
3. 私有仓库只运行本机 `release:check`，GitHub 托管作业必须跳过。公开后只使用免费的标准 GitHub 托管运行器，不启用 larger runner；中间 Actions 产物保留 1 天。
4. 最终代码和文档确定后运行一次完整 `release:check`。门禁会在构建后先运行 `release:probe`，用无扫描能力请求快速定位共享服务启动、套接字或协议故障；后续产品测试仍负责真实扫描语义。失败后先做最小修正和定向复验；只有源码、版本、发行脚本、锁文件或清单继续变化时才重新运行完整门禁，不对相同内容机械重复构建。`release:prepare --check` 和 `release:probe` 只提供快速反馈，不能代替该门禁。
5. 提交并推送候选，公开仓库后在同一提交运行五平台 CI。全部通过才创建并推送匹配标签；标签工作流负责重建、汇总、最终归档五平台安装验证、来源证明和 Pre-release 创建。
6. 等待 Release 完成，读取 `release-set.json` 和 `SHA256SUMS`，从公开 URL 重新下载并核对五份归档。用版本化安装命令在仓库外干净前缀验收当前平台，再执行 `wombat update --check --version <version>`。
7. 将真实运行、归档哈希、平台结果和未覆盖边界写入任务或 Release 验证结果；验收变化更新实施状态。发布失败保留失败证据并使用新的递增预览版本修复，不移动或覆盖已公开标签。

## 收尾

用户安装包不要求 Node/npm、Rust、pnpm 或编译器。当前平台为 macOS arm64/x64、Linux glibc arm64/x64、Windows x64；musl、Windows ARM64 和旧系统不能在未验收时宣称支持。

结束时报告版本、提交、平台、门禁、归档与校验值、安装/升级证据、是否真的创建 Release，以及用户的一键安装命令。开发候选保留在 `dist/github/`，不表述为外部可安装版本。仅在不再需要且忽略文件已另存时清理隔离工作区。
