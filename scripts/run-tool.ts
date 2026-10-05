import { existsSync } from 'node:fs';
import path from 'node:path';

/** Resolve native archive tools and invoke package-manager JS on Windows without shell interpolation. */
export function toolCommand(program: string, args: string[]): [string, string[]] {
  if (process.platform === 'win32' && program === 'tar') {
    const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    if (!existsSync(executable)) throw new Error('Windows tar.exe is required');
    return [executable, args];
  }
  if (process.platform !== 'win32' || !['npm', 'corepack'].includes(program)) return [program, args];
  const relative = program === 'npm' ? 'npm/bin/npm-cli.js' : 'corepack/dist/corepack.js';
  const roots = [path.dirname(process.execPath), ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : []),
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean)];
  for (const root of roots) {
    const file = path.join(root, 'node_modules', relative);
    if (existsSync(file)) return [process.execPath, [file, ...args]];
  }
  throw new Error(`Cannot locate ${program} beside Node or in the standard user installation`);
}
