# 开发与交付约定

中文 | [English](workflow.en.md)

本页定义修改与验证流程；职责见[架构](architecture.md)，字段见[契约](contracts.md)，全仓约束见 [AGENTS.md](../../AGENTS.md)。

## 代码规范

- 按业务归属和当前消费者选择实现；新增抽象、选项和兼容路径须有现有需求。跨模块只用公开导出或协议。
- 新能力同步交付 Web 和无 TTY 接口；公共 DTO 从 Rust 生成，修改时检查所有消费者及取消、错误和状态语义。
- 在配置、文件、进程和网络入口校验不可信数据；已类型化的同进程值不重复校验。TypeScript 保持 strict；新增 any 或断言说明无法收窄的原因，禁止双重断言绕过校验。
- 封闭联合按判别字段穷尽处理；开放来源值有明确的未知分支。默认值由拥有该选项的入口一次解析，配置错误在最早可确认处报告。
- 授权与版本检查放在实际执行操作中，不能只靠页面禁用或包装层过滤；验证直接调用及其他入口也不能绕过。
- 一次异步操作由一个控制器或事务管理。额外状态须有独立职责；完成、失败与取消都要结算。清理须有界等待子任务退出，迟到结果不能更新失效视图。
- 持久提交成功后才发布状态或通知，失败保留已提交事实。缓存与展示从同一权威结果派生。
- 在完整输出或保留值可知处执行资源限制，包含信封、元数据及多字节编码；覆盖最小值、精确边界和单块超限。
- catch 只包围预期失败的操作；忽略错误须说明原因，保留可观察失败。回调异常不能破坏无关请求或清理。
- 注释写调用者所需的行为、失败、时机与所有权；理由链接决策，不复述代码或审阅。更新所属说明，局部改动不建决策。

UI/Web 手写 TypeScript 使用锁定的 Prettier：`corepack pnpm format:write` 格式化，`corepack pnpm format:check` 只读检查，已纳入 `repo:check`。生成契约由生成器维护。

## 验证

源码检查用 `corepack pnpm repo:check`，不依赖 dist，CI 在构建前运行。脚本按 [scripts/AGENTS.md](../../scripts/AGENTS.md)，范围用 [wombat-verify](../../.agents/skills/wombat-verify/SKILL.md)。语义规范由审阅和行为测试验证；静态检查不能全部覆盖。

```sh
corepack pnpm build
corepack pnpm typecheck
corepack pnpm contracts:check
corepack pnpm test
~/.cargo/bin/cargo fmt --manifest-path core/Cargo.toml -- --check
~/.cargo/bin/cargo clippy --locked --manifest-path core/Cargo.toml --all-targets -- -D warnings
```

按改动选命令，完整链路执行全部。跨语言测试先构建 dist；不重复未受影响的通过检查。产品行为须验证真实装配入口的可观察结果，手工 mock 不能证明交付；可替换外部服务和非确定输入。计量用[独立真值](adapters.md)，不以旧输出为唯一依据。

分别验证宿主、真实内核、浏览器及安装资产；Web 检查窄屏、取消、失败和返回路径。性能用固定语料和 release，记录缓存、启动、耗时、峰值内存与结果一致性；基准见 package.json 的 benchmark 脚本。

依赖变化运行 `corepack pnpm licenses:generate` 和 `corepack pnpm licenses:check`。发行按[发行 Skill](../../.agents/skills/wombat-release/SKILL.md)核验目标平台与干净安装。只报告本次实际验证，不以构建替代产品或平台验收。

### 失败排查

- 停止重试，保留阶段、日志、源码版本与环境；追查根因。不熟悉的行为先查上游文档，不能以重跑、调参或延长超时代替分析。
- 检查共享假设的调用方、平台、构建前置及 CI/发行流程；批量修复并补回归后验证。
- 先针对性复现整类问题，再统一检查确定的改动，之后才运行昂贵的平台或发行任务；只复用仍有效的通过证据。
