import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { GitHubReleaseSet } from './github-release.ts';
import { validateReleaseSet } from './generate-release-notes.ts';
import { releaseVersion } from './release-version.ts';

export function verifyReleaseAssets(directory: string, version: string, source: string): string[] {
  const set = JSON.parse(readFileSync(path.join(directory, 'release-set.json'), 'utf8')) as GitHubReleaseSet;
  validateReleaseSet(set);
  if (set.version !== version || set.source !== source || set.candidateOnly !== false) throw new Error('Release candidate identity differs from the exact source');
  const files = set.assets.map(asset => {
    const file = path.join(directory, asset.archive);
    if (!statSync(file).isFile() || statSync(file).size !== asset.bytes
      || createHash('sha256').update(readFileSync(file)).digest('hex') !== asset.sha256) throw new Error(`Release archive size or SHA-256 mismatch: ${asset.archive}`);
    return file;
  });
  const sums = readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/).sort();
  if (JSON.stringify(sums) !== JSON.stringify(set.assets.map(asset => `${asset.sha256}  ${asset.archive}`).sort())) throw new Error('SHA256SUMS differs from the release set');
  return files;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    if (process.argv.length !== 3 || !process.env.GITHUB_SHA) throw new Error('Pass a release directory and GITHUB_SHA');
    const files = verifyReleaseAssets(path.resolve(process.argv[2]), releaseVersion(root), process.env.GITHUB_SHA);
    console.log(`Exact-source candidate hashes verified: ${files.length} archives`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
