---
name: wombat-release
description: Build and release Wombat GitHub archives, run release gates and clean installation/update checks, and verify published assets; use for packaging, publication, and release failures.
---

# Wombat Build and Release

Follow [repository rules](../../../AGENTS.md), [development](../../../docs/development/workflow.en.md), and [distribution](../../../docs/reference/distribution.en.md). This Skill orchestrates existing tools without a second product contract.

## Establish scope

- Distinguish local builds, development candidates, five-platform candidates, and public Releases. Candidate preparation does not authorize tags, publication, or repository visibility changes. Continue under existing explicit authorization; otherwise finish the reviewable candidate before requesting approval of its version, commit, and archives.
- Inspect branch, commit, staged and unstaged changes. Use isolation when the shared checkout is changing and record the baseline and patches. Preserve user changes and exclude real logs, credentials, and private material.
- Read source Node requirements from engines.node, bundled runtime identity from scripts/github-release.ts, and Rust from rust-toolchain.toml. Install using the lockfile.
- Use release:prepare for version changes across manifests, current release docs, bilingual records, and license inventory. Preparation, commits, tags, Releases, and repository visibility are separate actions.

## Existing entries

| Goal | Entry | Evidence scope |
|---|---|---|
| Prepare version | `corepack pnpm release:prepare -- --version <version>` | Updates versions, current release docs, named bilingual records, and licenses; no commit/tag/publication |
| Check preparation | `corepack pnpm release:prepare -- --check` | Fast version, pairing, license, and diff checks; not full release acceptance |
| Pre-tag remote preflight | `corepack pnpm release:preflight -- --version <version>` | Requires current root READMEs, a clean `main`, exact `origin/main`, no existing tag/Release, a public unarchived repository, and successful CI for the exact commit; no mutation |
| Publish end to end | `corepack pnpm release:publish -- --version <version>` | Resumable primary path: prepares/checks/commits/pushes, waits exact-source CI, runs preflight, tags, waits publication, verifies immutable assets/attestations, and tests a clean install/update |
| Local build | `corepack pnpm build` | Compiles core, client, Web, and CLI |
| Startup probe without scanning | `corepack pnpm release:probe` | Starts the shared service with nonexistent source directories and reads capabilities to check process startup, sockets, and the CLI protocol; requires built dist/ |
| Full release gate | `corepack pnpm release:check` | Formatting, Rust lint, build, types, contracts, product tests, licenses, repository rules, and public-source checks |
| Local candidate | `corepack pnpm github:pack -- --current-platform` | Packs and extracts the local archive, checksums, and release-set; no upload |
| Five-platform candidate | `corepack pnpm github:pack -- --native-dir <artifacts>` | Validates matching version/commit, cores, runtimes, and notices before packing; no upload |
| Native export | `corepack pnpm native:export` | Exports local core, Node runtime, licenses, version, commit, and hashes |

Packing runs release:check by default. Use --reuse-build only after gates passed on exactly the same source; fingerprint validation still applies. Rebuild after source, lockfile, release-script, or manifest changes. If local Node lacks its distributed LICENSE, pass --runtime-license with the official license for the bundled runtime; CI setup-node should provide it. The project MIT license cannot replace Node's license.

## Verify candidates

1. Run the scoped entry with locked dependencies in isolation. Record and fix the failing stage instead of bypassing gates.
2. Inspect dist/github/release-set.json, SHA256SUMS, and every archive against the payload and platform requirements owned by the distribution guide. Check release.json and project, dependency, and runtime notices.
3. verify-github-release.ts uses the bundled runtime for version, empty-snapshot, live, append, fixed-snapshot, task, and Web tests with an empty application PATH, synthetic sources, and temporary data directories.
4. Run install.sh --base-url file://<dist/github> into a repository-external prefix. Verify the managed marker, version directory, current.txt, launcher, and empty-PATH operation. Verify install.ps1 -BaseUrl <URL> on Windows itself.
5. cli/tests/update.test.ts covers check-only, size/hash, archive safety, and atomic switching with a simulated Release. After actual publication, test wombat update --check and a real cross-version remote upgrade.
6. Report archive paths, size, SHA-256, source commit, verified platforms, and omissions. Changed archives or rebuilds invalidate previous hash/install evidence.

