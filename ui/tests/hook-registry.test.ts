import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createUsageClient, type ConfigResult } from '@wombat/client';
import { locale, reviewPresentation } from '@wombat/client/locale';
import { HookRegistry } from '../src/config/HookRegistry.js';
import { createRuleFixture, inventory } from '../src/preview/configuration.js';
test('Hook detail separates project registration, incomplete coverage and runtime evidence in both languages', () => {
  const saved = locale.getSnapshot().locale;
  const registration = { itemId: 'hook', nativeKey: 'key', contentHash: 'file', registrationHash: 'registration', enabled: true, trust: 'trusted' as const, handler: 'command' as const, source: 'plugin', pluginId: 'sample.tools@test' };
  const registry: ConfigResult['hookRegistry'] = { nativeVersion: '0.160.0', checkedAt: '2026-10-04T00:00:00Z', status: 'partial', contexts: [{ project: '/project-a', complete: true, registrations: [registration] }, { project: '/project-b', complete: false, registrations: [{ ...registration, enabled: false, trust: 'modified' }] }] };
  try { for (const language of ['zh', 'en'] as const) {
    locale.setLocale(language);
    const html = renderToStaticMarkup(createElement(HookRegistry, { registry, itemId: 'hook', timezone: 'UTC' }));
    assert.match(html, /project-a/); assert.match(html, /project-b/); assert.match(html, /已启用|Enabled/); assert.match(html, /已禁用|Disabled/);
    assert.match(html, /插件：sample.tools@test|Plugin: sample.tools@test/);
    assert.match(html, /信任后已变化|Changed since trust/); assert.match(html, /覆盖不完整|coverage for this project is incomplete/);
    assert.match(html, /不代表 Hook 已运行|do not prove execution/);
    const unknown = renderToStaticMarkup(createElement(HookRegistry, { registry, itemId: 'unmatched', timezone: 'UTC' }));
    assert.match(unknown, /未观察到不代表已禁用|Not observed does not mean disabled/); assert.doesNotMatch(unknown, /project-a|project-b/);
  } } finally { locale.setLocale(saved); }
});

test('Hook finding shows the affected project and static reference without claiming execution failure', async () => {
  const { Findings } = await import('../src/optimize/Findings.js');
  const saved=locale.getSnapshot().locale;
  const result = createRuleFixture(false, 'unchanged', 'rules-hook', {
    ...inventory[3], id: 'hook', project: null, name: 'SessionStart',
    path: '/source/config.toml', contentHash: 'current',
  })({ action: 'list' });
  const suggestion = result.suggestions[0];
  const finding = suggestion.findings[0];
  assert.ok(finding.evidence?.hook);
  assert.equal(finding.identity.version, 1);
  assert.ok(finding.identity.findingId);
  assert.equal(finding.identity.gap, null);
  finding.basis = 'effectiveTrustedEnabledHookRegistry';
  finding.evidence.hook = {
    ...finding.evidence.hook, project: '/only-affected-project',
    target: './工具 script.py',
  };
  suggestion.checks[0].findings = structuredClone(suggestion.findings);
  assert.ok(suggestion.reviewBaseline);
  suggestion.reviewBaseline.assessments[0].findings = structuredClone(suggestion.findings);
  const client = createUsageClient({
    query: async () => { throw new Error('Unexpected usage query'); },
    optimize: async () => result,
  });
  assert.deepEqual((await client.optimize!({ action: 'list' })).suggestions[0], suggestion);
  try {for(const language of ['zh','en'] as const){locale.setLocale(language);assert.match(reviewPresentation(suggestion).title,/脚本引用|script reference/);const html=renderToStaticMarkup(createElement(Findings,{suggestion}));assert.match(html,/only-affected-project/);assert.match(html,/工具 script.py/);assert.match(html,/不代表已观察到运行失败|not an observed execution failure/);assert.doesNotMatch(html,/用户声明|user-declared|referenceTargetMissing/i);}}
  finally {locale.setLocale(saved);}
});
