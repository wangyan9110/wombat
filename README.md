<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wombat-logo-dark.svg">
    <img src="assets/wombat-logo-light.svg" alt="Wombat" width="80" height="56">
  </picture>
</p>

# Wombat — Codex Token Usage Analysis & Configuration Review

English | [中文](README.zh-CN.md)

**Understand Codex usage. Improve your setup.**

Wombat brings local Codex token usage analysis and configuration review into your conversation. Find the tasks behind a usage increase, inspect input growth and repeated operations, and check AGENTS.md, Skills, MCP entries, and Hooks. Use the Codex plugin to discuss findings, make changes you authorize, and recheck the results.

When you need charts, task timelines, or configuration details, open the local Web dashboard for the same project and data version, then continue in Codex.

## Why use Wombat with Codex?

Wombat turns local records into reusable statistics, evidence tied to one data version, and review decisions you can use across conversations. Codex can use these results when you analyze usage across many tasks or follow changes to project configuration.

- **Reduce repeated preparation.** Reuse local indexes to query usage, growth, and operation records across tasks, reducing the need to organize history again for each question.
- **Compare on a common basis.** View summaries and details for the same project, period, and data version. Missing data stays visible so you can check conclusions and select changes.
- **Continue the follow-up.** Save configuration review decisions and reasons, recheck with the same rules after edits, and use those records in a new conversation.

## Get started

**Stable: [`v0.3.0`](https://github.com/wangyan9110/wombat/releases/tag/v0.3.0).**

Wombat supports macOS, Linux, and Windows. Local analysis needs no API key or development tools. Install a compatible local Codex first to use the plugin.

On macOS or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/scripts/install/install.sh | sh -s -- --plugin
```

On Windows PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/scripts/install/install.ps1))) -Plugin
```

The installer installs Wombat and its Codex plugin, then checks discovery and runtime compatibility. Open Web when needed with `wombat web --open`; during the initial read, you can inspect tasks already found.

Open your project in a new Codex conversation, invoke `$wombat:wombat`, and ask:

> Where did this week's token usage increase? Find the main tasks and turns.

> Check this project's AGENTS.md and Skills. Preserve their purpose and suggest useful changes.

An existing enabled collection plugin keeps its mode; use `$wombat-collection:wombat` for that plugin. Use the invocation discovered for your project and select one explicitly if multiple instances exist. To use only Web, omit `--plugin` or `-Plugin` from the installation command. See the [plugin guide](plugin/README.en.md) for discovery, removal, and existing standalone copies.

If plugin installation fails, Wombat remains installed. Check the reported stage and retry only the plugin with the options in the [installation guide](docs/guides/installation.en.md), or run `wombat web --open` to view data first. If the Skill is unavailable, open **Setup and collection** in Web for discovery status and plugin guidance. If installation still fails, [report the problem](https://github.com/wangyan9110/wombat/issues).

## Start with a question

| Your question | What Wombat provides |
|---|---|
| Where did usage increase? | Period and task comparisons, main contributions, and input, cache, and output tokens |
| How does this task's usage compare with other tasks in the project? | Population mean, median, P90, and the selected task's percentile rank |
| Did usage grow because of more tasks or larger tasks? | Separate contributions from task count and usage per task |
| How can I get token budget warnings and periodic reviews? | Save daily, weekly, or monthly budgets, run threshold checks, and review the most recent closed period |
| Where did this task's input grow? | Input trajectories, change points, and records before and after compaction |
| Which operations deserve attention? | Repeated requests and reads, rapid status checks, failure patterns, and duration signals |
| Which repeated work could become a script or Skill? | Recurring operations across tasks in one project, for Codex to review and organize |
| What needs attention in my project configuration? | Format checks, exact duplicate instruction blocks, large files, local references, and Hook targets |
| Which Skills or MCP entries deserve a review? | Recorded use counts and last-use times for the selected period, to identify extensions to review |
| Does a configuration issue remain after a change? | Rechecks using the same rules, remaining findings, and action history |
| Was the changed configuration read or loaded? | Content-version matches supported by native records, and usage before and after the change in the same scope |

You can also inspect recorded task and turn durations, operation intervals, resource records, and Skill or MCP use evidence. Read Codex account allowance, reset times, and stored allowance history separately from project usage.

Ongoing budget checks require a running `wombat monitor watch` or periodic checks enabled in an open Web budget panel. User token budgets are separate from Codex account allowance.

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

- Wombat currently analyzes local Codex records. Support for other agents is planned.
- Token usage, API cost estimates, and account allowance are separate. Estimates are not subscription charges and cannot be converted to remaining allowance. Missing or unpriced data stays explicit; operations have no separately allocated cost.
- Repetition, input changes, and timing provide investigation signals. Recorded timing can be partial, and these signals do not prove waste, causes, task quality, or savings. Static rechecks establish whether a checked issue remains, not whether later work uses the change.
- Configuration checks describe current files. Current content does not prove historical loading or use; missing observations do not justify disabling or deleting an extension.
- Wombat's local queries and checks make no model calls. Codex conversations and authorized work use model tokens. Handoffs provide selected targets and necessary findings to Codex.
- Local analysis does not upload logs. Missing prices can trigger an official price download. See [privacy](docs/reference/privacy.en.md) and [pricing](docs/reference/pricing.en.md) for network behavior and retained data.

### Optional Hook collection

Historical log analysis works without the collection plugin. For native event observations, open **Setup and collection** in Web or ask the Skill about collection. The [collection guide](docs/guides/cli.en.md) covers receipt status and pause/resume; the [plugin guide](plugin/README.en.md) covers installation.

Installing the plugin, selecting collection mode, trusting Hook declarations in Codex, and receiving events are separate steps. Receipts do not add token accounting or establish complete coverage. The POSIX bridge is implemented; Windows Hook collection remains unverified.

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
