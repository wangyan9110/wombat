---
name: html-to-opentui
description: Guide coding agents to faithfully reproduce HTML/CSS/JavaScript prototype designs in OpenTUI, fix visual and interaction mismatches, and carry prototype updates into existing implementations.
---

# High-fidelity prototype implementation for coding agents

The primary outcome is working OpenTUI code that faithfully reproduces the supplied prototype’s design and interactions. Source inventories, interface contracts, comparison scripts and incremental reports help the coding agent understand, implement and verify that result; producing those artifacts alone does not complete an implementation request.

Treat the supplied prototype as the design authority. Start with HTML, CSS cascade and JavaScript state/DOM behavior; use screenshots as supplementary evidence. Preserve product scope and existing implementation edits. Improving this skill does not resume a paused product task.

This skill is standalone: its TypeScript tools do not import a host application's code, fixtures, framework or configuration. OpenTUI belongs to the target application, not this tool package. Read the installed target version before choosing native APIs. Do not introduce another layout, text-measurement, input or ANSI rendering engine.

## Choose the workflow

- Initial port: inventory sources and states, resolve a component/interaction plan, then implement native components and validate.
- Prototype update: read [incremental reconciliation](references/incremental-workflow.md), compare the accepted baseline with the new prototype and current implementation, and change only affected components plus their dependents.
- Fidelity defect: read [mapping pitfalls](references/mapping-pitfalls.md); reproduce with native geometry/styles and synthetic data before changing code.
- For complex component/state mappings, use the [interface mapping contract](references/compilation-contract.md) as an engineering aid. Build a reusable compiler or generator only when explicitly requested; it is not a prerequisite for restoring a prototype.

## The agent’s implementation loop

1. Understand the reference: read HTML structure, winning CSS and JS behavior; identify reachable screens, states and responsive variants. Preserve the existing design rather than inventing replacement styling or interactions.
2. Locate the implementation: inspect native components, themes, state handlers and existing user edits. Map the requested scope to the owning code; use a small mapping for a small fix instead of requiring a full protocol model.
3. Make the fidelity decisions explicit: component hierarchy, column alignment, spacing, border/fill boundaries, typography, state precedence, focus and scroll. Record only the terminal approximations that materially affect the result.
4. Implement the authorized changes in the actual application using native OpenTUI capabilities. Preserve data ownership and existing behavior. When the request is to implement or fix, continue beyond a difference report; when it is discussion or audit only, stay within that scope.
5. Compare the rendered result and interactions against the reference, correct remaining mismatches, and report what is verified or still different. Test success does not replace checking design fidelity.

For prototype updates, repeat this loop on affected components and shared dependents. Use the incremental report to target edits, not to automatically replace current code. Completion means the requested design and behavior are implemented and verified to the stated scope, with material remaining differences disclosed.

## Standalone tools

From this skill directory, use Node.js 22.18+ (native erasable TypeScript support):

```sh
npm ci --ignore-scripts
npm run check
node scripts/extract_prototype.ts --html /absolute/prototype.html --out /absolute/review/inventory.json
node scripts/check_sources.ts --inventory /absolute/review/inventory.json
```

`package.json` and `package-lock.json` pin the skill's own dependencies. No Python environment or global CLI is required. The existing MIT attribution is retained in `LICENSE`; regenerate and check third-party notices with `npm run licenses:generate` and `npm run licenses:check` after dependency changes. Do not upgrade the user's global runtime implicitly. Keep reference inventories, captures and bindings outside public source trees when they contain private paths or prototype content.

The extractor uses parse5, PostCSS and the TypeScript AST. It records HTML elements/attributes, linked and imported CSS in order, raw-byte hashes, linked/inline scripts, statically named local JS dependencies and source-located interaction candidates. Repeat `--extra-source /absolute/file.js` for manually discovered model/fixture modules. It never executes JS, fetches remote resources or computes CSS cascade. Unresolved resources, nested CSS and computed JS imports are reported. Exit 0 means inventory without reported issues; 2 means output exists but needs review; 1 means the command failed.

## Resolve the interface

For work that benefits from a structured mapping, use the typed contracts in [scripts/types.ts](scripts/types.ts) to describe components, states, bindings, transitions, effects, cell policies and unresolved features. The host may serialize that plan as JSON. Do not add a runtime dependency on this skill to the product.

Separate JS responsibilities: reusable pure presentation functions; state/actions; DOM construction; browser-only effects; simulated business data. Static candidates are leads, not verified transitions. Do not copy mock prices, timers or network effects into production business logic. Where available and permitted, run the trusted local prototype with synthetic fixtures in the browser to observe dynamic DOM, computed styles, focus and transition results. Keep source analysis for unvisited branches; a screenshot or single DOM snapshot cannot represent all states. Use the environment's permitted browser tools; no browser executor is bundled here.

Resolve stylesheet order, specificity, inheritance, shorthand, variables, media conditions and state precedence before mapping colors or layout. An explicit child color wins over an inherited selected-parent color. Record evidence at the actual text node. Match stable component IDs and state keys across source, implementation and captures.

Map supported properties to native Box/Text/Input/Select/ScrollBox options. Handle Grid/table tracks, pixel-to-cell spacing, thin strokes, responsive breakpoints and browser font differences with explicit component policies. Unsupported features must remain visible as unresolved or approved approximations; never silently drop them. Implement through native component configuration and state bindings; do not hand-paint terminal output.

## Verify and accept

Read [comparison workflow](references/comparison-workflow.md) for capture formats and checks. With source-resolved mappings:

```sh
node scripts/compare_styles.ts --inventory /absolute/review/inventory.json --capture /absolute/review/screens.json --mapping /absolute/review/colors.json --out /absolute/review/colors-report.json
node scripts/check_geometry.ts --capture /absolute/review/screens.json --mapping /absolute/review/geometry.json --out /absolute/review/geometry-report.json
```

Color checks support opaque hex values and require explicit cascade confirmation. Geometry checks verify specified native rectangle relations and exact visible substrings; they never calculate layout. Missing evidence and empty check sets cannot pass. These checks exit 1 for mismatch or invalid input. Verify keyboard/mouse transitions, focus, selection, scroll, resize and cancellation separately in the target's actual runtime.

Use the same synthetic data and corresponding viewport/state on both sides. Include active/inactive, hover, expanded/collapsed, long values, boundary widths, empty, failure and loading states actually present in the source. Capture settled native bounds rather than immediately reading after setters. Compare shell geometry, shared controls, tables, then detail states. A passing subset is not whole-screen fidelity.

Keep an immutable accepted baseline: source inventory, reviewed mappings, implementation hashes, state/size captures, verified checks and remaining approximations. Incremental output is a review plan, never permission to overwrite current edits or advance that baseline. Accept a new baseline only after relevant checks pass; retain the old one for comparison.

Report measured changes and remaining differences, not fidelity percentages or browser/terminal pixel identity. If acceptance targets an installed app, verify all loaded chunks and relevant native artifacts against the tested build; source fixes alone do not update a running installation. Publishing or global installation requires the user's existing scope to cover it.
