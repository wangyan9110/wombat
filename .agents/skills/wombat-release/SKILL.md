---
name: wombat-release
description: 构建和发行 Wombat，准备 npm 候选包，执行发行门禁、干净安装及发布后核验；用于打包、版本发布和发行失败处理。
---

# Wombat 构建与发行

遵循[仓库约定](../../../AGENTS.md)和[开发流程](../../../docs/development/workflow.md)。本 Skill 编排现有脚本；产品范围、支持平台与运行要求分别读取[支持矩阵](../../../docs/reference/support-matrix.md)、`package.json` 和发行脚本，不在这里另建一套产品契约。

## 确定产物与基线

- 区分用户要构建、生成 npm 候选，还是公开发布；沿用对话中已有的包名、版本、平台、渠道和发布授权。登录成功、创建 Skill 或准备候选本身不代表授权公开上传。已明确要求发布时无需重复确认；缺少授权时先完成候选与验证，再就具体产物询问。
- 查看分支、提交、暂存区和未提交改动。确认候选包含哪些改动；共享工作区仍在变化时使用可用的隔离工作区，并记录提交与额外补丁。不要把其他任务的代码、真实数据或凭据混入包，也不要为了打包清空用户工作。
- 源码工具的Node要求读取根 `engines.node`，npm运行要求读取 `scripts/npm-layout.ts`；pnpm读取 `packageManager`，Rust读取 `rust-toolchain.toml`；使用锁文件安装依赖。npm 通用候选必须提供五个平台的原生产物；目标与本机试装方式见下文，其他平台未经运行不能宣称已验收。
- 需要换版本时同步根、`client/`、`ui/`、`web/`、`cli/` 的 package.json 及 Rust crate/锁文件中的项目版本，保持校验一致。准备、提交、Git 标签、GitHub Release 和 npm 发布是不同动作，按用户范围执行。

## 选择现有入口

命令从选定工作区根目录执行。先读取对应脚本，确认其实际步骤；复用已经覆盖的检查。

| 目标 | 入口 | 证明范围 |
|---|---|---|
| 本机开发构建 | `corepack pnpm build` | 编译内核、客户端、Web 和 CLI，组装 dist；不代表发行验收 |
| 完整发行检查 | `corepack pnpm release:check` | 格式、Rust lint、构建、类型、契约、产品测试、许可、仓库规则、公开包与隔离安装 |
| npm 候选包 | `corepack pnpm npm:pack -- --name @wangyan9110/wombat --native-dir native-artifacts` | 校验五个平台产物、完整门禁、一个主包/五个平台版本及本机干净安装；不上传 |

npm 包名已选为 `@wangyan9110/wombat`；用户变更时使用其明确选择。根包保持 `private: true`，由 [npm 打包脚本](../../../scripts/prepare-npm-package.ts)创建公开包元数据；不能为了发布直接移除根包保护或上传整个工作区。安装后的命令仍为 `wombat`。

`native:export` 从已构建和验证的目标导出内核、版本、提交、内核和许可哈希及许可库存；CI 收集 macOS arm64/x64、Linux glibc arm64/x64、Windows x64。通用候选需同一提交、同一版本的全部产物。`npm:pack -- --name @wangyan9110/wombat --current-platform` 仅生成带平台限制的本机试装候选，不作为跨平台发行包。汇总后仍需五个平台安装同一最终发行组；CLI 与本机 Web 分别验收。

`npm:pack` 已调用 `release:check`；不要紧接着再完整跑一次相同门禁。打包期间源文件、锁文件或发行清单发生变化时，重新生成受影响产物并验证，旧绿色结果不能覆盖新内容。

## 验证候选

