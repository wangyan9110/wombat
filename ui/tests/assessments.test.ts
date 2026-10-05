import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createUsageClient } from '@wombat/client';
import { locale, t } from '@wombat/client/locale';
import { AssessmentRows, ReviewFacts } from '../src/optimize/Assessments.js';
import { RelatedUsageContent, textChanges, TextChanges } from '../src/ReviewUsage.js';
import { configFixture, createRuleFixture, type ReviewScenario } from '../src/preview/configuration.js';
import { createPreviewClient } from '../src/preview/fixtures.js';
import { parseRoute } from '../src/state.js';
const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

test('shared assessment presentation retains all five outcomes and actual miss measurements', () => {
  const result = createRuleFixture()({ action: 'checks' });
  const checks = structuredClone(result.checks);
  checks[1].basis.measurement = { kind: 'numeric', basis: 'synthetic', observed: 0, threshold: 5000, inclusive: true };
  const saved = locale.getSnapshot().locale;
  try {
    for (const language of ['zh', 'en'] as const) {
      locale.setLocale(language);
      const html = render(createElement(AssessmentRows, { checks, timezone: 'UTC' }));
      assert.equal((html.match(/class="finding-evidence"/g) ?? []).length, 5);
      assert.match(html, language === 'zh' ? /未发现问题/ : /No issue found/);
      assert.match(html, language === 'zh' ? /检查依据不足/ : /Insufficient evidence/);
      assert.match(html, language === 'zh' ? /当前无法检查/ : /Cannot check currently/);
      assert.match(html, language === 'zh' ? /检查失败/ : /Check failed/);
      assert.match(html, />0<\/dd>/); assert.match(html, /≥ 5,000/);
      assert.match(html, /continuousCoverageUnavailable/);
      assert.match(html, /synthetic-dependency-bodyTokens/);
    }
  } finally { locale.setLocale(saved); }
});

test('a comparable resolved recheck consumes original assessment identity, preserving baseline and decision', () => {
  const query = createRuleFixture(false, 'resolved');
  const original = structuredClone(query({}).suggestions[0].reviewBaseline);
  query({ action: 'keep', decisionReason: 'necessary' });
  const result = query({ action: 'recheck' }), suggestion = result.suggestions[0];
  assert.equal(suggestion.status, 'verified');
  assert.equal(suggestion.checks[0].outcome, 'miss');
  assert.equal(suggestion.checks[0].comparison.status, 'comparable');
  assert.deepEqual(suggestion.reviewBaseline, original);
  assert.equal(suggestion.decision?.kind, 'keep');
  assert.deepEqual(textChanges(suggestion).map(r => [r.before, r.after]), [[6200, 2000]]);
  const html = render(createElement(ReviewFacts, { suggestion, timezone: 'UTC' }));
  assert.match(html, /synthetic-assessment-bodyTokens/);
  assert.match(html, /synthetic-content-method-scope-binding/);
  assert.match(html, /6,200/); assert.match(html, /2,000/);
});

test('upgrade and missing evidence retain the user decision but never expose a comparable measurement change', () => {
  const saved = locale.getSnapshot().locale;
  try {
    for (const language of ['zh', 'en'] as const) {
      locale.setLocale(language);
      for (const scenario of ['incomparable', 'unknown'] as ReviewScenario[]) {
        const query = createRuleFixture(false, scenario);
        const original = structuredClone(query({}).suggestions[0].reviewBaseline);
        query({ action: 'not_applicable', decisionReason: 'incorrect_evidence' });
        const result = query({ action: 'recheck' }), suggestion = result.suggestions[0];
        assert.equal(suggestion.status, 'recheckUnavailable');
        assert.equal(suggestion.checks[0].comparison.status, scenario);
        assert.equal(suggestion.decision?.kind, 'not_applicable');
        assert.deepEqual(suggestion.reviewBaseline, original);
        assert.deepEqual(textChanges(suggestion), []);
        const html = render(createElement(ReviewFacts, { suggestion, timezone: 'UTC' }));
        assert.match(html, language === 'zh' ? /不能确认原问题已解决/ : /resolution.*cannot be confirmed/);
        assert.match(html, language === 'zh' ? /不代表检查通过或问题已解决/ : /do not establish a passed check or resolution/);
        assert.match(html, /The evidence is incorrect|依据不正确/);
        if (scenario === 'unknown') { assert.match(html, /assessmentIdentityUnavailable/); assert.equal(result.resultStatus, 'partial'); }
        else assert.match(html, /ruleParametersOrMethodChanged/);
      }
    }
  } finally { locale.setLocale(saved); }
});

