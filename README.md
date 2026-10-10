<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wombat-logo-dark.svg">
    <img src="assets/wombat-logo-light.svg" alt="Wombat" width="80" height="56">
  </picture>
</p>

# Wombat — Codex Token Usage Analysis & Configuration Review

English | [中文](README.zh-CN.md)

**See where Codex tokens and time go.**

Wombat analyzes local Codex records. Find the tasks behind token growth, inspect recorded task durations and time breakdowns, and spot repeated work. Review AGENTS.md, Skills, MCP, and Hooks, let Codex make changes you authorize, then recheck the specific issues.

Ask through the Codex plugin. Open the local Web dashboard when you need charts, timelines, or detailed evidence.

## Get started

**Stable: [`v0.3.0`](https://github.com/wangyan9110/wombat/releases/tag/v0.3.0).**

Local analysis needs no API key or development tools. Install a compatible local Codex first to use the plugin.

Install Wombat and its Codex plugin on macOS or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/scripts/install/install.sh | sh -s -- --plugin
```

On Windows PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/scripts/install/install.ps1))) -Plugin
```

The installer checks plugin discovery and runtime compatibility. Open your project in Codex, start a **new conversation**, and ask:

> $wombat:wombat Where did this week's token usage increase? Find the main tasks and turns.

The answer identifies the main contributions and the input, cache, and output changes. Ask to open matching Web details when you want to inspect the records.

<details>
<summary>Existing plugins, Web-only use, and installation recovery</summary>

An existing enabled collection plugin keeps its mode; use `$wombat-collection:wombat`. Use the invocation discovered for your project, and select one explicitly if multiple instances exist. To use only Web, omit `--plugin` or `-Plugin`, then run `wombat web --open`. See the [plugin guide](plugin/README.en.md) for discovery, removal, and standalone copies.

If plugin installation fails, Wombat remains installed. Check the reported stage and retry only the plugin as described in the [installation guide](docs/guides/installation.en.md), or run `wombat web --open` to view data first. **Setup and collection** in Web shows discovery status and plugin guidance. If installation still fails, [report the problem](https://github.com/wangyan9110/wombat/issues).

</details>

## Start with a question

| Ask Codex | What you get |
|---|---|
| Where did this week's token usage increase? | Period comparisons, the tasks and turns behind the increase, and input, cache, and output changes |
| How long did this turn take, and where did the time go? | Recorded duration, operation intervals, overlaps, and gaps in timing coverage |
| Which repeated work could become a script or Skill? | Operations repeated across tasks in one project, with task and operation evidence for Codex to assess workflow stability and whether a script or Skill would help |
| Check this project's AGENTS.md, Skills, MCP, and Hooks. What should I change? | Specific locations and check results for format issues, exact duplicate instruction blocks, large files, local references, and Hook targets |
| Recheck the configuration after my changes. Does the issue remain? | Checks with the same rules, remaining findings, and action history; native content-version matches when recorded |

### Task statistics and token budget monitoring

- **Compare task usage.** Query the mean, median, P90, and a selected task's percentile rank for the project population.
- **Explain growth.** Separate contributions from task count and usage per task. Inspect input change points and records before and after compaction.
- **Set a token budget.** Save daily, weekly, or monthly budgets and review the most recent closed period. Ongoing checks require a running `wombat monitor watch` or periodic checks enabled in an open Web budget panel.

You can also query resource records, Skill or MCP use counts and last-use times, and configuration content-version observations. Codex account allowance, reset times, and stored allowance history remain separate from project usage. See the [CLI guide](docs/guides/cli.en.md) for these queries and budget controls.

## Why use Wombat with Codex?

Wombat turns local records into reusable statistics, evidence tied to one data version, and review decisions you can use across conversations. Codex can use these results when you analyze usage across many tasks or follow changes to project configuration.

- **Reduce repeated preparation.** Reuse local indexes to query usage, growth, and operation records across tasks, reducing the need to organize history again for each question.
- **Compare on a common basis.** View summaries and details for the same project, period, and data version. Missing data stays visible so you can check conclusions and select changes.
- **Continue the follow-up.** Save configuration review decisions and reasons, recheck with the same rules after edits, and use those records in a new conversation.

## Turn findings into changes

Review findings and their evidence in the same Codex conversation. Select what to change, then let Codex make the changes you authorize. Wombat supplies local queries and checks; Codex handles explanations, file edits, and recovery.

After a configuration change, rerun the same checks. Resolved findings move to action history; remaining issues stay available. You can also keep the current setup with a reason or mark a recommendation as not applicable. Rechecks preserve those user decisions.

For workflow changes, compare relevant later records when available to assess the result. To use a separate Codex task, review and send selected targets through [CLI handoff](docs/guides/cli.en.md). Queue acceptance does not establish completed changes or resolution.

## Explore charts and detailed records

The Web dashboard provides usage trends, project and model distributions, task statistics, turn timelines, budget reminders, periodic reviews, configuration details, and action history. Ask the Skill to open matching details, or run:

```sh
wombat web --open
```

If the browser does not open, use the full URL printed in the terminal. If no tasks appear, complete a Codex task and select **Refresh data**. If reading fails, open **Data sources** and select **Retry**. Add a project directory there to inspect configuration outside the projects found in task history.

“Use with Skill” in the header shows the discovered invocation and example questions. An installed Skill does not mean the initial data read is complete; you can continue with the available records while reading progresses.

## Update

Rerun the installation command above to update Wombat and its Codex plugin. Check for updates, or update only the Wombat runtime:

```sh
wombat update --check
wombat update
```

See the [installation guide](docs/guides/installation.en.md) for specific versions and custom installation directories.

## Data and scope

- Wombat analyzes local Codex records; other agents are planned. Local analysis does not upload logs. Missing prices can trigger an official price download; see [privacy](docs/reference/privacy.en.md) and [pricing](docs/reference/pricing.en.md).
- Tokens, API-equivalent cost estimates, and account allowance are separate. Estimates are not subscription charges or remaining allowance. Missing and unpriced data stay explicit; operations have no separately allocated cost.
- Timing describes recorded durations and activity intervals, with overlaps and coverage gaps. It does not measure pure model reasoning time or establish causes, waste, quality, or savings. Current files do not prove historical loading or use. A recorded configuration read or load does not prove adoption; missing observations do not justify deleting an extension.
- Local queries and checks make no model calls. Codex conversations and authorized work use model tokens. Handoffs provide selected targets and necessary findings; static rechecks show whether the checked issue remains. See the [plugin guide](plugin/README.en.md) for collection and use.

<details>
<summary>Optional Hook collection</summary>

### Optional Hook collection

Historical log analysis works without the collection plugin. For native event observations, open **Setup and collection** in Web or ask the Skill about collection. The [collection guide](docs/guides/cli.en.md) covers receipt status and pause/resume; the [plugin guide](plugin/README.en.md) covers installation.

Installing the plugin, selecting collection mode, trusting Hook declarations in Codex, and receiving events are separate steps. Receipts do not add token accounting or establish complete coverage. The POSIX bridge is implemented; Windows Hook collection remains unverified.

</details>

## Compatibility

Release packages support macOS arm64/x64, Linux glibc arm64/x64, and Windows x64.

Some data saved by earlier versions cannot be opened by this release. Keep the original data directory and its user decisions. See the [format and recovery limits](cli/README.en.md) before starting a separate data store.

## CLI and source development

<details>
<summary>Use JSON queries or run from source</summary>

The CLI provides JSON output for agents and scripts. See the [CLI guide](docs/guides/cli.en.md) for usage, task statistics, budget monitoring, timing, configuration queries, and handoffs.

To run from source, you need Node.js 26.4.0 or newer, Corepack, pnpm, and the Rust version specified in `rust-toolchain.toml`. Clone this repository, then run from its directory:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/wombat.js web
```

See the [development workflow](docs/development/workflow.en.md) for environment setup and the [plugin guide](plugin/README.en.md) for local plugin trials.

</details>

## Help shape Wombat

Having trouble understanding usage, maintaining configuration, or dealing with repeated operations? [Tell us about it](https://github.com/wangyan9110/wombat/issues). Share the tools you use, what happens, and how you handle it today. No private logs are needed. Requests for other agents are welcome.

See [CONTRIBUTING](.github/CONTRIBUTING.md) to contribute, or the [security policy](.github/SECURITY.md) to report security issues.

## License

[MIT](LICENSE). See [third-party notices](licenses/THIRD_PARTY_NOTICES.md) for dependency licenses.
