import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { validateVersion } from './release-version.ts';

export interface PublishedAsset { name: string; size: number; digest: string }

export function releaseCacheDirectory(cache: string, repository: string, version: string, source: string): string {
  validateVersion(version);
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(repository)
    || !/^[0-9a-f]{40}$/.test(source)) throw new Error('Invalid release cache identity');
  return path.join(cache, 'published', repository.toLowerCase(), `v${version}`, source);
}

function validateAsset(asset: PublishedAsset): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.name) || !Number.isSafeInteger(asset.size) || asset.size <= 0
    || !/^sha256:[0-9a-f]{64}$/.test(asset.digest)) throw new Error(`Invalid published asset metadata: ${asset.name}`);
}

function matches(file: string, asset: PublishedAsset): boolean {
  if (!existsSync(file)) return false;
  const stat = lstatSync(file);
  return stat.isFile() && !stat.isSymbolicLink() && stat.size === asset.size
    && `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}` === asset.digest;
}

/** Only complete, hash-checked files survive an interrupted download. */
export function cacheReleaseAsset(
  directory: string, asset: PublishedAsset, download: (destination: string) => void,
  verify: (file: string) => void,
): {file: string; reused: boolean} {
  validateAsset(asset);
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, asset.name);
  if (matches(file, asset)) {
    verify(file);
    return {file, reused: true};
  }
  const scratch = mkdtempSync(path.join(directory, '.download-'));
  try {
    download(scratch);
    const incoming = path.join(scratch, asset.name);
    if (!matches(incoming, asset)) throw new Error(`Downloaded size or SHA-256 differs from GitHub: ${asset.name}`);
    verify(incoming);
    // Never replace arbitrary directories or symlinks found in a cache slot.
    if (existsSync(file)) {
      if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error(`Release cache slot is not a regular file: ${file}`);
      rmSync(file);
    }
    renameSync(incoming, file);
    return {file, reused: false};
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** gh batches downloads; verified progress survives a partial batch failure. */
export function cacheReleaseAssets(
  directory: string, assets: PublishedAsset[], download: (assets: PublishedAsset[], destination: string) => void,
  verify: (file: string) => void,
): Array<{file: string; reused: boolean}> {
  assets.forEach(validateAsset);
  if (new Set(assets.map(asset => asset.name)).size !== assets.length) throw new Error('Duplicate published asset');
  mkdirSync(directory, {recursive: true});
  const existing = assets.filter(asset => matches(path.join(directory, asset.name), asset));
  for (const asset of existing) verify(path.join(directory, asset.name));
  const missing = assets.filter(asset => !existing.includes(asset));
  if (missing.length) {
    const scratch = mkdtempSync(path.join(directory, '.download-'));
    let failure: unknown;
    try {
      try { download(missing, scratch); } catch (error) { failure = error; }
      for (const asset of missing) {
        const incoming = path.join(scratch, asset.name);
        if (!matches(incoming, asset)) {
          failure ??= new Error(`Downloaded size or SHA-256 differs from GitHub: ${asset.name}`);
          continue;
        }
        cacheReleaseAsset(directory, asset, destination => renameSync(incoming, path.join(destination, asset.name)), verify);
      }
      if (failure) throw failure;
    } finally {
      rmSync(scratch, {recursive: true, force: true});
    }
  }
  return assets.map(asset => ({file: path.join(directory, asset.name), reused: existing.includes(asset)}));
}
