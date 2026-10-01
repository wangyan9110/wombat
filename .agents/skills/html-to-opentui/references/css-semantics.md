# CSS: resolve semantics before native layout

Treat CSS as a conditional constraint and paint program. Parse declarations, resolve the cascade, determine computed/used behavior, then lower to native capabilities. Syntax similarity is not proof that browser and native properties have the same defaults or sizing effects.

## Cascade and conditions

Recover selector matching against each relevant static/dynamic tree. Include combinators, attribute selectors, structural/functional pseudo-classes, pseudo-elements, nested rules and scoped/shadow styling when present. Selected, hovered, focused, checked, disabled and expanded states are independent; combinations may have their own winning rules.

Resolve origins, importance, layers, specificity, scoping and order using the actual cascade. Include inline declarations and browser defaults, inherited properties, initial/unset/revert behavior, shorthand expansion and custom-property substitution/fallback. A variable reference is not a color or dimension until resolved in its element/state context. Invalid declarations or variable cycles can change the winning result.

Keep authored, computed and used values distinct. Percentages, intrinsic sizes, `auto`, `calc`/`min`/`max`/`clamp`, font-relative/viewport units and logical properties depend on context. Media, container and support queries need explicit environment/ancestor conditions; record which source branch applies and how its target variant is selected. `@supports` browser capability tests cannot simply be copied as terminal capability tests.

## Layout and paint coverage

| Family | Source semantics to resolve | Native lowering decision |
|---|---|---|
| Formatting contexts | Block/inline flow, line boxes, anonymous boxes, floats/clear, `display: contents`, replaced elements | Preserve content order and wrapping/grouping constraints; an HTML wrapper is not necessarily a native layout box |
| Box sizing | Content/border box, intrinsic/min/max sizing, aspect ratio, padding, borders, margins and collapsing | Assign content/outer ownership and constraints; native margins do not imply browser margin collapse |
| Flex | Axis and direction, wrap, basis/grow/shrink, min-content constraints, alignment, auto margins, order/gaps | Explicit native options and defaults; check shrink/wrap and visual versus focus order |
| Grid | Explicit/implicit tracks, placement/auto-flow, spans, `fr`, `minmax`, intrinsic sizing and subgrid | Shared native tracks or a recorded component policy; do not replace with independently sized rows |
| Tables and columns | Table layout algorithm, spanning cells, border collapse/spacing, vertical alignment, multi-column flow | Native supported table behavior or coordinated tracks; preserve relationships and record unsupported flow |
| Position and stacking | Containing block, relative/absolute/fixed/sticky position, inset, stacking contexts, z-index and top layer | Native overlay/position/scroll ownership; test clipping, overlap and hit testing together |
| Overflow and scrolling | Visible/hidden/clip/auto distinctions, nested scroll containers, scrollbars, sticky/snap behavior | Native clipping/scroll policy with retained offsets and keyboard/mouse reachability |
| Text | Font metrics, line height, white space, wrap/word break, ellipsis, direction/bidi, alignment and decoration | Native text measurement/rendering, terminal typography adaptation and wrapping checks; never JS string length as cell width |
| Generated content | `::before`/`::after`, markers, counters and state-dependent content | Explicit owned native text/decoration if needed; preserve source order and state conditions |
| Paint | Fill/background layers, border/radius, outline, opacity, shadow, gradients, transforms, filters, masks | Supported native styling or recorded approximation; separate decoration bounds from hit/focus/layout bounds |
| Time and preference | Transitions, keyframes, duration/delay/easing, reduced motion and color preferences | Preserve functional timing/state; choose native animation or static adaptation and verify cancellation/cleanup |

For unlisted properties or at-rules, consult their semantics and add a coverage decision. Never treat an unrecognized property as safe to ignore solely because it is absent from a previous prototype.

## Lower constraints into cells

The target [OpenTUI layout](https://opentui.com/docs/core-concepts/layout/) uses terminal cells and a supported Yoga/Flexbox subset. Verify the installed version rather than assuming full CSS support. Prefer native constraints; use component-specific shared track/rounding policies where necessary, not a parallel CSS layout engine.

Map horizontal and vertical spacing separately. Browser font sizes, line-height and `ch` units can produce different used dimensions even when CSS declarations look identical. Allocate available content width after the actual container cap, border, padding and gutters. Keep any rounding remainder deterministic so adjacent columns share boundaries. Recompute responsive constraints on resize through the owning component.

Verify outer rectangle, content rectangle and leaf bounds independently. Equal parent coordinates do not guarantee text containment. Distinguish centering the child box, aligning text inside it and aligning wrapped baselines. Preserve start alignment when that is the winning rule; universal vertical centering is not a fidelity fix.

Paint ownership also matters: row background, group rail, button fill, outline and pseudo-element underline may belong to different boxes. Native focus decoration must not accidentally replace the source selected style. A thin browser stroke requires an explicit terminal stroke policy rather than automatic full-cell fill.

## Acceptance and change impact

Check applicable state combinations, long/wrapped content, empty/hidden branches, overflow, overlay/scroll and both sides of responsive boundaries. Relate every adapted property to observable checks; do not infer correctness from a supported option name. A new ancestor, font, variable, layer or selector can invalidate unchanged leaf declarations, so propagate incremental impact through the resolved cascade and layout dependencies.

References: [CSS cascade](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction), [CSS values and units](https://www.w3.org/TR/css-values-4/), [CSS Grid](https://www.w3.org/TR/css-grid-2/). Use the applicable specification for constructs outside the installed target's direct mapping.
