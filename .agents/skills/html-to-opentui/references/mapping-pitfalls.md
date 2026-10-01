# Mapping pitfalls found during fidelity work

Use these cases to diagnose differences, not as a new visual specification. Colors, breakpoints, widths and heights come from the current prototype. Do not copy another project's constants.

## CSS inheritance and state

**Symptom:** the row background matches, but model names and subtotal text still look wrong.

An ancestor's selected color does not override an explicit child color. For example, `.selected { color: ... }` is inherited only where a descendant has no winning color of its own. A more specific ancestor selector cannot beat a directly specified child value through inheritance. Read through the actual DOM to the text-bearing element, including shorthand declarations and later rules. Check font weight separately: it can remain inherited while color is explicitly replaced.

Record the winning declaration per property and state, rather than copying a whole rule as the final style. The extraction helper inventories rules; it does not compute the cascade. The color comparator cannot detect a wrongly chosen selector. Do not set `cascadeConfirmed` based solely on its successful output.

**Symptom:** all selected rows share a background, or keyboard movement changes their text unexpectedly.

The prototype may distinguish a selected report row, a selected conversation, an expanded detail, and the current group rail. Give them separate semantic roles. Match hover/selected precedence from the source, preserve explicit descendant foregrounds, and restore the previous row on selection movement. Verify mouse enter/leave as well as keyboard movement. Native nested text nodes also need a usable selected state under `NO_COLOR`.

Native controls can supply their own default colors even when the surrounding page omits its theme colors. For example, the installed Select may use a colored selected background by default. In `NO_COLOR`, explicitly use the native terminal-default foreground/background APIs for fields and selections, and retain a visible selection indicator or inverse focus on actions. Verify the actual cell color intent and focus transition; merely passing `color: false` to a page wrapper is insufficient.

An unselected rail painted with the page background becomes a visible dark stripe when its row is hovered. If the source rail is transparent, its fallback color must follow the row's current surface. Test selected A plus hovered B; a single selected snapshot misses this interaction. A hovered row is not necessarily another selected row: preserve the source hover behavior while removing unintended selection-like decoration.

## Typography

**Symptom:** actual terminal text looks heavier or different from the HTML preview.

First establish whether the difference concerns the running terminal or an offline preview. Inspect source `font-family`, `font-size`, `line-height` and `font-weight`; then inspect native text attributes at the final rendered node. Avoid automatically bolding every headline or styling operation status as an amount. Whole-row selection repaint must not accidentally overwrite the intended child weight.

Ordinary terminal text uses the terminal's configured font and cell dimensions. Browser font stacks, per-component pixel sizes, and weights such as 650/750 do not transfer directly to normal OpenTUI text. Map ordinary/bold/underline deliberately. Do not claim a source change fixed the terminal's font family or silently alter global font settings. A synthetic preview with a chosen raster font is not evidence of the user's terminal font.

## Tables, indentation and centering

**Symptom:** headers, model rows and totals drift by one or more cells.

Use one native track specification and equal outer content widths for all rows. If a model label is indented, put the inset inside its label cells; changing the whole row's padding changes the available grid width and can shift every numeric column. CSS `fr` tracks are not automatically equivalent to content-based native flex growth: map fixed tracks, growing tracks, minimum widths and growth bases explicitly.

Set a zero growth basis only on the tracks meant to grow. Applying `flexBasis: 0` to fixed-width tracks can collapse them. Inspect native bounds after layout instead of assuming width options were honored. Let OpenTUI handle text measurement and wrapping; do not pad strings to simulate columns.

For each representative viewport, assert:

- corresponding header/data/total cells have the same x-coordinate and width;
- minimum widths preserve required headings and amounts;
- label indentation leaves numeric columns stationary;
- the capped content container is centered within one cell of rounding;
- long model names and wide Chinese text remain legible.

Viewport examples such as 80/120/160 columns are test fixtures, not universal breakpoints.