1. 首次准备发行在隔离目录执行锁定安装，然后选择上表对应入口。记录失败阶段与准确错误，定位并修复原因后重跑受影响路径；不跳过失败门禁来宣布可发行。网络、登录或权限失败不能解释为包名可用或测试通过。
2. 交叉语言测试使用 dist，必须先构建。检查 [package:check](../../../scripts/check-package.mjs)的版本一致性、内核与许可哈希、执行权限、命令链接、空目录安装、CLI/内核及实时服务结果。空数据的 `usage --cached --json` 应报 NO_SNAPSHOT；普通实时查询可成功返回空结果，不能用旧行为判断安装失败。
3. 涉及 Web 或首个平台发行时，在相同候选上验证本机宿主、CLI 与真实内核一致性、浏览器交互及退出清理。通过 `WOMBAT_WEB_TEST_ENTRY` 指向隔离安装后的入口运行 Web 端到端测试；不以构建通过替代浏览器验收。
4. npm 页面引用图片时，使用 `npm:pack -- --name @wangyan9110/wombat --native-dir native-artifacts --public-ref <公开标签或提交>` 固定 README 链接；默认 main 仅供候选准备。发布前核实该引用已包含 README 与图片、无需登录即可访问；检查两份 README、6 份白名单资产（4 张 JPEG 和 2 个 SVG Logo）、语言切换和第二张图的折叠。GitHub README 保留相对路径，npm 转换只作用于暂存副本。检查发行组中每份 tgz 的文件清单、包名、版本、平台限制、Node 要求、bin、依赖和许可。记录实际归档路径、大小与 SHA-256；后续发布使用这一份已测试的归档。包内不含开发依赖、私人材料或认证配置；公开检查以实际生成物为准。
5. 报告已通过和未验证范围。需要仓库完成记录时使用双语[进度](../../../docs/project/progress.md)；真实来源的结果仅存仓库外。更换归档或重新构建后更新其验证依据。

## npm 登录与发布

只在需要 npm 时执行本节。注册、网页登录和 2FA 由用户在本机完成；不索取、回显或保存密码、Token、一次性验证码、恢复码，也不读取认证配置来展示其内容。

```sh
npm whoami --registry=https://registry.npmjs.org
npm view @wangyan9110/wombat version dist-tags --json --registry=https://registry.npmjs.org
```

确认账号拥有命名空间或包维护权限。未认证的 404 只代表没有可见包，不能证明私有包不存在；同一包的已有版本不能覆盖。按版本和用户意图选择 dist-tag，预发布不要意外替换 latest。

发布前向用户呈现具体名称、版本、平台、基线、归档及验证结果。已有明确公开发布授权时继续；否则此时确认，不能在尚未准备候选时索要空泛批准。

先读取候选release-set.json并复核每份归档SHA-256。发行组共六个版本，包名相同；先逐个平台上传平台版本，使用明确的非latest标签（例如native-darwin-arm64），逐份查询精确版本及完整性。全部平台可用后最后上传主版本，按用户授权设置latest或预发布渠道。禁止平台版本覆盖latest；若某平台上传失败，主版本不发布。

使用 `npm publish <已验证的tgz路径> --access public --tag <已确定的渠道> --registry=https://registry.npmjs.org` 上传这一份归档。若需要交互验证，在本机完成 npm 提供的认证流程。不得用聊天中的恢复码尝试登录。遇到超时或返回不明，先查远端版本及 `dist.integrity` 与本地归档是否匹配；结果未知时停止重复上传，不能盲目增版或修改已有发布。

发布成功后重新查询精确版本及完整性，在新的临时目录从 registry 安装 `@wangyan9110/wombat@<版本>`，验证版本、命令与内核，再按风险补实际浏览器旅程。此安装使用隔离的 CODEX_HOME 和 WOMBAT_DATA_HOME；只读验证不得访问用户真实对话。确认 registry 安装通过后才报告“外部可安装”，并给出带版本的安装命令、包页面、支持平台和 Node 要求。

若远端已发布但安装失败，如实报告当前远端状态，保留版本与错误证据；修复、新版本、修改 dist-tag 或弃用均按用户授权处理，不自动删除包。

## npm 安装与收尾

用户只需Node/npm，通过`npm install -g @wangyan9110/wombat`安装，使用`wombat web --open`或CLI查询。运行最低Node22，开发工具仍为26.4.0+；不携带Node，不依赖用户Rust/pnpm/编译器，不通过postinstall下载二进制。支持系统ABI与浏览器仍有边界，不能宣称任意机器可运行。

`--reuse-build`只能复用源码与产物指纹完全一致的构建，不能绕过产物检查；原生导出也核对回执。`verify-npm-install.ts --set <release-set.json> --runtime <Node路径>`通过临时loopback registry执行真实全局安装，检查仅下载本机可选依赖、缺失依赖错误、空PATH下CLI/内核/Web运行；测试用隔离prefix、合成来源和临时数据，不能扫描用户日志。CI逐平台安装最终发行组，以Node22验证最低兼容性，并在macOS arm64增加24/26。配置CI不是运行通过证据。

结束时报告包名/版本、来源提交及补丁、平台、检查结果、归档/校验值、是否真的发布以及用户安装方法。未发布时给出本地候选而非registry可安装承诺。保留待发布归档及必要证据；隔离工作区只在无需继续使用且忽略文件已另存时归档。
