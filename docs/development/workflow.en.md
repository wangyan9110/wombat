# Development and delivery rules

[中文](workflow.md) | English

This page defines code-change and verification procedures. Module responsibilities belong in [architecture](architecture.en.md), product fields in [contracts](contracts.en.md), and repository constraints in [AGENTS.md](../../AGENTS.md).

## Code conventions

- Identify the domain owner and current consumers before choosing an implementation. New abstractions, options, and compatibility paths need a present requirement. Cross-module access uses public exports or protocols.
- Deliver new capabilities through Web and non-TTY interfaces. Generate public DTOs from Rust; check all consumers and cancellation, error, and state semantics when changing them.
- Validate untrusted data at configuration, file, process, and network entries; do not repeatedly simulate hostile input for typed same-process values. Keep TypeScript strict. Explain why narrowing is infeasible for new any or assertions; never use double assertions to bypass validation.
- Exhaust closed unions by their discriminants; open source values need an explicit unknown branch. Resolve defaults once at the owning entry and report invalid configuration at the earliest reliable point.
- Enforce authorization and version checks in the operation itself, not solely through disabled UI or wrapper filters. Verify that direct and alternate callers cannot bypass them.
- Give each asynchronous operation one lifecycle controller or transaction. Additional state needs an independent responsibility; settle success, failure, and cancellation. Cleanup waits boundedly for child work to stop, and late results cannot update expired views.
- Publish state and notifications only after durable commit succeeds; preserve committed facts on failure. Derive caches and presentation from the same authoritative result.
- Apply resource limits where the complete emitted or retained value is known, including envelopes, metadata, and multibyte encoding. Cover tiny limits, exact boundaries, and oversized single chunks.
- Limit catch blocks to the expected failing operation. Explain ignored errors and preserve observable failure. Callback exceptions must not break unrelated requests or cleanup.
- Comments describe caller-relevant behavior, failures, timing, and ownership. Link decision rationale instead of narrating code or review. Update the owning documentation with the change; local edits need no new decision.

## Verification

Run `corepack pnpm repo:check` for source rules without dist; CI runs it before platform builds. Follow [scripts/AGENTS.md](../../scripts/AGENTS.md) for check scripts and [wombat-verify](../../.agents/skills/wombat-verify/SKILL.md) for scope selection. Code review and relevant behavior tests verify the semantic conventions above; static checks do not claim complete coverage.

```sh
corepack pnpm build
corepack pnpm typecheck
corepack pnpm contracts:check
corepack pnpm test
~/.cargo/bin/cargo fmt --manifest-path core/Cargo.toml -- --check
~/.cargo/bin/cargo clippy --locked --manifest-path core/Cargo.toml --all-targets -- -D warnings
```

Select commands by changed scope; run all for full-chain changes. Cross-language tests use dist, so build first. Do not repeat unaffected passing checks. Product behavior changes require observable results through a real assembled entry; manually composed mocks alone cannot establish delivery. External services and nondeterministic inputs may be replaced. Accounting uses [independent truth](adapters.en.md), not old output as its only oracle.

Verify hosts, real core, browsers, and installed assets separately. Web checks cover narrow layouts, cancellation, failure, and return paths. Performance uses fixed fixtures and release builds, recording cache state, startup, elapsed time, peak memory, and result consistency separately; benchmark entry points are the package.json benchmark scripts.

For dependency changes run `corepack pnpm licenses:generate` and `corepack pnpm licenses:check`. Verify target platforms and clean installation under the [release Skill](../../.agents/skills/wombat-release/SKILL.md) and [distribution guide](../reference/distribution.en.md). Report actual verification only; builds do not establish product or platform acceptance.
