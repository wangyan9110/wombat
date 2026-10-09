<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wombat-logo-dark.svg">
    <img src="assets/wombat-logo-light.svg" alt="Wombat" width="80" height="56">
  </picture>
</p>

# Wombat — Codex Token Usage Analysis & Configuration Review

English | [中文](README.zh-CN.md)

**Understand Codex usage. Improve with evidence.**

Wombat is a local Codex token usage analyzer and configuration review tool. Locate high-usage tasks, review task timing, inspect repeated operations and project configuration, then use the evidence to decide what to change next.

Use the Codex Skill to ask questions, inspect evidence, authorize changes, and recheck results in your existing conversation. For example: 'Where did this week's usage increase?', 'Which operations need a closer look?', or 'What needs attention in this project's AGENTS.md and Skills?' Open the local Web dashboard when you need charts, timelines, or detailed records.

Wombat currently reads local Codex records. Support for other agents is planned.

## Get started

**Stable: [`v0.2.0`](https://github.com/wangyan9110/wombat/releases/tag/v0.2.0).**

Wombat supports macOS, Linux, and Windows. No development tools or API key are required for local inspection. The Skill requires a compatible local Codex installation.

1. Install Wombat. On macOS or Linux, run:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh -s -- --open
   ```

   On Windows PowerShell, run:

   ```powershell
   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1))) -Open
   ```

   The terminal prints a local URL and opens the Web dashboard. Wombat starts reading local records; discovered tasks are available before the initial read finishes.

2. In a new terminal, open your project directory and install the standalone Codex Skill:

   ```sh
   wombat skill install --json
   wombat skill status --cwd . --json
   ```

   If you already use the Wombat plugin, keep that installation mode. Use the invocation name actually discovered for your project; select explicitly if multiple instances exist. See the [Skill guide](skill/README.en.md) for plugin installation and removal. Updating Wombat does not update a Codex-managed plugin.

3. In Codex, invoke the discovered Skill and ask a question. The standalone entry is `$wombat`. For example:

   > Where did this week's token usage increase? Locate the main tasks and turns, and explain the coverage.

   > Check this project's AGENTS.md and Skills. Preserve their purpose and suggest changes.

   > Open Web details for the same project and data version, then continue here.

   Codex uses Wombat's local queries to explain available facts. Skill discovery and data readiness are separate: an installed Skill does not mean the initial read is complete. Codex conversations use model tokens.

If installation does not complete, run the command again. If it still fails, [report the problem](https://github.com/wangyan9110/wombat/issues). If the Skill is unavailable, open **Setup and collection** in Web to inspect project discovery and installation guidance. You can view data in Web while resolving Skill setup.

### Update Wombat

Check for or install the latest stable release:

```sh
wombat update --check
wombat update
```

## What you can ask the Codex Skill

### Understand Codex token usage and API cost estimates

Find high-usage tasks, inspect input, cache, and output tokens, and compare periods or tasks. Follow usage investigation signals to the related turns and operations. Input trajectories, compaction comparisons, resource records, and period reviews provide more context for further inspection.

Read account allowance, reset times, and stored allowance history separately. API cost estimates are not subscription charges and cannot be converted to remaining allowance. Investigation signals do not prove waste or explain its cause.

### Inspect task duration and activity

Review recorded task and turn timing, operation intervals, repeated calls and reads, and Skill or MCP use evidence. Open the Web timeline for a detailed view.

Timings describe identifiable records and their sequence. Missing durations or associations remain unknown; operation costs are not inferred. These records do not diagnose why a task was slow.

### Review AGENTS.md, Skills, MCP entries, and Hooks

Ask Codex to explain configuration evidence and Wombat recommendations. Checks include format issues, exact duplicate instruction blocks, large files, local references, and Hook targets. Turn activity checks can also highlight repeated rapid status checks.

Recommendations identify the location, evidence, suggested action, and content to preserve. Current configuration does not prove historical loading or use; missing evidence does not justify disabling or deleting an extension.

### Make authorized changes and recheck them

Continue in the same Codex conversation to review recommendations, authorize selected changes, and rerun the same checks. You can also keep the current setup or mark a recommendation as not applicable.

Resolved issues move to action history. Remaining issues stay available for review. User decisions remain separate from check results. File checks do not prove reduced token usage; changes to runtime behavior need evidence from later work records.

## Use the Web dashboard for charts and evidence

Web provides usage trends, project and model distributions, task lists, turn timelines, configuration details, and recommendation history. The Skill can open a view for the same project and data version, so you can examine the evidence and continue in Codex.

To open Web directly:

```sh
wombat web --open
```

If the browser does not open, use the full URL printed in the terminal. If no tasks appear, complete a Codex task and select **Refresh data**. If reading fails, open **Data sources** and select **Retry**. Add a project directory from **Data sources** to inspect configuration outside the projects found in task history.

Use Web to inspect evidence and recheck results. Continue processing in your current Codex conversation. “Use with Skill” in the header provides installation guidance, the discovered invocation, and example questions. When you need a separate Codex task, review and send selected objects through [CLI handoff](docs/guides/cli.en.md). Queue acceptance does not establish completed changes or resolution.

## Optional Hook collection

Historical log reading is available without the collection plugin. For native event observations, use **Setup and collection** in Web or ask the Skill about collection. The [collection guide](docs/guides/cli.en.md) explains modes, receipt status, and pause/resume; the [Skill guide](skill/README.en.md) explains the local collection plugin.

Installing the plugin, selecting Hook collection, trusting declarations in Codex, and receiving events are separate steps. Hook receipts do not add token accounting or establish complete coverage. The POSIX bridge is implemented; Windows collection remains unverified.

## CLI and source development

<details>
<summary>Use JSON queries or run from source</summary>

The CLI provides JSON output for scripts. See the [CLI guide](docs/guides/cli.en.md) for filters, fixed versions, comparisons, timing, and configuration queries:

```sh
wombat usage --json
wombat threads --sort tokens --json
wombat turns --thread THREAD_ID --sort tokens --json
wombat optimize inventory --project-root /path/to/project --json
wombat optimize list --project-root /path/to/project --json
```

To run from source, you need Node.js 26.4.0 or newer, Corepack, pnpm, and the Rust version specified in `rust-toolchain.toml`.

Clone this repository. Run the following commands from the repository directory:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/wombat.js web
```

See the [development workflow](docs/development/workflow.en.md) for environment setup and the [Skill guide](skill/README.en.md) for local plugin trials.

</details>

Wombat's local queries and checks need no API key and make no model calls. Skill conversations and work sent to Codex use model tokens. Sending transfers the selected targets and necessary findings to Codex. [Privacy](docs/reference/privacy.en.md) · [Pricing](docs/reference/pricing.en.md).

## Compatibility

Release packages support macOS arm64/x64, Linux glibc arm64/x64, and Windows x64.

Some data saved by earlier versions cannot be opened by this release. Keep the original data directory; see the [format and recovery limits](cli/README.en.md) before starting a separate data store.

## Help shape Wombat

Codex is the current source for task analysis. Claude Code, pi, and other agents are planned.

Having trouble understanding usage, maintaining your setup, or dealing with repeated checks? [Tell us about it](https://github.com/wangyan9110/wombat/issues). Share what you use, what happens, and how you handle it today. No private logs are needed. Requests for other agents are welcome.

See [CONTRIBUTING](CONTRIBUTING.md) to contribute, or the [security policy](SECURITY.md) to report security issues.

## License

[MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency licenses.
