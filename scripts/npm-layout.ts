import type {NativeTarget} from './native-platforms.ts';
export const npmNodeEngine = '>=22.0.0';
export function platformPackages(name: string, version: string, targets: readonly NativeTarget[]) {
  return Object.fromEntries(targets.map(target => [target, {alias: name+'-'+target, version: version+'-'+target}]));
}
export function optionalPackages(name: string, version: string, targets: readonly NativeTarget[]) {
  return Object.fromEntries(Object.values(platformPackages(name, version, targets)).map(p => [p.alias, `npm:${name}@${p.version}`]));
}
export interface NpmArtifact {
  name: string; version: string; target: 'main' | NativeTarget; archive: string; sha256: string;
  metadata: Record<string, unknown>;
}
export interface NpmReleaseSet {
  format: 1; name: string; version: string; source: string; candidateOnly: boolean; targets: NativeTarget[]; packages: NpmArtifact[];
}
