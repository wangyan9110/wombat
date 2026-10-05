# Distribution status and public descriptions

[中文](distribution.md) | English

## Current status

Wombat uses GitHub Releases as its only product distribution channel and does not publish an npm package. The root npm workspace stays `private: true` for source development. `v0.1.0` is the first stable release. Source tools require Node.js 26.4.0 or newer. User archives bundle a fixed Node.js 26.4.0 runtime, CLI/Web, and the local Rust core, so users do not install Node, npm, Rust, pnpm, or a compiler.

Release automation uses only free GitHub capabilities. The public repository runs CI and tag releases on standard GitHub-hosted runners; paid larger runners are not used. Intermediate Actions artifacts expire after one day, while final archives become GitHub Release assets. Versions with a prerelease component create a Pre-release and do not occupy the stable `latest` endpoint.

## One-command installation and updates

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh
```

Specify a version for a pre-release:

```sh
curl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh -s -- --version PREVIEW_VERSION
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1 | iex
```

For a pre-release:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1))) -Version PREVIEW_VERSION
```

The installer detects the local target, downloads `wombat-<target>.tar.gz` and `SHA256SUMS`, verifies the archive, and installs under `~/.local`. It adds the default bin directory to the user's shell profile or Windows user `PATH`; use `--no-modify-path` on macOS/Linux or `-NoModifyPath` on Windows to disable that change. On macOS/Linux, use `WOMBAT_INSTALL_PREFIX` or `--prefix` to change the destination, `--version` to select a release, and `--base-url` for a development candidate or controlled mirror. The corresponding Windows parameters are `-Prefix`, `-Version`, and `-BaseUrl`. The installer replaces only directories and commands carrying Wombat's management marker.

After an installer-managed deployment, `wombat update` downloads and installs the latest stable Release. `wombat update --check` checks only, and `--version X.Y.Z` selects a version. Previews do not enter `latest`, so moving to a later preview requires an explicit version. Releases live in sibling directories. The updater verifies metadata, size, and SHA-256 before atomically switching `current.txt`. It never overwrites the running version, including on Windows, keeps the selected and previously running versions, and cleans older managed versions. Source builds and manually extracted archives have no installation pointer and are rejected explicitly.

`wombat doctor` checks the managed installation, command path, runtime, local core, and Codex data directory. It does not scan source records, use the network, or change product data; `--json` returns one machine-readable result.

## GitHub Release structure

Each version contains five archives: macOS arm64/x64, Linux glibc arm64/x64, and Windows x64. Each archive contains only its platform's Rust core, bundled CLI/Web, Node.js 26.4.0 runtime, Wombat license, dependency license inventory, and Node runtime license. `release-set.json` binds version, source commit, source/build fingerprint, target, archive size, and SHA-256. `SHA256SUMS` supports installers and manual review.

Each platform runs the release gate at the same commit and exports native artifacts. Assembly rejects mismatched version, commit, core, runtime, or notice hashes. All five platforms then extract the final archives and exercise version reporting, live usage, append handling, fixed snapshots, task queries, and Web without depending on system Node. A matching `v<package version>` tag creates the GitHub Release only after those checks pass and emits build provenance for platform archives. Builds and candidate preparation never upload by themselves.

Prepare a local development candidate with:

```sh
corepack pnpm build
corepack pnpm github:pack -- --current-platform --reuse-build --runtime-license /path/to/node/LICENSE
```

Use `--native-dir <artifacts>` for a full five-platform set. `--reuse-build` still checks source and output fingerprints and cannot reuse a stale build. Actual archive acceptance belongs to the corresponding Release/CI results; see the [release Skill](../../.agents/skills/wombat-release/SKILL.md) for operating steps.

## Root README maintenance

These rules apply to the root `README.md` and `README.zh-CN.md`. Follow the [GitHub README guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes), [user-facing copy rules](../i18n/product.en.md), and [bilingual review rules](../i18n/README.en.md). Use ASD-STE100 for technical explanations. Keep product introductions and short headings natural in each language. Apply the relevant public-content principles in the [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide). Do not apply configuration requirements for a separate website to a GitHub README.