## Vertical spacing and grouped borders

**Symptom:** roomier rows look reasonable alone but hide the first model row in a real terminal.

Evaluate the complete frame: heading, navigation, controls, header, scroll area, actions and footer. A component-only test misses the accumulated height cost. Derive compact behavior from representative short terminal heights; do not globally add blank rows to imitate fractional CSS spacing. Verify the initial content and the selected row remain visible after expansion and resize.

If the source has a continuous date or turn rail, represent it with a shared native parent around the relevant rows. Separate row borders or nested margins may create discontinuities. Check selected-group rail, per-record separator and focused record as distinct parts.

**Symptom:** a footer height cap still shrinks the wrong region or hides content.

For a column shell, inspect the scroll region's growth basis and the footer's shrink behavior together. Content-based growth can compete with the footer even when both individual heights look correct. Derive an adaptive footer from wrapped native child bounds, not a second string-measurement routine. Avoid overlapping percentage constraints without checking the resulting geometry. After setting a native dimension, its getter can still reflect the prior layout until the next pass; preserve the calculated local value when finishing the same update, then verify the next frame. Any percentage cap must come from the supplied source, not a universal constant.

**Symptom:** expanding content does not bring its first amount into view.

In the tested OpenTUI version, nearest-child scrolling did not move one child whose height exactly matched the viewport. Target a stable first meaningful descendant and verify the amount is actually visible after expansion and resize. Inspect the installed implementation before treating this as a cross-version limitation. Rebuilding a tree also changes pixel/cell offsets: preserve selection by record ID, then let native scrolling reveal it; a prior row index can identify a different record after sorting or re-pagination.

## Compact values and links

Use native equal-width cells for compact label/value pairs instead of joining them into a line with separators. Keep a Token amount with its own fee; test exact zero, unknown and long decimal strings so truncation cannot pass as correct rendering. Keep rate strings and per-model conditions from the data; copying a prototype's example threshold would introduce a business rule into the view.

A long raw URL can dominate a narrow detail panel. If the source uses a short link label, preserve that label and use native link metadata. Assert the actual destination as well as underline/color. Terminal hyperlink support remains environment-dependent; never replace it with an unrequested shell launcher.

## Loading, cancellation and interrupted work

Loading is a real source state, not just a status string. Inventory its shell, disabled navigation, observed phases, cancel action and return destination alongside the success view. A timer in a demo is not product evidence that scanning or saving has finished.

A prior interrupted port exposed a design risk: reusing the application's exit signal for a local cancel would turn Escape into exiting, while overwriting a request's supplied signal could prevent cancellation. For an implementation task, verify operation-local cancel, application quit, Ctrl+C, late progress/results, retry and resize separately. Keep the prior view/data until the operation succeeds; do not claim cancellation rolled back a write merely because a promise rejected. These are acceptance requirements, not a claim that the interrupted draft implements them.

When the user pauses for a changing prototype, preserve the current draft and its failed checks explicitly. Do not promote that draft or resume implementation as a side effect of documenting lessons. When work resumes, inspect the current files and reference delta before using old captures or previous passing results.

## Thin consumption meters

**Symptom:** a thin HTML meter becomes a thick block in the terminal.

A CSS meter only a few pixels high should not automatically become a box with a full-cell background. Layout height and painted thickness are different. A native Box with a single horizontal border is a useful approximation when the source is a fine line; use foreground/track border colors while preserving the row's background. Let native layout size the filled and remaining portions, rather than manually drawing ANSI or repeated characters in production.

Verify 0%, an intermediate fraction, and 100%. Check that no stray track or fill cell appears at endpoints, the intermediate split is within one cell of rounding, track and progress colors are correct, and selection does not turn it back into a solid strip. The line glyph's actual stroke thickness depends on the terminal font; it is not an exact browser-pixel measurement. Recheck the mapping if the prototype uses a different meter design.

