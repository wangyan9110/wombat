# Decision Note: Report defaults follow grouping granularity

[中文](2026-09-30-report-ranges.md) | English

Status: implemented

Update (2026-10-01): terminal-specific behavior below is historical after [TUI removal](../architecture/2026-10-01-remove-tui.en.md). Current Web scope and navigation follow the [frontend contract](../../../../ui/README.en.md); shared core query semantics remain authoritative.

## Problem

The seven-day default applied to all groups. The terminal also copied response dates into requests, limiting weekly and monthly reports to the latest week.

## Decision

The shared core selects thirty days for daily reports, the current month plus five preceding months for weekly reports, and the current month plus eleven preceding months for monthly reports, through today in the selected timezone. Explicit dates, complete-thread and undated scopes take precedence. The terminal preserves implicit request dates and displays resolved response dates; “Follow report” restores automatic ranges; changing TUI periods also restores them while retaining model and project filters.

## Alternatives considered

Only the current week/month limits comparison with preceding periods; all history expands routine queries. We therefore use bounded windows of multiple periods. Computing dates only in the UI would diverge from the CLI, so the core owns date calculations.

## Impact and verification

This changes the default range of daily/weekly/monthly requests without dates, without changing collection, snapshots or protocol fields. Fixed date boundaries, synthetic CLI ledgers, native interactions and PTY switching cover verification. Execution results belong in the verification records retained in Git history.
