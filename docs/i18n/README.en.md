# Wombat bilingual documentation workflow

[中文](README.md) | English

Public human-facing documentation is maintained in Chinese and English pairs; existing prose pages are now fully paired. Both languages have equal authority; either may be edited first, and its counterpart is updated in the same change. Use the [terminology table](terminology.md) for terms and the [documentation rules](../AGENTS.md) for ownership. The pairing and confirmation-record approach draws on the [DeepSeek Harness documentation workflow](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/i18n/README.md); this repository uses its own naming and check scope.

## Files and scope

`docs/foo.md` retains the existing Chinese path, with English at `docs/foo.en.md` and the confirmation record at `docs/foo.i18n.json`. The root keeps its existing `README.md` / `README.zh-CN.md` and `CONTRIBUTING.md` / `CONTRIBUTING.zh-CN.md` pairs. Version 2 records store both sides’ SHA-256 hashes per section, keyed by English heading paths. Code blocks are compared verbatim and excluded from section prose hashes; edits to different sections change separate records, reducing merge conflicts. Hashes establish that these versions were confirmed, not that the translation is good.

The [pairing manifest](../../scripts/doc-i18n.manifest.json) lists all paired pages and explicit exclusions; `legacyUnpaired` is now empty and must not become an entry point for new monolingual documents. Root-module READMEs and active Decision Notes are paired individually. New public documents must be added as complete pairs. Importing an external legacy document adds both languages and a record; an automatic translation draft is not a confirmed pair. `AGENTS.md`, the terminology table, generated schemas, and dated measurement artifacts are outside page-by-page translation scope.

## Update workflow

1. Check source code, contracts, and current verification evidence before editing the page that owns a fact; do not infer current support from old progress records.
2. Update the other language to match the changed passage. Preserve heading levels, list structure, commands, and code blocks; translated links should target an available counterpart, while links to exempt documents and machine evidence keep the same target.
3. Review terminology, negative conditions, numbers, limits, and executable commands. Run `corepack pnpm docs:i18n:record -- <Chinese file>` for each confirmed page; record only explicitly named pairs.
4. Run `corepack pnpm docs:check` and `git diff --check`, then review the changes in both languages and the record.

The check uses a Markdown syntax tree to verify complete pairs, section hashes, language links, heading levels, nested lists and starting numbers, table dimensions, code blocks, and link targets including queries and fragments. It cannot decide whether the two languages express the same facts; the editor must review that. The manifest makes exclusions visible; a passing check does not mean all original source text in the product is translated.

## Incremental maintenance

For routine edits, read the terminology table and directly update the changed passages while preserving untouched translations. Never re-record hashes without review merely to pass checks. Delete or rename both languages and their record together.

`corepack pnpm docs:i18n:check -- docs/i18n/README.md` validates the named pair’s content; repository checks still validate every pair. Failures identify changed sections and languages. `node scripts/check-doc-i18n.mjs --migrate` migrates only records whose contents still exactly match the old whole-file confirmation hashes; it does not confirm new translations. Records remain JSON, and that command does not rename files or change pairing scope.

Product language and documentation translation are maintained separately; see [product language and copy](product.en.md).
