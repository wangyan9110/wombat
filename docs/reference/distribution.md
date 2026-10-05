# 分发状态与公开简介

中文 | [English](distribution.en.md)

## 当前状态

Wombat 以 GitHub Releases 为唯一产品分发渠道，不发布 npm 包。根工作区的 npm 包保持 `private: true`，只用于源码开发。`v0.1.0-dev.2` 是首个公开 Development Preview；`v0.1.0-beta.1` 是当前 Beta 测试版，仍通过 GitHub Pre-release 分发。预发行版本可能调整功能、数据格式和命令。源码工具要求 Node.js 26.4.0 或更新版本，用户安装包已内置固定的 Node.js 26.4.0、CLI/Web 和本机 Rust 内核，无需另装 Node、npm、Rust、pnpm 或编译器。

发行自动化只使用 GitHub 的免费能力：公开仓库的 CI 和标签发行使用标准 GitHub 托管运行器，不使用收费的 larger runner。Actions 中间产物只保留 1 天，最终归档进入 GitHub Release。带预发行段的版本创建 Pre-release，不占用 `latest` 稳定版入口。

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

## 根 README 维护规则

本节适用于仓库根目录的 `README.md` 和 `README.zh-CN.md`。维护时遵循 [GitHub README 指南](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)、[用户页面与文案规则](../i18n/product.md)和[双语审校规则](../i18n/README.md)。技术说明采用 ASD-STE100；产品介绍和短标题保持目标语言的自然表达。搜索优化采用 [Google SEO 基础指南](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)中适用于公开内容的原则，不将独立网站的配置要求套用到 GitHub README。

- 面向首次访问的用户，开头说明 Wombat 是什么、适合谁、解决什么问题。随后提供当前版本状态、安装与首次使用、主要用途、必要限制，以及帮助、贡献、安全和许可证入口。开发细节链接到对应文档，不让读者先理解内部架构才能开始使用。
- 快速开始以首次安装、没有项目背景知识的用户为基准。先说明适用系统、必要的来源记录或目录授权，以及需要了解的数据与费用边界，再按最短可用路径给出安装、启动、首次读取和查看结果的步骤。说明到哪里执行、如何判断成功，以及浏览器未打开、没有记录或读取失败时实际可用的下一步。普通安装与源码开发分开；可选功能和升级说明不打断首次使用路径。术语和缩写首次出现时按需要解释，不假定用户懂内部名称或已有配置。
- 安装、升级、使用步骤和故障说明须按 ASD-STE100 的[写作与词典审校要求](../i18n/README.md)检查。操作用主动语态和明确动词，每步聚焦一项操作；先说明条件和必要警告，再给出动作、可观察结果及有依据的失败处理。统一对象名称，保留命令、版本、路径、数量、单位和否定范围。中英文同步技术含义，中文保持自然表达。未完成官方规则和词典审校时，不声明 README 已符合该标准。
- 介绍内容以当前能力为依据，明确区分可用功能、产品方向和计划支持。版本、安装命令、平台与验收范围须与当前发行事实一致；金额、额度、隐私和优化效果保留各自限制。不为宣传或关键词覆盖扩大功能承诺。
- 保持一个主标题和清晰的标题层级。标题、首段和相关小节自然使用产品名、已支持的来源名称和实际用途词，例如 Codex、Token 用量及 API 费用估算；中英文按各自读者的搜索表达撰写。每个小节回答明确问题，避免只用口号代替用途说明。
- SEO 以有用、准确、便于理解的内容为先。不得设置关键词密度指标，反复堆叠同义词，加入隐藏关键词或用未支持的 Agent 与热门功能引流。不要为了搜索词重复已有段落；不承诺搜索收录、排名、流量或转化效果。
- 链接文字说明内容或操作，仓库内文档和图片优先使用相对路径。修改标题或路径后检查章节锚点及入站链接。重要的用途和上手说明保留为文字；截图配有准确的替代文本，并使用已审校、无私人信息的对应语言图片。渲染后检查窄屏、深浅主题及语言切换链接。
- README、仓库 About、Topics 和包描述须表达一致的产品定位，关键词只反映真实范围。Topics 按 [GitHub Topics 指南](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)选择相关主题。本地文案变更不等于远端元数据已更新；记录和报告实际状态，遵循现有发布授权范围。
- 版本、安装或升级方式、功能、平台支持、页面名称和文档路径变化时，在同一次改动中复核并更新受影响的 README 段落、双语记录、链接及相关描述。发行前对照版本清单、安装脚本、当前实现和实际验收结果；候选版本与已发布版本须区分，不只改版本号或更新时间。完整细节由所属模块或参考文档维护，README 只保留必要摘要和入口，减少重复内容过期的风险。
- ASD-STE100 须注明采用的版本；修改相关规则时查阅官方标准，不无依据改成「最新版」。SEO 与 GitHub 指南变动时，复核本规则是否仍适用。命令、链接和版本一致性沿用现有发行与仓库检查；功能承诺、译文和外部规范仍须人工审阅。无法核实的现状明确标注范围，不沿用旧验收结论，也不以刷新日期代替复核。
- 中英文保留相同的事实、安装步骤和限制，同时分别使用自然的标题、句式及链接文字。只为经过审校的配对更新确认记录。按首次用户的阅读顺序复核：能否判断是否适用、找到准备条件、完成首次操作、理解结果并找到帮助。结合现有安装验收复核快速开始，不将作者已有环境视为用户默认环境；报告实际验证的平台和未覆盖步骤。审阅正文、GitHub 渲染效果、版本与链接后运行仓库检查；机械检查不能证明语言质量、首次使用体验或 SEO 效果。

## GitHub 简介

仓库已经公开，About 描述和 Topics 已与当前产品范围同步：

```json
{
  "about": "Review Codex token usage and task timing locally. Estimate API costs, inspect AGENTS.md, Skills, MCP, and Hooks, and send evidence-backed recommendations to Codex.",
  "topics": ["codex", "token-usage", "usage-tracker", "agent-skills", "agents-md", "mcp", "cli", "web"],
  "summaryZh": "在本机回看 Codex 任务、追踪 Token 用量与 API 估算金额，检查 AGENTS.md 和 Skill 文件，盘点 MCP 配置及调用尝试记录。"
}
```

当前能力不使用 Claude Code、pi、自动修复或订阅额度监控作为标签；其他 Agent 仍是计划。来源事实、静态文件检查、调用尝试和运行时有效性不能混用。准备候选不授权公开仓库或创建 Release。
