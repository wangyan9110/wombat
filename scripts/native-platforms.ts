import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const nativeTargets = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64'] as const;
export type NativeTarget = typeof nativeTargets[number];
export function checkedSourceRevision(): string {
  const paths = ['core', 'client', 'cli', 'ui', 'web', 'scripts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'rust-toolchain.toml', 'tsconfig.json'];
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...paths], { encoding: 'utf8' }).trim();
  if (dirty) throw new Error('Commit source changes before exporting or assembling universal native artifacts; use --current-platform for local testing');
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}
export function nativeBinary(target: string): string { return target.startsWith('win32-') ? 'wombat-core.exe' : 'wombat-core'; }
export function currentNativeTarget(): NativeTarget {
  const target = process.platform + '-' + process.arch;
  if (!(nativeTargets as readonly string[]).includes(target)) throw new Error('Unsupported native target: ' + target);
  return target as NativeTarget;
}
export function sha256(file: string): string { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
export interface NativeManifest { target: NativeTarget; version: string; source: string; sha256: string; }
export function inspectNative(directory: string, target: NativeTarget, version: string, source: string): NativeManifest {
  const folder = path.join(directory, target);
  const manifest: NativeManifest = JSON.parse(readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  const binary = path.join(folder, nativeBinary(target));
  if (manifest.target !== target || manifest.version !== version || manifest.source !== source || manifest.sha256 !== sha256(binary))
    throw new Error('Native artifact identity/hash mismatch: ' + target);
  if (!statSync(binary).isFile()) throw new Error('Native artifact is not a file: ' + target);
  return manifest;
}
