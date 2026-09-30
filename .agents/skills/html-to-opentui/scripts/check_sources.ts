import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Inventory } from './types.ts';
import { args, main, readJson } from './io.ts';
export function checkSources(inventory: Pick<Inventory, 'hashEncoding' | 'sources'>) {
  if (inventory.hashEncoding !== 'raw-bytes') throw new Error('Re-extract with raw-byte source hashes');
  const checks = inventory.sources.map(source => {
    try { return { path: source.path, passed: createHash('sha256').update(readFileSync(source.path)).digest('hex') === source.sha256 }; }
    catch (error) { return { path: source.path, passed: false, error: String(error) }; }
  });
  return { scope: 'Listed sources only; re-extract after drift. Computed imports and runtime resources are not resolved.', passed: checks.length > 0 && checks.every(c => c.passed), checks };
}
main(import.meta.url, () => { const a = args(['inventory']); const report = checkSources(readJson(a.inventory as string)); console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1; });
