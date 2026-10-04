# Decision: npm installation of platform-specific prebuilt cores

[中文](2026-10-03-npm-platform-distribution.md) | English

Status: implemented

Current product distribution is superseded by the [self-contained GitHub Release decision](2026-10-04-github-release-distribution.en.md). This record retains the previously implemented design and the still-applicable target-identity and notice-verification rationale.

## Problem

Shipping five cores in one package downloads foreign binaries on every machine. The source-tool Node 26.4 requirement was also imposed on users. Users requested one-command npm installation patterned after Codex CLI, avoiding compiler dependencies and excess disk usage. No public release exists, so prior-release migration is unnecessary.

## Decision

npm is the primary channel. The main package contains bundled CLI dependencies, Web assets and licenses, using five exact platform aliases to prerelease platform versions under one package name. Keep `@wangyan9110/wombat`: for example, alias `@wangyan9110/wombat-darwin-arm64` points to`npm:@wangyan9110/wombat@0.3.0-darwin-arm64`. Platform packages declare os/cpu and Linux glibc only; no install script or runtime downloader exists. This structure references the [official Codex package definition](https://github.com/openai/codex/blob/main/codex-cli/package.json) and [build script](https://github.com/openai/codex/blob/main/codex-cli/scripts/build_npm_package.py); implementation is independently written.

User runtime is Node 22+; source tools remain26.4.0+. Package resolution selects one core and checks version, target and commit. Missing dependencies give a command to reinstall with optional dependencies. Development keeps local build resolution, but installed packages never fall back to other cores. Windows links the CRT statically and rejects compiler DLL imports; macOS deployment minimum is 11 and the current Linux build baseline is Ubuntu 24.04. Minimum OS versions still require real-machine acceptance.

Build receipts bind source/output contents and execution permissions; reuse checks fingerprints. Native export/assembly check version/commit and binary/notice hashes. A release set contains five platform versions and one main version. Publish and verify platform versions with non-latest tags first, then the main version last. CI installs the same final set; building never uploads publicly.

This decision replaces the all-cores-in-one-package portion of the [earlier npm decision](2026-09-30-portable-npm.en.md). Its local transport decision remains valid. See [distribution](../../../reference/distribution.en.md) for current entry points and platform boundaries.

## Alternatives considered

A standalone installer with bundled Node removes runtime preparation but increases download, disk, update and platform-maintenance costs. Users explicitly accepted npm, so standalone bundle entries are removed. The old single package reduces release coordination while charging every user for five platforms; versions under one package name preserve exact pinning and reduce namespace maintenance.

## Consequences and verification

Installation downloads only the main package and local core, adds no resident process, and changes no accounting/storage algorithm. The tradeoff is coordinating six versions and requiring Node/npm; not every OS, musl or Windows ARM64 is supported.

A local macOS arm64 candidate ran real npm installation, empty-PATH queries and Web end-to-end tests with Node 22.0.0/26.4.0. Missing artifacts, mixed versions, corrupted artifacts and stale builds have failure checks. Five-platform CI and Node 24 compatibility flows are configured, without hosted-run evidence or public publication this round. OS browser opening and older OS interaction remain untested. See verification records retained in Git history for the full gate and candidate evidence.
