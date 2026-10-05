import { readFileSync } from 'node:fs';
import path from 'node:path';

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

export function validateVersion(version: string): void {
  if (!semver.test(version)) throw new Error(`Invalid release version: ${version}. Use SemVer without a leading v or build metadata.`);
}

export function releaseVersion(projectRoot: string, requested?: string): string {
  const value: unknown = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  if (!value || typeof value !== 'object' || !('version' in value) || typeof value.version !== 'string') {
    throw new Error('package.json: missing string version');
  }
  validateVersion(value.version);
  if (requested !== undefined) {
    validateVersion(requested);
    if (requested !== value.version) throw new Error(`Requested version ${requested} differs from package.json ${value.version}; run release:prepare -- --version ${requested} first.`);
  }
  return value.version;
}
