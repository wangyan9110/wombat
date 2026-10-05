import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { locale } from '@wombat/client/locale';
import { timingFixture } from '../src/preview/timing.js';

registerHooks({ load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); } });
const { Execution } = await import('../src/tasks/Execution.js');

test('Work facts SSR preserves zero and explicit source failure while hiding unsupported measures in both locales', () => {
  const previous = locale.getSnapshot().locale;
  try {
    for (const language of ['en', 'zh'] as const) {
      locale.setLocale(language);
      const summary = timingFixture();
      summary.work.operationCandidates = { value: 0, status: 'observed', basis: 'safe_event_count', evidenceRefs: [] };
      summary.work.failedOperations = { value: 2, status: 'observed', basis: 'safe_event_count', evidenceRefs: [] };
      summary.work.fileChangeRecords = { value: 3, status: 'observed', basis: 'safe_event_count', evidenceRefs: [] };
      summary.work.changedFiles = { value: 1, status: 'derived', basis: 'reported_file_paths', evidenceRefs: [] };
      summary.work.addedLines = { value: null, status: 'unavailable', basis: 'missing_repository_baseline', evidenceRefs: [] };
      summary.work.removedLines = { value: null, status: 'unavailable', basis: 'missing_repository_baseline', evidenceRefs: [] };
      summary.work.labelledCommandMs = { value: null, status: 'unavailable', basis: 'unsupported_method', evidenceRefs: [] };
      summary.work.userBoundaryRecords = { value: 4, status: 'observed', basis: 'safe_event_count', evidenceRefs: [] };
      summary.coverage.sourceStatus = 'failed';
      summary.quality.partial = true;
      const html = renderToStaticMarkup(createElement(Execution, { summary, refresh() {}, onEvidence() {}, onShare() {} }));
      const observed = language === 'en' ? 'observed' : '已观察';
      const derived = language === 'en' ? 'derived' : '推导';

      assert.match(html, language === 'en' ? /Work facts/ : /工作事实/);
      assert.ok(html.includes(`0 · ${observed}`));
      assert.ok(html.includes(`2 · ${observed}`));
      assert.ok(html.includes(language === 'en' ? 'The source did not record this measure' : '来源未记录此测量'));
      assert.doesNotMatch(html, language === 'en' ? /Unknown · unavailable ·/ : /未知 · 不可用 ·/);
      assert.ok(html.includes(`1 · ${derived} · ${language === 'en' ? 'Source-reported file paths' : '来源报告的文件路径'}`));
      assert.doesNotMatch(html, language === 'en' ? /Added lines|Removed lines|Command duration by label/ : /新增行数|删除行数|按命令标签归类的时长/);
      assert.ok(html.includes(`4 · ${observed}`));
      assert.ok(html.includes(language === 'en' ? 'Cannot read source' : '无法读取'));
      assert.match(html, /reported_file_paths/);
      assert.match(html, /missing_repository_baseline/);
      assert.match(html, /unsupported_method/);
      assert.match(html, language === 'en' ? /Some source facts are incomplete/ : /部分来源事实尚不完整/);
      assert.match(html, language === 'en' ? /not code defects/ : /不代表代码缺陷/);
    }
  } finally {
    locale.setLocale(previous);
  }
});
