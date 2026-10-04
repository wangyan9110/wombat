# Initialization and continuous discovery

[中文](initialization.md) | English

2026-10-04. This document defines one read flow for first run, later runs, and projects added while Wombat is running. It supplements the [version-one specification](specification.en.md) and [startup rules](startup-rules.en.md). The [architecture](../development/architecture.en.md) and source remain authoritative for implementation status.

## Goals

Wombat restores usable results first, then incrementally reads supported local Agent sources. Projects do not require registration. When reliable session metadata provides a working directory, that project enters the local project catalog and its usage is indexed automatically. Selecting it allows current configuration reads without a separate authorization step.

Creating a folder alone is not project evidence. Wombat does not scan the whole disk to guess projects. A new directory appears after a supported Agent actually uses it and records that use in a source. Extra sources or directories absent from history can still be added through the system directory picker.

## Unified flow

1. **Connect to the local service.** Render the shell first. Connection, preferences, and account reads do not block one another.
2. **Discover sources.** Adapters inspect default locations, startup arguments, and added sources. Raw logs remain read-only.
3. **Restore a committed result.** When an index exists, return the last complete commit before checking changes in the background. One failed update never removes the old result.
4. **Read incrementally.** First run reads active and archived history. Later runs process only added, appended, replaced, or removed source files. Cursors, derived facts, and the published revision update in one transaction.
5. **Build the project catalog.** Extract project observations from reliable session working directories. Append new projects without moving existing identities; records with unknown attribution remain unassigned.
6. **Publish usable results.** The current implementation publishes immutable usage revisions and can expose a bounded provisional task view. A future per-project commit may say “Ready to view” only when that project has records that can actually be opened.
7. **Follow in the background.** Visible Overview, Tasks, and Sources pages check for new revisions. The local service also watches known source roots and uses short periodic checks as a fallback. A new revision does not replace the user’s current reading position.

Reopening, page recovery, and projects added at runtime all enter steps 3–7. There is no separate one-time import state, and initialization is never inferred from whether a button was clicked.

## Project discovery and current configuration

The project catalog comes from `facets.directories` in the shared Rust usage result. The local Web host accepts only startup or system-picker directories and projects already observed by the current source synchronization. A browser-supplied arbitrary path cannot expand the read scope.

When a project configuration URL is opened directly, the host first synchronizes current sources incrementally. If the requested path is present in the resulting project catalog, only that project is added to the current configuration read; otherwise the request is rejected explicitly. New projects therefore do not require an Overview visit or a host restart. Configuration, Optimize, and Codex handoff share this decision.

Automatic import imports derived identities and index facts only. It does not copy raw logs, execute project files, or modify Agent configuration. Configuration files are read on demand when the user enters a project. Project discovery itself never invokes Hooks, MCP servers, scripts, or Codex.

## First-read UI

With no usable result, the main area keeps the heading “Preparing your history,” one purpose sentence, and the currently confirmed activity. Before project evidence exists, show “Finding source records.” Once projects are identified, show the count and a stable list. Project states are Waiting, Loading, Ready to view, or an explicit failure. Do not show inferred percentages, remaining time, or per-file logs.

As soon as a project has openable records, the user can enter its task list while a single notice says history is still loading and totals are incomplete. Completion must not navigate the user back to Overview or close current content. Disambiguate same-named projects by working directory. If only working directories are known, describe them as such; do not automatically count every worktree as a separate project.

Stop waiting aborts only the current page request and follow-up. Committed results remain and shared reading may continue. Continue observes current state again; it does not clear the index or start another full scan unconditionally. One failed project does not clear successful projects. Future project-level retry rereads only the failed object.

## State and data boundaries

Initialization depends on the read cycle, source states, committed revisions, and usable results. The page never infers history size from elapsed time and never treats the presence of `data` as proof of completeness. Project narration requires real events for:

- read-cycle and source identities;
- project or working-directory identity, display name, and path;
- waiting, reading, committed-usable, or failed state;
- an openable task or revision reference;
- coverage gaps, cancellation scope, and error code.

These events must come incrementally from the existing scan. Do not parse all logs a second time just to count projects. Several projects may read in parallel, and finishing one file does not prove that a project is complete. Assistive narration combines updates and changes only when the count, active project, or usability changes.

## Current implementation and gaps

Implemented: source discovery, active and archived history, transactional incremental indexing, file notification with periodic checks, last-commit restore, global first-read state, bounded provisional tasks, automatic checks on visible pages, automatic project-catalog additions, and direct configuration reads for observed projects. Synthetic end-to-end coverage includes projects present before host startup, projects added after startup, and rejection of browser-forged paths.

Not implemented: per-project read events, per-project progressive commits, stable project/worktree attribution, per-project failure presentation, and per-project retry. Without those events, the UI continues to show a truthful generic stage. The complete first-read page is not considered implemented from copy or a synthetic prototype alone.

## Verification

Functional acceptance covers at least an empty index, background refresh with old results, a project added while the host is running, a direct configuration URL for the added project, same-named directories, unassigned records, one failed source, cancel and resume, an unreadable project, and arbitrary path injection. Tests use synthetic logs and temporary directories outside the repository and never read real conversations.
