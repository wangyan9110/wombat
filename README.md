<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wombat-logo-dark.svg">
    <img src="assets/wombat-logo-light.svg" alt="Wombat" width="80" height="56">
  </picture>
</p>

# Wombat — Make AI work better

English | [中文](README.zh-CN.md)

Wombat helps you understand Codex token usage and task timing, and find issues in your instructions, extensions, and workflow. Send specific recommendations to Codex for action.

Usage, account allowance, and optimization recommendations appear in one local overview. See what needs attention, then return after Codex makes changes to check the results.

This page describes the product direction. See the [support matrix](docs/reference/support-matrix.en.md) for current implementation, platform support, and release acceptance boundaries.

## Get started

**Not yet released.** After the first GitHub Release, install the self-contained build with its bundled runtime, CLI, Web app, and native core. There is no public Release to install yet.

On macOS or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh
~/.local/bin/wombat web --open
```

On Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1 | iex
& "$HOME\.local\bin\wombat.cmd" web --open
```

The default installation prefix is `~/.local`. After adding its `bin` directory to `PATH`, start Wombat directly. Installer-managed copies can also check for and install updates:

```sh
wombat web --open
wombat update --check
wombat update
```

Release targets are macOS arm64/x64, Linux glibc arm64/x64, and Windows x64. The archives require no separate Node.js, npm, Rust, pnpm, or compiler installation. See the [support matrix](docs/reference/support-matrix.en.md) for platform and acceptance boundaries. If the browser does not open, use the full URL printed in your terminal.

On first use, confirm the source location and select **Read local records**. You can view the first available results before loading finishes.

Without task history, you can still inspect instructions and extensions in authorized directories.

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

## Help shape Wombat

Codex is the current source for task analysis. Claude Code, pi, and other agents are planned.

Having trouble understanding usage, maintaining your setup, or dealing with repeated checks? [Tell us about it](https://github.com/wangyan9110/wombat/issues). Share what you use, what happens, and how you handle it today. No private logs are needed. Requests for other agents are welcome.

See [CONTRIBUTING](CONTRIBUTING.md) to contribute, or the [security policy](SECURITY.md) to report security issues.

## License

[MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency licenses.
