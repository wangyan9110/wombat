import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
export const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
export function args(required: string[], extra: string[] = []): Record<string, string | string[]> {
  const options = Object.fromEntries([...required, ...extra].map(key => [key, { type: 'string' as const, multiple: extra.includes(key) }]));
  const { values } = parseArgs({ options });
  for (const key of required) if (!values[key]) throw new Error(`Missing --${key}`);
  return values as Record<string, string | string[]>;
}
export function main(url: string, run: () => void): void {
  if (!process.argv[1] || pathToFileURL(resolve(process.argv[1])).href !== url) return;
  try { run(); } catch (error) { console.error(JSON.stringify({ passed: false, error: String(error) })); process.exitCode = 1; }
}
export function unique<T>(items: T[], predicate: (item: T) => boolean, label: string): T {
  const found = items.filter(predicate);
  if (found.length !== 1) throw new Error(`Expected one ${label}, found ${found.length}`);
  return found[0];
}
