# 决策记录：GUI 技术路线调研

中文 | [English](2026-10-01-gui-technical-routes.en.md)

Status: proposed

实施更新（2026-10-01）：本地 Web 已采用 Node HTTP 与 React / TypeScript / Vite，见[本地 Web 决策](../../implemented/architecture/2026-10-01-local-web.md)。以下保留调研时基线；Tauri 2 仍为已选桌面框架，TUI 产品代码与专用 Skill 已移除，桌面交付仍未完成。

调研日期为 2026-10-01。本记录面向开发维护者，保存桌面框架、内核接入方式、CLI 与 Web 共存及验证取舍。桌面框架已选定 Tauri 2；产品方向是去掉 TUI，保留 GUI 和 CLI，并提供 CLI+Web 版本。完整产品方案正在另行编写，这里不确定具体功能、页面、交互或交付平台顺序。框架选型已确定，但尚未实施 GUI/Web、移除 TUI 或取得性能实测。按仓库生命周期保留 proposed，表示工程未交付，不表示框架仍待选。

## 问题

需要比较 GUI、CLI 与 CLI+Web 的运行成本、现有实现复用程度和维护成本。当前代码仍包含 CLI/TUI，模块边界见[架构](../../../development/architecture.md)，实际支持范围见[支持矩阵](../../../reference/support-matrix.md)。TUI 退出属于尚未实施的产品方向，当前产品边界只作为调研基线，不用于限制后续产品方案。

源码依据：通用 [UsageClient](../../../../client/src/client.ts)提供生成契约校验、查询、价表与可选实时接口；[Node 宿主](../../../../client/src/node/core.ts)管理内核子进程；[实时传输](../../../../client/src/node/live.ts)连接共享服务；[价表传输](../../../../client/src/node/prices.ts)负责受限下载。共享 [Rust library](../../../../core/src/lib.rs)和可执行入口已经存在，但直接嵌入桌面宿主的生命周期尚未验收。

## 方案

### 已选框架与内核接入

