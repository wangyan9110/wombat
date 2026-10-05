---
name: wombat-docs
description: Restructure or maintain Wombat documentation, scoped instructions, and decision records; verify ownership, current facts, bilingual changes, and repository checks.
---

# Wombat Documentation Maintenance

Find the reader's task and authoritative owner before editing. Follow [documentation instructions](../../../docs/AGENTS.md); this Skill owns maintenance procedure, not product behavior.

For restructuring, read [maintenance procedure](references/maintenance.md). For a local correction, read only the affected owner and incoming references.

- Root README changes: read [reader workflow](references/readme.md).
- Decision lifecycle or consolidation: read [decision maintenance](references/decisions.md).
- Chinese/English paired edits: read [bilingual maintenance](references/translation.md).

Preserve unique rationale, limitations, unfinished acceptance, and untouched translations.

Use `corepack pnpm docs:check` for documentation and `corepack pnpm skills:verify -- --scope repository` for rules/tools; the latter includes whitespace checks. Record only named, semantically reviewed language pairs with `corepack pnpm docs:i18n:record -- <Chinese file>`. Do not re-record blindly or start translation agents automatically.

Report owners changed, duplication removed, checks actually run, and unverified operations in the task. Do not add a maintenance ledger.
