# Source-language translation workflow

Treat a prototype as a program whose observable interface must survive translation. Translate syntax through semantics before choosing OpenTUI components; neither a tag-to-widget dictionary nor CSS property renaming is sufficient. A small fix needs a small dependency trace; an initial port needs coverage of the entire requested interface.

## 1. Establish the source and target environments

Identify entry documents, local and remote dependencies, injected resources, templates, framework/runtime requirements, fonts and assets. Record fixture, locale, theme, browser viewport, prototype size preset and relevant environment preferences separately. Recover loading order and initialization rather than assuming file order is execution order.

Inspect the installed OpenTUI version, framework binding and supported native APIs. Terminal dimensions, font, color/image/input capabilities and platform behavior are target inputs. Match corresponding states and available content space; do not assume a universal pixels-to-cells ratio. Resource access follows the environment's permissions; an unavailable source or observation remains a named evidence gap.

## 2. Recover connected semantics

Use these guides as decision checklists for constructs actually encountered, not as a closed list of supported syntax:

| Source | Recover | Target responsibility |
|---|---|---|
| [HTML](html-semantics.md) | Parsed structure, text order, semantics, attributes, templates and implicit browser behavior | Component ownership, identity, content, controls and resource adapters |
| [CSS](css-semantics.md) | Selector matching, cascade, computed/used values, formatting contexts, paint and conditional styles | Native constraints, style resolution, cell adaptation and responsive policies |
| [JavaScript](javascript-semantics.md) | Control/data flow, dynamic construction, state, events, async effects and lifecycle | Typed state/actions, derived rendering, event bindings and managed effects |

Trace across languages: an event changes state, state changes an attribute/class or subtree, that changes selector matching and layout, and the resulting element controls focus or scroll. Include HTML defaults and CSS pseudo-states even when no JS handler exists. Conversely, a CSS class name alone does not establish a JS state machine.

Recover unresolved constructs with source analysis and permitted runtime observation. Inspect unvisited branches; runtime coverage of one state is not source coverage. Preserve observable results and relevant ordering, without mechanically reproducing browser DOM mutation APIs inside the terminal application.

## 3. Account for source coverage

For each relevant construct or reusable group, retain the following compact record. Use the optional `coverage` authoring records in `InterfacePlan`, or an equivalent small table for local work.

| Field | Meaning |
|---|---|
| Source | File/location, selector or symbol, construct and stable identity |
| Semantics | What this construct contributes to structure, appearance or behavior |
| Conditions | States, environment, branch guards and lifecycle in which it applies |
| Dependencies | Ancestors, tokens, resources, state, functions or effects that influence it |
| Disposition | `native`, `adapted`, `unresolved`, or `out-of-scope` |
| Target | Owning component/action/adapter and implementation symbol |
| Verification | Scenario and expected outcome; evidence or explicit unverified status |

One record may cover a repeated template or equivalent declarations; retain its source members. For adaptations, state what is preserved, what changes and why. For out-of-scope decisions, give the scope reason; hidden, offscreen or currently inactive is not sufficient. Unknown syntax must receive a disposition rather than disappear from the inventory. An unresolved feature affecting required behavior remains unfinished work.

Do not claim completeness from AST parsing, a clean extractor exit, or a count of mapped selectors. Review the resource graph, dynamic branches and implicit browser behavior against the ledger. The objective is no silently omitted semantics within scope, not line-by-line code copying.

## 4. Lower into native architecture

Separate source semantics from terminal adaptation:

1. Build the semantic tree and state/action/effect dependencies, independent of rendering syntax.
2. Choose native components and constraints; verify their defaults and capabilities in the target version.
3. Specify cell rounding, overflow, typography, paint and browser-only behavior adaptations where needed.
4. Bind the tree to state/actions and managed effects, with stable identity and cleanup.
5. Link implementation ownership back to sources and verification scenarios.

Preserve content order, interactive boundaries and ownership of fill, border, clip, focus and scroll. Do not map every DOM element to an extra Box: text runs, fragments and non-rendering containers may collapse only when their layout, inheritance and event semantics remain represented. A full source redraw does not require destroying native state, but intentional source resets must survive.

OpenTUI owns layout, display-width measurement, rendering and input dispatch. Adapt shared constraints or integer track allocations at component boundaries; do not build a competing browser layout engine, Unicode width implementation or ANSI renderer. Keep browser effects behind narrow target adapters and mock business behavior in fixtures.

## 5. Verify observable equivalence

For each affected scenario, compare initial structure/content → action and guard → state/effect result → structure/style/layout → focus/selection/scroll. Check applicable no-op, failure, cancellation and lifecycle paths as well as success. Preserve event ordering when it changes the outcome.

Geometry evidence distinguishes outer, content and leaf bounds. Behavior evidence checks bindings, state retention/reset, asynchronous completion and resource cleanup. Use matched synthetic data, environment and state; browser observations supplement source analysis. Read [comparison workflow](comparison-workflow.md) for implemented capture checks and [mapping pitfalls](mapping-pitfalls.md) for diagnostic cases.

## 6. Reconcile subsequent changes

Use [incremental reconciliation](incremental-workflow.md) with accepted source, updated source and current implementation. Invalidate dependents across all three languages: a template changes selector matching; an ancestor style changes child geometry; a JS guard changes reachable states; an effect change alters loading/error/cleanup behavior. Source hashes establish identity, not semantic impact. Review current user edits before applying changes and retain unchanged mappings and checks.

## Tool boundaries

| Helper | Evidence it supplies | Analysis still required |
|---|---|---|
| `extract_prototype.ts` | Flat HTML records, ordered CSS declarations, static JS dependency/candidate inventory | Tree/templates, full resource resolution, cascade, control/data flow and implicit behavior |
| `check_sources.ts` | Freshness of known source hashes | Whether the known graph includes runtime-generated or external resources |
| `compare_styles.ts` | Authored opaque-color comparisons | Cascade resolution, other paint properties, conditions and combined states |
| `check_geometry.ts` | Authored rectangle relationships and visible text assertions | Correctness of the complete layout and runtime interaction/effect behavior |
| `plan_changes.ts` | Source deltas, bound impact and implementation file drift | Semantic dependency closure, symbol-level reconciliation and safe edits |

`InterfacePlan` is a typed authoring aid, not a validated runtime format or an implemented general compiler. The agent performs semantic translation and produces the requested application change; supporting artifacts alone do not finish the task.
