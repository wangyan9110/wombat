/** Real installed runtime, native plugin manager, browser and optional native model journey. */
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, realpathSync, rmSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {onboardingOptions, commandMentionsExecutable} from './verify-onboarding-options.ts';
import {assertExternalOutputDir, runBoundedCommand, stdoutFromLog, terminateTree} from './verify-e2e-helpers.ts';
import {checkBuild, sourceIdentity} from './build-identity.ts';
import {playwright, type Browser, type BrowserServer} from './event-upgrade-browser/playwright.ts';
import {agentMetrics} from './verify-agent-query.ts';
import {nativeSessionId} from './verify-skill-conversation-helpers.ts';
import {cleanupOnboardingCores} from './onboarding-cleanup.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = onboardingOptions(process.argv.slice(2));
if (process.platform === 'win32') throw new Error('This POSIX installer journey requires macOS or Linux; Windows acceptance is separate');
checkBuild(repo);
const output = assertExternalOutputDir(repo, options.output);
if (existsSync(output) && readdirSync(output).length) throw new Error('Choose a fresh empty --output-dir; previous evidence is preserved');
mkdirSync(output, {recursive: true, mode: 0o700});
const work = path.join(output, 'fixture'), prefix = path.join(work, "安装 & runtime '"), home = path.join(work, 'codex'), data = path.join(work, 'data'), project = path.join(work, "项目 with ' quote");
mkdirSync(path.join(home, 'sessions'), {recursive: true}); mkdirSync(project, {recursive: true});
const source = realpathSync(home), cwd = realpathSync(project), agentEnv = {...process.env};
const env = {...process.env, PATH: '/usr/bin:/bin', CODEX_HOME: source, WOMBAT_DATA_HOME: data,
  WOMBAT_CODEX_BIN: options.codex, WOMBAT_CORE_BIN: '', WOMBAT_AUTO_PRICES: '0', WOMBAT_LANG: 'en'};
const launcher = path.join(prefix, 'bin/wombat'), installer = path.join(repo, 'scripts/install/install.sh');
const report: {status: string; sourceSha256: string; platform: string; checks: unknown[]; boundaries: string[]; failure?: string; completedAt?: string} = {
  status: 'running', sourceSha256: sourceIdentity(repo), platform: process.platform+'-'+process.arch, checks: [],
  boundaries: ['Real local candidate archive and native plugin installation; only independent synthetic usage is queried.',
    'Optional model sessions retain the current authentication profile; runtime queries are restricted to synthetic source and data. No credentials are read or copied.',
    'Browser acceptance uses installed production assets, two languages and desktop/narrow layouts. No Hook trust changes or publication. Other platforms and large-history performance remain separate.']};
