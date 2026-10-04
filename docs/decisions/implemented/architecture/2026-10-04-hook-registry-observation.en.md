# Decision: Bind native Hook registry observations by project

[中文](2026-10-04-hook-registry-observation.md) | English

Status: implemented

## Problem

A declaration cannot establish enablement, trust or execution. The same global declaration can have different effective states in different projects; matching command text alone cannot detect changes between native configuration and file versions.

## Decision

A bounded preflight checks local Hook declarations and explicitly enabled plugins, skipping native startup when neither exists to reduce unrelated initialization. The Node host calls hooks/list in the verified Codex version. Rust retains ownership of authorized scope, declaration identity and current file versions. Observations use private core messages rather than public requests; the renderer receives no generic native RPC. States remain scoped to authorized working directories instead of becoming one effective-state label on a file.

Hash authorized regular files between two fully equal native responses, then match inventory file versions again in Rust. Observations enter only the pinned query view. Enabled/trust states and registration hashes affect its revision; observation time does not invalidate equal evidence. New reads and send revalidation observe again. The complete registry, commands and arbitrary native errors do not enter persistent product caches. Findings and user decisions retain only the project, registration hash and file version needed for rechecks. Native parent/child inheritance augments the current view only; failed observations do not delete scoped history. Invocation counts continue to require runtime evidence.

Standalone/inline plugin JSON declarations bind the native pluginId, package-relative path or inline document position. Only native-listed files inside authorized roots are read, without reproducing installation selection or traversing caches. Each file shares one inventory-phase read, and inventory project membership comes from the current registrations. Safe inventory retains last-known membership; absent observations without source reads mark it stale rather than deleted. Registration identities/states remain in the view, and historical rechecks stay unknown. Inline single objects/arrays use actual JSON pointers. Native-expanded commands cross private messages temporarily, then bind to the project, registration version and reread current declaration. Wombat does not duplicate native variable expansion; remaining dynamic expressions stay unknown.

## Alternatives considered

Reconstructing host precedence and trust from configuration would create a second parser prone to drift. Command-only matching cannot bind other registration parameters. Native observations plus file-version checks cost bounded native queries and additional hashing; unverified versions and key shapes remain unknown.

Static paths use pinned [shlex2.0.1](https://docs.rs/shlex/2.0.1/shlex/) for a limited Unix command subset, rejecting dynamic syntax without probing by executing commands. Node entries conservatively exclude [extension-resolution candidates](https://nodejs.org/api/modules.html#all-together); interpreter identity and script validity remain unproven.

## Impact and validation

Codex0.160.0 ordinary files and standalone/inline plugin JSON declarations are bound; Unix static script and native-expanded path checks are integrated. Remaining dynamic expressions stay unknown; Windows commands still have gaps. Coverage gaps remain per project; empty registries do not imply disabling or deletion. See the [contract](../../../development/contracts.en.md) for deadlines, count/byte budgets and fields. Synthetic validation covers project isolation, version changes, failures, limits and path boundaries; isolated native and browser evidence is in [progress](../../../project/progress.en.md). This decision does not establish runtime evidence, complete Hook rules or acceptance on other platforms.
