import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

function authoredSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === 'generated' ? [] : authoredSources(file);
      return entry.isFile() && /\.tsx?$/.test(entry.name) ? [file] : [];
    })
    .sort();
}

/** Adopt formatting for UI and Web sources; generated contracts remain generator-owned. */
export async function formatSources(root: string, write = false): Promise<string[]> {
  const changed: string[] = [];
  for (const file of ['ui/src', 'web/src'].flatMap((directory) =>
    authoredSources(path.join(root, directory)),
  )) {
    const source = readFileSync(file, 'utf8');
    const formatted = await format(source, {
      filepath: file,
      singleQuote: true,
      tabWidth: 2,
      printWidth: 100,
      trailingComma: 'all',
    });
    if (source === formatted) continue;
    changed.push(path.relative(root, file));
    if (write) writeFileSync(file, formatted);
  }
  return changed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.length > 1 || args.some((arg) => arg !== '--write'))
    throw new Error('Use format:check or format:write without additional arguments');
  const write = args.includes('--write'),
    root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const changed = await formatSources(root, write);
  if (!write && changed.length) {
    console.error(
      'Unformatted hand-written source files; run corepack pnpm format:write:\n' +
        changed.join('\n'),
    );
    process.exitCode = 1;
  } else
    console.log(
      write ? `Formatted ${changed.length} source files` : 'UI and Web source formatting passed',
    );
}
