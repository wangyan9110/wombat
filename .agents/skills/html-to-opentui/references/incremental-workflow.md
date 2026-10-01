# Incremental prototype reconciliation

## Three inputs, not a blind replacement

Compare the **accepted prototype baseline**, **updated prototype**, and **current implementation**. Keep the accepted inventory, mappings, implementation hashes, state/size captures and verification results immutable until the next acceptance. Do not reconstruct acceptance from whatever happens to be on disk now.

A source delta is not itself an implementation defect. A modified implementation file is not a conflict by itself. Report evidence in distinct categories:

- exact CSS property/declaration additions, removals and changes;
- rule ordering and structural changes requiring cascade/template review;
- JS dependency/candidate differences requiring semantic review;
- files changed since implementation acceptance;
- observed expected/actual color or geometry mismatches;
- unmapped changes, unobserved transitions and unresolved extraction issues.

## Commands and binding format

Re-extract the new prototype rather than reusing a stale inventory:

```sh
node scripts/extract_prototype.ts --html /absolute/prototype.html --out /absolute/review/current.json
node scripts/check_sources.ts --inventory /absolute/review/current.json
node scripts/plan_changes.ts --before /absolute/review/accepted.json --after /absolute/review/current.json --bindings /absolute/review/bindings.json --capture /absolute/review/current-native.json --out /absolute/review/change-plan.json
```

`--capture` is optional. Without it, the plan reports source impact and implementation drift only. Captures must be freshly made from the current implementation with recorded build identity and the mapped scenarios; the tool does not attest when a capture was made. Exit 2 means review is required and a report was written, 1 means invalid input/command failure, 0 means no detected mapped or source change. Exit 0 is not full interaction parity.

The binding file follows `Bindings` in `scripts/types.ts`:

```json
{
  "schemaVersion": 1,
  "baselineSources": [{"path":"/review/prototype.css","sha256":"accepted-raw-byte-sha256"}],
  "components": [{
    "id":"period-controls",
    "sources":[{"path":"/review/prototype.css","selectors":[".period.active"]},{"path":"/review/controller.js"}],
    "implementation":[{"path":"/target/src/period.ts","sha256":"accepted-implementation-sha256"}],
    "colors":[{"screen":"period-active-80","text":"Weekly","selector":".period.active","property":"color","channel":"fg","cascadeConfirmed":true}],
    "geometry":[{"screen":"period-active-80","kind":"inside","node":"period-label","container":"period-button"}],
    "interactions":["switch period by mouse and keyboard","resize while active"]
  }]
}
```

Replace sample paths/hashes with real evidence. `baselineSources` must contain **every** accepted inventory source and matching hash, not only the sources relevant to this component. `sources` maps source files and optionally exact inventory selector strings; include shared stylesheet/controller dependencies to avoid missing inherited effects. Repeated rules are paired by source + selector + conditions + occurrence; reordering/renaming may produce conservative added/removed entries. Location shifts alone do not change CSS declarations.

The implementation side is currently **file-level drift**, not an AST patch or automatic attribution to a particular implementation symbol. Source-selector impact is only as complete as the authored bindings. `unmappedSources` and `unmappedCss` must be reviewed before accepting. JS module changes are conservatively assigned to all bound components, even when no recognized candidate changed. Dynamic runtime effects can still lie outside the source inventory.

Color checks show expected CSS values and actual native span values. Geometry checks show measured rectangles and failed relationships. A changed geometry policy must be reviewed and updated before its old expectations can validate a new design. A removed selector leaves the old mapping unresolved; do not invent a replacement or discard the check automatically. No interaction replay is performed by this tool; `interactionsToVerify` lists the required host-runtime checks.

## Modification procedure

1. Validate baseline identity and source freshness. Review extraction issues and unmapped changes first.
2. Trace semantic dependencies across HTML/CSS/JS using the [source translation workflow](source-to-native.md): template/attribute changes alter selector matching; tokens/ancestors alter used layout; state guards and effects alter reachable branches and lifecycle. Resolve affected styles, structure, transitions and effects, including shared consumers and responsive variants. Update coverage decisions and their checks; do not limit impact to the changed selector or recognized JS candidate.
3. Inspect current implementation edits. If both sides changed, reconcile them without overwriting human work. Locate implementation symbols through the mapped files and source review.
4. Produce a concrete plan: component → source before/after → observed current behavior → owning code → required edit → checks. Keep known differences separate from inferred risks.
5. Change the smallest owning component/state adapter. Preserve stable IDs, focus, scroll and data ownership. Do not regenerate unrelated pages.
6. Recapture affected state/size pairs, plus consumers of shared components. Run native interaction and applicable host type/build/installation checks.
7. Record accepted evidence and remaining approximations as a new baseline. Keep the previous baseline; hashes updating alone is not acceptance.

For example, changing `.period.active` background requires checking the active button's content fill and border cells, active → inactive transfer, mouse/keyboard activation and resize. It does not justify replacing unrelated report data queries. A shared table track change requires header/data/total alignment, large values and breakpoint widths, even when only one CSS declaration changed.
