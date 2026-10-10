# Decision Note: Task statistics and host-driven monitoring

[中文](2026-10-09-task-statistics-monitoring.md) | English

Status: implemented

## Problem

Answering whether a task is unusually large, why usage grew, or when a user budget was crossed requires repeatable statistics over the same ledger and scope. Reconstructing these facts in a conversation repeats work and can mix populations. The user requests these capabilities together with recurring budget checks and reviews.

## Decision

Rust owns task-population statistics and descriptive change comparisons. Hosts consume generated results through the same public client. User budgets and acknowledgements live outside rebuildable indexes. CLI watch and an explicitly enabled Web loop drive checks during their own lifetimes.

This partially supersedes only the exclusion of continuous monitoring in G13 of the [optimization lifecycle proposal](../../proposed/product/2026-10-03-optimization-lifecycle.en.md). The one-query review and evidence distinctions remain applicable. Host-driven checks do not install a background scheduler. G05 continuous inactivity and the full G08 adoption requirements remain proposed: bounded no-recorded-use intervals and supported native version matches provide useful evidence without completing those requirements.

## Alternatives considered

Conversation-side calculations reuse no durable statistic contract and can mix scope or pagination. Shared Rust queries provide deterministic populations and let Codex explain results. A dedicated background service would add an installation and lifecycle responsibility; explicit running hosts satisfy the current local monitoring request while making their lifetime visible.

## Consequences and verification

Monitoring requires an active host and newly logged usage. Notifications bind the authorized source set so one restricted host cannot consume another host's crossing notice. Reviews can receive a new fact revision when late data changes them; acknowledgements remain separate. Read/load content matches and equal elapsed before/after windows do not establish behavioral adoption or causal savings.

The [core reference](../../../../core/README.en.md) owns methods and limits; the [CLI guide](../../../guides/cli.en.md) owns user operations. Independent synthetic tests cover quantiles, growth reconciliation, incomplete populations, durable deduplication and acknowledgement, generated contracts, and source-restricted CLI/Web delivery. The live benchmark also checks task distributions against its fixture oracle; it does not certify arbitrary-history investigation performance.
