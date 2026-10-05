# Skill Instructions

Follow [root instructions](../../AGENTS.md). Skills own workflows, not product facts.

- Use `<kebab-name>/SKILL.md`; match frontmatter name and state task/trigger.
- Keep purpose, authorization, constraints, and routing in SKILL.md. Link conditional detail in references with when to read it; never load all by default. Short skills need no router.
- Link facts to owners. Keep scripts/resources with their Skill; exclude private data and absolute paths.
- Scripts resolve paths, validate arguments, bound subprocesses, and need no caller cwd or unrelated Skill. Use one `corepack pnpm` entry. Explain shared build/CI dependencies instead of copying them.
- Read scripts only to diagnose/edit. Test changed scripts and valid/invalid checks; run `skills:check` and `repo:check`.
