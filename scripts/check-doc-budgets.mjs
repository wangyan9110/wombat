import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const budgets = JSON.parse(readFileSync(path.join(root, 'scripts/doc-budgets.json'), 'utf8'));
const list = process.argv.slice(2).includes('--list');
const errors = [];
const rows = [];

for (const [relative, ceiling] of Object.entries(budgets)) {
  const file = path.resolve(root, relative);
  if (!Number.isInteger(ceiling) || ceiling <= 0 || !file.startsWith(root + path.sep) || !existsSync(file)) {
    errors.push(`${relative}: invalid ceiling, path, or missing file`);
    continue;
  }
  // Unicode code points without whitespace keep Chinese and English on one predictable scale.
  const size = [...readFileSync(file, 'utf8').replace(/\s/gu, '')].length;
  rows.push(`${size <= ceiling ? 'ok' : 'OVER'} ${String(size).padStart(5)} / ${String(ceiling).padStart(5)} ${relative}`);
  if (size > ceiling) errors.push(`${relative}: ${size} non-whitespace characters exceed ${ceiling}; relocate, condense, or justify a larger ceiling`);
}

if (list) console.log(rows.join('\n'));
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else if (!list) {
  console.log(`Standing-document budgets passed: ${Object.keys(budgets).length} file(s).`);
}
