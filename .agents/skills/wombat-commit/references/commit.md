## Stage, verify, and commit

Stage explicit paths or inspected hunks for one group. Avoid blanket staging, destructive resets, or clearing someone else's index. If unrelated staged content prevents an exact commit, preserve it using an isolated index/workspace strategy or resolve the scope; do not silently include or discard it. Inspect the complete staged diff, including deletions, new files, modes, and generated artifacts, before proceeding.

Select meaningful checks with wombat-verify. When unstaged files could mask missing dependencies, validate the staged tree in an isolated snapshot. Reuse passing evidence only when it applies to that exact group and its prerequisites; build before artifact-dependent tests. Run staged whitespace checks and the checks required for the affected scope. Failed or unavailable required checks leave the group uncommitted unless the user explicitly accepts that specific omission; report the limit rather than claiming it passed.

Immediately before committing, recheck HEAD and staged content against the reviewed and verified candidate. If another edit, hook, or tool changes the candidate, inspect and revalidate the affected scope. Use a concise repository-consistent commit message describing the resulting behavior; add rationale or limits only when useful. Do not bypass failed hooks, amend existing commits, or reset history unless explicitly authorized. A failure stops dependent commits until diagnosed; it does not justify force or blind retries.

After each successful commit, inspect its actual diff and remaining staged/unstaged state. Verify that only the intended group entered the commit and that unrelated work remains. Continue with dependent groups using the new HEAD as their base. If a discrepancy appears, report and resolve it without silently rewriting history.

## Report

List the created commit IDs and purposes, reused versus new review scope, relevant checks, and any uncommitted changes or unresolved findings. If no commits were requested, return the concrete grouping and review outcome instead. Keep this evidence in the task; do not add another progress document or decision solely to record a commit.
