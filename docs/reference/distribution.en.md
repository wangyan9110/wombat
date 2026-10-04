# Distribution status and public descriptions

[中文](distribution.md) | English

## Current status

The root workspace remains `private: true`; no public npm release has passed acceptance. The planned package is `@wangyan9110/wombat`, its command is `wombat`, and npm runtime requires Node.js 22 or newer; source tools require 26.4.0 or newer. README installation instructions remain explicitly planned for after publication. See the [support matrix](support-matrix.en.md) for platform acceptance.

## npm installation and release structure

After publication, run `npm install -g @wangyan9110/wombat`, then `wombat web --open` or a CLI query. Users need only Node/npm, without Rust, pnpm, compilers or post-install download scripts. The main package bundles CLI dependencies and Web assets, without a Node runtime.

The main package contains no native core. Five platforms use exact `optionalDependencies`aliases to platform versions under the same package name: for example,`@wangyan9110/wombat-darwin-arm64` points to`npm:@wangyan9110/wombat@0.3.0-darwin-arm64`. npm os/cpu/libc filtering downloads only the local component; core resolution checks version, target and source commit. Omitted optional dependencies yield CORE_UNAVAILABLE and an`--include=optional`recovery command, without falling back to development binaries; unsupported targets fail explicitly. See the [decision](../decisions/implemented/architecture/2026-10-03-npm-platform-distribution.en.md) for version rules.

`npm:pack -- --name @wangyan9110/wombat --native-dir native-artifacts`creates one main package, five platform versions and release-set.json with SHA-256 hashes. Native artifacts must share version/commit; cores and platform notices are checked. Windows checks the static CRT and compiler DLL imports.`--current-platform`creates local candidates only. `--reuse-build`still validates source/output fingerprints and runs actual installation; stale builds cannot be reused.

Candidates use a temporary loopback registry for real npm global installation, asserting only main/local tarballs are downloaded. Live, append, fixed-snapshot and Web queries run with empty PATH, and missing optional dependencies are checked. Sources and data are synthetic and temporary. CI collects five platforms at one revision and installs the same final set on each target. Node 22 verifies the runtime minimum, with additional 24/26 coverage on macOS arm64. Configured CI does not establish target-machine acceptance.

Follow the [release Skill](../../.agents/skills/wombat-release/SKILL.md): publish five platform versions with explicit non-latest tags first, verify exact remote versions/integrity, then publish the main version last. No public release exists, and no prior-release migration is promised. See [progress](../project/progress.en.md) for passed local installation and unverified platforms.

## GitHub description candidates

These candidates are ready for a later external update; they do not mean GitHub About or Topics have changed. The root `package.json` owns npm description and keywords, maintained separately from GitHub Topics.

```json
{
  "about": "Review Codex tasks and token usage locally. Estimate API costs, check AGENTS.md and Skills, and view MCP entries and call attempts. Web app + CLI.",
  "topics": ["codex", "token-usage", "usage-tracker", "agent-skills", "agents-md", "mcp", "cli", "web"],
  "summaryZh": "在本机回看 Codex 任务、追踪 Token 用量与 API 估算金额，检查 AGENTS.md 和 Skill 文件，盘点 MCP 配置及调用尝试记录。"
}
```

Claude Code, pi, automatic repair and subscription-allowance monitoring are not current capability labels; other agents remain planned. Source facts, static file checks, call attempts and runtime validity are distinct.

## README and packaged materials

Root READMEs keep relative image, language and documentation links. Each language has two screenshots, with the second inside a details disclosure. The four JPEGs are labelled design-prototype previews; the two SVGs provide light/dark logos. Only these six assets ship in the current package. Older images remain available to historical records but are excluded from the package. Screenshots do not establish product acceptance or savings.

npm packaging calls `scripts/npm-readme.ts` only on staged copies to pin relative image, logo, language and documentation links to a public reference. Before publication, verify that a real public tag or commit contains the corresponding READMEs, images and documentation, then check unauthenticated access and npm rendering. Unauthenticated access and npm rendering have not been verified for these new materials. Committing and pushing source does not replace public-reference acceptance. Converter unit tests verify rewriting, not remote availability.

Actual checks are recorded in [progress](../project/progress.en.md). Preparing candidates does not update GitHub descriptions or authorize publication.