## Painted bounds and visual assets

In OpenTUI 0.5.12, a Box background also colors the character cells containing a rounded border. The border stroke only uses part of each cell, so a selected background on the outer Box can appear as a rectangular halo outside the outline. A native inner fill with parent-colored border cells removes that halo, but does not create pixel-perfect fill up to the curved stroke. Check both interior and exterior paint; asserting that every border cell has the selected background would preserve the defect.

Likewise, `▃` occupies the lower part of its cell. Centering its Box does not center the meter ink relative to neighboring text. Choose an appropriate centered native stroke or another supported rendering policy, then verify complete-row spacing and selected hit/scroll bounds. Do not claim rectangle equality measured glyph alignment.

A logo hidden in CSS `mask: url(...)` can be missed by an HTML/CSS/JS-only source list. Track the asset bytes as well as the declaration. Inspect the installed native image component, protocol capability selection and fallback before substituting text characters. Font-dependent glyphs cannot faithfully represent every compact asset; preserve the graphic or keep the substitution visibly unresolved, rather than repeatedly calling it a completed approximation.

## Evidence and delivery

Use a small per-component record: source element/state → winning declarations → native properties → cell geometry/style checks → any remaining approximation. Keep private source inventories and captures outside public repositories; public tests should use synthetic data and standalone semantic expectations.

Use native capture spans for foreground/background/text attributes and native renderable bounds for geometry. Character-frame assertions can verify a thin stroke, but plain text alone cannot establish selection color or weight. Real PTY tests cover input, resize, scrolling and terminal restoration; they do not prove all visual properties. Screenshots can supplement these records when permitted.

After a correction, replace stale captures or label them historical. Do not present old images or successful checks against an incorrect CSS selector as current proof. Re-run the affected checks and the checks required by the project; broaden testing when shared layout or packaging changed. Avoid repeating unrelated suites solely to increase a test count.

For an installed app, test the actual installed entry and compare all loaded JS chunks plus relevant native artifacts with the tested build. Identical package version numbers or matching launchers alone can hide an old UI chunk. Installing or rebuilding does not update a process that is already running; tell the user to restart it when appropriate.

## Incremental evidence and numeric cell bounds

A prototype change and an implementation edit are separate evidence. Keep accepted hashes and mappings; use the incremental workflow to report both-sided changes before modifying code. Never update a baseline just to make checks pass.

A native column can have correct geometry while a text child extends into its neighbor. Test child bounds, actual numeric text and the visible gutter, including breakpoint widths and long values. Native fractional growth can expose rounding differences; use an explicit integer track policy where required rather than silently truncating amounts. Recheck header/data/total alignment after adapting tracks. Screen resize must update related properties together, such as a navigation rule, tab border color and shared baseline margin.

Parent bounds are not the usable content area. Border and padding can be overwritten even when a child passes outer containment. The [comparison helper](comparison-workflow.md#content-bounds-not-just-outer-bounds) can check captured content rectangles. Do not assume `auto`, `100%`, `maxWidth` or clipping alone resolves the mismatch.

In a local OpenTUI 0.5.12 experiment, a percentage column resolved to 33 cells with one border and one padding cell on each side. Its Input resolved to 31 cells instead of the 29-cell content area. Constructing the same component with an integer track produced 29. Changing the child to `auto`, adding `maxWidth:'100%'`, or switching the parent to equal flex growth did not reliably remove the mismatch. Another experiment showed that freezing rendered parent widths did not remove oversized Text descendants; explicitly constraining leaf content width did. These are version-specific observations, not universal percentage-layout rules or proof of an upstream algorithm defect.

For recurrence, isolate synthetic long values and record settled outer/content/leaf bounds. Compare original constraints, integer track construction and explicit leaf constraints separately at initial render and resize. Check exact text after containment passes. Prefer a correction in the owning native component over scattered per-frame coordinate patches; an isolated passing experiment does not establish application fidelity.