## Publish and verify

Prefer `release:publish` for an authorized public release. It accepts an explicit version, refuses unrelated worktree changes, runs the local gates before committing, waits for CI on the exact pushed source, and calls `release:preflight` immediately before creating a missing tag. Rerunning it resumes from remote CI, tag, or Release state only when the existing identity still matches. It never replaces a tag or published asset. Use the lower-level entries only for diagnosis, candidate-only work, or recovery that the primary path explicitly requests.

The tag workflow independently checks that the tagged commit belongs to the default branch and already passed CI. It then runs gates and native export on five platforms, assembles archives, verifies the final files on each platform, creates provenance, uploads every asset to a draft, and publishes that complete draft. The primary script then requires an immutable complete Release, verifies its release and archive attestations, downloads and hashes all five archives, and exercises the public installer and update check on the operator's platform.

Before publication present version, tag, commit, archives/hashes, verification, and coverage gaps. Without publication authorization stop at the candidate. Upload the exact validated files, not manually repacked variants. Do not bypass failed tagged workflows with replacement tags; fix and issue a new version without overwriting a published one.

After publication redownload assets, compare SHA-256, and use the public installation command in a clean prefix. Verify version, CLI, Web, and update --check. Confirm raw installer URLs work without login. If remote state is uncertain, inspect Release assets and hashes before uploading again.

## Development Preview

Preview candidates increment dev.N. Moving to beta, RC, or stable requires the user's explicit decision. Use GitHub Pre-release without occupying stable latest; pass explicit versions in README and installation/update acceptance.

1. Establish local and remote baselines and one candidate version/tag. Run release:prepare; it requires consistent existing versions before updating root/modules/Rust manifests and lockfiles, README, distribution docs, named pairing records, and licenses. Missing expected versions stop preparation; it does not commit, tag, or publish.
2. Review the generated diff, especially stage, status, platform limits, and bilingual meaning, then run release:prepare --check. Tests read the current version from the root manifest rather than duplicate literals. The workflow derives Pre-release from the tag version.
3. Private repositories use local gates and skip hosted builds. Public repositories use only free standard GitHub-hosted runners, without larger runners; retain intermediate Actions artifacts for one day.
4. Run the complete release gate once after code/docs settle. After building, the gate runs release:probe with a capability request that does not scan sources, to isolate shared-service startup, socket, or protocol failures; subsequent product tests cover actual scanning. After failure, fix narrowly and retest affected paths. Rerun the full gate only when source, version, release scripts, lockfiles, or manifests change; release:prepare --check and release:probe cannot replace it.
5. With publication authorized, run `corepack pnpm release:publish -- --version <version>`. It performs commit/push, waits for five-platform CI on that commit, runs remote preflight, creates and pushes the matching tag, waits for the tag workflow, and verifies publication. If interrupted, run the same command again; it validates completed identities before continuing.
6. The primary script retrieves release-set/checksums, redownloads and verifies all five assets, verifies the immutable Release plus archive attestations, then installs the explicit version in an external clean prefix and runs `wombat update --check --version <version>` on the current platform. CI supplies final install evidence for every platform.
7. Record actual runs, hashes, platforms, and gaps in the task or Release results. Keep verification results with the Release or task; update an owning proposal only when its acceptance changes. Preserve failure evidence and use a new incremented preview version after fixes, never move public tags.

## Finish

Use the distribution guide for supported targets and runtime prerequisites; do not infer musl, Windows ARM64, or old-system acceptance. Report version, commit, platforms, gates, archive hashes, installation/update evidence, whether publication actually occurred, and the user's installation command. Candidates in dist/github are not externally installable Releases. Clean isolated workspaces only when no longer needed and required ignored files are saved.

The preflight follows GitHub's secure-use guidance: third-party Actions remain pinned to full commit SHAs, job permissions stay minimal, and verified assets are attached before a draft becomes public. GitHub artifact attestations bind archives to the hosted build, while SLSA recommends publishing and verifying provenance alongside release artifacts. Repository settings should enable immutable Releases and protect release tags when available; those server-side controls are inspected separately because the local preflight does not change GitHub settings.
