## Report and follow through

Lead with actionable findings ordered by severity. Each finding names a precise file/line, trigger, consequence, supporting evidence, and a concise correction direction. Use P0 for an immediate critical issue, P1 for a high-impact defect, P2 for a normal actionable defect, and P3 for a minor concrete issue; do not assign urgency without evidence. Documentation and decision defects use the same impact-based standard.

Then state unresolved assumptions, actual checks, and coverage limits. If no actionable findings remain, say so explicitly without claiming the code is defect-free. Keep pre-existing issues separate from introduced regressions. When repairs were authorized, distinguish fixed findings from unresolved ones and report focused revalidation; do not publish findings to external systems without authorization.

Make review reuse assessable: identify the base and reviewed revision, or content fingerprints for uncommitted files/diffs, along with covered scope and unresolved findings. Retain this evidence in the task, not a repository ledger. Later edits or changed dependencies require reassessing affected coverage; a review is not permanent approval of a filename.
