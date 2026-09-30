# Decision Note: Repository guidance and bilingual confirmation

[中文](2026-09-30-repository-guidance.md) | English

Status: implemented

## Problem

Existing rules were concentrated in the root file, making module, documentation, and Skill responsibilities easy to repeat. Chinese documents and English entry pages also lacked evidence of synchronized edits. Importing a large repository's entire governance system would add maintenance work that this project does not need.

## Decision

Keep repository-wide rules at the root and add local rules where modules, docs, and Skills own them; module READMEs describe public entries. Pair public pages with English within their respective directories, and use named confirmation records and static checks to catch accidental drift. Store lasting design rationale in this directory and continue selecting behavior tests by changed scope.

## Alternatives considered

- **Keep only the root file**: module detail would remain in every session's baseline context, while docs and Skills would lack nearby ownership.
- **Copy all DeepSeek Harness directories, templates, and checks**: those serve a larger plugin repository and a fully bilingual corpus, adding workflows and a bulk migration with no matching Wombat content.

## Consequences and verification

Local instructions, bilingual pairs, and focused scripts are now present; original Chinese-only pages have been organized by purpose and fully paired, leaving no legacy migration entries in the manifest. `repo:check` verifies rules, pairing, and public links but cannot establish translation meaning, product behavior, or terminal appearance; those still require human review and relevant tests.
