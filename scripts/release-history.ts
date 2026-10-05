import {execFileSync} from 'node:child_process';

/** Public Releases and reachable tags must agree; a failed build's tag is not a release. */
export function publishedReleaseTags(value: unknown, mergedTags: string[]): string[] {
  if (!Array.isArray(value)) throw new Error('Published release history must be an array');
  const merged = new Set(mergedTags.map(tag => tag.trim()));
  const releases = value.flatMap((release: unknown) => {
    if (typeof release !== 'object' || release === null || Array.isArray(release)
      || !('tagName' in release) || typeof release.tagName !== 'string'
      || !('isDraft' in release) || typeof release.isDraft !== 'boolean') {
      throw new Error('Published release history contains invalid release metadata');
    }
    if (release.isDraft) return [];
    if (!('publishedAt' in release) || typeof release.publishedAt !== 'string'
      || !Number.isFinite(Date.parse(release.publishedAt))) {
      throw new Error(`Published release ${release.tagName} has no valid publication time`);
    }
    return merged.has(release.tagName) ? [{tag: release.tagName, time: Date.parse(release.publishedAt)}] : [];
  });
  if (value.length >= 100 && !releases.length) throw new Error('No reachable Release in the bounded published release history');
  return releases.sort((left, right) => right.time - left.time).map(release => release.tag);
}

export function readPublishedReleaseTags(repository: string): string[] {
  const options = {encoding: 'utf8' as const, timeout: 60_000, maxBuffer: 1024 * 1024};
  const merged = execFileSync('git', ['tag', '--merged', 'HEAD'], options).split(/\r?\n/);
  const releases = JSON.parse(execFileSync('gh', ['release', 'list', '--repo', repository,
    '--limit', '100', '--exclude-drafts', '--json', 'tagName,isDraft,publishedAt'], options));
  return publishedReleaseTags(releases, merged);
}

export function previousReleaseTag(tags: string[], currentVersion: string): string | undefined {
  const current = `v${currentVersion}`;
  return tags.map(tag => tag.trim()).find(tag => tag && tag !== current && /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag));
}
