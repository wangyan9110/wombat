# HTML: translate structure and implicit behavior

Use this guide to recover the semantic tree before native component selection. Read source and JS-generated markup together. The extractor's flat element list is an index, not the tree or a complete behavioral specification.

## Parsing and resource ownership

- Recover the parsed parent/child and sibling order, including text nodes, comments used as framework anchors, namespaces and parser-inserted/reparented nodes. Do not infer hierarchy from indentation or only direct element text. Entity decoding and whitespace affect visible content; whitespace rendering also depends on CSS.
- Resolve document/base URLs, linked styles/scripts, imports, fonts and referenced assets. Distinguish source-authored, browser-inserted and runtime-injected nodes. Script attributes and module dependencies affect initialization; stylesheet order affects cascade.
- Account for templates, slots, custom elements, Shadow DOM and embedded documents when encountered. Templates are inert until instantiated; a slot's assigned content and fallback are distinct branches. Shadow-root styling/event boundaries cannot be flattened without checking their consequences.
- For framework templates or JSX, recover conditional/repeated components, keys, refs and portals using the framework's actual semantics. A runtime DOM snapshot loses template identity and branches.

## Construct-to-semantics coverage

| Encountered construct | Recover before lowering | Native adaptation and verification |
|---|---|---|
| Structural elements, fragments, headings and sections | Content grouping, order, inherited context, navigation meaning | Preserve ownership and hierarchy; elide wrappers only if layout, paint, events and semantics survive |
| Mixed text, inline formatting, links, `br`, `pre`, `code` | Ordered text runs, whitespace/newline policy, inline marks and actions | Native styled text runs and explicit breaks; verify wrapped text, focusable links and copied values |
| Lists and nested lists | Ordering, markers/counters, nesting and dynamic membership | Repeated components with stable keys; preserve marker and indentation policy |
| Tables, captions, row/column groups, span attributes | Logical grid, heading associations, shared tracks and spans | Native table capability or shared component tracks; validate spanning cells, wrapping and alignment |
| Forms and controls | Control type, label relation, name/value, initial versus live value, selection, constraints, submission/reset | Native control plus explicit missing browser behavior; test submit/cancel/reset and validation |
| `details`/`summary`, dialogs and popovers | Open state, trigger, dismissal, modality, default focus and focus return | Native disclosure/overlay state and focus handling; include keyboard and outside interaction |
| Images, SVG, canvas, audio/video, embedded resources | Visible content, dimensions, alternatives, dynamic behavior, loading/failure | Version/capability-appropriate native rendering or recorded fallback; do not silently discard functional content |
| Data and global attributes | Class/id hooks, `data-*`, hidden/inert, editable/draggable, title, language/direction | Preserve state/binding hooks and necessary behaviors; distinguish metadata from visible content |
| Accessibility attributes and roles | Name, state, relationship, focus order and announcements intended by the source | Preserve applicable navigation/labels/state cues; document terminal limits rather than claiming browser accessibility parity |

The table is a coverage aid, not an allowlist. For a new element or attribute, determine its actual browser semantics and classify it using the same source → behavior → native target → check chain.

## Defaults are part of the program

Translate boolean attributes by presence, not by parsing strings as booleans. Distinguish attributes from mutable DOM properties: default values/checked states, current user edits and reset behavior can differ. A `button` in a form, a label, a link or Enter in a control can cause browser actions without explicit JS listeners. Trace those actions and any JS cancellation before creating terminal key bindings.

Treat `disabled`, `readonly`, `hidden`, `inert`, CSS invisibility and unmounted nodes separately: they differ in focusability, editability, space, events and retained state. Determine effective behavior including ancestor rules and CSS. Avoid implementing every hidden state by destroying a component.

Identity matters when lists reorder, filters change or subtrees remount. Preserve stable records and draft/selection ownership; reproduce intentional resets. Identify separate activation targets within a row instead of making the entire row swallow child actions.

## Acceptance evidence

For relevant branches verify content order, conditional membership, form/control values, focus traversal, activation/default actions and reset/dismissal. Include source-generated structure and resource failures where present. Link each structural change to affected selectors and JS references so incremental updates do not leave stale style or event bindings.

Semantic definitions: [WHATWG HTML elements](https://html.spec.whatwg.org/multipage/semantics.html) and [forms](https://html.spec.whatwg.org/multipage/forms.html). Consult the applicable element definition when behavior is implicit; do not treat this guide as a replacement HTML specification.