桌面采用 Tauri 2，业务复用现有 Rust 内核。框架和内核接入是两个决策：Tauri 可以调用独立内核，也可以链接 Rust library；接入方式仍需验证，不能据此把已选桌面框架重新列为待定。选择 Web UI 不要求运行 Node 服务。React/TypeScript/Vite 仅为前端候选，组件体系待产品需求明确后评估。Tauri 支持静态前端，官方推荐用 Vite 接入常见单页框架。[前端配置](https://v2.tauri.app/start/frontend/)

| 接入方式 | 潜在收益 | 代价与待验证点 |
|---|---|---|
| 独立 Rust 内核进程 | 延续现有协议与故障隔离，可复用按需服务 | 进程打包、通信复制、启动与取消、服务版本协商；Tauri 支持附带平台二进制 |
| 进程内 Rust library | 减少宿主到内核的一层进程通信 | 阻塞任务调度、协作取消、崩溃影响及与 CLI 共用索引的所有权需设计 |

优先验证独立进程是基于现有实现的工程判断，不是性能结论。Tauri 的[附带程序机制](https://v2.tauri.app/develop/sidecar/)要求为各目标准备对应二进制。

### GUI 与 CLI 及 CLI+Web 的位置

目标入口包括桌面 GUI、无需 TTY 的 CLI，以及由 CLI 启动本地服务并在浏览器使用的 CLI+Web 版本。CLI 启动细节和命令名称待定。当前 TUI 由 CLI 装配，未来移除；本次只记录方向，不执行迁移。新的业务能力应由共享内核和契约承载，供保留的入口消费；具体功能及入口覆盖由产品方案确定。

| 入口 | 当前或目标宿主 | 技术责任 |
|---|---|---|
| CLI JSON 与文本 | 现有 Node 宿主 | 参数、退出码、机器输出；帮助和普通查询不加载 OpenTUI |
| GUI | 已选 Tauri 2 宿主，待实施 | 窗口及桌面运行环境，实现受限传输并复用业务契约 |
| CLI+Web | 待实施的本地服务与浏览器 | CLI 管理启动与停止，浏览器通过受限 HTTP 接口访问同一业务契约 |

性能对照区分一次性 CLI、持续运行 GUI 和 CLI+Web；记录相同数据、缓存与查询条件，分别计入进程启动和驻留开销，Web 版本应同时说明浏览器进程的统计范围。各版本可能独立升级，共用服务前需验证运行中服务的协议、存储及能力兼容性；不能只检查随包二进制。取消一个客户端不得误杀其他入口使用的共享服务。

现行[多入口开发约定](../../../development/workflow.md)仍描述 CLI/TUI 基线。实施产品迁移时需同步修订约定、支持矩阵与发行清单；本调研不把目标写成当前已交付能力。

### 桌面与 Web 的复用候选

Tauri 桌面版拟与 CLI+Web 共享前端模块和生成契约，通过注入传输区分 Tauri IPC 与本地 HTTP。前端公共模块不直接导入 Node 或 Tauri 宿主实现；桌面专有能力经明确接口适配。该复用方案尚未实施，实际复用比例待验证。

CLI+Web 的本地服务可由 Node 承接以复用现有宿主，也可由 Rust 承接以减少运行时层次，二者尚未选型。先评估 loopback 访问、每次启动的访问凭据、Origin/Host 校验、跨站请求和 DNS rebinding 防护、资源与连接上限、浏览器关闭及 CLI 退出后的清理。接口限定产品操作，不能把通用内核 dispatch 直接映射到 HTTP。远程访问、局域网共享或托管部署未确定，需要独立的身份与安全设计。

### 宿主与通信边界

- 复用 Rust 生成的 DTO、校验和共享语言服务；宿主适配不维护第二套业务字段或计价规则。
- 将取消信号和进度回调映射为请求标识、取消操作及进度通道；核实断开连接与停止工作各自的语义。
- Tauri 需要补齐 Node 当前承担的受限下载、进程和连接管理，保留离线、超时、输出上限和失败回执。
- 大响应与持续推送单独验证复制、积压、顺序和订阅释放。Tauri 普通事件不适合高吞吐或大消息；Channel 是流式传输候选，不自动证明端到端背压已实现。[通信说明](https://v2.tauri.app/develop/calling-frontend/)
- 页面只获得明确产品操作；校验调用者和参数，不暴露任意命令、文件写入或通用内核 dispatch。Tauri 自定义应用命令需要显式配置权限边界。[权限说明](https://v2.tauri.app/security/capabilities/)

## 考虑过的方案

下表保留已选路线及实际考虑过的替代方案，框架能力描述来自官方资料。Electron 和纯 Rust GUI 仅保留为取舍记录，不是当前并行推进的桌面候选。

| 路线 | 技术特点与复用 | 成本与当前判断 |
|---|---|---|
| Tauri 2 与 Web UI | Rust 宿主，系统 WebView；可复用通用 TS 客户端与语言服务 | 已选定；依据是分发体积与 Rust 架构匹配，仍需适配宿主并逐平台验证，不代表性能已证实最好 |
| Electron 与 Web UI | Chromium 渲染与 Node 宿主；现有 Node 传输复用机会最多 | 未采用，保留取舍依据；运行时随包分发，需验证内置 Node、打包路径和生命周期并持续升级 |
| 纯 Rust GUI，如 Iced 或 GPUI | Rust 界面和内核衔接，独立于 WebView | 未采用，保留取舍依据；TS 展示与语言服务复用减少，浏览器界面通常需另外实现 |
| CLI+Web 本地服务与浏览器 | 已明确要保留的版本方向；可与 Web UI 桌面方案共享前端及契约 | 具体实现待选；增加 HTTP、访问鉴权、端口及服务生命周期，不能直接沿用私有 socket 的安全假设 |

框架依据：[Tauri 进程模型](https://v2.tauri.app/concept/process-model/)、[Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)、[Iced](https://github.com/iced-rs/iced)、[GPUI](https://gpui.rs/)。Electron 当前支持最近三个稳定版本；这是持续维护成本。[支持政策](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)

### 性能判断的边界

Tauri 不捆绑完整浏览器引擎，具备较小分发体积的架构优势；启动和内存可能受益，但须测量完整进程树。系统 WebView 的渲染表现与版本随平台变化，不能概括为 Tauri 性能最好。[WebView 版本](https://v2.tauri.app/reference/webview-versions/)

相同 Rust 内核下，扫描、计价与查询的主要算法成本不会仅因更换外壳消失；通信与渲染仍可能改变整链路耗时。现有来源归并和大规模索引的资源边界继续适用，详见[当前架构](../../../development/architecture.md)。没有采用空窗口数据或他人基准作为本项目性能证据。

## 验收条件

下列是已选路线的工程验证项，尚未执行；用于确定实现细节与验收能力。使用不依赖最终产品页面的合成载体，固定数据、release 构建、系统版本、缓存条件及测量方式。

| 验证维度 | 要保存的证据 |
|---|---|
| 运行成本 | 安装体积、冷启动、空闲 CPU、完整进程树内存、长时运行趋势；说明共享页统计方式 |
| 通信与取消 | 不同响应大小的耗时与峰值内存、连续推送、积压、超时、取消及退出清理 |
| 结果一致性 | 相同查询和固定数据下 CLI/GUI/CLI+Web 业务结果一致，分页和展示不改变汇总 |
| 共存与恢复 | 多入口并发、内核崩溃、重连、旧服务存活、版本不兼容与存储迁移 |
| 桌面兼容 | 中文输入法、字体、缩放、焦点、辅助功能、睡眠恢复和目标系统差异 |
| Web 宿主 | 桌面与浏览器前端复用、访问凭据、Origin/Host 与跨站防护、端口冲突、服务关闭及多标签页连接释放 |
| 测试与分发 | 真实应用自动化、签名、公证、干净安装、更新失败恢复、依赖许可及目标平台 CI |

Tauri 当前官方推荐的 WebdriverIO 嵌入式驱动支持 macOS、Windows 和 Linux；直接使用传统 tauri-driver 的桌面路径限 Windows/Linux。测试插件应限于测试构建，浏览器模拟不替代真实应用和最终安装包验收。[测试说明](https://v2.tauri.app/develop/tests/webdriver/)

分发需分别评估[系统签名与公证](https://v2.tauri.app/distribute/sign/macos/)和[应用更新签名](https://v2.tauri.app/plugin/updater/)，应用更新与业务价表更新属于不同机制。在已选 Tauri 2 的基础上，核实技术限制并取得基准，再结合产品方案确定内核接入方式、前端组件与平台支持。
