# Wombat Decision Notes

[中文](README.md) | English

Decision Notes preserve rationale that code and current guides cannot carry: the problem, the chosen approach, alternatives actually considered, costs, and verification evidence. They are not task lists or the sole authority on product state; source, contracts, and the [support matrix](../reference/support-matrix.en.md) still establish current behavior.

## Creation and status

Project decisions belong in `docs/decisions/` for all maintainers to consult. Reusable agent workflows belong in `.agents/skills/`, and standing rules belong in the applicable directory's `AGENTS.md`.

- `proposed/<class>/YYYY-MM-DD-topic.md` records an unshipped decision with `Status: proposed`.
- `implemented/<class>/YYYY-MM-DD-topic.md` records a shipped decision with `Status: implemented` and stays factually current with code.
- `rejected/<class>/YYYY-MM-DD-topic.md` keeps a declined proposal while it prevents a plausible repeated mistake, with `Status: rejected`.

Classes are limited to `architecture`, `product`, and `process`. Pair each Chinese source with sibling `.en.md` and `.i18n.json` files under the [bilingual workflow](../i18n/README.en.md). Create a note only when its rationale has lasting value; mechanical and local changes need none.

## Content and verification

Put status after the title and language switcher. A proposal contains Problem, Proposal, Alternatives considered, and Acceptance criteria; an implemented note contains Problem, Decision, Alternatives considered, and Consequences and verification; a rejected note retains its proposal body and gives a short rejection reason on the status line. Record only alternatives that were actually discussed. Run `corepack pnpm notes:check` for path, status, and structure; `corepack pnpm docs:i18n:check` checks the language pair.

## Record index

| Status | Decision |
|---|---|
| implemented | [Independent accounting and source adapters](implemented/architecture/2026-09-30-independent-accounting.en.md) |
| implemented | [Immutable snapshots](implemented/architecture/2026-09-30-snapshot-storage.en.md) |
| implemented | [Product localization boundaries](implemented/architecture/2026-09-30-localization.en.md) |
| implemented | [Daily, weekly, and monthly defaults](implemented/product/2026-09-30-report-ranges.en.md) |
| implemented | [Repository rules and bilingual confirmation](implemented/process/2026-09-30-repository-guidance.en.md) |
| proposed | [Full live usage plan (partially delivered)](proposed/architecture/2026-09-30-live-usage.en.md) |
| proposed | [GUI and CLI and CLI+Web technical routes](proposed/architecture/2026-10-01-gui-technical-routes.en.md) |
| implemented | [Official price checks for missing rates](implemented/architecture/2026-09-30-automatic-prices.en.md) |
| implemented | [Report distribution and full-range queries](implemented/product/2026-09-30-report-distribution.en.md) |
| implemented | [Portable npm and local transport](implemented/architecture/2026-09-30-portable-npm.en.md) |
| implemented | [Local Web and shared frontend](implemented/architecture/2026-10-01-local-web.en.md) |
| implemented | [Remove TUI product and tools](implemented/architecture/2026-10-01-remove-tui.en.md) |
| implemented | [Rust live queries and failure isolation](implemented/architecture/2026-10-01-rust-live-query.en.md) |
| proposed | [Four-entry Web and configuration usage analysis](proposed/architecture/2026-10-01-config-analysis-web.en.md) |
| implemented | [Read-only configuration and composite views](implemented/architecture/2026-10-01-config-inventory.en.md) |
| implemented | [Configuration measurement and manual review records](implemented/architecture/2026-10-02-config-reviews.en.md) |
| implemented | [Compact live index and replacement algorithm](implemented/architecture/2026-10-02-compact-live-index.en.md) |
| implemented | [Startup and bounded static rules](implemented/architecture/2026-10-02-startup-static-rules.en.md) |
| implemented | [Physical configuration identity and complete rechecks](implemented/architecture/2026-10-02-rule-review-integrity.en.md) |
