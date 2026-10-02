# 分发状态与公开简介

中文 | [English](distribution.en.md)

## 当前状态

根工作区保持`private: true`，当前没有已验收的公开 npm 发行。计划包名为`@wangyan9110/wombat`，命令为`wombat`，运行环境为Node.js 26.4.0或更新。README中的安装方式仍标为发布后的计划，平台验收以[支持矩阵](support-matrix.md)为准。

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

npm打包只在暂存副本调用`scripts/npm-readme.ts`，把相对图片、Logo和双语/文档链接固定到公共引用。发布前须核对真实已公开的标签或提交包含对应README、图片与文档，并验证无需登录的访问和npm渲染。当前新物料尚未提交推送，没有已核验的公开引用；转换器单元测试仅证明链接改写，不证明远端资源存在。

本轮只落实文案、资产和公开清单，未生成通用npm候选、试装、更新远端简介或发行。后续按[发行Skill](../../.agents/skills/wombat-release/SKILL.md)执行平台产物、安装和公开引用验收；准备候选不等于获得发布授权。实际检查记录见[进度](../project/progress.md)。
