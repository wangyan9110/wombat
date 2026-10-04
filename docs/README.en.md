# Wombat documentation

[中文](README.md) | English

Choose documentation by task. Source code, technical references, and implementation evidence define current behavior. Specifications and proposals describe targets; historical results apply only to their recorded builds.

## User guides · guides

- [CLI and machine interface](guides/cli.en.md): startup, refresh, queries, filters, JSON, and errors.
- [Web frontend](../ui/README.en.md): usage, conversations, drill-down, and current UI scope.
- Start installation and building from the [project homepage](../README.md).

## Technical references · reference

- [Distribution and public descriptions](reference/distribution.en.md): unreleased status, GitHub description candidates and README asset boundaries.
- [Pricing rules](reference/pricing.en.md): official evidence, cost policies, unknown values, and explicit updates.
- [Privacy and data boundaries](reference/privacy.en.md): local reads/writes, body allowlists, and public materials.
- [Generated schemas](schemas/) and the [dependency license inventory](dependency-licenses.json) are machine-maintained references.

## Developer documentation · development

- [Architecture](development/architecture.en.md): modules, dependencies, data flow, storage, and failures.
- [Multi-entry development workflow](development/workflow.en.md): delivering and verifying the same business capability.
- [Contracts](development/contracts.en.md): Rust source of truth, generated types, versions, and formats.
- [Source adapter acceptance](development/adapters.en.md): independent truth, attribution, and failure cases.
- [Four-entry Web and configuration analysis proposal](decisions/proposed/architecture/2026-10-01-config-analysis-web.en.md): shared Rust contracts, configuration evidence, versions and phased acceptance; partly delivered with remaining stages pending acceptance.
- [Contributing](../CONTRIBUTING.md) provides repository workflow entry points.

## Project status · project

- [Version-one specification](project/specification.en.md) maintains requirements and acceptance criteria.
- [Codex Skill product plan](project/codex-skill.en.md) defines task workflows, CLI capability mapping and local installation boundaries.
- [Configuration measurement/manual review upgrade](project/config-upgrade.en.md) maintains additional requirements and boundaries.
- [Startup and deterministic rule upgrade](project/startup-rules.en.md) maintains startup-state and static-rule specifications, phase A/B work, and conditional capabilities still awaiting implementation.
- [Implementation status](project/status.en.md) tracks current delivery and remaining acceptance.

## Decisions and documentation maintenance

The [decision directory](decisions/README.en.md) preserves lasting rationale, alternatives, and costs, distinguishing proposed, implemented, and rejected records. When consolidating existing pages, extract useful tradeoffs into decisions, retain current operations in guides, delete obsolete and repeated passages, and preserve dates and scope for verification results.

Public prose follows the [bilingual workflow](i18n/README.en.md); instruction files, the terminology table, and machine evidence are exempt as listed in the manifest. Read the [documentation rules](AGENTS.md) before editing. Product localization is defined separately in the [language contract](i18n/product.en.md); document translation does not change protocol values or original source text.
