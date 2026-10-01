# Scripted visual conversion

`compile_visuals.ts` is a deliberately bounded converter, not an arbitrary browser-to-terminal compiler. It consumes source-reviewed resolved component declarations, token bindings and SVG references; it emits TypeScript `visualStyles` factories and `visualAssets` masks. The generated module has no skill/runtime dependency. The host still uses native OpenTUI layout, images and events.

## Inputs and source ownership

Recover the actual winning declarations from source/cascade analysis or permitted computed-style capture first. Keep the source selector/state and resource fingerprints in the review evidence. Do not infer them from the existing implementation. The input is a normalized public design contract when the complete prototype must remain private; production builds use the checked-in generated output and must not need private design files.

```json
{
  "cell": { "width": 8, "height": 20 },
  "tokens": { "--page": "background", "--line": "border", "--selected": "selectedBackground" },
  "styles": {
    "selectedControl": {
      "css": "border:1px solid var(--line); border-radius:3px; padding:4px 10px; background:var(--selected)",
      "borderBackdrop": "var(--page)"
    }
  },
  "assets": { "mark": { "svg": "./mark.svg" } }
}
```

Cell dimensions are a reviewed rounding policy, not a measurement of every user's font. SVG paths are relative to the input. Token names map to host palette properties. State variants are separately named recipes; bind them to real state in the host, preserving source precedence. This is not automatic JS state inference.

## Supported conversion and explicit limits

The CSS subset includes solid 1px borders, border colors/radius, background colors, px padding, flex direction/alignment and gap. Horizontal and vertical lengths use separate scales. Palette variables resolve at runtime, so changing a theme does not require regenerating literal colors. Bordered controls require an explicit border-cell backdrop: the border glyph's cell uses the surrounding background while a native child owns the fill. This avoids a filled halo, but does not promise browser-perfect subcell curves.

SVG conversion accepts bounded integer viewBoxes starting at zero and untransformed integer rectangles with monochrome currentColor semantics. It preserves the source mask rather than choosing a vaguely similar glyph. The host feeds the mask to its native image API and verifies both supported graphics protocols and the actual fallback. A second generated Braille representation preserves mask dots for terminal-default monochrome text; it is a dotted adaptation, not an identical solid graphic. Other SVG shapes/styling fail instead of producing an invented approximation.

Unknown properties, unresolved lengths/tokens, duplicate declarations requiring cascade resolution, unsupported assets and extra input sections fail before overwriting the output. Font metrics, arbitrary selectors/media queries, HTML structure, form semantics, JS effects and interaction handlers are not compiled by this tool. Record them in the semantic coverage ledger; do not omit them from the task or claim this converter handled them.

## Adoption and incremental updates

1. Produce source-reviewed input for the affected components, keeping unrelated user edits intact.
2. Generate into a temporary file, inspect the diff, then integrate the generated recipes/assets into the real components. Do not retain hand-written copies of the generated values.
3. Re-run generation after source changes. Compare both input/output and dependent component behavior; an asset-only update must alter its fingerprint and generated mask.
4. Verify native paint boundaries, state combinations and whole-page geometry. Retain an explicit adaptation or unresolved result for properties beyond the subset.

Extend supported syntax from a concrete source requirement with independent truth samples. A larger accepted input vocabulary without equivalent rendering and behavior tests is not improved fidelity. Keep unsupported constructs visible while expanding the converter.
