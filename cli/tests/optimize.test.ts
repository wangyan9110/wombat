import test from 'node:test';
import assert from 'node:assert/strict';
import type { OptimizeResult, OptimizeSuggestion } from '@wombat/client';
import { locale, t } from '@wombat/client/locale';
import { formatOptimizeText } from '../src/optimize-cli.js';
import {activityResult} from '../../tests/fixtures/activity.js';

const at = '2026-10-01T00:00:00Z';
const item: OptimizeSuggestion['item'] = {
  id: 'synthetic-item', name: 'sample', kind: 'skill', sourceInstanceId: 'synthetic', path: '/synthetic/SKILL.md',
  authorizedProjects: [], sourceContexts: [], configuredState: 'discovered', contentHash: 'current-content', observedAt: at,
  current: true, stale: false, estimateStatus: 'unknown', measurementStatus: 'complete', bodyEstimateStatus: 'unknown',
  observation: 'unknown', counts: { fileReads: 0, toolCalls: 0, resourceReads: 0, succeeded: 0, failed: 0, outcomeUnknown: 0 },
  relatedTurns: 0, relatedTasks: 0,
};
const scope: OptimizeSuggestion['checks'][number]['basis']['scope'] = {
  sourceInstanceId: 'synthetic', itemProject: null, global: true, project: null, sourceInstances: ['synthetic'],
  authorizedProjects: [], roots: ['/synthetic'], projectRoots: [], sourceRoots: ['/synthetic'], complete: true,
};
function check(outcome: OptimizeSuggestion['checks'][number]['outcome'] = 'hit', comparison: OptimizeSuggestion['checks'][number]['comparison']['status'] = 'not_requested'): OptimizeSuggestion['checks'][number] {
  return {
    assessmentId: 'synthetic-assessment', identityGap: null, ruleSemanticsVersion: 1,
    methodVersions: [{ method: 'synthetic-measurement', version: 1 }], rule: 'bodyTokens', ruleVersion: 'synthetic-rules',
    itemId: item.id, contentVersion: item.contentHash, checkedAt: at, outcome, reason: null, findings: [],
    basis: { version: 1, dependencyRevision: 'synthetic-dependency', scope, cutoff: at, applicability: 'synthetic',
      measurement: { kind: 'numeric', basis: 'agentSkillsRecommendation', observed: 6000, threshold: 5000, inclusive: true, suppressedByStandard: false }, gaps: [] },
    comparison: { status: comparison, baselineAssessmentId: comparison === 'not_requested' ? null : 'original-assessment', reason: null },
  };
}
function result(): OptimizeResult {
  const current = check();
  const original = { ...check(), assessmentId: 'original-assessment', contentVersion: 'original-content' };
  return {
    outputVersion: 4, action: 'detail', capabilities: { staticChecks: true, manualEditReview: true, decisions: true, inactivity: false,
      mcpFaults: false, spaceCleanup: false, loadingBudgetDiagnosis: false, exactInstructionBlocks: true, declaredCopyDrift: true,
      hookSupport: { effectiveRegistry: false, status: 'no_verified_adapter' } },
    configRevision: 'synthetic-config', usageRevision: null, readView: 'synthetic-fixed-view', decisionRevision: 'synthetic-decision', checkedAt: at,
    suggestions: [{ reviewFormatVersion: 1, id: 'synthetic-suggestion', item: structuredClone(item), category: 'trim', status: 'stillNeedsReview',
      checks: [current], findings: [], checkedAt: at, ruleVersion: 'synthetic-rules',
      reviewBaseline: { version: 1, item: { ...item, contentHash: 'original-content' }, scope, assessments: [original] } }],
    pending: 1, history: 0, page: { offset: 0, limit: 50, total: 1 }, issues: [], resultStatus: 'complete',
    ruleParameters: { version: 'synthetic-rules', agentsBytesDefault: 16384, descriptionCharactersDefault: 500, overrides: {},
      bodyTokens: 5000, descriptionStandardMax: 1024, applicability: 'synthetic' }, ruleCatalog: [], checks: [], followUps: [],
  };
}
function bilingual(run: () => void) {
  const saved = locale.getSnapshot().locale;
  try { for (const language of ['zh', 'en'] as const) { locale.setLocale(language); run(); } }
  finally { locale.setLocale(saved); }
}

