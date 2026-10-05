import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const scopes = {
  repository: ['repo:check'],
  client: ['build', 'typecheck'],
  full: ['build', 'typecheck', 'test', 'repo:check'],
};
type Scope = keyof typeof scopes;
type Stage = { program: string; args: string[] };

/** Expand prerequisites before running; invalid scope never executes a stage. */
export function verificationPlan(scope: string): Stage[] {
  if (!Object.hasOwn(scopes, scope)) throw new Error('Expected --scope repository, client, or full');
  return [...scopes[scope as Scope].map(script => ({ program: 'corepack', args: ['pnpm', 'run', script] })),
    { program: 'git', args: ['diff', '--check'] }];
}

// Windows needs the JS entry: spawning a .cmd wrapper would require a shell.
function executable(stage: Stage): Stage {
  if (process.platform !== 'win32' || stage.program !== 'corepack') return stage;
  const roots = [path.dirname(process.execPath), ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : []),
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean)];
  for (const candidate of roots) {
    const entry = path.join(candidate, 'node_modules/corepack/dist/corepack.js');
    if (existsSync(entry)) return { program: process.execPath, args: [entry, ...stage.args] };
  }
  throw new Error('Cannot locate Corepack beside Node or in the standard user installation');
}

export function verify(scope: string, run = (stage: Stage) => {
  const command = executable(stage);
  const result = spawnSync(command.program, command.args, {
    cwd: root, encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 16 * 1024 * 1024,
    killSignal: 'SIGKILL', windowsHide: true,
  });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${stage.program} ${stage.args.join(' ')} failed (${result.signal ?? result.status})`);
}) {
  const completed: string[] = [];
  for (const stage of verificationPlan(scope)) {
    const name = [stage.program, ...stage.args].join(' ');
    console.log(`Checking: ${name}`);
    try { run(stage); }
    catch (error) { throw new Error(`Stopped at ${name}; completed: ${completed.join(', ') || 'none'}`, { cause: error }); }
    completed.push(name);
  }
  return completed;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ args: process.argv.slice(2).filter(arg => arg !== '--'), options: { scope: { type: 'string' } } });
    verify(values.scope ?? '');
  } catch (error) { console.error(error); process.exitCode = 1; }
}
