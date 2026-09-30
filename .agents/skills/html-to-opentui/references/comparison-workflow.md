# Repeatable source-to-native comparison

## Baseline and scope

Keep the review artifact outside the repository when it includes private references. Record:

| Field | Evidence |
|---|---|
| Reference | HTML, linked/imported CSS, interaction/model JS and fixture hashes |
| Runtime | Installed OpenTUI and Node/Bun versions; production component and actual entry |
| Scenario | View, stable selected item ID, expanded IDs, filter draft, sort and scroll |
| Size | Terminal columns/rows and corresponding prototype variant |
| Requirement | Source element/state and winning declaration or JS transition |
| Mapping | Native component, semantic color, cell allocation, integer rounding |
| Result | Capture name, node IDs, check output; verified / mismatched / not checked |

List the scenarios before fixing them. A typical report includes default, selected, hover, expanded, filtered, empty, updating, canceled and failed states. Use the states actually present in the source; do not invent new product screens. Record keyboard and mouse actions, focus destination, preserved data, and disabled actions for each transition.

The extractor follows statically named local script dependencies; add manually discovered interaction/model modules with repeated `--extra-source`. Re-run `check_sources.ts` before a final comparison. It fails for changed or missing listed files. Computed imports and runtime resources remain unresolved; freshness does not prove complete discovery. For update work, use the three-way process in [incremental reconciliation](incremental-workflow.md).

## Short iteration loop

1. Reproduce one discrepancy with fixed synthetic data in the real component. Capture text, styled spans and native rectangles after the awaited render. Retain the baseline capture.
2. Read the source rule/transition and the installed component API. Make the mapping explicit; use the source for expected styles, not the current TUI snapshot.
3. Change the owning component or semantic theme role. Check types after changing shared frame fields, callback signatures or async result handling, before widening the edit.
4. Run the affected geometry/style/interaction checks. Include narrow and short viewports, a long value and the transition back to the baseline state.
5. Once the component checks pass, run the applicable application journey and delivery checks. Hash all runtime chunks and native artifacts when an installed entry is the acceptance target. Keep previous release evidence dated.

Capture names should include state and size, for example `usage-selected-80x24`, not just `usage`. Use actual settled native bounds. Prefer observable frame predicates for asynchronous work over guessed sleeps. A text predicate must distinguish the expected state; finding a tab label that is always present proves no transition. Do not raise wait limits repeatedly without inspecting pending work.

## Geometry checks

The capture input is an array. Each selected screen has unique `name`, `width`, `height`, `plain` from the character frame, and `geometry` from the native renderable tree:

```json
[{"name":"report-80","width":80,"height":24,"plain":"… $1.5001 …",
  "geometry":[{"id":"footer","x":2,"y":20,"width":76,"height":4}]}]
```

Use stable IDs assigned by the application. Record the viewport wrapper of a ScrollBox when checking visible containment; its content can legitimately extend beyond the visible area. Collect bounds after layout and after the action being verified, not immediately after a setter.

The mapping is a separate JSON array, with one rule per relationship:

```json
[
  {"screen":"report-80","kind":"aligned","nodes":["header-input","row-input","total-input"],"properties":["x","width"]},
  {"screen":"report-80","kind":"inside","node":"footer","container":"@viewport"},
  {"screen":"report-80","kind":"centered","node":"content","axis":"x","tolerance":1},
  {"screen":"report-80","kind":"ordered","nodes":["header","records-viewport","footer"],"axis":"y","gap":0},
  {"screen":"report-80","kind":"text","value":"$1.5001"}
]
```

These are input-shape examples, not a matching capture/mapping pair. Replace the IDs with captured nodes. `aligned` compares the named rectangle properties; `inside` requires the full rectangle within its container; `centered` compares centers on one axis; `ordered` checks non-overlap in the supplied order. Tolerance defaults to zero and is in terminal cells. Use one-cell tolerance only for justified rounding, not to hide drift. All referenced rectangles must have positive size. Missing/duplicate IDs or screens, invalid numbers, and an empty check list fail.

This is a comparison tool, not a layout engine. Containment does not prove visibility through all clipping ancestors, overlays or terminal glyphs. `text` requires an exact substring on the character frame and will fail if that substring wraps; use a genuinely unbroken amount or a targeted native text assertion. Check colors, glyph weight, links and interactions separately. A passing subset does not establish whole-screen fidelity.

## Upstream experience checked on 2026-09-30

- [OpenTUI layout](https://opentui.com/docs/core-concepts/layout/): native layout uses terminal cells and a supported Flexbox subset. Borders and padding consume track space. Apply this to the shared header/data/total track contract; do not assume all browser CSS is available.
- [OpenTUI testing](https://opentui.com/docs/core-concepts/testing/): the test renderer provides native in-memory output, character frames, styled spans and input drivers. Observable render waits and explicit teardown are more reliable than arbitrary delays. Match APIs to the installed version.
- [OpenTUI ScrollBox](https://opentui.com/docs/components/scrollbox/): distinguish wrapper, viewport and content. Culling skips offscreen rendering hooks, so correctness must not depend on those hooks firing for invisible children.
- [OpenClaw's TUI prototype skill](https://github.com/openclaw/openclaw/blob/main/.agents/skills/prototype-openclaw-tui/SKILL.md): reuse the real rendering stack, keep a baseline and compare deterministic fixtures without live data effects. Borrow the isolation method; its Clack/Pi renderer and tmux workflow are not dependencies of this skill.

The geometry/freshness helpers are local implementations. The footer, equal-height scroll and cancellation notes in [mapping pitfalls](mapping-pitfalls.md) come from prior terminal-port work; they are not upstream guarantees. No automatic arbitrary HTML-to-TUI compiler is assumed.
