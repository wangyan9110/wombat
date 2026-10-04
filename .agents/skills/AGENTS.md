# Repository Skill Instructions

Follow [root instructions](../../AGENTS.md). Skills are task-loaded workflows, not product facts or repository-wide standing rules.

- Use .agents/skills/<kebab-name>/SKILL.md. Frontmatter name matches the directory; description states the task, trigger, and limits. Keep actionable steps and reachable relative references.
- Link product behavior, APIs, and limitations to their owners. Put standing rules in the applicable AGENTS.md; do not duplicate decisions across Skills.
- Keep supporting scripts, references, and examples with their Skill. Exclude private prototypes, account data, and local absolute paths.
- Run corepack pnpm skills:check after changes; run corepack pnpm repo:check for repository rules and references.