test('missing baseline and assessment gaps are visible independently of user handling', () => {
  const suggestion = createRuleFixture()({}).suggestions[0];
  suggestion.reviewBaseline = null;
  suggestion.checks[0].identityGap = 'missingStableProblemLocation';
  suggestion.checks[0].comparison = { status: 'unknown', reason: 'missingBaseline' };
  const html = render(createElement(ReviewFacts, { suggestion, timezone: 'UTC' }));
  assert.match(html, /Original assessment evidence is unavailable|原始检查依据不可用/);
  assert.match(html, /prior records are retained|原有记录仍保留/);
  assert.deepEqual(textChanges(suggestion), []);
});

test('related usage preserves zero, unknown use count, all operation records, and the core total outside a page', () => {
  const result = configFixture({ action: 'evidence', itemId: 'preview-skill', limit: 2 });
  const props = { result, route: parseRoute('?timezone=UTC'), navigate() {}, onPage() {} };
  let html = render(createElement(RelatedUsageContent, props));
  assert.match(html, /3 次使用|3 uses/);
  assert.equal((html.match(/class="config-evidence"/g) ?? []).length, 2);
  assert.match(html, /Failed|失败/);
  const zero = structuredClone(result); zero.items[0].usageCount = 0; zero.evidence = [];
  html = render(createElement(RelatedUsageContent, { ...props, result: zero }));
  assert.match(html, /0 次使用|0 uses/); assert.match(html, /No related records observed|未观察到关联记录/);
  const unknown = structuredClone(result); unknown.items[0].usageCount = null;
  html = render(createElement(RelatedUsageContent, { ...props, result: unknown }));
  assert.doesNotMatch(html, /3 次使用|3 uses|No related records observed|未观察到关联记录/);
  assert.equal((html.match(/class="config-evidence"/g) ?? []).length, 2);
});

test('preview uses the production public validator for upgrade, missing-evidence, and resolved decisions and redisplay', async () => {
  for (const scenario of ['resolved', 'rule-upgraded', 'evidence-gap'] as const) {
    const raw = createPreviewClient(scenario);
    const client = createUsageClient({ query: raw.query, prices: raw.prices, optimize: raw.optimize });
    await client.optimize!({ action: 'keep', suggestionId: 'preview-suggestion', decisionReason: 'necessary' });
    const checked = await client.optimize!({ action: 'recheck', suggestionId: 'preview-suggestion' });
    assert.equal(checked.suggestions[0].decision?.kind, 'keep');
    assert.deepEqual(checked.checks, checked.suggestions[0].checks);
    assert.equal(checked.suggestions[0].checks[0].comparison.status, scenario === 'resolved' ? 'comparable' : scenario === 'rule-upgraded' ? 'incomparable' : 'unknown');
    const displayed = await client.optimize!({ action: 'redisplay', suggestionId: 'preview-suggestion' });
    assert.equal(displayed.suggestions[0].decision, null);
    assert.equal(displayed.suggestions[0].checks[0].comparison.status, checked.suggestions[0].checks[0].comparison.status);
  }
});

