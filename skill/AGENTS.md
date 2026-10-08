# User Skill Instructions

Follow [root instructions](../AGENTS.md). This directory owns versioned user Skill source; .agents/skills/ owns repository development workflows.

- Keep each entry in skill/<kebab-name>/SKILL.md with matching name and a precise description. Load substantial references only for relevant tasks; colocate needed scripts and metadata.
- Reuse public CLI/contracts. Keep business behavior in its owning module and standing rules in AGENTS.md.
- Generate install/plugin resources from this source; packaged plugins use skills/<name>/. Source ownership does not establish host discovery.
- One Skill serves Chinese and English. Follow user language choices and existing Web preferences; use shared locale messages for product copy. Preserve protocol values and source text.
- Use synthetic examples, no credentials or machine-specific paths. Public prose follows the [bilingual workflow](../docs/i18n/README.en.md).
- Run skills:check and repo:check; validate installation, initialization and real task behavior separately.

- skill/collection/ owns the local plugin Hook declarations and minimal POSIX bridge; it is not a Skill entry. Keep parsing, storage and status in the runtime.