test('activity text leads with measured findings and next steps while retaining every check',()=>bilingual(()=>{
 const fixture=activityResult(),text=formatOptimizeText(fixture);
 assert.match(text,locale.getSnapshot().locale==='zh'?/失败后再次调用 1 次/:/Calls after failure: 1/);
 const basis=text.indexOf(t('activity.checks'));
 assert.ok(basis>0);assert.ok(text.indexOf(t('activity.failureAdvice'))<basis);
 assert.ok(text.indexOf(t('activity.sampleSmall'))>basis);
 assert.match(text,/live:synthetic:fixed/);assert.match(text,/safe_event_turn_v7/);
}));

test('optimize text separates each recorded decision and reason from current check facts in both languages', () => bilingual(() => {
  for (const kind of ['keep', 'not_applicable'] as const) for (const reason of ['necessary', 'object_changed', 'incorrect_evidence'] as const) {
    const fixture = result();
    fixture.suggestions[0].decision = { kind, reason, recordedAt: '2026-10-02T00:00:00Z', binding: {
      version: 1, identityBasis: 'stable_problems', suggestionId: fixture.suggestions[0].id, findingIds: ['synthetic-finding'],
      assessmentIds: ['synthetic-assessment'], contentVersion: item.contentHash, scope, applicabilityId: 'synthetic-applicability', gap: reason === 'incorrect_evidence' ? 'decisionApplicabilityUnavailable' : null,
    } };
    const text = formatOptimizeText(fixture);
    assert.ok(text.includes(`${t('optimize.assessment.decision')}: ${t(kind === 'keep' ? 'optimize.kept' : 'optimize.inapplicable')} · 2026-10-02T00:00:00Z`));
    const reasonKey = reason === 'necessary' ? 'optimize.assessment.necessary' : reason === 'object_changed' ? 'optimize.reason.objectChanged' : 'optimize.reason.incorrectEvidence';
    assert.ok(text.includes(`${t('optimize.decisionReason')}: ${t(reasonKey)}`));
    assert.ok(text.includes(t('optimize.assessment.decisionNote')));
    if (reason === 'incorrect_evidence') assert.ok(text.includes(t('optimize.assessment.identityGap')));
    assert.ok(text.includes(t('optimize.check.hit')));
    assert.ok(text.includes(t('optimize.assessment.comparison.not_requested')));
    assert.ok(!text.includes(t('optimize.verified')));
    assert.doesNotMatch(text, /synthetic-applicability|synthetic-finding|"binding"/);
  }
}));

test('optimize text preserves all core outcomes and comparison states, including the checks entry', () => bilingual(() => {
  const fixture = result(); fixture.suggestions = []; fixture.action = 'checks';
  fixture.checks = (['hit', 'miss', 'insufficient', 'unsupported', 'error'] as const).map(outcome => check(outcome));
  fixture.checks.push(...(['not_requested', 'comparable', 'incomparable', 'unknown'] as const).map(status => check('miss', status)));
  const text = formatOptimizeText(fixture);
  for (const outcome of ['hit', 'miss', 'insufficient', 'unsupported', 'error'] as const) assert.ok(text.includes(t(`optimize.check.${outcome}`)));
  for (const status of ['not_requested', 'comparable', 'incomparable', 'unknown'] as const) assert.ok(text.includes(t(`optimize.assessment.comparison.${status}`)));
  assert.ok(text.includes(t('optimize.checks')));
  assert.ok(!text.includes(t('optimize.verified')));
}));

test('original assessment and current miss remain distinct when the core says rules changed', () => bilingual(() => {
  const fixture = result();
  fixture.suggestions[0].checks = [{ ...check('miss', 'incomparable'), comparison: { status: 'incomparable', reason: 'ruleParametersOrMethodChanged' } }];
  fixture.suggestions[0].item.bytes = 0;
  const text = formatOptimizeText(fixture);
  const current = text.indexOf(t('optimize.assessment.latest')), original = text.indexOf(t('optimize.assessment.original'));
  assert.ok(current >= 0 && original > current);
  assert.ok(text.slice(current, original).includes(t('optimize.check.miss')));
  assert.ok(text.slice(current, original).includes(t('optimize.assessment.comparison.incomparable')));
  assert.ok(text.slice(current, original).includes(t('optimize.assessment.reason.methodChanged')));
  assert.ok(text.slice(original).includes(t('optimize.check.hit')));
  assert.ok(!text.includes(t('optimize.assessment.comparison.comparable')));
  assert.ok(!text.includes(t('optimize.verified')));
}));

