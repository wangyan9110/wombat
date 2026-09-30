# Wombat bilingual documentation workflow

[中文](README.md) | English

Public human-facing documentation is gradually maintained in Chinese and English pairs. Both languages have equal authority; either may be edited first, and its counterpart is updated in the same change. Use the [terminology table](terminology.md) for terms and the [documentation rules](../AGENTS.md) for ownership. The pairing and confirmation-record approach draws on the [DeepSeek Harness documentation workflow](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/i18n/README.md); this repository uses its own naming and check scope.

## Files and scope

`docs/foo.md` retains the existing Chinese path, with English at `docs/foo.en.md` and the confirmation record at `docs/foo.i18n.json`. The root keeps its existing `README.md` / `README.zh-CN.md` and `CONTRIBUTING.md` / `CONTRIBUTING.zh-CN.md` pairs. Records store SHA-256 hashes of both files; they establish that these versions were confirmed, not that the translation is good.

The [pairing manifest](../../scripts/doc-i18n.manifest.json) lists paired pages and existing Chinese documents awaiting translation. Root-module READMEs and active Decision Notes are paired individually. New public documents must be added as complete pairs. Migrating an existing unpaired document adds both languages and a record; an automatic translation draft is not a confirmed pair. `AGENTS.md`, the terminology table, generated schemas, and dated measurement artifacts are outside page-by-page translation scope.

## Update workflow

1. Check source code, contracts, and current verification evidence before editing the page that owns a fact; do not infer current support from old progress records.
2. Update the other language to match the changed passage. Preserve heading levels, list structure, commands, and code blocks; translated links should target an available counterpart, while links to unpaired documents keep their current path.
3. Review terminology, negative conditions, numbers, limits, and executable commands. Run `corepack pnpm docs:i18n:record -- <Chinese file>` for each confirmed page; record only explicitly named pairs.
4. Run `corepack pnpm docs:check` and `git diff --check`, then review the changes in both languages and the record.

The check verifies pair completeness, recorded hashes, language links, and mechanically comparable Markdown structure. It cannot decide whether the two languages express the same facts; the editor must review that. The manifest makes the existing unpaired scope visible, and a passing check does not claim full repository translation.
