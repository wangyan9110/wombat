# Interface mapping and constrained compilation

This contract helps a coding agent translate design intent into implementation decisions. Use only the structure needed for the task. The primary deliverable remains the faithfully restored application; building a general compiler is optional work requiring its own explicit scope.

## Pipeline and ownership

`HTML + CSS + JS → source inventory + runtime observations → reviewed interface plan → terminal lowering → native OpenTUI components → evidence`

The executable tools currently implement source inventory, source freshness, mapped color/geometry comparisons and incremental impact reporting. They **do not** implement full CSS cascade, automatic state-machine recovery, browser automation or OpenTUI code generation. `InterfacePlan` in `scripts/types.ts` is a proposed typed authoring contract; TypeScript types are not a runtime JSON validator. Validate external plan inputs before a future generator consumes them.

Keep the compiler/adaptation tools separate from product business services. Target products supply their own data client and public model. Generated product code should use OpenTUI and the host's approved public interfaces, without importing private prototype sources or this skill package. Do not copy demonstration data into production defaults.

## Intermediate representation

Keep these concerns separate, with stable IDs and source locations:

| Concern | Required information |
|---|---|
| Component | DOM role/template, parent/children, native target, text/data bindings |
| Style | Resolved per-state values, winning declarations, inherited versus explicit values |
| Layout | Flow, shared tracks, minimums, overflow, responsive variants, cell rounding policy |
| State | Selected record ID, expanded IDs, tab, sort, draft, loading/error/cancelled state |
| Transition | From/action/to, guard if any, keyboard/mouse binding, retained data, focus destination |
| Effect | Data request, cancellation, actual progress, error result; narrow host adapter |
| Provenance | Source paths/hashes, selectors/symbols, observation scenario, confidence/unresolved reasons |

For a JS click handler that sets a period, clears selection and redraws, preserve those state changes as a named action. Bind both pointer and keyboard inputs to that action. Rendering should update native components without discarding input drafts, stable selection IDs or scroll unnecessarily. A prototype's full DOM replacement is not a requirement to destroy the entire terminal tree.

## JavaScript classification

1. Pure presentation functions: review inputs and dependencies, then reuse or port with equivalent fixtures.
2. State and transitions: extract explicit conditions, assignments and actions. The AST inventory reports candidates only; aliases, closures, delegated events and framework lifecycles need source/runtime review.
3. DOM construction: turn template structure and state-conditioned children into component definitions. A captured DOM is one state, not a reusable template.
4. Browser effects: focus, scrolling, layout measurement, timers and animation need target-specific native adapters.
5. Business mocks: simulated pricing, successful requests, timer-based progress and fabricated records remain fixtures, never production truth.

The scanner follows explicit local script URLs and string-literal ESM imports/re-exports, dynamic imports and `require`. It does not resolve package exports, extensionless modules, import maps, bundler aliases or computed imports. Async/defer/module scheduling remains runtime behavior, not inferred from inventory order. New Function/eval, Web Workers, injected scripts/styles, adopted stylesheets and network resources require explicit review even when no candidate is emitted. Discovery coverage is bounded, not proof of complete behavior.

Runtime observation should record initial state → action → resulting DOM/style/state → focus/scroll, using deterministic fixtures. Avoid replaying mutating/network actions without authorization. Browser permission limits still apply; do not replace a prohibited observation path with a separate hidden executor.

## Lowering rules

Prefer semantic mappings over arbitrary CSS property renames:

- Flex containers → native Box layout, with explicit grow/shrink/basis defaults.
- Shared table tracks → one reusable column contract across header, rows and total. Verify actual numeric glyph bounds as well as parent widths.
- Padding in px → an explicit horizontal/vertical cell policy; independently rounding each edge can break symmetry. A one-line label cannot be exactly centered within two integer rows.
- Border/background → distinguish border cells from content fill. Rounded browser geometry is an approximation using native border styles.
- A thin meter → a native fine stroke when appropriate, not automatically a whole-cell fill.
- Selected/hover/focus/expanded → separate states and precedence; do not collapse them into one generic selected palette.
- Responsive behavior → named terminal variants and tested boundary widths/heights, not an assumed universal pixels-to-columns ratio.
- Typography → terminal-controlled font, native normal/bold/underline and semantic color. Browser font size, fractional weights, shadows and subpixel detail cannot be promised identical.

Native OpenTUI owns Yoga layout, text display width, clipping, scrolling, focus/input dispatch and terminal lifecycle. The adaptation layer must not implement a competing layout solver or ANSI renderer. A future generator should produce native configuration, bindings, source maps and diagnostics. Unsupported input fails review or uses an explicitly recorded approximation.

## References

- [OpenTUI layout](https://opentui.com/docs/core-concepts/layout/): cell geometry, supported properties and rounding.
- [OpenTUI renderables](https://opentui.com/docs/core-concepts/renderables/): native tree ownership and updates.
- [CSS cascade](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction): why extracting declarations alone is insufficient.
- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API): AST analysis, not arbitrary JS semantic equivalence.

## Distribution boundary

The skill's package and lockfile are independent of any host repository. Tests create synthetic sources in temporary directories; no private prototypes, captures or real user data belong in the distributable. Preserve dependency attribution and lockfile license records. Repository extraction/publication still requires a review of the actual files and license/ownership; standalone tests alone are not a release approval.
