import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { structureErrors } from './check-doc-structure.ts';

test('prose wrapping is rejected at the source line, including nested list paragraphs', () => {
  assert.deepEqual(structureErrors('guide.md', '# Guide\n\nFirst line\ncontinued.\n'), [
    'guide.md:3: keep each prose paragraph on one physical line',
  ]);
  assert.match(structureErrors('guide.md', '# Guide\n\n- First\n  continued\n')[0]!, /guide.md:3/);
});

test('code, tables, quotations and distinct list items retain their formatting', () => {
  const source = '# Guide\n\nA complete paragraph.\n\n- One\n- Two\n\n```md\n# Example\nwrapped\ncode\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> Quoted\n> original\n';
  assert.deepEqual(structureErrors('guide.md', source), []);
  assert.deepEqual(structureErrors('guide.md', '<p><img src="logo.svg"></p>\n\n# Guide\n'), []);
});

test('the command discovers paired docs and scoped instructions and exits nonzero on violations', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-doc-structure-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  mkdirSync(path.join(root, 'scripts'));
  copyFileSync(path.join(repository, 'scripts/check-doc-structure.ts'), path.join(root, 'scripts/check-doc-structure.ts'));
  symlinkSync(path.join(repository, 'node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(root, 'scripts/doc-i18n.manifest.json'), JSON.stringify({ pairs: [{ zh: 'guide.md', en: 'guide.en.md' }] }));
  writeFileSync(path.join(root, 'scripts/doc-budgets.json'), JSON.stringify({ 'AGENTS.md': 100 }));
  for (const file of ['guide.md', 'guide.en.md', 'AGENTS.md']) writeFileSync(path.join(root, file), '# Title\n');
  const run = () => spawnSync(process.execPath, ['scripts/check-doc-structure.ts'], {
    cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  const valid = run();
  assert.ifError(valid.error);
  assert.equal(valid.status, 0, valid.stderr);
  for (const file of ['guide.en.md', 'AGENTS.md']) {
    writeFileSync(path.join(root, file), '# Title\n\nWrapped\nparagraph.\n');
    const invalid = run();
    assert.ifError(invalid.error);
    assert.equal(invalid.status, 1);
    assert.ok(invalid.stderr.includes(`${file}:3:`));
    writeFileSync(path.join(root, file), '# Title\n');
  }
});

test('empty, missing, duplicate and misplaced document titles fail', () => {
  for (const source of ['', 'Text\n', '# One\n\n# Two\n', 'Text\n\n# Title\n']) {
    assert.match(structureErrors('guide.md', source)[0]!, /exactly one level-one title/);
  }
  assert.match(structureErrors('guide.md', '# Title\n\n##\n')[0]!, /heading must have a title/);
  assert.deepEqual(structureErrors('guide.md', '# 标题\n\n正文。\n\n## 子标题\n'), []);
});
