import type { ConfigItem, OptimizeResult, OptimizeSuggestion } from '@wombat/client';
export const ruleScenarios = [
  'rules-format',
  'rules-reference',
  'rules-hook',
  'rules-clean',
] as const;
/** Examples use safe structural diagnostics and authorized static evidence, never raw bodies. */
export function ruleExample(
  result: OptimizeResult,
  scenario: string,
  item: ConfigItem,
): OptimizeSuggestion | undefined {
  if (!ruleScenarios.some((value) => value === scenario)) return;
  const template = result.suggestions[0];
  if (!template) return;

  const rule =
    scenario === 'rules-format'
      ? 'skillFormat'
      : scenario === 'rules-hook'
        ? 'hookTarget'
        : 'localReference';
  const evidence: NonNullable<OptimizeSuggestion['findings'][number]['evidence']> = {
    method: 'synthetic-authorized-static-v1',
    applicability: rule === 'hookTarget' ? 'nativeHookProject' : 'ownerRelativePath',
    versions: [{ itemId: item.id, path: item.path, contentHash: item.contentHash }],
    positions: [],
    references:
      rule === 'localReference'
        ? [
            {
              target: '/synthetic/wombat/docs/missing.md',
              baseDirectory: '/synthetic/wombat',
              expectedType: 'file',
              status: 'referenceTargetMissing',
              startByte: 12,
              endByte: 30,
              startLine: 2,
              endLine: 2,
            },
          ]
        : [],
    hook:
      rule === 'hookTarget'
        ? {
            project: '/synthetic/wombat',
            nativeKey: 'synthetic-hook',
            registrationHash: 'synthetic-registration',
            hostVersion: 'synthetic-native-v1',
            trust: 'trusted',
            target: '/synthetic/wombat/hooks/missing.js',
            status: 'referenceTargetMissing',
          }
        : null,
  };
  const finding: OptimizeSuggestion['findings'][number] = {
    identity: { version: 1, findingId: `synthetic-problem-${rule}`, gap: null },
    rule,
    status: 'failed',
    observed: null,
    threshold: null,
    evidenceCodes: [rule === 'skillFormat' ? 'nameTypeInvalid' : 'referenceTargetMissing'],
    evidence: rule === 'skillFormat' ? null : evidence,
  };
  const original = template.checks[0],
    clean = scenario === 'rules-clean';
  const check: OptimizeSuggestion['checks'][number] = {
    ...original,
    rule,
    itemId: item.id,
    contentVersion: item.contentHash,
    assessmentId: `synthetic-assessment-${rule}`,
    outcome: clean ? 'miss' : 'hit',
    reason: null,
    findings: clean ? [] : [finding],
    methodVersions: [
      {
        method:
          rule === 'skillFormat' ? 'synthetic-skill-metadata-v1' : 'synthetic-authorized-static-v1',
        version: 1,
      },
    ],
    basis: {
      ...original.basis,
      dependencyRevision: `synthetic-dependency-${rule}`,
      measurement:
        rule === 'skillFormat'
          ? { kind: 'skill_metadata', status: 'invalid', issues: ['nameTypeInvalid'] }
          : { kind: 'static', complete: true, findings: clean ? 0 : 1 },
      scope: {
        ...original.basis.scope,
        sourceInstanceId: 'preview',
        sourceRoots: ['/synthetic/codex-home'],
        roots: ['/synthetic/codex-home'],
        itemProject: item.project ?? null,
        project: item.project ?? null,
      },
    },
  };
  return {
    ...template,
    id: `synthetic-suggestion-${rule}`,
    item,
    category: 'repair',
    findings: clean ? [] : [finding],
    checks: [check],
    reviewBaseline: {
      version: 1,
      item: structuredClone(item),
      scope: structuredClone(check.basis.scope),
      assessments: [structuredClone(check)],
    },
  };
}
