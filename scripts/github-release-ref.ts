import { spawnSync } from 'node:child_process';

export function parseRemoteRef(value: unknown, expectedRef: string): {source: string; type: 'commit' | 'tag'} {
  if (!value || typeof value !== 'object' || !('ref' in value) || value.ref !== expectedRef
    || !('object' in value) || !value.object || typeof value.object !== 'object'
    || !('sha' in value.object) || typeof value.object.sha !== 'string' || !/^[0-9a-f]{40}$/.test(value.object.sha)
    || !('type' in value.object) || (value.object.type !== 'commit' && value.object.type !== 'tag')) {
    throw new Error(`GitHub returned an invalid remote ref: ${expectedRef}`);
  }
  return {source: value.object.sha, type: value.object.type};
}

export function readRemoteRef(repository: string, ref: string): string | undefined {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^refs\/(heads|tags)\/[A-Za-z0-9._/-]+$/.test(ref)) throw new Error('Invalid remote ref query');
  const lookup = (endpoint: string, allowAbsent = false): unknown => {
    const result = spawnSync('gh', ['api', endpoint], {encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024});
    if (!result.error && result.status === 0) return JSON.parse(result.stdout);
    if (allowAbsent && !result.error && /HTTP 404/.test(result.stderr)) return undefined;
    throw new Error(`GitHub ref query failed: ${result.error?.message || result.stderr.trim() || `exit ${result.status}`}`);
  };
  const endpoint = ref.replace(/^refs\//, '').split('/').map(encodeURIComponent).join('/');
  const value = lookup(`repos/${repository}/git/ref/${endpoint}`, true);
  if (value === undefined) return undefined;
  let identity = parseRemoteRef(value, ref);
  for (let count = 0; identity.type === 'tag'; count++) {
    if (count >= 5) throw new Error('Annotated tag nesting exceeds the supported bound');
    const tag = lookup(`repos/${repository}/git/tags/${identity.source}`);
    if (!tag || typeof tag !== 'object' || !('sha' in tag) || tag.sha !== identity.source || !('object' in tag)) throw new Error('GitHub returned an invalid annotated tag');
    identity = parseRemoteRef({ref, object: tag.object}, ref);
  }
  return identity.source;
}