const save = () => writeFileSync(path.join(output, 'onboarding-report.json'), JSON.stringify(report, null, 2)+'\n', {mode: 0o600});
const pass = (name: string, evidence: unknown = {}) => {report.checks.push({name, status: 'passed', evidence}); save(); console.log(JSON.stringify({stage: name, status: 'passed'}));};
const cancel = new AbortController(), onCancel = () => cancel.abort();
process.once('SIGINT', onCancel); process.once('SIGTERM', onCancel);
const deadline = setTimeout(onCancel, 12*60_000);
let web: ChildProcess | undefined, browser: Browser | undefined, server: BrowserServer | undefined;
save();
const run = async (name: string, command: string[], commandEnv: NodeJS.ProcessEnv = env, timeoutMs = 120_000) => {
  const log = path.join(output, name+'.log');
  const result = await runBoundedCommand({command, cwd, env: commandEnv, logFile: log, timeoutMs, maxBytes: 4*1024*1024, signal: cancel.signal});
  assert.equal(result.exitCode, 0, `${name}: ${JSON.stringify(result)}`);
  assert.ok(!result.timedOut && !result.outputLimit && !result.interrupted && !result.closeTimedOut && !result.spawnError && !result.logError, name);
  return stdoutFromLog(readFileSync(log, 'utf8')).trim();
};
const start = async (command: string[]) => {
  const started = performance.now(); let text = '';
  web = spawn(command[0], command.slice(1), {cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  const child = web, log = path.join(output, 'web-start-'+report.checks.length+'.log');
  const capture = (chunk: Buffer) => {
    if (Buffer.byteLength(text)+chunk.length > 2*1024*1024) {child.kill('SIGTERM'); return;}
    text += chunk.toString(); writeFileSync(log, text, {mode: 0o600});
  };
  child.stdout!.on('data', capture); child.stderr!.on('data', capture);
  let spawnError: Error | undefined; child.once('error', error => {spawnError = error;});
  const until = Date.now()+60_000;
  for (;;) {
    cancel.signal.throwIfAborted();
    const url = text.match(/https?:\/\/127\.0\.0\.1:\d+\/[^\s"<>]*/)?.[0];
    if (url) return {url, startupMs: Math.round(performance.now()-started)};
    if (spawnError || child.exitCode !== null || child.signalCode !== null || Date.now()>until) throw new Error('Installed Web failed to start; inspect '+log);
    await delay(50, undefined, {signal: cancel.signal});
  }
};
const closeWeb = async () => {if (web) assert.ok(await terminateTree(web), 'Web process tree did not stop'); web = undefined;};
const fixtureFile = path.join(source, 'sessions/synthetic.jsonl');
const timestamp = new Date().toISOString();
const record = (response: string, tokens: number) => JSON.stringify({timestamp, type: 'event_msg', payload: {
  type: 'token_usage_record', thread_id: 'onboarding', turn_id: 'turn', response_id: response,
  usage: {input_tokens: tokens-10, cached_input_tokens: 0, output_tokens: 10, total_tokens: tokens}}})+'\n';
const sourceBody = [JSON.stringify({timestamp, type: 'session_meta', payload: {id: 'onboarding', cwd}}),
  JSON.stringify({timestamp, type: 'turn_context', payload: {turn_id: 'turn', model: 'gpt-5.4'}})].join('\n')+'\n'+record('one', 110);
const api = async (url: string, method: string, body: unknown) => {
  const parsed = new URL(url), token = new URLSearchParams(parsed.hash.slice(1)).get('token'); assert.ok(token);
  const response = await fetch(parsed.origin+'/api/'+method, {method: 'POST', signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(15_000)]),
    headers: {Origin: parsed.origin, Authorization: 'Bearer '+token, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  assert.equal(response.status, 200);
  const frame = (await response.text()).trim().split('\n').map(row => JSON.parse(row)).at(-1);
  assert.equal(frame.type, 'result', JSON.stringify(frame)); return frame.value;
};
try {
  const installed = await start(['/bin/sh', installer, '--prefix', prefix, '--base-url', pathToFileURL(options.release).href, '--no-modify-path', '--plugin', '--open']);
  const id = readFileSync(path.join(prefix, 'lib/wombat/current.txt'), 'utf8').trim(), destination = path.join(prefix, 'lib/wombat/versions', id);
  const release = JSON.parse(readFileSync(path.join(destination, 'release.json'), 'utf8'));
  assert.equal(release.sourceSha256, report.sourceSha256);
  const version = JSON.parse(await run('bundled-no-system-runtime', ['/usr/bin/env', 'PATH=', launcher, '--version', '--json']));
  assert.equal(version.version, release.version);
  const setup = JSON.parse(await run('native-discovery', [launcher, 'setup', '--project', cwd, '--json']));
  assert.equal(setup.discovery.status, 'available'); assert.equal(setup.discovery.instances[0].name, 'wombat:wombat');
  assert.equal(setup.runtimeChecks[0].status, 'compatible');
  pass('fresh-install-plugin-and-open', {release, startupMs: installed.startupMs, invocation: 'wombat:wombat', noSystemNodeOrRust: true});
  const pw = await playwright(options.playwright);
  server = await pw.chromium.launchServer({headless: true, executablePath: options.browser, timeout: 20_000});
  browser = await pw.chromium.connect(server.wsEndpoint(), {timeout: 15_000});
  const empty = await api(installed.url, 'live', {query: {action: 'usage', scope: {allTime: true}}, mode: 'fresh'});
  assert.equal(empty.result.summary.measurementCount, 0);
  for (const language of ['zh', 'en']) for (const width of [390, 1440]) {
    const context = await browser.newContext({viewport: {width, height: 900}}), page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(15_000);
    try {
      const url = new URL(installed.url), fragment = new URLSearchParams(url.hash.slice(1)); fragment.set('lang', language); url.hash = fragment.toString(); url.search = '?allTime=1&timezone=UTC';
      await page.goto(url.href); await page.locator('.empty h2').waitFor();
      assert.equal(await page.evaluate('document.documentElement.lang'), language);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true);
      assert.deepEqual(errors, []); pass(`empty-${language}-${width}`);
    } finally {await context.close();}
  }
  writeFileSync(fixtureFile, sourceBody);
  const first = await api(installed.url, 'live', {query: {action: 'usage', scope: {allTime: true}}, mode: 'fresh'});
  assert.equal(first.result.summary.tokens.total, 110);
  for (const language of ['zh', 'en']) for (const width of [390, 1440]) {
    const context = await browser.newContext({viewport: {width, height: 900}}), page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15_000);
    try {
      const url = new URL(installed.url), fragment = new URLSearchParams(url.hash.slice(1)); fragment.set('lang', language); url.hash = fragment.toString(); url.search = '?page=threads&allTime=1&timezone=UTC';
      await page.goto(url.href); await page.locator('.thread-row').first().waitFor(); await page.locator('.thread-row').first().click();
      await page.waitForFunction(() => document.querySelector('.turn[open] > summary .token-number')?.getAttribute('title') === '110 Token');
      if (width <= 760) await page.locator('.task-return').click(); else await page.goBack();
      await page.reload(); await page.locator('.thread-row').first().waitFor();
      assert.equal(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true);
      assert.deepEqual(errors, []); pass(`task-drilldown-return-reload-${language}-${width}`);
    } finally {await context.close();}
  }
  const updateContext = await browser.newContext({viewport: {width: 390, height: 900}}), updatePage = await updateContext.newPage();
  updatePage.setDefaultTimeout(15_000);
  const updateUrl = new URL(installed.url); updateUrl.search = '?page=threads&allTime=1&timezone=UTC';
  await updatePage.goto(updateUrl.href); await updatePage.locator('.thread-row').first().waitFor(); await updatePage.locator('.thread-row').first().click();
  await updatePage.waitForFunction(() => document.querySelector('.task-detail > p.subtle .token-value')?.getAttribute('title') === '110 Token');
  appendFileSync(fixtureFile, record('two', 220));
  const updated = await api(installed.url, 'live', {query: {action: 'usage', scope: {allTime: true}}, mode: 'fresh'});
  assert.equal(updated.result.summary.tokens.total, 330); assert.notEqual(updated.result.snapshotRef.snapshotId, first.result.snapshotRef.snapshotId);
  const fixed = await api(installed.url, 'live', {query: {action: 'usage', snapshotId: first.result.snapshotRef.snapshotId, scope: {allTime: true}}, mode: 'cached'});
  assert.equal(fixed.result.summary.tokens.total, 110);
  await updatePage.locator('.query-scope .scope-actions button').click();
  await updatePage.waitForFunction(() => document.querySelector('.task-detail > p.subtle .token-value')?.getAttribute('title') === '330 Token');
  await updateContext.close();
  pass('append-and-fixed-view', {previous: 110, current: 330});
  await closeWeb(); await assert.rejects(fetch(new URL(installed.url).origin, {signal: AbortSignal.timeout(1000)}));
  const resumed = await start(['/bin/sh', installer, '--prefix', prefix, '--plugin-only', '--open']);
  assert.equal(readFileSync(path.join(prefix, 'lib/wombat/current.txt'), 'utf8').trim(), id);
  assert.equal((await api(resumed.url, 'live', {query: {action: 'usage', scope: {allTime: true}}, mode: 'fresh'})).result.summary.tokens.total, 330);
  pass('plugin-only-open-and-retained-data', {startupMs: resumed.startupMs, sameRuntime: true}); await closeWeb();
  if (options.agentBin) {
    const modelData = path.join(work, 'cold-model-data'), answer = path.join(work, 'answer.json'), schema = path.join(work, 'answer-schema.json');
    writeFileSync(schema, JSON.stringify({type: 'object', additionalProperties: false, required: ['tokens', 'taskId', 'explanation'], properties: {tokens: {type: 'integer'}, taskId: {type: 'string'}, explanation: {type: 'string'}}}));
    const quote = (s: string) => "'"+s.replaceAll("'", "'\\''")+"'";
    const runtime = `CODEX_HOME=${quote(source)} WOMBAT_DATA_HOME=${quote(modelData)} WOMBAT_AUTO_PRICES=0 WOMBAT_CODEX_BIN=${quote(options.codex)} ${quote(launcher)}`;
    const boundary = ` This is an isolated installed-plugin onboarding test. Use the installed $${options.agentSkill} Skill and selected executable ${launcher}. Every runtime call must start with ${runtime}; query only synthetic source ${source} and project ${cwd}. Do not read raw logs, databases, credentials, other projects, or other plugins. No MCP, network tools or delegation. Only return the required JSON with a Chinese explanation. Do not change source files or Hook trust.`;
    const events = await run('installed-plugin-first-question', [options.agentBin, 'exec', '--config', 'mcp_servers={}', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--cd', cwd, '--json', '--output-schema', schema, '--output-last-message', answer,
      `$${options.agentSkill} 我第一次用，请告诉我这个项目全部日期用了多少 Token，哪项任务用量最多？`+boundary], agentEnv, 360_000);
    const firstAnswer = JSON.parse(readFileSync(answer, 'utf8')); assert.equal(firstAnswer.tokens, 330); assert.match(firstAnswer.taskId, /^[0-9a-f]{64}$/); assert.match(firstAnswer.explanation, /[\u3400-\u9fff]/);
    const metrics = agentMetrics(events); assert.equal(metrics.unsupportedToolCalls, 0); assert.ok(metrics.commands.some(c => commandMentionsExecutable(c, launcher)));
    appendFileSync(fixtureFile, record('three', 440));
    const followEvents = await run('installed-plugin-followup', [options.agentBin, 'exec', 'resume', nativeSessionId(events), '--config', 'mcp_servers={}', '--skip-git-repo-check', '--json', '--output-schema', schema, '--output-last-message', answer,
      '刚才这个任务又有了新的用量记录，请更新一下全部日期用量，继续查看同一项任务。'+boundary], agentEnv, 360_000);
    const next = JSON.parse(readFileSync(answer, 'utf8')); assert.equal(next.tokens, 770); assert.equal(next.taskId, firstAnswer.taskId); assert.match(next.explanation, /[\u3400-\u9fff]/);
    const followMetrics = agentMetrics(followEvents); assert.equal(followMetrics.unsupportedToolCalls, 0); assert.ok(followMetrics.commands.some(c => commandMentionsExecutable(c, launcher)));
    assert.equal(readFileSync(fixtureFile, 'utf8'), sourceBody+record('two', 220)+record('three', 440));
    pass('installed-plugin-cold-first-question-and-resume', {first: firstAnswer, followup: next, metrics, followMetrics});
  }
  report.status = 'passed';
} catch (error) {report.status = 'failed'; report.failure = error instanceof Error ? error.stack : String(error); process.exitCode = 1;}
finally {
  try {
    const closes = await Promise.allSettled([browser?.close(), server?.close(), closeWeb()]);
    await cleanupOnboardingCores(prefix,[data,path.join(work,'cold-model-data')]);
    for (const closed of closes) if (closed.status === 'rejected') throw closed.reason;
    pass('owned-process-cleanup');
    rmSync(work, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  } catch (error) {report.status = 'failed'; report.failure = (report.failure ?? '')+'\nCleanup: '+String(error); process.exitCode = 1;}
  clearTimeout(deadline); process.off('SIGINT', onCancel); process.off('SIGTERM', onCancel);
  report.completedAt = new Date().toISOString(); save(); console.log(JSON.stringify({status: report.status, report: path.join(output, 'onboarding-report.json'), failure: report.failure}));
}
