# Privacy and local data

[中文](privacy.md) | English

This page describes current privacy boundaries. See [architecture](../development/architecture.en.md) for data directories and storage mechanisms.

Wombat operates offline by default without an API key, reading local Codex rollout logs and the title index. Basic refresh does not fetch prices online or modify Codex logs, configuration, authentication, or installation.

Derived indexes and snapshots retain token categories, pricing basis, source/conversation/turn identities, model and reasoning effort, time, project, native titles, and safe operation fields (tool name, file path, exit code, duration, MCP server/tool). Raw user messages, model text, complete command arguments, and tool output are excluded from snapshots and Node responses. Models, titles, paths, and names can still contain sensitive information and should not be shared indiscriminately.

Product data uses the system application data directory, overridable with WOMBAT_DATA_HOME. Files use private permissions and atomic replacement; snapshots are not encrypted vaults. This version has no upload, full-text replay, evidence export, or arbitrary execution capability.

Source directories change continuously. Each refresh fixes the observed boundary of each file; partial failures, incomplete tails, and uncertain associations retain explicit status. Tool calls without exclusive token accounting do not receive invented costs. Official-standard API-equivalent cost is not a subscription invoice.

Tests and public source use synthetic fixtures only. Real-source smoke outputs must stay outside the repository. Unreviewed raw data, real conversations, and secrets must not enter tests or public material. Removing retired features does not remove historical user decisions, identity registrations, or recovery material.
