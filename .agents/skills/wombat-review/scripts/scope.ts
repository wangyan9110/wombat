import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Read-only checkout inventory; diffs require separate, scoped inspection. */
export function checkoutScope(cwd = root) {
  const git = (args: string[]): string => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
    return result.stdout;
  };
  const head = git(['rev-parse', 'HEAD']).trim();
  const branch = git(['branch', '--show-current']).trim();
  const tracking = branch ? git(['for-each-ref', '--format=%(upstream:short)', 'refs/heads/' + branch]).trim() : '';
  const records = (args: string[]) => git(args).split('\0').filter(Boolean);
  const result = {
    root: cwd, head, branch: branch || null, tracking: tracking || null,
    mergeBase: tracking ? git(['merge-base', 'HEAD', tracking]).trim() : null,
    // NUL-delimited records preserve spaces, tabs, newlines, and rename pairs.
    status: records(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    staged: records(['diff', '--cached', '--name-status', '-z']),
    unstaged: records(['diff', '--name-status', '-z']),
    recent: git(['log', '-5', '--format=%h %s']).trimEnd().split('\n'),
  };
  if (git(['rev-parse', 'HEAD']).trim() !== head) throw new Error('HEAD changed during inventory; reacquire scope');
  return result;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--')) throw new Error('skills:scope accepts no arguments');
    console.log(JSON.stringify(checkoutScope(), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
