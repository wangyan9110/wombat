# Wombat Decision Notes

[中文](decision-maintenance.md) | English

This directory owns decision rationale, alternatives actually considered, costs, and required verification. Current behavior belongs in module READMEs or technical references. Retain only facts needed to explain tradeoffs and link their owners; do not duplicate interfaces, default-value inventories, or acceptance ledgers.

## When to record

Add or update a note in the same change only when lasting decision rationale is not explained by code, tests, or existing documentation. Search for and update the existing owner; that satisfies the rule without another note. Mechanical or local edits, including local UI presentation and interaction changes, are exempt. Never invent alternatives to fill a template.

A reversal requires a new cross-linked note; do not rewrite an old decision into its opposite. Each new note checks whether older notes are fully or partially superseded. For partial supersession, identify the replaced scope and rationale that remains applicable.

Unfinished requirements, proposals, and acceptance criteria belong only in the owning proposed decision, without separate product specifications or implementation-status tables. Link module guides, technical references, and tests for delivered behavior. Keep run results in tasks, CI, or necessary evidence artifacts; after implementation, replace acceptance plans with actual consequences and verification rather than retaining planning checklists.

## Status and discovery

Paths are `<status>/<class>/YYYY-MM-DD-topic.md`. The date is the first proposal date; classes are architecture, product, and process. Directories are the status index; do not maintain a separate itemized catalog.

- [proposed/](../decisions/proposed): uncompleted or partly implemented proposals. Partial delivery does not complete the whole proposal.
- [implemented/](../decisions/implemented): shipped decisions. Update referenced paths and mechanisms with code, without appending a change diary.
- `rejected/`: declined proposals with a brief reason on the status line. Retain only while they prevent a plausible repeated mistake.

Move or delete Chinese, English, and `.i18n.json` files together and repair all references. Lifecycle moves update Status and the body structure together; see the [pairing workflow](../i18n/workflow.en.md).

## Consolidation and deletion

A fully superseded note may merge into the current owner. Before deletion, preserve unique motivations, alternatives, consequences, required verification, and named coverage gaps; Git history alone is not sufficient for rationale. Keep partially superseded notes cross-linked. Do not delete by length, age, or quota.

Wombat does not add a frozen archive tree or archive manifest at this stage. Keep maintaining records that guide development, delete mechanical records without unique rationale, and evaluate others against the consolidation conditions above. Retrieve historical test output from tasks, CI, and Git instead of copying it into decisions.

## Content and verification

After the title and language switcher, write `Status: proposed`, `Status: implemented`, or `Status: rejected — reason`. Use the following sections by lifecycle:

| Status | Required sections |
|---|---|
| proposed | Problem, Proposal, Alternatives considered, Acceptance criteria |
| implemented | Problem, Decision, Alternatives considered, Consequences and verification |
| rejected | Problem, Proposal, Alternatives considered; retain the proposal body |

Use present tense for the applicable decision in implemented notes; clearly identify superseded choices as historical. Paths, names, and mechanisms may change, but do not retrospectively rewrite motivations or tradeoffs. After implementation, replace plans with actual consequences rather than retaining implementation checklists.

`corepack pnpm notes:check` validates paths, dates, status, and sections. `corepack pnpm docs:check` also checks structure, bilingual pairs, and references. Checks cannot establish whether alternatives were real or supersession is complete; review must confirm those.
