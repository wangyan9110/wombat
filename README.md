<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wombat-logo-dark.svg">
    <img src="assets/wombat-logo-light.svg" alt="Wombat" width="80" height="56">
  </picture>
</p>

# Wombat — Make AI work better

English | [中文](README.zh-CN.md)

Wombat is a local tool for Codex users who want to understand token usage and task timing, inspect instructions and extensions, and turn evidence-backed findings into work for Codex.

Use one overview to find high-usage tasks, review API cost estimates and account allowance, inspect AGENTS.md, Skills, MCP entries, and Hooks, and recheck the results after changes.

Wombat currently reads local Codex records. Support for other agents is planned.

## Get started

**Stable: [`v0.2.0`](https://github.com/wangyan9110/wombat/releases/tag/v0.2.0).**

Wombat supports macOS, Linux, and Windows. No development tools or API key are required.

1. Install and open Wombat. On macOS or Linux, run:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh -s -- --open
   ```

   On Windows PowerShell, run:

   ```powershell
   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1))) -Open
   ```

2. Wombat starts reading local records. The terminal prints a local URL, and the browser opens that address. You can view discovered tasks before the initial read finishes.

If installation does not complete, run the command again. If it still fails, [report the problem](https://github.com/wangyan9110/wombat/issues). If the browser does not open, use the full URL from the terminal. If no tasks appear, complete a Codex task and select **Refresh data**. If reading fails, open **Data sources** and select **Retry**. Add a project directory from **Data sources** when you want to inspect configuration outside the projects found in task history.

### Update Wombat

Check for or install the latest stable release:

```sh
wombat update --check
wombat update
```

## Improve your day-to-day Codex workflow

### Understand your Codex token usage

The overview shows usage trends, usage by project, and estimated API costs. When usage spikes, inspect the related tasks and turns for input, cache, output, and activity records.

Account allowance and reset times help you plan your next work. They describe your account, separately from usage in local records.

### See how long tasks take and where the time goes

See task duration and a breakdown of time spent. Use this view to decide which parts of the work need a closer look.

These timings come from identifiable task and operation records. They show the recorded sequence; they do not diagnose why a task was slow.

### Find recommendations backed by evidence

Inspect AGENTS.md, Skills, MCP entries, and Hooks. Open related recommendations beside each file or extension.

Wombat checks files and records for format issues, exact duplicate instruction blocks, large files, and repeated rapid status checks.

Each recommendation explains where to act, what to change, and what to preserve. Decide whether to act, keep the current setup, or mark the recommendation as not applicable.

### Send work to Codex, then check the result

Select one recommendation or a group within the current scope. After confirming the projects, files, and scope, send the recommendations to Codex.

Review the work and changes in Codex. When it finishes, return to Wombat and rerun the checks.

Sending requires a compatible local Codex installation. If native handoff is unavailable, apply the recommendation yourself and rerun the check.

Resolved issues move to action history. Issues that remain stay pending.

You can also edit files yourself and recheck them. Changes to runtime behavior need confirmation from later work records. A passed file check does not prove lower token usage.

<details>
<summary>Run from source or use the CLI</summary>

To run from source, you need Node.js 26.4.0 or newer, Corepack, pnpm, and the Rust version specified in `rust-toolchain.toml`.

Clone this repository. Run the following commands from the repository directory:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/wombat.js web
```

See the [development workflow](docs/development/workflow.en.md) for environment setup.

The CLI provides JSON output for scripts:

```sh
wombat usage --json
wombat threads --sort tokens --json
wombat turns --thread THREAD_ID --sort tokens --json
wombat optimize inventory --project-root /path/to/project --json
wombat optimize list --project-root /path/to/project --json
```

</details>

Local inspection needs no API key and makes no model calls. Sending work to Codex shares only the content and findings needed for the selected objects. Codex tasks use model tokens. API cost estimates are not subscription charges and cannot be converted to remaining allowance. [Privacy](docs/reference/privacy.en.md) · [Pricing](docs/reference/pricing.en.md).

## Compatibility

Release packages support macOS arm64/x64, Linux glibc arm64/x64, and Windows x64.

Some data saved by earlier versions cannot be opened by this release. Keep the original data directory; see the [format and recovery limits](cli/README.en.md) before starting a separate data store.

## Help shape Wombat

Codex is the current source for task analysis. Claude Code, pi, and other agents are planned.

Having trouble understanding usage, maintaining your setup, or dealing with repeated checks? [Tell us about it](https://github.com/wangyan9110/wombat/issues). Share what you use, what happens, and how you handle it today. No private logs are needed. Requests for other agents are welcome.

See [CONTRIBUTING](CONTRIBUTING.md) to contribute, or the [security policy](SECURITY.md) to report security issues.

## License

[MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency licenses.
