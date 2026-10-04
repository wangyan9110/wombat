# Contributing

English | [中文](CONTRIBUTING.zh-CN.md)

Wombat uses a shared Rust core and a Node CLI/Web. Read [AGENTS.md](AGENTS.md), [architecture](docs/development/architecture.en.md), and [development](docs/development/workflow.en.md).

Install locked dependencies, build, then run type checking, generated contract checks and tests. Cross-language tests use dist and must run after a build. Rust changes require formatting and clippy with warnings denied.

For documentation or Skill changes, update both languages where paired and run `corepack pnpm docs:check`.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm typecheck
corepack pnpm contracts:check
corepack pnpm repo:check
corepack pnpm test
```

Keep business rules in Rust. Adapters normalize source facts; pricing and queries operate on Wombat types. Web and automation must use the same contract. Do not add a ccusage build, runtime or test dependency. Independent synthetic expectations cover counting and money; snapshot regeneration is not an oracle.

Never commit real messages, tool output, credentials or unaudited raw fields. Preserve user changes and user-owned data. Read-only collection must not mutate source files. No arbitrary execution capabilities belong in rendering interfaces.

Dependency changes require license review and `licenses:generate` / `licenses:check`. Before packaging run `public:check`; this is a guard, not a publication or complete security audit. Record actual tested platforms and limits, not planned capabilities. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Review and automation

Provide a minimal synthetic reproduction, version, platform, expected and observed behavior for bug reports. Explain changes and actual validation in pull requests; never attach private logs. Suspected vulnerabilities follow [Security](SECURITY.md).

CI builds and checks five native targets, exports the core and bundled Node.js runtime, and assembles five self-contained GitHub Release archives only when all native artifacts match. The final archive is exercised on every target without relying on a system Node runtime. Source tools use Node 26.4.0+. Each target exports its own dependency license inventory and Node runtime license; the checked-in dependency inventory is the macOS arm64 baseline. Other targets regenerate their inventory in CI before checking. CLI and local Web require separate acceptance. Tag workflows publish only after the full matrix passes; ordinary CI never publishes or changes repository visibility.

Run `corepack pnpm audit --audit-level moderate` after dependency updates. The current pnpm audit may identify the local workspace directory `cli` as the unrelated npm package of that name; verify the lockfile path before treating that low-severity entry as a shipped dependency. This does not suppress actual advisories. Rust advisories are checked with cargo-audit 0.22.2 against `core/Cargo.lock`.
