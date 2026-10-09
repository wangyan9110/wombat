# Current configuration

Default to this Codex workspace only when the request means “this project”; otherwise keep the selected project's exact cwd. Use `optimize inventory --project-root PATH --project PATH --json` for current configuration and evidence, and `optimize --project-root PATH --project PATH --json` for deterministic suggestions. Read command help for narrower kinds/actions; scope sources separately with `--root`.

Use `optimize inventory --action detail|evidence|related_scopes --item ID --read-view VERSION --json` to examine an item, or `optimize detail --suggestion ID --read-view VERSION --decision-revision REVISION --json` for a suggestion. Keep project roots and scope on every call. Current configuration does not establish historical contents or loading. `optimize` checks current files and does not accept usage date/model filters such as `--all-time`; use its project/source options. Inventory date filters narrow related historical evidence rather than the current-file checks.

Separate declared configuration, native loaded observations, runtime attempts and actual successful use. Static measurement is not actual injected Token consumption. Unknown MCP text, historical versions or incomplete history cannot prove absence or inactivity. Inspect findings, exact target paths, shared project impact and coverage before suggesting a change.
