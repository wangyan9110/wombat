## Review decision and documentation maintenance

Apply the owning decision rules to the same change, not as an optional later cleanup:

- Apply the decision owner’s recording threshold: lasting rationale not explained by code, tests, or existing docs. Updating the existing note satisfies it; mechanical/local edits, including local UI, are exempt.
- For refinements of the same decision, identify facts, paths, alternatives, or consequences that need updating. For a reversal, require a new cross-linked owner rather than editing the old rationale into its opposite.
- Verify lifecycle against the complete agreed scope and evidence. Partial delivery stays proposed; moving to implemented replaces plans with actual decisions and consequences. Remaining acceptance gaps must retain an owner rather than disappearing during a move.
- Inspect full versus partial supersession. Partial replacement keeps both owners linked. Before full consolidation/deletion, account for unique rationale, alternatives, costs, required verification, and named gaps in the surviving owner; Git history alone does not preserve their active ownership.
- Check one home per fact: unfinished requirements and acceptance in the owning proposal; current behavior in module/reference documentation; rationale in decisions; execution results in tests, CI, or scoped evidence. Flag duplicate specifications, status tables, catalogs, or conflicting claims with concrete locations.
- Check incoming links, both language files, confirmation records, manifests, and executable consumers of moved/deleted paths. Hash confirmation alone does not prove translation fidelity. Use [wombat-docs](../../wombat-docs/SKILL.md) when authorized maintenance requires edits.

Report a decision-maintenance omission with the affected note or code location, the specific conflict or lost requirement, and the needed update/move/link/consolidation. Do not create a new review report, progress ledger, or decision merely to record that a review occurred.
