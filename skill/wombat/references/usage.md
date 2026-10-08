# Usage and tasks

Use `usage --json` for the full selected scope. Resolve “today/yesterday” using the user's local date and timezone, not display language. CLI `--since` includes its date and `--until` excludes it. Filters include project, source, model and effort; a source root is not a project root. Respect explicit ranges and offline/fixed requests.

For “where did it go”, use a relevant presentation (`--presentation projects|models|distribution|details`) and `threads --sort tokens|cost --limit 10 --json`. The returned overview covers the complete scope; a page of rows is not a complete total. Preserve unpriced coverage and Token categories; tool operations have no separately allocated cost.

Locate named tasks with `threads --search TEXT`, or exact IDs with `--locate-thread ID`. Pin the returned snapshot using `--snapshot ID` for subsequent pages and `turns --thread ID --sort tokens --limit 10 --json`. Use `--locate-turn ID` for a selected turn and `steps --thread ID --turn ID --json` for its records. A pinned CLI query cannot combine `--snapshot` with `--root` or `--fresh`: its returned snapshot ID already binds the source set. Keep project/source-ID/date filters and selected IDs; omit source-root flags only on these pinned queries. Request `--matched-only` only when the question concerns matching turns.

Use page.nextOffset for pagination, not guessed offsets or new rankings. Explain what evidence associates an operation with consumption without attributing an independent fee to it. Missing text or turn attribution stays unknown. A later “that project” uses the reliable cwd from the selected task. On expiration, disclose a new version before comparing results.
