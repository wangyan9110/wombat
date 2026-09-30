# Wombat

English | [中文](README.zh-CN.md)

Wombat is a local Codex usage and conversation viewer. Its two views are usage and conversations: inspect Token counts and costs, then find expensive turns and recorded operations.

Choose Chinese or English with `--lang zh|en` or `WOMBAT_LANG`; press `L` on the main terminal view to switch. See [product language](docs/i18n/product.en.md) for precedence and boundaries.

## Run from source

Requires Node.js 26.4.0+, Corepack/pnpm, and Rust (see `rust-toolchain.toml`). The terminal uses OpenTUI; the command entry configures the FFI runtime needed for interactive use.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/wombat.js
```

- Usage: daily, weekly, and monthly views with date, model, reasoning-effort, and project filters.
- Conversations: span days and models; sort by consumption or recent activity, then expand turns and steps.
- Cost: offline official-standard API-equivalent pricing with inspectable components, separate from subscription spending.
- Automation: incremental sync by default; `--fresh` waits for synchronization, `--cached` reads committed data, and `usage --watch --json` streams updates. Fixed views aggregate the full range before pagination.

```sh
node dist/wombat.js refresh --root /path/to/codex-home --json
node dist/wombat.js usage --since 2026-09-23 --until 2026-09-30 --timezone Asia/Shanghai --json
node dist/wombat.js threads --sort tokens --json
node dist/wombat.js turns --thread THREAD_ID --json
node dist/wombat.js steps --thread THREAD_ID --turn TURN_ID --json
```

The end date is exclusive. Without an explicit source root, Wombat reads `CODEX_HOME` or `~/.codex`, including archived logs. Pass `--root` repeatedly on live queries to select multiple source directories. Daily usage defaults to the most recent seven days; weekly usage covers the current week and three preceding weeks, and monthly usage covers the current month and eleven preceding months, all through today. Explicit dates take precedence; collection still covers historical records.

Wombat implements accounting and pricing independently, without ccusage; Token counts and official-standard API-equivalent costs share one ledger, and general-purpose open-source libraries are reused where appropriate. The first version registers Codex only, while the adapter protocol can support other Agents. Source logs are read-only. Snapshots omit user messages, model text, full command arguments, and tool output. Missing or unpriced records stay unknown; tool operations do not receive separately allocated costs.

This version removes the earlier quota, checkup, environment and rule diagnostics, installation repair, observation, comparison, export, and HTML report entries. Existing v1/v2 snapshots remain readable; refresh creates v3 without deleting historical identity records or recovery material.

The root contains independent `core/` for Rust business logic, `client/` for typed access, `tui/` for terminal presentation, and `cli/` for the command entry. Modules collaborate through public interfaces, allowing other interfaces to reuse the business client; the CLI enables the required FFI arguments only for interactive sessions.

This is a source preview. OpenTUI migration acceptance is in progress; earlier terminal verification does not establish acceptance of the new path. macOS Apple Silicon is the first verification target. Chinese and English CLI/TUI are delivered; unknown core diagnostics and source text may retain their original language. Other platforms, desktop product, and web server are outside this acceptance scope.

## Develop

Run the checks relevant to each change. Cross-language tests use the built core; OpenTUI migration acceptance is tracked separately from earlier terminal verification.

```sh
corepack pnpm build
corepack pnpm typecheck
corepack pnpm contracts:check
corepack pnpm test
corepack pnpm release:check
```

`release:check` builds and tests the project, checks contracts, licenses, repository rules and archive contents, then installs the packed archive in a temporary directory and exercises the installed CLI and core. The install fetches public runtime dependencies; it needs registry access. Builds and checks do not publish the software. The root uses the MIT license; dependency licenses and provenance are preserved separately. Contributing guidance and third-party notices are linked below.

## Transferable install

On the build machine, run `corepack pnpm release:bundle`. It runs the full release gate, then writes a platform-labelled directory under `dist/releases/` containing the archive, its SHA-256 manifest, and `install.mjs`. For a local installation candidate while other tests are still in progress, use `corepack pnpm package:bundle`; it checks the build, package and isolated install, but does not run the full test suite.

Copy that directory to a matching machine with Node.js 26.4.0+ and npm. From inside the copied directory, run `node install.mjs`. The installer checks the platform and archive hash, downloads public runtime dependencies, installs into `~/.local/share/wombat`, and tests the installed command and core. It prints the absolute command path; add its `bin` directory to PATH to use `wombat` by name. Rust, pnpm and the source checkout are not needed on the target machine. The current installation acceptance target is macOS Apple Silicon.

[Terminal operation](docs/guides/terminal.en.md) · [CLI and JSON](docs/guides/cli.en.md) · [Pricing sources](docs/reference/pricing.en.md) · [Support matrix](docs/reference/support-matrix.en.md) · [Implementation tracking](docs/project/status.en.md) · [Verification record](docs/project/progress.en.md) · [Privacy](docs/reference/privacy.en.md) · [Contributing](CONTRIBUTING.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)
