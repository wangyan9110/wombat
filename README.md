<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wombat-logo-dark.svg">
    <img src="assets/wombat-logo-light.svg" alt="Wombat" width="80" height="56">
  </picture>
</p>

# Wombat — Codex usage & configuration

English | [中文](README.zh-CN.md)

**Make AI work better.**

Wombat brings your Codex task history, token usage, and configuration into one local tool. Find past work, see estimated API costs, check AGENTS.md and Skill files, and browse MCP entries and logged call attempts. Use the web app to explore your data or the CLI to query it from scripts.

- **Find past work:** search tasks and review their turns and recorded actions.
- **See where tokens go:** compare projects, models, and time periods, then open the relevant tasks.
- **Check your setup:** review file size, format, and exact duplicate instruction blocks. Open related records and rerun checks after editing.

**Not yet released.** An npm release is planned. [Tell us what you'd like to find or check](https://github.com/wangyan9110/wombat/issues).

![Wombat Codex overview showing token usage, estimated API costs, project distribution, configuration recommendations, and recent tasks](assets/prototype-overview-en.jpg)

Design prototype preview. Costs are API estimates, not subscription charges or remaining quota.

## What you can do

### Find past work

Open **Tasks** and search by title, working directory, or task ID. Review the turns and recorded actions to find the work you're looking for and compare usage within it. Full conversation transcripts aren't available.

### Find high-usage tasks

Open **Overview**, choose a date range or project, and select a usage peak to see the related tasks and turns. Usage updates as Codex writes complete records to its local logs.

### Check your setup

Open **Configuration** to browse AGENTS.md, Skills, and MCP entries in the folders you've allowed Wombat to read, along with any activity it can identify in the logs.

In **Optimize**, review file size and format issues, exact duplicate instruction blocks in AGENTS.md and SKILL.md, and differences between files you've declared as copies. Check the evidence, decide whether to edit or ignore a finding, and rerun the checks after a manual edit. MCP support covers inventory and logged call attempts; full MCP health checks aren't available.

<details>
<summary>Example: follow a recommendation to the related work</summary>

In this prototype, Wombat flags a large AGENTS.md file, shows two recorded reads, and links to the relevant task turns. Open those records to help decide whether the file needs attention.

![Wombat AGENTS.md recommendation with recorded reads, linked turn tokens, estimated API costs, and links to related tasks](assets/prototype-review-en.jpg)

The 576K tokens cover everything in the linked turns, including other actions. They aren't a measure of this file's token cost or how much you could save by shortening it. Wombat doesn't know what the file contained at the time.

</details>

## Installation

Wombat isn't on npm yet. Once it's released, the planned installation is:

```sh
npm install -g @wangyan9110/wombat
wombat web
```

You'll need Node.js **26.4.0+**. Local Codex records are needed to view past tasks and usage; you can run static configuration checks without usage history.

Open the full URL printed in your terminal. To inspect a specific project's configuration, run `wombat web --project-root /path/to/project`.

See the [support matrix](docs/reference/support-matrix.en.md) for platform support and verification status.

<details>
<summary>Run from source before the npm release</summary>

Clone this repository, install Corepack/pnpm and Rust, then run these commands from the repository directory:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/wombat.js web
```

Use the Rust version in `rust-toolchain.toml`. See the [development workflow](docs/development/workflow.en.md) for setup and checks.

</details>

## CLI and JSON

Query your local data from the terminal or use JSON output in scripts.

<details>
<summary>Usage, task, and configuration examples</summary>

```sh
wombat usage --json
wombat threads --sort tokens --json
wombat turns --thread THREAD_ID --sort tokens --json
wombat optimize inventory --project-root /path/to/project --json
wombat optimize list --project-root /path/to/project --json
```

See the [CLI guide](docs/guides/cli.en.md) for filters, updates, and review commands.

</details>

## Privacy and costs

Wombat processes and stores data on your machine. It reads local Codex logs and the configuration you've allowed it to inspect, without uploading conversations or modifying those source files. The current analysis requires no API key or model calls.

Cost estimates use recorded token usage and official standard API rates. **They aren't your subscription bill or remaining Codex quota.** Unknown prices stay unknown; incomplete data is marked as partial.

<details>
<summary>Local storage and pricing downloads</summary>

The local usage index doesn't store user messages, model replies, full command arguments, or tool output. It can contain task titles, project paths, and tool names, so check these before sharing screenshots or JSON.

If a model's price is missing, Wombat may download official pricing documents. These requests don't include your logs. To turn off automatic pricing downloads:

```sh
WOMBAT_AUTO_PRICES=0 wombat web
```

Read the [privacy policy](docs/reference/privacy.en.md) and [pricing details](docs/reference/pricing.en.md).

</details>

## Common questions

**Does it support Claude Code or pi?**

Wombat currently supports Codex. Support for Claude Code, pi, and other agents is planned. [Tell us what you use and what you'd like to see](https://github.com/wangyan9110/wombat/issues).

**Can it tell me why my Codex allowance dropped?**

It can help you find high-usage tasks in your local records. It can't determine how OpenAI calculates subscription allowances or explain a change in your remaining allowance.

**Does an entry in Configuration mean it was used?**

No. An entry shows what was found in your configuration; it doesn't confirm that Codex loaded or used it. Reading a Skill file doesn't prove the Skill was invoked. Without explicit records, usage stays unknown. MCP counts include identifiable call attempts, not confirmed successes.

**Can it fix my setup or tell me how much I'll save?**

You can review findings, keep a review history, and rerun checks after manual edits. Wombat doesn't change configuration automatically or predict savings. Passing a static check doesn't guarantee that the configuration will work when the agent runs.

**Why isn't any usage showing up?**

Check that you have local Codex logs with usage records and that your date and project filters include them. By default, Wombat reads `CODEX_HOME` or `~/.codex`. If your logs are elsewhere, use `wombat web --root /path/to/codex-home`.

## Help shape Wombat

What would you like to find or check, and how do you do it today? [Tell us about your workflow](https://github.com/wangyan9110/wombat/issues). Mention your agent and platform if they're relevant. You don't need to share private logs.

For contributions, see [CONTRIBUTING](CONTRIBUTING.md). Report security issues using the [security policy](SECURITY.md).

## License

[MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency licenses.
