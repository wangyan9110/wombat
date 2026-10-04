import type {NativeTarget} from './native-platforms.ts';

export const releaseNodeVersion = '26.4.0';

export interface GitHubReleaseAsset {
  target: NativeTarget;
  archive: string;
  sha256: string;
  bytes: number;
}

export interface GitHubReleaseMetadata {
  format: 1;
  version: string;
  source: string;
  sourceSha256: string;
  target: NativeTarget;
  runtime: { name: 'node'; version: string };
}

export interface GitHubReleaseSet {
  format: 1;
  version: string;
  source: string;
  sourceSha256: string;
  candidateOnly: boolean;
  targets: NativeTarget[];
  assets: GitHubReleaseAsset[];
}

export function releaseArchive(target: NativeTarget): string {
  return `wombat-${target}.tar.gz`;
}
