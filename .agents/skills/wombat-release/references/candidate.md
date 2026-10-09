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
| Generate Release notes | `corepack pnpm release:notes -- --set <release-set.json> --output <notes.md>` | Produces the canonical English body from reviewed user impact plus verified version, source, targets, and comparison facts |
| Pre-tag remote preflight | `corepack pnpm release:preflight -- --version <version>` | Requires current root READMEs, a clean `main`, exact `origin/main`, no existing tag/Release, a public unarchived repository, and successful CI for the exact commit; no mutation |
| Publish end to end | `corepack pnpm release:publish` | Uses root version; synchronizes/checks/commits/pushes, waits exact-source CI, reuses its verified archives, tags/publishes and verifies public install/update |
| Local build | `corepack pnpm build` | Compiles core, client, Web, and CLI |
| Startup probe without scanning | `corepack pnpm release:probe` | Starts the shared service with nonexistent source directories and reads capabilities to check process startup, sockets, and the CLI protocol; requires built dist/ |
| Full release gate | `corepack pnpm release:check` | Formatting, Rust lint, build, types, contracts, product tests, licenses, repository rules, and public-source checks |
| Focused install candidate | `corepack pnpm release:verify-install` | Builds the current target, checks types/repository rules/update regressions, and packages/tests installation, upgrade and Web; no publication or full release signoff |
| Local candidate | `corepack pnpm github:pack -- --current-platform` | Packs and extracts the local archive, checksums, and release-set; no upload |
| Five-platform candidate | `corepack pnpm github:pack -- --native-dir <artifacts>` | Validates matching version/commit, cores, runtimes, and notices before packing; no upload |
| Native export | `corepack pnpm native:export` | Exports local core, Node runtime, licenses, version, commit, and hashes |

Packing runs release:check by default. Use --reuse-build only after gates passed on exactly the same source; fingerprint validation still applies. The focused install entry uses it after its scoped checks for candidate diagnosis, while public releases still require the full gate. Rebuild after source, lockfile, release-script, or manifest changes. If local Node lacks its distributed LICENSE, pass --runtime-license with the official license for the bundled runtime; CI setup-node should provide it. The project MIT license cannot replace Node's license.

## Verify candidates

1. Run the scoped entry with locked dependencies in isolation. For failures, follow the [failure investigation rules](../../../../docs/development/workflow.en.md#failure-investigation) across all matching CI and release entries before another platform run; never bypass gates.
2. Inspect dist/github/release-set.json, SHA256SUMS, and every archive against the target and payload definitions in scripts/native-platforms.ts and scripts/github-release.ts. Check release.json and project, dependency, and runtime notices.
3. verify-github-release.ts uses the bundled runtime for version, read-only offline `wombat doctor`, empty-snapshot, live, append, fixed-snapshot, task, and Web tests with an empty application PATH, synthetic sources, and temporary data directories. It also installs the preceding public release and upgrades that managed installation to the candidate, preserving the previous version while switching the current pointer.
4. Run scripts/install/install.sh --base-url file://<dist/github> into a repository-external prefix. Verify the managed marker, version directory, current.txt, launcher, and empty-PATH operation. Verify scripts/install/install.ps1 -BaseUrl <URL> on Windows itself.
5. cli/tests/update.test.ts covers check-only, size/hash, archive safety, and atomic switching with a simulated Release. Candidate CI performs the real cross-version upgrade on all five targets. After publication, test `wombat update --check` through the stable public endpoint.
6. Report archive paths, size, SHA-256, source commit, verified platforms, and omissions. Changed archives or rebuilds invalidate previous hash/install evidence.
