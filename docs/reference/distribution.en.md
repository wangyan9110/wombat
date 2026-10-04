# Distribution status and public descriptions

[中文](distribution.md) | English

## Current status

Wombat uses GitHub Releases as its only product distribution channel and does not publish an npm package. The root npm workspace stays `private: true` for source development. `v0.1.0-dev.2` is the first Development Preview and is distributed as a GitHub Pre-release. Preview features, data formats, and commands may change. Source tools require Node.js 26.4.0 or newer. User archives bundle a fixed Node.js 26.4.0 runtime, CLI/Web, and the local Rust core, so users do not install Node, npm, Rust, pnpm, or a compiler.

Release automation uses only free GitHub capabilities. GitHub-hosted builds stay disabled while the repository is private. After it becomes public, CI and tag releases use standard GitHub-hosted runners; paid larger runners are not used. Intermediate Actions artifacts expire after one day, while final archives become GitHub Release assets. Versions with a prerelease component create a Pre-release and do not occupy the stable `latest` endpoint.

## One-command installation and updates

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh
```

Specify a version for a Development Preview:

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh -s -- --version 0.1.0-dev.2
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1 | iex
```

For a Development Preview:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1))) -Version 0.1.0-dev.2
```

The installer detects the local target, downloads `wombat-<target>.tar.gz` and `SHA256SUMS`, verifies the archive, and installs under `~/.local`. `WOMBAT_INSTALL_PREFIX` or `--prefix` changes the destination; `--version` selects a release; `--base-url` supports development candidates or controlled mirrors. The installer replaces only directories and commands carrying Wombat's management marker.

After an installer-managed deployment, `wombat update` downloads and installs the latest stable Release. `wombat update --check` checks only, and `--version X.Y.Z` selects a version. Previews do not enter `latest`, so moving to a later preview requires an explicit version. Releases live in sibling directories. The updater verifies metadata, size, and SHA-256 before atomically switching `current.txt`. It never overwrites the running version, including on Windows, keeps the selected and previously running versions, and cleans older managed versions. Source builds and manually extracted archives have no installation pointer and are rejected explicitly.

## GitHub Release structure

Each version contains five archives: macOS arm64/x64, Linux glibc arm64/x64, and Windows x64. Each archive contains only its platform's Rust core, bundled CLI/Web, Node.js 26.4.0 runtime, Wombat license, dependency license inventory, and Node runtime license. `release-set.json` binds version, source commit, source/build fingerprint, target, archive size, and SHA-256. `SHA256SUMS` supports installers and manual review.

Each platform runs the release gate at the same commit and exports native artifacts. Assembly rejects mismatched version, commit, core, runtime, or notice hashes. All five platforms then extract the final archives and exercise version reporting, live usage, append handling, fixed snapshots, task queries, and Web without depending on system Node. A matching `v<package version>` tag creates the GitHub Release only after those checks pass and emits build provenance for platform archives. Builds and candidate preparation never upload by themselves.

Prepare a local development candidate with:

```sh
corepack pnpm build
corepack pnpm github:pack -- --current-platform --reuse-build --runtime-license /path/to/node/LICENSE
```

Use `--native-dir <artifacts>` for a full five-platform set. `--reuse-build` still checks source and output fingerprints and cannot reuse a stale build. Actual archive acceptance belongs to the corresponding Release/CI results; see the [release Skill](../../.agents/skills/wombat-release/SKILL.md) for operating steps.

## GitHub description

The About description is applied on GitHub, while the repository remains private. Topics are candidates for the public repository and have not been synchronized yet:

```json
{
  "about": "Review Codex token usage and task timing locally. Estimate API costs, inspect AGENTS.md, Skills, MCP, and Hooks, and send evidence-backed recommendations to Codex.",
  "topicsCandidate": ["codex", "token-usage", "usage-tracker", "agent-skills", "agents-md", "mcp", "cli", "web"],
  "summaryZh": "在本机回看 Codex 任务、追踪 Token 用量与 API 估算金额，检查 AGENTS.md 和 Skill 文件，盘点 MCP 配置及调用尝试记录。"
}
```

Claude Code, pi, automatic repair, and subscription-allowance monitoring are not current capability labels. Source facts, static checks, call attempts, and runtime validity remain distinct. Candidate preparation does not authorize repository visibility changes or Release creation.