- Write for first-time users. Start with what Wombat is, who it is for, and the problem it solves. Then provide the current release status, installation and first use, main uses, necessary limits, and links to help, contribution, security, and licensing information. Link development details to their owners. Users should not need to understand the internal architecture before they can start.
- Write the quick start for a new installation and a reader with no project background. First explain supported systems, necessary source records or directory authorization, and relevant data and cost boundaries. Then give the shortest available path through installation, startup, the first read, and viewing results. State where to run each step, how to recognize success, and the available next action if the browser does not open, records are missing, or reading fails. Describe installation and recovery through user actions and visible results. Omit implementation details such as installation layout, `PATH` mutation, runtime or core composition, packaging, and internal verification unless the reader must use that fact to make a decision; link to the distribution reference for those details. Separate normal installation from source development. Keep optional features and updates out of the first-use sequence. Explain terms and abbreviations on first use when needed. Do not assume knowledge of internal names or an existing configuration.
- Review installation, updates, usage procedures, and troubleshooting under the ASD-STE100 [writing and dictionary review requirements](../i18n/README.en.md). Use active voice and clear verbs. Give each step one operation. Put conditions and necessary warnings before the action, followed by observable results and evidence-based recovery instructions. Use consistent names for objects. Preserve commands, versions, paths, quantities, units, and the scope of negation. Keep technical meaning consistent in both languages and Chinese phrasing natural. Do not claim that the README complies with the standard before review against the official rules and dictionary is complete.
- Base descriptions on current capabilities. Distinguish available features, product direction, and planned support. Keep versions, installation commands, platforms, and acceptance scope consistent with current release facts. Preserve the limits of cost estimates, account allowance, privacy, and optimization results. Do not expand capability claims for promotion or keyword coverage.
- Keep one main heading and a clear heading hierarchy. Use the product name, supported source names, and actual uses naturally in the title, introduction, and relevant sections. Examples include Codex, token usage, and API cost estimates. Choose search terms that fit readers of each language. Give each section a clear purpose rather than relying on slogans to explain the product.
- Put useful, accurate, understandable content first. Do not set keyword density targets, repeat lists of synonyms, add hidden keywords, or attract searches for unsupported agents or popular features. Do not duplicate paragraphs to cover search terms. Do not promise indexing, rankings, traffic, or conversions.
- Use link text that describes the content or action. Prefer relative paths for repository documents and images. After heading or path changes, check section anchors and incoming links. Keep essential use and setup information in text. Give screenshots accurate alternative text and use reviewed images in the corresponding language without private information. Check the rendered page on narrow screens, in light and dark themes, and through its language links.
- Keep the README, repository About, Topics, and package description consistent in product positioning. Keywords must reflect the actual scope. Select relevant topics using the [GitHub Topics guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics). Local copy changes do not mean remote metadata has changed. Record and report the actual state, and follow the existing publication authorization scope.
- When versions, installation or update methods, features, platform support, page names, or document paths change, review and update the affected README passages, bilingual records, links, and related descriptions in the same change. Before release, compare them with version manifests, installation scripts, current implementation, and actual acceptance results. Distinguish release candidates from published versions. Do not update only version numbers or dates. Keep full details in the owning module or reference document, with only necessary summaries and links in the README, to reduce stale duplication.
- Name the ASD-STE100 issue in use. Consult the official standard when changing related rules; do not call it the latest issue without verification. Review these rules when the SEO or GitHub guidance changes. Use existing release and repository checks for command, link, and version consistency. Review capability claims, translations, and external standards manually. State the scope of unverified current behavior. Do not reuse old acceptance conclusions or replace review with a new date.
- Keep facts, installation steps, and limits consistent in both languages. Use natural headings, sentences, and link text in each version. Update confirmation records only for reviewed pairs. Review in a new user's reading order: can they decide whether the product fits, find prerequisites, complete the first operation, understand the result, and find help? Compare the quick start with existing installation acceptance results. Do not assume users have the author's environment. Report the platforms verified and steps not covered. Review the prose, GitHub rendering, versions, and links, then run repository checks. Mechanical checks do not establish language quality, first-use usability, or SEO results.

## GitHub description

The repository is public. Its About description and Topics are synchronized with the current product scope:

```json
{
  "about": "Review Codex token usage and task timing locally. Estimate API costs, inspect AGENTS.md, Skills, MCP, and Hooks, and send evidence-backed recommendations to Codex.",
  "topics": ["codex", "token-usage", "usage-tracker", "agent-skills", "agents-md", "mcp", "cli", "web"],
  "summaryZh": "在本机回看 Codex 任务、追踪 Token 用量与 API 估算金额，检查 AGENTS.md 和 Skill 文件，盘点 MCP 配置及调用尝试记录。"
}
```

Claude Code, pi, automatic repair, and subscription-allowance monitoring are not current capability labels. Source facts, static checks, call attempts, and runtime validity remain distinct. Candidate preparation does not authorize repository visibility changes or Release creation.