test('all measurement variants and stable reasons use readable fields while unknown codes stay in technical details', () => {
  const base = createRuleFixture()({}).checks[0];
  const checks = [
    { ...base, rule: 'missingInstruction', basis: { ...base.basis, measurement: { kind: 'existence' as const, configuredState: 'missing', measurementStatus: 'missing', missing: true } } },
    { ...base, rule: 'skillFormat', basis: { ...base.basis, measurement: { kind: 'skill_metadata' as const, status: 'invalid', issues: ['descriptionMissing'] } } },
    { ...base, rule: 'localReference', basis: { ...base.basis, measurement: { kind: 'static' as const, complete: false, findings: 0 } } },
    { ...base, rule: 'skillInactivity', reason: 'continuousCoverageUnavailable', basis: { ...base.basis, measurement: { kind: 'unsupported' as const, reason: 'continuousCoverageUnavailable' } } },
    { ...base, comparison: { status: 'incomparable' as const, reason: 'ruleParametersOrMethodChanged' }, identityGap: 'scopeIdentityBudgetExceeded', basis: { ...base.basis, gaps: ['scopeIdentityBudgetExceeded', 'syntheticFutureReason'] } },
  ];
  const saved = locale.getSnapshot().locale;
  try {
    for (const language of ['zh', 'en'] as const) {
      locale.setLocale(language);
      const html = render(createElement(AssessmentRows, { checks, timezone: 'UTC' }));
      assert.match(html, language === 'zh' ? /授权范围内确认缺失/ : /Confirmed absent within the authorized scope/);
      assert.match(html, language === 'zh' ? /格式无效/ : /Invalid format/);
      assert.match(html, language === 'zh' ? /检查不完整/ : /Check incomplete/);
      assert.match(html, /(?:发现数|Findings): 0<\/p>/);
      assert.match(html, language === 'zh' ? /达到资源上限/ : /reached a resource limit/);
      assert.match(html, language === 'zh' ? /规则、参数或方法版本已变化/ : /Rule, parameter, or method versions changed/);
      const readable = html.replace(/<details class="provenance"><summary>(?:技术详情|Technical details)<\/summary>.*?<\/details>/g, '');
      assert.doesNotMatch(readable, /syntheticFutureReason|scopeIdentityBudgetExceeded|ruleParametersOrMethodChanged|&quot;kind&quot;/);
      assert.match(html, /syntheticFutureReason/);
    }
  } finally { locale.setLocale(saved); }
});

test('a reminder suppressed by the standard maximum explains why its over-threshold measurement is a miss', () => {
  const check = createRuleFixture()({}).checks[0];
  check.rule = 'descriptionSize'; check.outcome = 'miss'; check.findings = [];
  check.basis.measurement = { kind: 'numeric', basis: 'productReminder', observed: 1025, threshold: 500, inclusive: false, standardMax: 1024, suppressedByStandard: true };
  const saved = locale.getSnapshot().locale;
  try {
    for (const language of ['zh', 'en'] as const) {
      locale.setLocale(language);
      const html = render(createElement(AssessmentRows, { checks: [check], timezone: 'UTC' }));
      assert.match(html, /1,025/); assert.match(html, /1,024/); assert.match(html, /&gt; 500/);
      assert.match(html, language === 'zh' ? /未发现问题/ : /No issue found/);
      assert.match(html, language === 'zh' ? /已由规范上限检查处理，不重复提醒/ : /Addressed by the standard-maximum check; this reminder is not repeated/);
    }
  } finally { locale.setLocale(saved); }
});


test('non-numerical or incomparable rechecks retain typed status and reason without a misleading missing-comparison table',()=>{
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
  const incomparable=createRuleFixture(false,'incomparable')({action:'recheck'}).suggestions[0];
  assert.equal(incomparable.checks[0].comparison.status,'incomparable');
  assert.equal(render(createElement(TextChanges,{suggestion:incomparable})), '');
  const facts=render(createElement(ReviewFacts,{suggestion:incomparable,timezone:'UTC'}));
  assert.ok(facts.includes(t('optimize.assessment.comparison.incomparable')));
  assert.ok(facts.includes(t('optimize.assessment.reason.methodChanged')));
  assert.ok(!facts.includes(t('optimize.comparisonUnknown')));
  const comparable=createRuleFixture()({}).suggestions[0];
  const check=comparable.checks.find(check=>check.rule==='localReference')!;
  const original=comparable.reviewBaseline!.assessments.find(original=>original.rule===check.rule)!;
  assert.equal(check.basis.measurement.kind,'static');
  check.comparison={status:'comparable',baselineAssessmentId:original.assessmentId,reason:null};
  comparable.checks=[check];
  assert.equal(render(createElement(TextChanges,{suggestion:comparable})), '');
  const staticFacts=render(createElement(ReviewFacts,{suggestion:comparable,timezone:'UTC'}));
  assert.ok(staticFacts.includes(t('optimize.assessment.comparison.comparable')));
  assert.ok(!staticFacts.includes(t('optimize.comparisonUnknown')));
 }}finally{locale.setLocale(saved);}
});
