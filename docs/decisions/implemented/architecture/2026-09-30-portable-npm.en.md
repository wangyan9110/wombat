# Decision: portable npm distribution and local transport

[中文](2026-09-30-portable-npm.md) | English

Status: implemented

## Problem

The original candidate contained only the host core and restricted npm metadata to darwin/arm64; Windows live queries were rejected. Removing the restriction alone would install the wrong binary on other platforms.

## Decision

The all-cores-in-one-package choice is replaced by the [platform npm decision](2026-10-03-npm-platform-distribution.en.md); the current main package installs only the local core through optional dependencies. The original decision was one npm package carries cores for macOS arm64/x64, Linux glibc arm64/x64, and Windows x64. The client selects by OS and architecture and rejects missing targets rather than invoking an incompatible binary. CI runs release and installation checks per target and exports version, source commit, and SHA-256 manifests. Export and assembly require committed product sources; assembly rejects missing, mixed-revision, or corrupt artifacts. Platform license inventories are retained. `--current-platform` produces only a platform-restricted local installation candidate, not a universal package. Builds do not publish automatically.

Windows uses the pinned interprocess library for local named pipes, rejects remote clients, and restricts access with an owner DACL and bounded nonblocking I/O. Unix keeps private sockets. Both reuse the service lock, sync worker, view cache, queries, and idle shutdown. There is no HTTP listener.

## Alternatives considered

Platform-specific npm optional dependencies reduce download size but require coordinated publication and version availability across multiple packages; the initial single package reduces release steps. Removing platform metadata alone cannot fix native binaries or Windows IPC. Loopback TCP requires additional authentication and port discovery, so system-local transport was selected.

## Impact and verification

The package is larger; installation needs neither Rust nor a separate binary download script. Linux CI currently uses Ubuntu 24.04/glibc; Alpine/musl and Windows ARM64 are not claimed. Windows permissions and ConPTY still require testing on a Windows runner. Configuration, cross-target type checks, and macOS tests do not establish target-platform acceptance. See [progress](../../../project/progress.en.md) for evidence and [security policy](../../../../SECURITY.md) for remote controls.
