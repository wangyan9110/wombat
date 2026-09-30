# Wombat Decision Notes

[中文](README.md) | English

Decision Notes preserve rationale that code and current guides cannot carry: the problem, the chosen approach, alternatives actually considered, costs, and verification evidence. They are not task lists or the sole authority on product state; source, contracts, and the [support matrix](../../docs/support-matrix.md) still establish current behavior.

## Creation and status

- `proposed/<class>/YYYY-MM-DD-topic.md` records an unshipped decision with `Status: proposed`.
- `implemented/<class>/YYYY-MM-DD-topic.md` records a shipped decision with `Status: implemented` and stays factually current with code.
- `rejected/<class>/YYYY-MM-DD-topic.md` keeps a declined proposal while it prevents a plausible repeated mistake, with `Status: rejected`.

Classes are limited to `architecture`, `product`, and `process`. Pair each Chinese source with sibling `.en.md` and `.i18n.json` files under the [bilingual workflow](../../docs/i18n/README.en.md). Create a note only when its rationale has lasting value; mechanical and local changes need none.

## Content and verification

Put status after the title and language switcher. A proposal contains Problem, Proposal, Alternatives considered, and Acceptance criteria; an implemented note contains Problem, Decision, Alternatives considered, and Consequences and verification; a rejected note retains its proposal body and gives a short rejection reason on the status line. Record only alternatives that were actually discussed. Run `corepack pnpm notes:check` for path, status, and structure; `corepack pnpm docs:i18n:check` checks the language pair.
