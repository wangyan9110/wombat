# Repository Skill Instructions

Follow [root instructions](../../AGENTS.md). Skills are task workflows, not product facts or standing rules.

- Use .agents/skills/<kebab-name>/SKILL.md. Match frontmatter name to the directory; state task, trigger, limits, and reachable references.
- Link product behavior, APIs, and limitations to their owners. Put standing rules in the applicable AGENTS.md; do not duplicate decisions across Skills.
- Skills use a primary script for programmable/computable work; add an entry instead of manual steps or command sequences. Keep lower-level commands for diagnosis.
- Keep supporting scripts, references, and examples with their Skill. Exclude private prototypes, account data, and absolute paths.
- Run `skills:check`; use `repo:check` for repository rules and references.