test('missing basis, open reason codes and binding gaps stay explicit without leaking records or terminal controls', () => bilingual(() => {
  const fixture = result(), suggestion = fixture.suggestions[0];
  suggestion.reviewBaseline = null;
  suggestion.item.path = '/synthetic/\u001b[31mSKILL.md\u001b[0m\nsource';
  suggestion.checks = [{ ...check('insufficient', 'unknown'), reason: 'sourceOnlySentinel', identityGap: 'assessmentIdentityUnavailable',
    comparison: { status: 'unknown', reason: 'assessmentIdentityUnavailable' },
    basis: { ...check().basis, gaps: ['checkScopeUnavailable'] } }];
  const text = formatOptimizeText(fixture);
  for (const key of ['optimize.assessment.baselineMissing', 'optimize.assessment.identityGap', 'optimize.assessment.reason.evidenceMissing',
    'optimize.assessment.reason.identityMissing', 'optimize.assessment.reason.scopeMissing'] as const) assert.ok(text.includes(t(key)));
  assert.doesNotMatch(text, /sourceOnlySentinel|\u001b|"measurement"|"scope"|synthetic-dependency/);
  suggestion.checks = [];
  assert.ok(formatOptimizeText(fixture).includes(t('optimize.evidenceIncomplete')));
}));

test('formatting observes the active language without mutating JSON facts or stored baselines', () => {
  const saved = locale.getSnapshot().locale, fixture = result(), before = JSON.stringify(fixture);
  try {
    locale.setLocale('en'); const en = formatOptimizeText(fixture); assert.match(en, /Current assessment facts/);
    locale.setLocale('zh'); const zh = formatOptimizeText(fixture); assert.match(zh, /本次检查事实/);
    assert.notEqual(zh, en); assert.equal(JSON.stringify(fixture), before);
  } finally { locale.setLocale(saved); }
});


test('review headings localize recorded states and omit absent headline metrics', () => bilingual(() => {
  for (const [status, key] of [['pending', 'optimize.pending'], ['verified', 'optimize.verified'],
    ['stillNeedsReview', 'optimize.stillNeedsReview'], ['recheckUnavailable', 'optimize.recheckUnavailable'],
    ['future-state', 'optimize.statusUnavailable']] as const) {
    const fixture = result(); fixture.suggestions[0].status = status;
    const text = formatOptimizeText(fixture);
    assert.ok(text.split('\n')[1].includes(t(key)));
    assert.ok(!text.split('\n')[1].includes(status));
    assert.doesNotMatch(text, /— Unknown|— 未知/);
  }
  const fixture = result();
  fixture.suggestions[0].findings = [{ identity: { version: 1, findingId: 'synthetic-problem', gap: null },
    rule: 'bodyTokens', status: 'failed', observed: 0, threshold: 5000, evidenceCodes: [] }];
  assert.match(formatOptimizeText(fixture), /  0 /);
}));

test('activity CLI requires a fixed turn and renders inspection signals in both languages',async()=>{
 const {parseOptimizeArgs}=await import('../src/optimize-cli.js');
 const {activityResult}=await import('../../tests/fixtures/activity.js');
 const parsed=parseOptimizeArgs(['activity','--snapshot','live:synthetic:fixed','--thread','task','--turn','turn','--json']);
 assert.equal(parsed.request.action,'activity');assert.equal(parsed.request.projectRoots,undefined);
 assert.deepEqual(parsed.request.activity,{snapshotId:'live:synthetic:fixed',threadId:'task',turnId:'turn'});
 for(const args of [['activity'],['activity','--snapshot','fixed','--thread','task'],['activity','--snapshot','fixed','--thread','task','--turn','turn','--read-view','config:other'],['list','--turn','turn']])assert.throws(()=>parseOptimizeArgs(args));
 const previous=locale.getSnapshot().locale;
 try{for(const language of ['en','zh'] as const){locale.setLocale(language);const text=formatOptimizeText(activityResult());assert.match(text,language==='en'?/Calls after failure: 1 observed/:/失败后再次调用: 已观察到 1 次/);assert.match(text,/40%/);assert.match(text,language==='en'?/at least 5 operations/:/至少 5 次结果可判定/);assert.match(text,language==='en'?/current sample is small/:/当前样本较少/);assert.match(text,language==='en'?/same path does not establish identical content/:/同路径不证明内容/);assert.doesNotMatch(text,/activity\.|undefined|NaN|未知/);}}finally{locale.setLocale(previous);}
});
