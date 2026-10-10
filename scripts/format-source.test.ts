import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { formatSources } from './format-source.ts';

test('source format check is read-only and fixes only adopted handwritten modules', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-format-'));
  try {
    for (const dir of ['ui/src', 'web/src', 'ui/src/generated', 'client/src'])
      mkdirSync(path.join(root, dir), { recursive: true });
    const ui = path.join(root, 'ui/src/App.tsx'),
      web = path.join(root, 'web/src/index.ts');
    const generated = path.join(root, 'ui/src/generated/dto.ts'),
      outside = path.join(root, 'client/src/example.ts');
    const input = 'export const value=1;\n';
    writeFileSync(ui, 'export const App=()=> <main><p>Hello</p><p>World</p></main>;\n');
    for (const file of [web, generated, outside]) writeFileSync(file, input);
    assert.deepEqual(await formatSources(root), [
      path.join('ui', 'src', 'App.tsx'),
      path.join('web', 'src', 'index.ts'),
    ]);
    assert.equal(readFileSync(web, 'utf8'), input);
    await formatSources(root, true);
    assert.deepEqual(await formatSources(root), []);
    assert.equal(readFileSync(generated, 'utf8'), input);
    assert.equal(readFileSync(outside, 'utf8'), input);
    writeFileSync(web, 'export const broken = ;');
    await assert.rejects(formatSources(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
