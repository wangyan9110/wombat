# CLI Instructions

Follow [root instructions](../AGENTS.md) and the [delivery workflow](../docs/development/workflow.en.md). Public behavior belongs in the [module README](README.en.md).

- CLI owns arguments, help, JSON/text rendering, and exit codes. Delegate accounting, pricing, filtering, and queries through the typed client.
- No subcommand means usage text with the same semantics as explicit usage. Start Web explicitly; no terminal rendering or FFI.
- JSON follows generated contracts; progress goes to stderr. Preserve distinct partial-result, cancellation, and argument-error states.
- Rebuild before CLI unit and real-core end-to-end tests when arguments/output change. Update affected bilingual command documentation.
- web only assembles the local host with startup scope. Exiting cancels this client's requests, not the shared core service used by other clients.
