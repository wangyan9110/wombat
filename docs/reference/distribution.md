# 分发状态与公开简介

中文 | [English](distribution.en.md)

## 当前状态

根工作区保持`private: true`，当前没有已验收的公开 npm 发行。计划包名为`@wangyan9110/wombat`，命令为`wombat`，npm运行要求Node.js 22或更新，源码工具要求26.4.0或更新。README中的安装方式仍标为发布后的计划，平台验收以[支持矩阵](support-matrix.md)为准。

## npm 安装与发行结构

发布后执行`npm install -g @wangyan9110/wombat`，再执行`wombat web --open`或CLI查询。用户只需Node/npm；无需Rust、pnpm、编译器或安装后的下载脚本。主包打包CLI依赖与Web静态资产，不携带Node运行时。

主包不含原生内核。五个平台分别通过`optionalDependencies`的精确别名安装同一包名的平台版本，例如`@wangyan9110/wombat-darwin-arm64`指向`npm:@wangyan9110/wombat@0.3.0-darwin-arm64`。npm的os/cpu/libc筛选仅下载本机组件；内核解析核对版本、平台和来源提交。跳过可选依赖明确返回CORE_UNAVAILABLE及`--include=optional`恢复命令，不回退开发二进制；不支持的平台明确拒绝。版本规则见[决策](../decisions/implemented/architecture/2026-10-03-npm-platform-distribution.md)。

`npm:pack -- --name @wangyan9110/wombat --native-dir native-artifacts`生成一个主包、五个平台版本及带SHA-256的release-set.json。原生产物须同版本/提交，内核和平台许可库存均校验；Windows检查静态CRT和编译器DLL导入。`--current-platform`仅生成本机候选。`--reuse-build`仍校验源码与构建产物指纹并执行真实安装；不能复用过期构建。

候选通过临时loopback registry执行真实npm全局安装，核对仅下载主包/本机平台包，在空PATH下运行实时、追加、固定快照与Web查询，并验证缺失可选依赖。测试使用合成来源和临时数据目录。CI汇总五个平台同一源码，再逐平台安装这一组候选；Node22为最低运行验证，macOS arm64额外覆盖24/26。配置了CI不等于已在目标机器验收。

按[发行Skill](../../.agents/skills/wombat-release/SKILL.md)先发布五个平台版本并使用明确的非latest标签，确认远端精确版本及完整性后，最后发布主版本。当前没有公开发布，不提供旧发行迁移承诺。已通过的本机安装与未验证的平台记录见[进度](../project/progress.md)。

## GitHub 简介候选

以下是待外部应用的候选，不代表GitHub About或Topics已经更新。npm的description和keywords由根`package.json`管理，与GitHub Topics分别维护。

```json
{
  "about": "Review Codex tasks and token usage locally. Estimate API costs, check AGENTS.md and Skills, and view MCP entries and call attempts. Web app + CLI.",
  "topics": ["codex", "token-usage", "usage-tracker", "agent-skills", "agents-md", "mcp", "cli", "web"],
  "summaryZh": "在本机回看 Codex 任务、追踪 Token 用量与 API 估算金额，检查 AGENTS.md 和 Skill 文件，盘点 MCP 配置及调用尝试记录。"
}
```

当前能力不使用Claude Code、pi、自动修复或订阅额度监控作为标签；其他Agent仍是计划。来源事实、静态文件检查、调用尝试和运行时有效性不能混用。

## README 与包内材料

根README保留相对图片、双语和文档链接，每种语言两张图，第二张在详情折叠内。四张JPEG是注明来源类型的设计原型预览；两份SVG分别供浅色与深色Logo使用。包清单仅包含这六份资产，旧图仍供历史记录引用，但不随当前包分发。图片不作为正式产品验收或收益证据。

npm打包只在暂存副本调用`scripts/npm-readme.ts`，把相对图片、Logo和双语/文档链接固定到公共引用。发布前须核对真实已公开的标签或提交包含对应README、图片与文档，并验证无需登录的访问和npm渲染。当前新物料的免登录访问和npm渲染尚未核验；源码提交和推送不代替公开引用验收，转换器单元测试仅证明链接改写，不证明远端资源存在。

实际检查记录见[进度](../project/progress.md)；候选准备不更新GitHub简介，也不代表发布授权。
