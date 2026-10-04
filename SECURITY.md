# Security

English | [中文](SECURITY.zh-CN.md)

## Supported versions

Security fixes target the current main branch and the next GitHub Release. Older preview versions have no separate maintenance commitment. Report a problem even if you are unsure whether it affects the latest version.

## Reporting a vulnerability

Use **Report a vulnerability** on the repository's [Security page](https://github.com/wangyan9110/wombat/security) when available. If it is unavailable, open an issue requesting a private reporting channel without describing the vulnerability or attaching evidence. The maintainer must establish that channel before requesting details. Never post credentials, exploit details, real conversations, titles, or personal paths publicly.

In private, provide the affected version or commit, platform, impact, and a minimal synthetic reproduction. For source builds, include the Node version. Do not test against other people's data. There is no guaranteed response time or bounty program. Coordinate disclosure after a fix is available.

## Release requirements

Before public release, the maintainer must verify private reporting and require the CI checks for platform verification, GitHub archive assembly, clean installation, and dependency advisories on the default branch. The present private repository's GitHub plan may block these settings; the policy file alone does not enable them. Do not mark this step complete until the controls are verified on GitHub.

Inspect dependency advisories, reachable history, and the actual GitHub Release archives. Existing secret-pattern checks have limited coverage. If a secret was exposed, revoke or rotate it; deleting it from the latest tree is insufficient. For local data and network behavior, read [Privacy](docs/reference/privacy.en.md).
