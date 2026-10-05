export function previousReleaseTag(tags: string[], currentVersion: string): string | undefined {
  const current = `v${currentVersion}`;
  return tags.map(tag => tag.trim()).find(tag => tag && tag !== current && /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag));
}
