# 项目 Skill 约定

本目录同时遵循[根目录约定](../../AGENTS.md)。每个 Skill 是一个按任务加载的工作流程，不是当前产品事实或长期全仓规则。

- 使用 `.agents/skills/<kebab-name>/SKILL.md`，frontmatter 的 `name` 与目录一致，`description` 明确任务、触发条件和边界；正文保留可执行步骤与所需的相对引用。
- 产品行为、接口和限制引用源码或所属文档；长期规则放适用目录的 `AGENTS.md`。避免在多个 Skill 中复制同一判断。
- 脚本、参考资料和示例放同一 Skill 目录，引用需可达。私人原型、账户数据和本机绝对路径不能进入仓库。
- 新增或修改 Skill 后运行 `corepack pnpm skills:check`；跨仓库规则和引用同时运行 `corepack pnpm repo:check`。
