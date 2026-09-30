# Contributing

English | [中文](CONTRIBUTING.zh-CN.md)

Wombat uses a shared Rust core and a Node CLI/TUI. Read [AGENTS.md](AGENTS.md), [architecture](docs/architecture.md), [development](docs/development.md) and the [v1 specification](docs/usage-threads-v1.md).

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

Keep business rules in Rust. Adapters normalize source facts; pricing and queries operate on Wombat types. TUI and automation must use the same contract. Do not add a ccusage build, runtime or test dependency. Independent synthetic expectations cover counting and money; snapshot regeneration is not an oracle.

Never commit real messages, tool output, credentials or unaudited raw fields. Preserve user changes and user-owned data. Read-only collection must not mutate source files. No arbitrary execution capabilities belong in rendering interfaces.

Dependency changes require license review and `licenses:generate` / `licenses:check`. Before packaging run `public:check --package`; this is a guard, not a publication or complete security audit. Record actual tested platforms and limits, not planned capabilities. See [third-party notices](THIRD_PARTY_NOTICES.md).
