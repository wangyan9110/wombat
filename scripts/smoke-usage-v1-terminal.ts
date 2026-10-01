/** Real POSIX PTY journeys with synthetic Codex logs; no private source reads. */
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Terminal } from './pty-terminal.js';
import { fileSha256, run } from './benchmark-common.js';

assert(process.platform !== 'win32', 'Real PTY journeys require POSIX');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const entry = path.resolve(process.env.WOMBAT_CLI_ENTRY ?? path.join(root, 'dist/wombat.js'));
const nativeCore = path.join(path.dirname(entry), 'native', `${process.platform}-${process.arch}`, 'wombat-core');
const core = existsSync(nativeCore) ? nativeCore : path.join(path.dirname(entry), 'wombat-core');
assert(existsSync(entry), `Missing built CLI: ${entry}`);
const temporary = mkdtempSync(path.join(os.tmpdir(), 'wombat-v1-pty-'));
const checks: object[] = [];
const jsonl = (file: string, rows: object[]) => writeFileSync(file, rows.map(value => JSON.stringify(value)).join('\n') + '\n');
const check = (terminal: Terminal, ...fragments: string[]) => fragments.forEach(value => assert(terminal.text().includes(value), `Expected ${JSON.stringify(value)} in terminal:\n${terminal.text()}`));
async function journey(env: NodeJS.ProcessEnv, columns: number, rows: number, label: string, body: (terminal: Terminal) => Promise<void>, extras: object = {}, args: string[] = [], exit = 0) {
  const terminal = new Terminal(process.execPath, entry, env, columns, rows, args);
  try {
    if (!('distribution' in extras)) {
      await terminal.expect(args.includes('en') ? 'Daily report' : '日报');
      await terminal.key('v');
    }
    await body(terminal);
    await terminal.finish(exit);
    checks.push({ columns, rows, journey: label, terminalRestored: true, alternateScreenRestored: true, cursorRestored: true, ...extras });
  } finally { terminal.close(); }
}
try {
  const codex = path.join(temporary, 'codex');
  const sessions = path.join(codex, 'sessions'); mkdirSync(sessions, { recursive: true });
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const events: object[] = [];
  const event = (type: string, payload: object, second: number) => events.push({ timestamp: `${day}T12:00:${String(second).padStart(2, '0')}Z`, type, payload });
  event('session_meta', { id: 'synthetic-thread', cwd: '/synthetic/project', cli_version: 'synthetic-v1' }, 0);
  event('turn_context', { turn_id: 'synthetic-turn', model: 'gpt-5.4', model_provider: 'openai', effort: 'high' }, 1);
  event('event_msg', { type: 'task_started', turn_id: 'synthetic-turn' }, 2);
  event('response_item', { type: 'function_call', name: 'read_file', call_id: 'synthetic-call', arguments: '{"path":"/synthetic/project/README.md"}' }, 3);
  const usage = { input_tokens: 100_000, cached_input_tokens: 20_000, cache_write_input_tokens: 0, output_tokens: 20_000, reasoning_output_tokens: 3000, total_tokens: 120_000 };
  event('event_msg', { type: 'token_usage_record', thread_id: 'synthetic-thread', turn_id: 'synthetic-turn', response_id: 'synthetic-response', usage }, 4);
  event('event_msg', { type: 'task_complete', turn_id: 'synthetic-turn' }, 5);
  jsonl(path.join(sessions, 'rollout-synthetic.jsonl'), events);
  jsonl(path.join(codex, 'session_index.jsonl'), [{ id: 'synthetic-thread', thread_name: '终端验收样本', updated_at: `${day}T12:01:00Z` }]);
  const env: NodeJS.ProcessEnv = { ...process.env, WOMBAT_AUTO_PRICES: '0', WOMBAT_LANG: 'zh', CODEX_HOME: codex, WOMBAT_DATA_HOME: path.join(temporary, 'data'), TERM: 'xterm-256color', COLORTERM: 'truecolor', WOMBAT_THEME: 'forest' };
  delete env.NO_COLOR;
  const refresh = run(process.execPath, [entry, 'refresh', '--root', codex, '--json'], env);
  const refreshJson = JSON.parse(refresh.stdout);
  await journey(env, 120, 32, '周期按钮及日期单行 → 周报 → 120/80/40 列缩放 → 月报 → 退出', async terminal => {
    await terminal.expect('gpt-5.4');
    const captions = () => assert(terminal.text().split('\n').some(line => ['按天', '按周', '按月'].every(label => line.includes(label))), 'period captions share one line');
    captions();
    await terminal.key('g', '周报');
    const date = terminal.text().split('\n').map(line => line.match(/\d+(?:年\d+)?月\d+日(?:—(?:\d+(?:年\d+)?月)?\d+日)? ›/)?.[0]).find(Boolean);
    assert(date, 'complete weekly date is visible');
    for (const columns of [80, 40, 120]) {
      await terminal.resize(columns, 32, '周报');
      await terminal.key(''); await terminal.expect(date); captions();
    }
    await terminal.key('g', '月报'); captions();
    const month = terminal.text().split('\n').map(line => line.match(/\d+月 ›/)?.[0]).find(Boolean);
    assert(month, 'complete monthly date is visible');
    await terminal.resize(40, 32, '月报');
    await terminal.key(''); await terminal.expect(month); captions();
    await terminal.key('q');
  }, { periodCaptionsSingleLine: true, dateRangesSingleLineAfterResize: true });
  for (const [columns, rows] of [[40, 24], [80, 24], [120, 32]]) {
    await journey(env, columns, rows, 'English launch → Chinese → English → weekly report → source title → filters → quit', async terminal => {
      await terminal.expect('Daily report'); await terminal.key('l', '日报'); await terminal.key('l', 'Daily report');
      await terminal.key('g', 'Weekly report'); await terminal.key('2', 'Threads'); await terminal.expect('终端验收样本');
      await terminal.key('f', 'Filters'); await terminal.key('\x1b', 'Threads'); await terminal.key('q');
    }, {}, ['--lang', 'en']);
  }
  for (const [columns, rows] of [[40, 14], [80, 24], [120, 32]]) {
    await journey(env, columns, rows, '用量 → 对话 → 轮次展开 → 按Token排序 → 分类费用 → 返回 → 切换入口 → 退出', async terminal => {
      await terminal.expect('Wombat'); await terminal.expect('Token');
      await terminal.key('\t', '对话'); await terminal.key('\r', '第 1 轮'); await terminal.key('\r', '时间顺序');
      await terminal.key('\x1b[B'); await terminal.key('\r', '消耗优先'); await terminal.key('\x1b[B'); await terminal.key('\r', '非缓存输入');
      await terminal.key('\x1b', '对话'); await terminal.key('\t', '日报'); await terminal.key('q');
    }, {}, [], refreshJson.quality.status === 'partial' ? 2 : 0);
  }
  await journey(env, 80, 24, 'U 查看完整价表 → 展开模型 → S 切换档位 → N/P 翻页 → Esc 返回用量 → 退出', async terminal => {
    await terminal.expect('gpt-5.4'); await terminal.key('u', '价格表'); await terminal.expect('缓存读取');
    // The two-row brand keeps the source mask legible. In this 24-row window,
    // verify the price action remains reachable through the native body scroll.
    await terminal.key('\x1b[<65;10;18M', '联网更新价表');
    await terminal.key('\x1b[<64;10;18M', '缓存读取');
    await terminal.key('\r', '别名'); await terminal.key('s', '长上下文价格');
    await terminal.key('s', '标准价格'); await terminal.key('n', '第 2 /'); await terminal.key('p', '第 1 /');
    await terminal.key('\x1b', 'gpt-5.4'); check(terminal, '12万', '$0.51'); await terminal.key('q');
  }, { priceDialogPreservesSnapshot: true });
  await journey(env, 80, 24, 'F 时间今天 → Esc 取消保留原结果 → F 时间今天 → A 应用空结果 → 近30天恢复结果 → 退出', async terminal => {
    await terminal.expect('gpt-5.4');
    await terminal.key('f', '筛选'); await terminal.key('\r', '本月'); await terminal.key('\x1b[B'); await terminal.key('\r', '今天');
    check(terminal, '今天');
    await terminal.key('\x1b', 'gpt-5.4'); check(terminal, '日报');
    await terminal.key('f', '筛选'); await terminal.key('\r', '本月'); await terminal.key('\x1b[B'); await terminal.key('\r', '今天');
    await terminal.key('a', '这个范围暂无记录'); check(terminal, '日报'); assert(!terminal.text().includes('gpt-5.4'));
    await terminal.key('f', '筛选'); await terminal.key('\r', '本月'); await terminal.key('\x1b[B'); await terminal.key('\r', '近30天');
    await terminal.key('a', 'gpt-5.4'); await terminal.key('q');
  }, { filterCancelPreservesPage: true, timePresetApplied: true });
  await journey(env, 80, 24, '用量项目/模型下拉选择 → 应用 → 对话项目下拉选择 → 应用 → 退出', async terminal => {
    await terminal.expect('gpt-5.4');
    await terminal.key('f', '筛选'); await terminal.key('\t'); await terminal.key('\r', '推理强度');
    await terminal.key('\t'); await terminal.key('\r', '/synthetic/project'); await terminal.key('\x1b[B'); await terminal.key('\r');
    await terminal.key('\t'); await terminal.key('\r', 'gpt-5.4'); await terminal.key('\x1b[B'); await terminal.key('\r');
    await terminal.key('a', '日报'); check(terminal, '12万', '$0.51');
    await terminal.key('\t', '对话'); await terminal.key('f', '标题 / 项目搜索');
    await terminal.key('\t'); await terminal.key('\r', '/synthetic/project'); await terminal.key('\x1b[B'); await terminal.key('\r');
    await terminal.key('a', '终端验收样本'); await terminal.key('q');
  }, { filterCandidatesApplied: true });
  for (const detail of [false, true]) {
    await journey(env, 80, 24, `${detail ? '轮次' : '用量'} → C 页尾金额说明 → C 收起保留当前页 → 退出`, async terminal => {
      await terminal.expect('gpt-5.4');
      if (detail) { await terminal.key('\t', '对话'); await terminal.key('\r', '第 1 轮'); }
      const current = detail ? '终端验收样本' : '日报';
      await terminal.key('c', '金额依据 · 标准 API 价格折算'); check(terminal, current, detail ? '12万 Token' : '12万');
      await terminal.key('c', detail ? '第 1 轮' : 'gpt-5.4'); check(terminal, current);
      assert(!terminal.text().includes('标准 API 价格折算')); await terminal.key('q');
    }, { footerDisclosurePreservesPage: true });
  }
  const firstData = path.join(temporary, 'first-launch-data');
  await journey({ ...env, WOMBAT_DATA_HOME: firstData }, 80, 24, '首次无快照 → 自动采集合成来源 → 用量表 → 退出', async terminal => {
    await terminal.expect('gpt-5.4');
    assert(existsSync(path.join(firstData, 'live-v1/index.sqlite')));
    assert(!existsSync(path.join(firstData, 'usage-v3/latest.json')));
    await terminal.key('q');
  }, { automaticCollection: true });
  await journey(env, 80, 24, '用量表 → 窄屏 → 宽屏 → 普通屏 → 退出', async terminal => {
    await terminal.expect('gpt-5.4'); await terminal.resize(40, 14, 'F 筛选'); await terminal.resize(120, 32, '缓存创建');
    await terminal.resize(80, 24, 'gpt-5.4'); await terminal.key('q');
  });
  await journey(env, 80, 24, '森林 → 午夜 → 纸张 → 琥珀 → 森林 → 对话 → 轮次 → 退出', async terminal => {
    await terminal.expect('gpt-5.4'); const colors: string[] = [];
    for (let index = 0; index < 4; index++) {
      await terminal.key('t', 'gpt-5.4'); colors.push([...terminal.colors()].sort().join(',')); check(terminal, '12万', '$0.51');
    }
    assert(colors.every(Boolean) && new Set(colors).size === 4, `Theme cycle did not change backgrounds: ${JSON.stringify(colors)}`);
    await terminal.key('\t', '对话'); await terminal.key('\r', '第 1 轮'); await terminal.key('q');
  }, { themeCyclePreservesData: true });
  await journey(env, 80, 24, '交互首页 → Ctrl+C 退出', async terminal => {
    await terminal.expect('gpt-5.4'); await terminal.key('\x03');
  }, { exitCode: 130 }, [], 130);
  const reportSource = path.join(temporary, 'report-source/sessions'); mkdirSync(reportSource, { recursive: true });
  for (const [index, [ago, factor]] of [[0, 1], [10, 2], [60, 4], [400, 8]].entries()) {
    const date = new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
    const stamp = `${date}T00:00:01Z`; const id = `report-${index}`;
    jsonl(path.join(reportSource, `${id}.jsonl`), [
      { timestamp: stamp, type: 'session_meta', payload: { id } },
      { timestamp: stamp, type: 'turn_context', payload: { turn_id: id, model: 'gpt-5.4', model_provider: 'openai' } },
      { timestamp: stamp, type: 'event_msg', payload: { type: 'token_usage_record', thread_id: id, turn_id: id, response_id: id, usage: { input_tokens: 100_000 * factor, cached_input_tokens: 20_000 * factor, cache_write_input_tokens: 0, output_tokens: 20_000 * factor, reasoning_output_tokens: 0, total_tokens: 120_000 * factor } } },
    ]);
  }
  const reportEnv = { ...env, WOMBAT_DATA_HOME: path.join(temporary, 'report-data'), CODEX_HOME: path.dirname(reportSource) };
  await journey(reportEnv, 120, 32, '日报近30天 → 周报近6个月 → 月报近12个月 → 日报 → 退出', async terminal => {
    await terminal.key('\x1b[F', '360,000'); await terminal.key('g', '周报'); await terminal.key('\x1b[F', '840,000');
    await terminal.key('g', '月报'); await terminal.key('\x1b[F', '840,000'); await terminal.key('g', '日报');
    await terminal.key('\x1b[F', '360,000'); await terminal.key('q');
  }, { dailyTokens: 360_000, weeklyTokens: 840_000, monthlyTokens: 840_000 }, ['--timezone', 'UTC']);
  for (const [columns, rows] of [[40, 14], [80, 24], [120, 32]]) {
    await journey(reportEnv, columns, rows, '默认分布 → 金额 → 消耗排序 → 明细 → 关联对话 → 全部对话 → 返回日报', async terminal => {
      await terminal.expect(columns < 68 ? 'Token ⇄' : '分布'); await terminal.key('\x1b[F', '36万'); await terminal.key('\x1b[H');
      // In the shortest viewport the toolbar scrolls above the selected row.
      // The visible column heading and amount establish the metric transition.
      await terminal.key('m', '估算 USD'); check(terminal, '$0.51');
      await terminal.key('s'); await terminal.key('v', 'gpt-5.4');
      await terminal.key('\r', '对话'); await terminal.key('a', '对话');
      await terminal.key('1', '日报'); await terminal.key('q');
    }, { distribution: true, metricsAndViews: true }, ['--timezone', 'UTC']);
  }
  const legacy = path.join(temporary, 'legacy-snapshot.json');
  writeFileSync(legacy, JSON.stringify({ schemaVersion: 2, snapshotId: 'synthetic-legacy', createdAt: `${day}T12:00:00Z`, catalog: { sessions: [{ id: 'legacy-thread', title: '旧快照样本', upstreamSessionId: 'legacy-native', sourceFile: '/synthetic/log' }], ledger: [{ id: 'legacy-row', sessionId: 'legacy-thread', totalTokens: 11, timestamp: `${day}T12:00:00Z`, costUsd: 0.01, pricingCoverage: 'partial' }] } }));
  await journey(env, 80, 24, '外部旧快照 → 对话 → 明细不可用 → 返回对话 → 退出', async terminal => {
    await terminal.expect('Wombat'); await terminal.key('\t', '旧快照样本'); await terminal.key('\r', '旧快照没有轮次明细');
    await terminal.key('\x1b', '旧快照样本'); await terminal.key('q');
  }, {}, ['--snapshot', legacy], 2);
  let observedLatencyMs = 0;
  await journey(env, 120, 32, '日志追加 → 无按键自动显示新总量 → 退出', async terminal => {
    await terminal.expect('120,000');
    const appended = { timestamp: `${day}T12:00:06Z`, type: 'event_msg', payload: { type: 'token_usage_record', thread_id: 'synthetic-thread', turn_id: 'synthetic-turn', response_id: 'synthetic-live-response', usage } };
    const start = performance.now(); appendFileSync(path.join(sessions, 'rollout-synthetic.jsonl'), JSON.stringify(appended) + '\n');
    await terminal.expect('240,000'); observedLatencyMs = Math.round((performance.now() - start) * 100) / 100; await terminal.key('q');
  }, { tokensBefore: 120_000, tokensAfter: 240_000, get observedLatencyMs() { return observedLatencyMs; } });
  await journey(env, 120, 32, '固定快照保持原总量 → 退出', async terminal => {
    await terminal.expect('120,000'); await new Promise(resolve => setTimeout(resolve, 1300));
    assert(!terminal.text().includes('240,000')); await terminal.key('q');
  }, { tokens: 120_000 }, ['--snapshot', refreshJson.snapshotRef.snapshotId]);
  const priceSource = path.join(temporary, 'auto-price-source/sessions'); mkdirSync(priceSource, { recursive: true });
  jsonl(path.join(priceSource, 'prices.jsonl'), [
    { timestamp: day + 'T12:00:00Z', type: 'session_meta', payload: { id: 'auto-price-thread' } },
    { timestamp: day + 'T12:00:01Z', type: 'turn_context', payload: { turn_id: 'turn', model: 'synthetic-new', model_provider: 'openai' } },
    { timestamp: day + 'T12:00:02Z', type: 'event_msg', payload: { type: 'token_usage_record', thread_id: 'auto-price-thread', turn_id: 'turn', response_id: 'response', usage: { input_tokens: 1_000_000, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1_000_000, reasoning_output_tokens: 0, total_tokens: 2_000_000 } } },
  ]);
  const priceHook = path.join(temporary, 'official-price-hook.mjs');
  const priceDocument = readFileSync('core/tests/fixtures/official-pricing-synthetic.txt', 'utf8');
  writeFileSync(priceHook, 'globalThis.fetch = async () => process.env.TEST_AUTO_PRICE_FAIL ? new Response("forbidden", {status:403}) : new Response(' + JSON.stringify(priceDocument) + ');');
  for (const failure of [false, true]) {
    const priceEnv = { ...env, WOMBAT_AUTO_PRICES: '1', WOMBAT_DATA_HOME: path.join(temporary, failure ? 'auto-price-failure' : 'auto-price-success'), CODEX_HOME: path.dirname(priceSource), NODE_OPTIONS: '--import=' + priceHook, TEST_AUTO_PRICE_FAIL: failure ? '1' : '' };
    await journey(priceEnv, 120, 32, failure ? '缺价 → 自动下载失败 → 保留用量及失败提示 → 退出' : '缺价 → 自动拉取合成官方价表 → 显示准确金额 → 退出', async terminal => {
      await terminal.expect(failure ? '价格自动更新失败' : '$5.79');
      check(terminal, 'synthetic-new');
      if (failure) check(terminal, 'PRICE_FETCH_FAILED');
      await terminal.key('q');
    }, { automaticPriceUpdate: true, simulatedFailure: failure, expectedTokens: 2_000_000, expectedCost: failure ? null : '5.79' });
  }
  const javascriptSha256 = Object.fromEntries(readdirSync(path.dirname(entry)).filter(file => file.endsWith('.js')).sort().map(file => [file, fileSha256(path.join(path.dirname(entry), file))]));
  const report = { method: 'actual POSIX PTY with node-pty 1.1.0 and @xterm/headless 5.5.0; synthetic Codex source; not a browser test or user study',
    platform: os.arch(), nodeVersion: process.version, verifiedAt: new Date().toISOString(),
    binarySha256: { core: fileSha256(core), cli: fileSha256(entry) }, javascriptSha256, checks };
  console.log(JSON.stringify(report, null, 2));
} finally { rmSync(temporary, { recursive: true, force: true }); }
