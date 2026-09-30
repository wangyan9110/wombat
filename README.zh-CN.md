# Wombat

中文 | [English](README.md)

本地 Codex 用量与对话查看工具。只有“用量 / 对话”两个入口：先看 Token 和费用，再找到高消耗轮次与实际操作。

通过 `--lang zh|en` 或 `WOMBAT_LANG` 选择中英文，终端主界面按 `L` 切换；优先级与边界见[产品语言](docs/i18n/product.md)。

## 从源码运行

需要 Node.js 26.4.0+、Corepack/pnpm 与 Rust（版本见 rust-toolchain.toml）。终端使用 OpenTUI，交互所需的 FFI 参数由命令入口自动处理。

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/wombat.js
```

- 用量：日 / 周 / 月、日期范围、模型、推理强度和项目筛选。
- 对话：跨天、跨模型；按消耗或最近活动排序，展开轮次和记录。
- 金额：按官方标准 API 价格离线折算，分项可查，与订阅实付分开。
- 自动化：默认增量同步，`--fresh`等待本次同步，`--cached`仅读缓存，`usage --watch --json`持续输出；固定版本按完整范围汇总后分页。

```sh
node dist/wombat.js refresh --root /path/to/codex-home --json
node dist/wombat.js usage --since 2026-09-23 --until 2026-09-30 --timezone Asia/Shanghai --json
node dist/wombat.js threads --sort tokens --json
node dist/wombat.js turns --thread THREAD_ID --json
node dist/wombat.js steps --thread THREAD_ID --turn TURN_ID --json
```

截止日期不包含该日。省略来源时读取 CODEX_HOME 或 ~/.codex，同时包含归档日志。实时查询可重复传 `--root` 指定多个来源目录。日报默认近7天，周报默认本周及之前3周，月报默认本月及之前11个月，均截止今天；手动日期优先，采集范围仍是历史记录。

Wombat 独立实现计量和计价，不依赖 ccusage；Token 与官方标准 API 等价金额共用账本，通用开源库按需复用。首版只接入 Codex，底层适配协议支持其他 Agent。原日志只读，快照不保存用户消息、模型正文、完整命令参数和工具输出。缺失或无法定价的记录保持未知；不把工具操作分摊成独立费用。

新版本移除旧额度、体检、环境/规则诊断、安装修复、观察、对比、导出与 HTML 报告入口。已有 v1/v2 快照仍可只读，更新生成 v3，不删除历史身份登记或恢复材料。

根目录采用独立的 `core/` 内核、`client/` 客户端、`tui/` 终端界面和 `cli/` 命令入口。各模块通过公开接口协作，其他界面可复用同一业务客户端；CLI 仅为交互会话启用所需的 FFI 参数。

当前为源码预览，OpenTUI 迁移验收正在进行，历史终端验证不替代新链路验收；先验收 macOS Apple Silicon；中英 CLI/TUI 已交付，未知内核诊断与来源原文仍可能保留原语言。其他平台、桌面产品和 Web 服务不在本次验收范围。

## 开发

开发时按范围运行相关检查。跨语言测试使用构建后的内核；OpenTUI 迁移验收与旧终端验证分开记录。

```sh
corepack pnpm build
corepack pnpm typecheck
corepack pnpm contracts:check
corepack pnpm test
corepack pnpm release:check
```

`release:check` 会构建和测试项目，检查契约、授权、仓库规则和发行包内容，再在临时目录安装打包产物并运行已安装的 CLI 与内核。安装会获取公开运行依赖，需要可访问软件包仓库。构建和检查不会发布软件。根目录使用 MIT 许可证，依赖许可和出处另行保留。贡献说明与第三方声明见下方链接。

## 可转移安装

在构建机器运行 `corepack pnpm release:bundle`。它通过完整发行检查后，在 `dist/releases/` 下生成按平台命名的目录，内含归档、SHA-256 清单和 `install.mjs`。如果其他测试仍在进行，可用 `corepack pnpm package:bundle` 生成本机试装候选包；它检查构建、包和隔离安装，但不运行全套测试。

将该目录复制到同平台、装有 Node.js 26.4.0+ 和 npm 的机器，在目录内运行 `node install.mjs`。安装程序会检查平台和归档哈希，获取公开运行依赖，安装到 `~/.local/share/wombat`，并测试已安装的命令与内核。它会输出命令的绝对路径；将其 `bin` 目录加入 PATH 后可直接运行 `wombat`。目标机器不需要 Rust、pnpm 或源码仓库。目前安装验收目标为 macOS Apple Silicon。

[终端操作](docs/guides/terminal.md) · [CLI 与 JSON](docs/guides/cli.md) · [价格依据](docs/reference/pricing.md) · [支持矩阵](docs/reference/support-matrix.md) · [实施跟踪](docs/project/status.md) · [验证记录](docs/project/progress.md) · [隐私](docs/reference/privacy.md) · [参与贡献](CONTRIBUTING.zh-CN.md) · [第三方声明](THIRD_PARTY_NOTICES.md)
