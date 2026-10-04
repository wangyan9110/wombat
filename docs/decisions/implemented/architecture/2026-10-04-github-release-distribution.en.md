# Decision: self-contained GitHub Release archives and atomic updates

[中文](2026-10-04-github-release-distribution.md) | English

Status: implemented

## Problem

Wombat users need one-command installation and in-product updates without installing Node/npm first. The prior npm platform-package design still required Node 22+ and coordinated one main version with five platform prereleases. No public release exists, so there are no npm users to migrate.

## Decision

GitHub Releases is the only product distribution channel. Each version has five independent archives for macOS arm64/x64, Linux glibc arm64/x64, and Windows x64. Each contains only the local Rust core, bundled CLI/Web, a fixed Node.js 26.4.0 runtime, and complete notices. `release-set.json` and `SHA256SUMS` bind version, source commit, target, size, and hashes. `install.sh` and `install.ps1` detect the platform, verify the archive, and write a managed installation.

Installations use `versions/<version>-<source>/` plus `current.txt`. `wombat update` reads Release metadata from the fixed GitHub repository, limits download size, cross-checks release-set and SHA256SUMS, rejects absolute paths, parent traversal, and links, then places the new payload beside the old one and switches the pointer. It does not overwrite the running version, so Windows never replaces an in-use `node.exe`. Source builds and manually extracted copies have no managed pointer and are rejected explicitly.

The tag workflow references [Mole's GitHub Release matrix, checksums, and provenance flow](https://github.com/tw93/Mole/blob/main/.github/workflows/release.yml), with an independent implementation for Wombat's Rust and Node architecture. Five targets export core, Node runtime, and notice hashes. After assembly, all targets verify the final archives. A tag that differs from `package.json` is rejected; normal CI and candidate builds never upload.

This decision supersedes the former all-core npm package and subsequent platform packages; their notes are consolidated here. Retain exact target selection and version, source-commit, target, hash, and license verification. Missing, corrupt, mismatched, or unlicensed artifacts fail rather than falling back to another architecture. [Distribution](../../../reference/distribution.en.md) alone owns current operating instructions.

## Alternatives considered

Keeping npm platform packages reduces each archive's size but requires users to prepare Node/npm and coordinates six versions. An installer without an in-product updater makes repeated installation the only update path and cannot safely replace occupied files on Windows. Overwriting one directory is simpler but an interrupted update can damage the current version and provides no reliable previous directory.

## Consequences and verification

User downloads are larger because every platform archive bundles an uncompressed Node runtime of about 145 MB; the macOS arm64 development candidate compresses to about 48.5 MiB. Users need no Node/npm, and the runtime matches the verified environment. The installation briefly keeps the selected and previously running versions, using more disk; later updates remove older managed directories.

The macOS arm64 development candidate passed build, archive hashes, clean extraction, live/append/fixed-snapshot/Web checks, one-command installation, and version/live queries with an empty application PATH. A local simulated Release passed update checking, download, archive constraints, hashes, and atomic selection. CI and tag matrices cover the other four targets but have no hosted-run evidence in this iteration. Public Release creation, public installer URLs, a remote update across real versions, and older-OS compatibility remain unverified.

The all-core npm package traded redundant downloads of every target core for one installation entry. Platform npm dependencies reduced downloads but introduced exact coordination between the main and native package versions. That design was informed by the [Codex package](https://github.com/openai/codex/blob/main/codex-cli/package.json) and [packaging script](https://github.com/openai/codex/blob/main/codex-cli/scripts/build_npm_package.py), with an independent implementation. Bundling Node was previously deferred because of runtime size and update maintenance; this decision accepts those costs to remove the runtime prerequisite. Artifact integrity, clean installation, and target-system acceptance remain gates; cross-compilation does not establish them.
