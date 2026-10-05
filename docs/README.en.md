# Wombat documentation

[中文](README.md) | English

Choose documentation by task. Source code, technical references, and implementation evidence define current behavior. Unfinished proposals describe targets; historical results apply only to their recorded builds.

## User guides · guides

- [Install and update](guides/installation.en.md): supported systems, one-command setup, recovery, updates, and version selection.
- [CLI and machine interface](guides/cli.en.md): startup, refresh, queries, filters, JSON, and errors.
- [Web frontend](../ui/README.en.md): usage, tasks, detail views, and current UI scope.
- Start with the [project homepage](../README.md).

## Technical references · reference

- [Pricing rules](reference/pricing.en.md): official evidence, cost policies, unknown values, and explicit updates.
- [Privacy and data boundaries](reference/privacy.en.md): local reads/writes, body allowlists, and public materials.
- Tools maintain the [generated schemas](schemas/) and [dependency license inventory](dependency-licenses.json) for reference.

## Developer documentation · development

- [Architecture](development/architecture.en.md): modules, dependencies, data flow, storage, and failures.
- [Multi-entry development workflow](development/workflow.en.md): delivering and verifying the same business capability.
- [Contracts](development/contracts.en.md): Rust source of truth, generated types, versions, and formats.
- [Source adapter acceptance](development/adapters.en.md): independent truth, data attribution, and failure cases.
- [GitHub distribution decision](decisions/implemented/architecture/2026-10-04-github-release-distribution.en.md): durable packaging and channel rationale. Repeatable release operations belong to the [release Skill](../.agents/skills/wombat-release/SKILL.md).
- [Contributing](../CONTRIBUTING.md) provides repository workflow entry points.

## Decisions and documentation maintenance

[Proposed decisions](decisions/proposed/) own unfinished requirements, designs, and acceptance criteria. Module guides and technical references own delivered behavior; tests, CI, or necessary artifacts retain run evidence.

The [decision directory](decisions/README.en.md) preserves lasting rationale, alternatives, and costs, distinguishing proposed, implemented, and rejected records. When consolidating existing pages, extract useful tradeoffs into decisions, retain current operations in guides, delete obsolete and repeated passages, and preserve dates and scope for verification results.

Public prose follows the [bilingual workflow](i18n/README.en.md); instruction files, the terminology table, and machine evidence are exempt as listed in the manifest. Read the [documentation rules](AGENTS.md) before editing. Product localization is defined separately in the [language contract](i18n/product.en.md); document translation does not change protocol values or original source text.
