# Explain through Web

Use charts for trends/contributor comparisons, task/turn detail for long sequences, and configuration/suggestion evidence for complex findings. Explain the conclusion in the conversation and what to inspect in the browser. Browser failure still leaves a useful conversational answer.

Check `web --help` before using context opening. When available, supply `web --context FILE --json` with a generated-contract context: page plus the corresponding usage/configuration/optimization request, selected IDs and returned versions. Supply both date boundaries or `allTime`; unsupported browser filters are rejected rather than silently widened. The browser may use its own pagination size. Source/project roots belong to startup flags, not arbitrary URL paths. The host validates scope/version before returning its effective context and session URL. Never build a fake same-version link or use an expired connection.

Without context support, `web --json` can open the existing local page; disclose that exact object/version navigation was not preserved. Do not claim integration from an address alone. Keep exclusive CLI date boundaries when forming context; the product converts display dates.

Preserve Web language preference by default; add `--lang zh|en` only for an explicit page-language request. Language changes do not change date timezone, scope, targets or authorization. Manage this invocation's service lifetime; stopping it must not stop other shared readers. Use the returned session link locally and do not publish its connection token. Browser selection is not automatically conversational selection; clarify a changed target before editing.


For a selected task’s turns, write the following shape using returned values; `turnId` belongs only to a `steps` request, not `turns`:

```json
{"page":"threads","usage":{"action":"turns","snapshotId":"RETURNED_SNAPSHOT_ID","threadId":"RETURNED_THREAD_ID","scope":{"allTime":true,"timezone":"USER_TIMEZONE","project":"SELECTED_PROJECT"},"sort":"tokens"}}
```

For a configuration item, use its own read view and authorized current project:

```json
{"page":"instructions","configuration":{"action":"detail","readView":"RETURNED_CONFIG_VIEW","itemId":"RETURNED_ITEM_ID","scope":{"project":"AUTHORIZED_PROJECT"}}}
```

For a reviewed suggestion, carry both configuration and decision versions:

```json
{"page":"optimize","optimization":{"action":"detail","readView":"RETURNED_CONFIG_VIEW","decisionRevision":"RETURNED_DECISION_REVISION","project":"AUTHORIZED_PROJECT","suggestionId":"RETURNED_SUGGESTION_ID"}}
```

Replace placeholders, retain explicit dated scope with both boundaries when relevant, and keep root paths in the Web startup flags. Read the host’s returned effective context before claiming the browser matches. Do not use the illustrative placeholder strings as real IDs or invent extra fields.
