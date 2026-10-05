/** Focused candidate acceptance; the full release gate remains mandatory before publication. */
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {toolCommand} from './run-tool.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const steps: Array<[string, string, string[]]> = [
  ['Build candidate', 'corepack', ['pnpm', 'build']],
  ['Types and module boundaries', 'corepack', ['pnpm', 'typecheck']],
  ['Repository rules and tool-selection regressions', 'corepack', ['pnpm', 'repo:check']],
  ['Initial scan and language regressions', process.execPath, ['--import', 'tsx', '--test',
    '--test-name-pattern=real CLI refresh, usage, threads, turns and steps conserve|language changes presentation',
    'tests/e2e/cli-blackbox.test.ts']],
  ['Managed installation diagnostics and update regressions', process.execPath, ['--import', 'tsx', '--test',
    'cli/tests/doctor.test.ts', 'cli/tests/update.test.ts']],
  ['Package, install, upgrade and Web acceptance', 'corepack', ['pnpm', 'github:pack', '--', '--current-platform', '--reuse-build']],
];
for (const [label, program, args] of steps) {
  console.log(`Release installation verification: ${label}`);
  const result = spawnSync(...toolCommand(program, args), {cwd: root, stdio: 'inherit', timeout: 30 * 60_000});
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${result.error?.message ?? `exit ${result.status}`}`);
  }
}
console.log(`Installation candidate verified on ${process.platform}/${process.arch}. Full release gates and publication remain separate.`);
