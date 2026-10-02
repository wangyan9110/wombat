# Distribution status and public descriptions

[中文](distribution.md) | English

## Current status

The root workspace remains `private: true`; no public npm release has passed acceptance. The planned package is `@wangyan9110/wombat`, its command is `wombat`, and it requires Node.js 26.4.0 or newer. README installation instructions remain explicitly planned for after publication. See the [support matrix](support-matrix.en.md) for platform acceptance.

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

npm packaging calls `scripts/npm-readme.ts` only on staged copies to pin relative image, logo, language and documentation links to a public reference. Before publication, verify that a real public tag or commit contains the corresponding READMEs, images and documentation, then check unauthenticated access and npm rendering. These new materials are not committed or pushed, so no public reference has been verified for them. Converter unit tests verify rewriting, not remote availability.

This round applies copy, assets and the public file list only. It does not assemble a universal npm candidate, run an installation, update remote descriptions or publish. Follow the [release Skill](../../.agents/skills/wombat-release/SKILL.md) for later platform-artifact, installation and public-reference checks; preparing a candidate is not publication authorization. Actual checks are recorded in [progress](../project/progress.en.md).
