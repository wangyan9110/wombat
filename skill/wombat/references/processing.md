# Process and recheck

For a Web handoff, preserve supplied cwd, target IDs/paths, hashes/existence, selectionVersion, readView and decisionRevision. Verify scope and current file state before editing. Changed targets require renewed review; do not substitute a reordered “first” item or expand to the whole machine.

Process within the user's authorization in the receiving conversation. Preserve purpose, triggers, necessary constraints, tests, references and shared projects. Codex owns file edits, review and recovery. Wombat has no apply/recover job API. Do not send another handoff to yourself.

After edits, call `optimize recheck --suggestion ID --project-root PATH --project PATH --json` with current evidence; inspect per-rule outcomes. A passing static recheck is not proof of actual adoption, better task quality or financial savings. Report residual findings and uncheckable rules. Keep user decisions separate from checks.

If the user explicitly chooses “keep” or “not applicable”, use `optimize keep|not-applicable --suggestion ID --reason necessary|object_changed|incorrect_evidence` with the reviewed readView/decisionRevision and scope. Follow current help for exact arguments. Rechecks must not revoke those decisions. Do not create consuming tasks just to test adoption.

Only use `optimize handoff` when the user asks to send to a separate Codex task. Preview first, bind the reviewed selection version, then send. Accepted, failed and unknown delivery are distinct; never automatically resend an unknown delivery. Native allowance checks apply at send time.
