import { toolCommand } from './run-tool.ts';
// Source-preview release gate. This script never changes versions, tags, or publishes.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const localCargo = path.join(os.homedir(), '.cargo', 'bin', executable);
const cargo = process.env.WOMBAT_CARGO || (existsSync(localCargo) ? localCargo : executable);
const steps = [
  ['Whitespace', 'git', ['diff', '--check']],
  ['Rust formatting', cargo, ['fmt', '--manifest-path', 'core/Cargo.toml', '--', '--check']],
  ['Rust lint', cargo, ['clippy', '--locked', '--manifest-path', 'core/Cargo.toml', '--all-targets', '--', '-D', 'warnings']],
  ['Build', 'corepack', ['pnpm', 'build']],
  ['Types and module boundaries', 'corepack', ['pnpm', 'typecheck']],
  ['Generated contracts', 'corepack', ['pnpm', 'contracts:check']],
  ['Tests', 'corepack', ['pnpm', 'test']],
  ['Dependency licenses', 'corepack', ['pnpm', 'licenses:check']],
  // repo:check already includes public:check; keep this scan single-pass because it walks reachable history.
  ['Repository and public-source rules', 'corepack', ['pnpm', 'repo:check']],
];
for (const [label, program, args] of steps) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(...toolCommand(program, args), { cwd: root, stdio: 'inherit', timeout: 900_000 });
  if (result.error || result.status !== 0) {
    console.error(`Release check stopped at ${label}: ${result.error?.message || `exit ${result.status}`}`);
    process.exit(result.status || 1);
  }
}
console.log(`\nRelease checks passed on ${process.platform}/${process.arch}. Run github:pack to assemble and verify release archives. No publication performed.`);
