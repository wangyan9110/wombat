# Decision note: separate Skill availability from approximate adoption observations

[中文](2026-10-04-skill-observation.md) | English

Status: implemented

## Problem

Codex logs expose a per-turn available-Skill catalog but no structured `skill_invoked` event. Current files cannot establish enablement, read counts miss later reuse within a task, and calling every read an exact invocation would overstate the evidence.

## Decision

Model availability and activity separately. Native `host_skills.instructions` proves only that a catalog was available for its source, project and turn. Queries use the latest matching catalog for “Available in latest turn”; absence never becomes disabled.

Activity uses an explicitly approximate observation rule. A positive assistant statement matching a native catalog name, or a non-failed targeted `SKILL.md` read, creates one observation. Structured read paths are accepted directly. The `exec` wrapper recognizes only literal `cat`, `sed`, `head`, `tail` and `bat` commands and never executes or interprets arbitrary shell. One Skill counts once per task turn; related tasks, file reads and latest activity remain separate.

Catalog descriptions, assistant prose, commands and file bodies never enter derived facts. Associated turn tokens support navigation and investigation without allocation to a Skill.

## Alternatives considered

- Count only file reads: precise but clearly misses reuse inside a task and does not answer practical activity questions.
- Parse all prose or arbitrary shell: broader but likely to mistake discussion, searches and patch text for use while expanding attack and resource boundaries.
- Require every Skill to write a receipt: third-party Skills cannot be controlled consistently and this would complicate Agent integration.

## Consequences and verification

`usageCount` is now a task-turn-deduplicated observation, not an exact invocation count. No observation remains unknown and cannot mean unused or instructions not followed. The UI says “Observed uses” and exposes the method in details. Native catalogs and positive statements resolve only normalized identities from the current catalog; ordinary user text cannot forge them.

Rust fixtures cover catalog aliases, user-text spoof resistance, statements, literal reads, body exclusion and same-turn association. The synthetic CLI/Web end-to-end path covers latest availability, observed use, related tasks and independent read counts. See the [contract](../../../development/contracts.en.md) and [support matrix](../../../reference/support-matrix.en.md) for boundaries.
