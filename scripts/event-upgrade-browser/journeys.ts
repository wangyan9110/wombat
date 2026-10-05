import assert from 'node:assert/strict';
import { locale, t, type MessageKey } from '@wombat/client/locale';
import type { Page, Locator, Request } from './playwright.ts';
import { record, shareWhitelist } from './policy.ts';
import { privateBody, title, nativeThread, nativeTurn, type Fixture } from './fixture.ts';

export type Language = 'zh' | 'en';
export interface Case { source: 'production' | 'preview'; language: Language; width: number; journeys: string[] }
type PlainKey = { [K in MessageKey]: Parameters<typeof t<K>> extends [K] ? K : never }[MessageKey];
const label = (key: PlainKey) => t(key);
const region = (page: Page, key: PlainKey) => page.getByRole('region', { name: label(key), exact: true });
const execution = (page: Page) => region(page, 'execution.title');
const uses = (page: Page) => region(page, 'execution.uses');
async function activate(item: Locator) { await item.waitFor(); await item.focus(); await item.press('Enter'); }
async function details(page: Page, key: PlainKey) { await activate(page.locator('summary').filter({ hasText: label(key) }).first()); }
async function text(item: Locator, expected: string) { await item.filter({ hasText: expected }).waitFor(); assert.ok((await item.innerText()).includes(expected), `Expected DOM text ${expected}`); }
async function overflow(page: Page) { assert.equal(await page.evaluate<boolean>('document.documentElement.scrollWidth > innerWidth + 1'), false, 'Horizontal document overflow'); }
async function waitCount(page: Page, selector: string, count: number) {
  await page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length === count, { selector, count });
}
async function settled(page: Page) {
  await page.waitForFunction(() => !document.querySelector('main [inert]') && !document.querySelector('.task-turns .execution[aria-busy="true"]'));
}
export function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => { if (errors.length < 20) errors.push(error.message.slice(0, 1000)); });
  page.on('console', message => {
    if (message.type() !== 'error' || errors.length >= 20) return;
    let location = ''; try { location = new URL(message.location().url).pathname; } catch { /* Browser-origin errors may have no URL. */ }
    errors.push((message.text() + (location ? ` (${location})` : '')).slice(0, 1000));
  });
  return errors;
}
export function timingRequests(page: Page): Record<string, unknown>[] {
  const requests: Record<string, unknown>[] = [];
  page.on('request', (request: Request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/timing') return;
    const body = request.postDataJSON();
    // Assertions run in the awaited journey, never escape an event callback.
    if (!record(body)) { requests.push({ invalid: true }); return; }
    if (requests.length >= 1000) { requests[999] = { exceeded: true }; return; } requests.push(body);
  });
  return requests;
}
function bound(requests: Record<string, unknown>[], snapshot: string, thread: string, turn: string, source: string): void {
  assert.ok(requests.length > 0);
  for (const request of requests) {
    if (request.action === 'capabilities') continue;
    assert.equal(request.snapshotId, snapshot); assert.equal(request.threadId, thread); assert.equal(request.turnId, turn);
    assert.ok(!('roots' in request)); assert.ok(!('projectRoots' in request));
    if (request.collection === 'use_records' || request.collection === 'use_objects') {
      assert.ok(record(request.scope)); assert.equal(request.scope.sourceInstanceId, source);
    }
  }
}
async function metric(page: Page, selector: string, name: string): Promise<string> {
  return page.evaluate<string>(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});const dt=[...(root?.querySelectorAll('dt')??[])].find(e=>e.textContent?.trim()===${JSON.stringify(name)});if(!dt)throw Error('Metric not found');return dt.nextElementSibling?.textContent?.trim()??'';})()`);
}
async function share(page: Page, sensitive: string[]) {
  await activate(execution(page).getByRole('button', { name: label('execution.share'), exact: true }));
  const dialog = page.locator('dialog.execution-share'); await dialog.waitFor();
  const shared: unknown = JSON.parse(await dialog.locator('pre').innerText()); shareWhitelist(shared, sensitive);
  await activate(dialog.getByRole('button', { name: label('execution.copy'), exact: true }));
  await page.waitForFunction(expected => document.querySelector('dialog.execution-share [role="status"]')?.textContent === expected, label('execution.copied'));
  const copied = await page.evaluate<string>('navigator.clipboard.readText()'); assert.deepEqual(JSON.parse(copied), shared);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate<string>('document.activeElement?.textContent?.trim()??""'), label('execution.share'));
  return shared;
}
export async function product(page: Page, fixture: Fixture, language: Language, width: number): Promise<Case> {
  locale.setLocale(language); await page.setViewportSize({ width, height: 900 });
  await fixture.reset(); const oracle = await fixture.current();
  assert.equal(oracle.time.command.unionMs.value, 50_000); assert.equal(oracle.time.command.sumMs.value, 60_000);
  assert.equal(oracle.time.nativeTtftMs.value, 0); assert.equal(oracle.work.operationCandidates.value, 7);
  const requests = timingRequests(page), errors = pageErrors(page);
  const url = new URL(fixture.product); url.search = new URLSearchParams({ page: 'threads', allTime: '1', timezone: 'UTC', sort: 'tokens', search: 'Synthetic browser task' }).toString();
  const fragment = new URLSearchParams(url.hash.slice(1)); fragment.set('lang', language); url.hash = fragment.toString();
  await page.goto(url.href); await page.locator('.thread-row').first().waitFor();
  await activate(page.locator('.thread-row').first()); await page.locator('.turn[open]').waitFor(); await execution(page).waitFor();
  await settled(page);
  await text(page.locator('.task-detail h2'), title);
  await text(page.locator('.turn[open] > summary .token-number'), '110');
  if (width <= 760) await activate(page.locator('.task-return')); else await page.goBack();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('thread'));
  await settled(page);
  assert.equal(new URL(page.url()).searchParams.get('search'), 'Synthetic browser task'); assert.equal(new URL(page.url()).searchParams.get('sort'), 'tokens');
  await page.waitForFunction(() => document.activeElement?.classList.contains('thread-row'));
  await activate(page.locator('.thread-row').first()); await execution(page).waitFor();
  await settled(page);

  await details(page, 'execution.distribution'); await text(execution(page), label('execution.concurrent'));
  assert.equal(await metric(page, '.turn[open] .execution', label('execution.category.command')), t('execution.unionSum', { union: '50000 ms', sum: '60000 ms' }));
  await activate(page.locator(width <= 760 ? '.execution-list button' : '.execution-track button').first()); await page.locator('aside.execution-evidence').waitFor();
  await text(page.locator('aside.execution-evidence'), label('execution.wholeTurn'));
  await activate(page.locator('aside.execution-evidence').getByRole('button', { name: label('execution.closeEvidence'), exact: true }));

  const skill = uses(page).locator('article').filter({ hasText: fixture.skill }).first(); await skill.waitFor();
  assert.equal(await metric(page, `section[aria-label=${JSON.stringify(label('execution.uses'))}] article`, label('execution.useCount')), '3');
  await text(uses(page), label('execution.useNote')); await activate(skill.getByRole('button', { name: label('execution.useEvidence'), exact: true }));
  const records = uses(page).locator('aside.execution-evidence'); await records.locator('article').first().waitFor();
  assert.equal(await records.locator('article').count(), 3); await text(records, label('execution.useOutcome.failed'));
  assert.equal(await skill.locator('dd').first().innerText(), '3');
  await activate(records.getByRole('button', { name: label('execution.closeEvidence'), exact: true }));

  await details(page, 'execution.moreMetrics'); const ttft = await metric(page, '.turn[open] .execution', label('execution.nativeTtft'));
  assert.ok(ttft.startsWith('0 ms')); assert.ok(ttft.includes(label('execution.evidence')));
  await text(page.locator('.work-facts'), label('execution.work.unknown')); // No repository baseline: line counts are unknown.
  const summaryRequest = requests.find(request => request.action === 'summary' && request.privacyProfile === 'local'); assert.ok(summaryRequest);
  assert.equal(typeof summaryRequest.snapshotId, 'string'); assert.equal(typeof summaryRequest.threadId, 'string'); assert.equal(typeof summaryRequest.turnId, 'string');
  const before = String(summaryRequest.snapshotId), thread = String(summaryRequest.threadId), turn = String(summaryRequest.turnId);
  const shared = await share(page, [fixture.dir, privateBody, title, nativeThread, nativeTurn, 'synthetic-browser-command-one', 'synthetic-browser-server', 'synthetic-browser-tool']);
  assert.ok(record(shared) && record(shared.uses) && record(shared.uses.recordCount)); assert.equal(shared.uses.recordCount.value, 4);
  bound(requests, before, thread, turn, oracle.scope.sourceInstanceId); await overflow(page);

  await fixture.append(); const next = await fixture.current(); assert.notEqual(next.readView.snapshotId, before);
  assert.equal(next.uses.objects.find(object => object.kind === 'skill')?.useCount.value, 4);
  assert.equal(next.work.operationCandidates.value, 8);
  // Existing group remains readable until the explicit application of new data.
  assert.equal(await skill.locator('dd').first().innerText(), '3');
  await page.getByRole('button', { name: label('webui.applyUpdates'), exact: true }).waitFor();
  await activate(page.getByRole('button', { name: label('webui.applyUpdates'), exact: true }));
  await page.waitForFunction(() => document.querySelector('.turn[open] > summary .token-number')?.getAttribute('title') === '220 Token');
  await page.waitForFunction(({ selector, skill }) => [...document.querySelectorAll(selector)].find(article => article.textContent?.includes(skill))?.querySelector('dd')?.textContent === '4', { selector: `section[aria-label=${JSON.stringify(label('execution.uses'))}] article`, skill: fixture.skill });
  await execution(page).getByRole('button', { name: label('execution.share'), exact: true }).waitFor();
  const refreshed = await share(page, [fixture.dir, privateBody, title, nativeThread, nativeTurn]);
  assert.ok(record(refreshed) && record(refreshed.uses) && record(refreshed.uses.recordCount)); assert.equal(refreshed.uses.recordCount.value, 5);
  const latest = requests.filter(request => request.action === 'summary' && request.privacyProfile === 'local').at(-1); assert.ok(latest); assert.notEqual(latest.snapshotId, before);
  const afterIndex = requests.indexOf(latest); bound(requests.slice(afterIndex), String(latest.snapshotId), thread, turn, next.scope.sourceInstanceId);
  assert.deepEqual(errors, []); await overflow(page);
  return { source: 'production', language, width, journeys: ['find-return-keyboard', 'parallel-union-sum', 'three-uses-including-failure', 'zero-versus-unrecorded', 'append-explicit-refresh-share-fixed-group'] };
}

export async function previews(page: Page, origin: string, language: Language, width: number): Promise<Case> {
  locale.setLocale(language); await page.setViewportSize({ width, height: 900 }); const errors = pageErrors(page);
  await page.goto(origin + `/preview.html?previewModule=execution&lang=${language}`);
  await text(page.locator('#preview-controls'), label('preview.title')); await execution(page).waitFor();
  const scenario = page.getByRole('combobox', { name: label('preview.scenario'), exact: true });
  await details(page, 'execution.distribution'); await text(execution(page), label('execution.concurrent')); await overflow(page);
  const skill = uses(page).locator('article').filter({ hasText: 'SKILL.md' }).first(); await skill.waitFor();
  assert.equal(await skill.locator('dd').first().innerText(), '3');
  assert.equal(await skill.locator('dd').nth(3).innerText(), '0');
  assert.equal(await uses(page).locator('article').nth(1).locator('dd').first().innerText(), label('execution.missing'));
  await activate(skill.getByRole('button', { name: label('execution.useEvidence'), exact: true }));
  await uses(page).locator('aside article').first().waitFor(); await text(uses(page).locator('aside'), label('execution.useOutcome.failed'));
  await activate(uses(page).locator('aside').getByRole('button', { name: label('execution.closeEvidence'), exact: true }));

  await scenario.selectOption('missing'); await execution(page).waitFor(); await text(execution(page), label('execution.missing'));
  assert.equal(await page.locator('.execution-track button').count(), 0);
  await scenario.selectOption('running'); await text(execution(page), label('execution.running')); await text(execution(page), label('execution.timeGap'));
  await scenario.selectOption('empty');
  await waitCount(page, `section[aria-label=${JSON.stringify(label('execution.uses'))}]`, 0);
  await text(execution(page), label('execution.missing'));
  await scenario.selectOption('uses-failure'); await uses(page).locator('article').first().waitFor();
  await activate(uses(page).locator('article').first().getByRole('button', { name: label('execution.useEvidence'), exact: true }));
  await uses(page).getByRole('alert').waitFor(); await text(execution(page), '10000 ms'); assert.equal(await uses(page).locator('article dd').first().innerText(), '3');
  await scenario.selectOption('uses-expired'); await uses(page).locator('article').first().waitFor();
  await activate(uses(page).locator('article').first().getByRole('button', { name: label('execution.useEvidence'), exact: true }));
  await uses(page).getByRole('alert').waitFor();
  assert.equal(await uses(page).locator('article').first().getByRole('button', { name: label('execution.useEvidence'), exact: true }).isEnabled(), false);
  assert.equal(await execution(page).getByRole('button', { name: label('execution.share'), exact: true }).isEnabled(), false);
  await activate(execution(page).getByRole('button', { name: label('execution.refresh'), exact: true }));
  await page.waitForFunction(selector => document.querySelector<HTMLButtonElement>(selector)?.disabled === false, `section[aria-label=${JSON.stringify(label('execution.uses'))}] article button`);

  await scenario.selectOption('dense'); await uses(page).locator('article').first().waitFor();
  await waitCount(page, `section[aria-label=${JSON.stringify(label('execution.uses'))}] > article`, 50);
  assert.equal(await uses(page).locator(':scope > article').count(), 50);
  await activate(uses(page).getByRole('button', { name: label('execution.nextUseObjects'), exact: true }));
  await waitCount(page, `section[aria-label=${JSON.stringify(label('execution.uses'))}] > article`, 3);
  assert.equal(await metric(page, `section[aria-label=${JSON.stringify(label('execution.uses'))}]`, label('execution.useObjectCount')), '53');
  await activate(uses(page).getByRole('button', { name: label('execution.firstUseObjects'), exact: true }));
  await activate(uses(page).locator('article').first().getByRole('button', { name: label('execution.useEvidence'), exact: true }));
  await waitCount(page, `section[aria-label=${JSON.stringify(label('execution.uses'))}] aside article`, 200);
  assert.equal(await uses(page).locator('aside article').count(), 200);
  const firstReference = await uses(page).locator('aside article details code').first().innerText();
  await activate(uses(page).locator('aside').getByRole('button', { name: label('execution.nextEvidence'), exact: true }));
  await page.waitForFunction(({ selector, previous }) => document.querySelector(selector)?.textContent !== previous, { selector: `section[aria-label=${JSON.stringify(label('execution.uses'))}] aside article details code`, previous: firstReference });
  await waitCount(page, `section[aria-label=${JSON.stringify(label('execution.uses'))}] aside article`, 14);
  await text(uses(page).locator('aside'), '214');
  await overflow(page); await page.keyboard.press('Tab'); assert.ok(await page.evaluate<boolean>('document.activeElement !== document.body'));

  // Application preview exercises production App navigation separately from
  // real-core acceptance above.
  await page.goto(origin + `/preview.html?page=threads&allTime=1&lang=${language}`);
  await page.locator('.thread-row').first().waitFor(); await activate(page.locator('.thread-row').first()); await page.locator('.turn[open]').waitFor();
  await settled(page);
  if (width <= 760) await activate(page.locator('.task-return')); else await page.goBack();
  await page.locator('.thread-row').first().waitFor();
  await overflow(page); assert.deepEqual(errors, []);
  return { source: 'preview', language, width, journeys: ['production-App-return', 'parallel-explanation-presentation-only', 'uses-failure-expiry-refresh', 'zero-missing-running', 'dense-object-and-record-pages-keyboard'] };
}
