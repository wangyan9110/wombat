import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const binary = process.env.WOMBAT_CORE_BIN ?? path.join(project, 'dist', process.platform === 'win32' ? 'wombat-core.exe' : 'wombat-core');
const cli = path.join(project, 'dist/wombat.js');
const sentinel = 'SYNTHETIC_PRIVATE_BODY_NEVER_PERSIST';
const jsonl = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const envelope = (timestamp: string, type: string, payload: object) => ({ timestamp, type, payload });
const event = (timestamp: string, payload: object) => envelope(timestamp, 'event_msg', payload);
const usage = (input: number, cache: number, output: number, reasoning = 0) => ({
  input_tokens: input, cached_input_tokens: cache, cache_write_input_tokens: 0,
  output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output,
});
const measurement = (timestamp: string, thread: string, turn: string, response: string, counts: object, extras: object = {}) =>
  event(timestamp, { type: 'token_usage_record', thread_id: thread, turn_id: turn, response_id: response, usage: counts, ...extras });

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'wombat-usage-v1-')));
  const source = path.join(root, 'source');
  const data = path.join(root, 'data');
  const workspace = path.join(root, 'project');
  await mkdir(path.join(source, 'sessions'), { recursive: true });
  await mkdir(path.join(source, 'archived_sessions'), { recursive: true });
  await mkdir(workspace, { recursive: true });
  const env = { ...process.env, WOMBAT_DATA_HOME: data, CODEX_HOME: source };
  const first = [
    envelope('2026-09-28T23:40:00Z', 'session_meta', { id: 'thread-a', cwd: workspace, ignored_body: sentinel }),
    envelope('2026-09-28T23:45:00Z', 'turn_context', { turn_id: 'turn-a1', model: 'gpt-5.3-codex', effort: 'medium', cwd: workspace }),
    event('2026-09-28T23:45:00Z', { type: 'task_started', turn_id: 'turn-a1' }),
    measurement('2026-09-28T23:50:00Z', 'thread-a', 'turn-a1', 'response-a1', usage(1_000, 200, 100, 40), { cost: '999', service_tier: 'priority' }),
    envelope('2026-09-28T23:55:00Z', 'response_item', { type: 'function_call', call_id: 'call-a1', name: 'exec_command', arguments: JSON.stringify({ cmd: sentinel }) }),
    envelope('2026-09-28T23:55:01Z', 'response_item', { type: 'function_call_output', call_id: 'call-a1', output: JSON.stringify({ stdout: sentinel, exit_code: 0 }) }),
    measurement('2026-09-29T00:01:00Z', 'thread-a', 'turn-a1', 'response-a2', usage(2_000, 500, 200, 80)),
    event('2026-09-29T00:02:00Z', { type: 'task_complete', turn_id: 'turn-a1', last_agent_message: sentinel }),
    envelope('2026-09-29T01:00:00Z', 'turn_context', { turn_id: 'turn-a2', model: 'gpt-5.4', effort: 'high', cwd: workspace }),
    event('2026-09-29T01:00:00Z', { type: 'task_started', turn_id: 'turn-a2' }),
    measurement('2026-09-29T01:01:00Z', 'thread-a', 'turn-a2', 'response-a3', usage(1_000, 100, 300, 200)),
    event('2026-09-29T01:02:00Z', { type: 'task_complete', turn_id: 'turn-a2' }),
  ];
  const second = [
    envelope('2026-09-29T02:00:00Z', 'session_meta', { id: 'thread-b', cwd: workspace }),
    envelope('2026-09-29T02:01:00Z', 'turn_context', { turn_id: 'turn-b1', model: 'unverified-model', effort: 'low', cwd: workspace }),
    measurement('2026-09-29T02:02:00Z', 'thread-b', 'turn-b1', 'response-b1', usage(400, 0, 100)),
  ];
  const activeFile = path.join(source, 'sessions', 'rollout-a.jsonl');
  await writeFile(activeFile, jsonl(first));
  await writeFile(path.join(source, 'archived_sessions', 'rollout-b.jsonl'), jsonl(second));
  await writeFile(path.join(source, 'session_index.jsonl'), jsonl([
    { id: 'thread-a', thread_name: '主工程', updated_at: '2026-09-29T01:02:00Z' },
    { id: 'thread-b', thread_name: '归档实验', updated_at: '2026-09-29T02:02:00Z' },
  ]));
  const raw = (args: object) => {
    const processResult = spawnSync(binary, [], { input: JSON.stringify({ op: 'usage_app', args }), env, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(processResult.status, 0, processResult.stderr || processResult.error?.message || 'core process failed');
    assert.ok(!processResult.stdout.includes(sentinel), 'private content leaked through core stdout');
    return JSON.parse(processResult.stdout);
  };
  const query = (args: object) => {
    const result = raw(args); assert.equal(result.ok, true, JSON.stringify(result)); return result.value;
  };
  const invokeCli = (args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args], { env, input: '', encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.ok(!result.stdout.includes(sentinel));
    return { ...result, value: JSON.parse(result.stdout) };
  };
  const refresh = () => query({ action: 'refresh', roots: [source] });
  return { root, source, data, workspace, activeFile, raw, query, invokeCli, refresh };
}
const allDates = { timezone: 'UTC', since: '2026-09-28', until: '2026-09-30' };

test('CLI refresh reads nested Codex settings and prices a current model', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.source, 'sessions', 'nested-settings.jsonl'), jsonl([
      envelope('2026-09-29T03:00:00Z', 'session_meta', { id: 'thread-c', cwd: f.workspace }),
      event('2026-09-29T03:00:01Z', { type: 'thread_settings_applied', thread_id: 'thread-c', thread_settings: { model: 'gpt-6-sol', model_provider_id: 'openai', reasoning_effort: 'high' } }),
      measurement('2026-09-29T03:00:02Z', 'thread-c', 'turn-c1', 'response-c1', usage(1_000, 100, 100)),
    ]));
    const refreshed = f.invokeCli(['refresh', '--root', f.source, '--json']);
    assert.equal(refreshed.status, 0);
    assert.equal(refreshed.value.action, 'refresh');
    const queried = f.invokeCli(['usage', '--model', 'gpt-6-sol', '--since', '2026-09-29', '--until', '2026-09-30', '--json']);
    assert.equal(queried.status, 0);
    assert.equal(queried.value.summary.tokens.total, 1_100);
    assert.equal(queried.value.summary.price.status, 'priced');
    assert.equal(queried.value.summary.price.cost, '0.00282');
    assert.equal(queried.value.items.find((item: any) => !item.isSubtotal).model, 'gpt-6-sol');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('v3 用量 → 跨日对话 → 轮次 → 操作，Token 和十进制金额全链路守恒', async () => {
  const f = await fixture();
  try {
    const updated = f.refresh();
    assert.equal(updated.outputVersion, 3);
    assert.equal(updated.summary.tokens.total, 5_100);
    assert.equal(updated.summary.price.status, 'partial');
    assert.equal(updated.summary.price.cost, null);
    // Independent amount: response A1 .002835 + A2 .0055125 + A3 .006775.
    assert.equal(updated.summary.price.knownCost, '0.0151225');
    assert.equal(updated.summary.price.policy, 'official-standard-api-equivalent-v1');
    const snapshotId = updated.snapshotRef.snapshotId;
    const report = f.query({ action: 'usage', snapshotId, scope: allDates });
    assert.equal(report.summary.tokens.total, 5_100);
    assert.deepEqual(report.items.filter((r: any) => r.isSubtotal).map((r: any) => [r.date, r.usage.tokens.total]), [
      ['2026-09-29', 4_000], ['2026-09-28', 1_100],
    ]);
    const row = report.items.find((r: any) => r.model === 'gpt-5.4');
    assert.equal(row.reasoningEffort, 'high');
    assert.equal(row.usage.price.cost, '0.006775');
    const linked = f.query({ action: 'threads', snapshotId, scope: row.scope });
    assert.equal(linked.items.length, 1);
    const thread = linked.items[0];
    assert.equal(thread.title, '主工程');
    assert.equal(thread.matchedUsage.tokens.total, 1_300);
    assert.equal(thread.threadUsage.tokens.total, 4_600);
    assert.equal(thread.threadUsage.price.cost, '0.0151225');
    const turns = f.query({ action: 'turns', snapshotId, threadId: thread.id, scope: row.scope });
    assert.equal(turns.summary.tokens.total, 4_600);
    assert.deepEqual(turns.items.map((r: any) => r.usage.tokens.total), [3_300, 1_300]);
    assert.deepEqual(turns.items.map((r: any) => r.matchedUsage.tokens.total), [0, 1_300]);
    assert.equal(turns.items[0].share, 3_300 / 4_600);
    const steps = f.query({ action: 'steps', snapshotId, threadId: thread.id, turnId: turns.items[0].id, sort: 'time' });
    assert.equal(steps.summary.tokens.total, 3_300);
    assert.equal(steps.summary.price.cost, '0.0083475');
    const measured = steps.items.filter((r: any) => r.kind === 'measurement');
    assert.deepEqual(measured.map((r: any) => r.usage.tokens.total), [1_100, 2_200]);
    assert.equal(measured[1].share, 2_200 / 3_300);
    const operations = steps.items.filter((r: any) => r.kind === 'operation');
    assert.equal(operations.length, 1, 'call and return must be one operation');
    assert.equal(operations[0].name, 'exec_command');
    for (const operation of operations) {
      assert.ok(!('usage' in operation)); assert.ok(!('cost' in operation)); assert.ok(!('price' in operation));
    }
    const back = f.query({ action: 'usage', snapshotId, scope: { timezone: 'UTC', threadId: thread.id } });
    assert.equal(back.summary.tokens.total, 4_600);
    assert.equal(back.scope.since, null);
    assert.equal(back.scope.until, null);
    assert.deepEqual(back.availableRange, { since: '2026-09-28', until: '2026-09-30' });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('固定快照分页前排序，更新不改变旧页总量、费用或占比', async () => {
  const f = await fixture();
  try {
    const { snapshotRef } = f.refresh(); const snapshotId = snapshotRef.snapshotId;
    const threads = f.query({ action: 'threads', snapshotId, limit: 1 });
    assert.equal(threads.page.total, 2); assert.equal(threads.page.nextOffset, 1);
    assert.equal(threads.summary.tokens.total, 5_100);
    const id = threads.items[0].id;
    const turns = f.query({ action: 'turns', snapshotId, threadId: id, limit: 1 });
    assert.equal(turns.items[0].usage.tokens.total, 3_300);
    assert.equal(turns.items[0].share, 3_300 / 4_600);
    const nextTurn = f.query({ action: 'turns', snapshotId, threadId: id, limit: 1, offset: 1 });
    assert.deepEqual(nextTurn.summary, turns.summary);
    assert.equal(nextTurn.items[0].share, 1_300 / 4_600);
    const ranked = f.query({ action: 'steps', snapshotId, threadId: id, turnId: turns.items[0].id, sort: 'tokens', limit: 1 });
    assert.equal(ranked.items[0].usage.tokens.total, 2_200);
    assert.equal(ranked.items[0].share, 2_200 / 3_300);
    const tail = f.query({ action: 'steps', snapshotId, threadId: id, turnId: turns.items[0].id, sort: 'tokens', offset: 2, limit: 1 });
    assert.equal(tail.items[0].kind, 'operation');
    assert.deepEqual(tail.summary, ranked.summary);
    await appendFile(f.activeFile, jsonl([measurement('2026-09-29T03:00:00Z', 'thread-a', 'turn-a2', 'response-a4', usage(100, 0, 10), { model: 'gpt-5.4', effort: 'high' })]));
    const refreshed = f.refresh();
    assert.notEqual(refreshed.snapshotRef.snapshotId, snapshotId);
    assert.equal(refreshed.summary.tokens.total, 5_210);
    const oldNext = f.query({ action: 'threads', snapshotId, offset: 1, limit: 1 });
    assert.deepEqual(oldNext.summary, threads.summary);
    assert.equal(oldNext.items[0].title, '归档实验');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('对话搜索汇总对应命中集合，周/月边界只计所选日期', async () => {
  const f = await fixture();
  try {
    const { snapshotRef } = f.refresh(); const snapshotId = snapshotRef.snapshotId;
    const searched = f.query({ action: 'threads', snapshotId, search: '主工程' });
    assert.equal(searched.page.total, 1);
    assert.equal(searched.summary.tokens.total, 4_600);
    assert.equal(searched.summary.price.cost, '0.0151225');
    for (const group of ['week', 'month']) {
      const result = f.query({ action: 'usage', snapshotId, group, scope: { timezone: 'UTC', since: '2026-09-29', until: '2026-09-30' } });
      assert.equal(result.summary.tokens.total, 4_000);
      const row = result.items.find((r: any) => r.isSubtotal);
      assert.equal(row.date, '2026-09-29'); assert.equal(row.endDate, '2026-09-29');
      assert.equal(row.usage.tokens.total, 4_000);
    }
    const shifted = f.query({ action: 'usage', snapshotId, scope: { timezone: 'Asia/Shanghai', since: '2026-09-29', until: '2026-09-30' } });
    assert.equal(shifted.summary.tokens.total, 5_100);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('部分来源失败保留成功账本，全部失败保留旧快照', async () => {
  const f = await fixture();
  try {
    f.refresh();
    await writeFile(path.join(f.source, 'sessions', 'broken.jsonl'), '{bad-json}\n');
    const partial = f.refresh();
    assert.equal(partial.quality.status, 'partial');
    assert.equal(partial.summary.tokens.total, 5_100);
    assert.equal(partial.summary.price.knownCost, '0.0151225');
    const cliResult = f.invokeCli(['usage', '--since', '2026-09-28', '--until', '2026-09-30', '--json']);
    assert.equal(cliResult.status, 2); assert.equal(cliResult.value.quality.status, 'partial');
    const latest = await readFile(path.join(f.data, 'usage-v3', 'latest.json'), 'utf8');
    const failed = f.raw({ action: 'refresh', roots: [path.join(f.root, 'nonexistent-source')] });
    assert.equal(failed.ok, false);
    assert.equal(await readFile(path.join(f.data, 'usage-v3', 'latest.json'), 'utf8'), latest);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('日期按真实时区跨夏令时和年份分组，不以固定24小时切日', async () => {
  const f = await fixture();
  try {
    const rows: unknown[] = [
      envelope('2026-03-08T07:59:00Z', 'session_meta', { id: 'calendar-thread', cwd: f.workspace }),
      envelope('2026-03-08T07:59:00Z', 'turn_context', { turn_id: 'calendar-turn', model: 'gpt-5.3-codex', effort: 'low' }),
    ];
    // Los Angeles spring-forward day is only 23 hours: 08:00Z to next 07:00Z.
    for (const [index, time] of ['2026-03-08T07:59:00Z', '2026-03-08T09:30:00Z', '2026-03-08T10:30:00Z', '2026-03-09T07:00:00Z', '2026-12-31T23:59:59Z', '2027-01-01T00:00:00Z'].entries()) {
      rows.push(measurement(time, 'calendar-thread', 'calendar-turn', `calendar-${index}`, usage(100, 0, 10)));
    }
    await writeFile(path.join(f.source, 'archived_sessions', 'old-path-calendar.jsonl'), jsonl(rows));
    const { snapshotRef } = f.refresh(); const snapshotId = snapshotRef.snapshotId;
    const day = f.query({ action: 'usage', snapshotId, scope: { timezone: 'America/Los_Angeles', since: '2026-03-08', until: '2026-03-09' } });
    assert.equal(day.summary.tokens.total, 220);
    assert.equal(day.summary.price.cost, '0.00063');
    assert.equal(day.items.filter((r: any) => r.isSubtotal).length, 1);
    const months = f.query({ action: 'usage', snapshotId, group: 'month', scope: { timezone: 'UTC', since: '2026-12-31', until: '2027-01-02' } });
    assert.equal(months.summary.tokens.total, 220);
    assert.deepEqual(months.items.filter((r: any) => r.isSubtotal).map((r: any) => [r.date, r.endDate, r.usage.tokens.total]), [
      ['2027-01-01', '2027-01-01', 110], ['2026-12-31', '2026-12-31', 110],
    ]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('无 TTY CLI 与 Rust 查询一致，JSON stdout 只有最终结果', async () => {
  const f = await fixture();
  try {
    const refreshed = f.invokeCli(['refresh', '--root', f.source, '--json']);
    assert.equal(refreshed.status, 0, refreshed.stderr);
    assert.match(refreshed.stderr, /Wombat/);
    const snapshotId = refreshed.value.snapshotRef.snapshotId;
    const flags = ['usage', '--snapshot', snapshotId, '--since', '2026-09-28', '--until', '2026-09-30', '--timezone', 'UTC', '--json'];
    const cliResult = f.invokeCli(flags);
    assert.equal(cliResult.status, 0, cliResult.stderr);
    const native = f.query({ action: 'usage', snapshotId, scope: allDates });
    assert.deepEqual(cliResult.value, native);
    const bad = f.invokeCli(['turns', '--json']);
    assert.equal(bad.status, 1); assert.equal(bad.value.error.code, 'INVALID_ARGUMENT');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('聚合超出安全整数范围时拒绝发布，保留上次可查询快照', async () => {
  const f = await fixture();
  try {
    const prior = f.refresh();
    const pointer = path.join(f.data, 'usage-v3', 'latest.json');
    const before = await readFile(pointer, 'utf8');
    await appendFile(f.activeFile, jsonl([
      measurement('2026-09-29T04:00:00Z', 'thread-a', 'turn-a2', 'huge-a', usage(6_000_000_000_000_000, 0, 0)),
      measurement('2026-09-29T04:01:00Z', 'thread-a', 'turn-a2', 'huge-b', usage(6_000_000_000_000_000, 0, 0)),
    ]));
    const failed = f.raw({ action: 'refresh', roots: [f.source] });
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'RESOURCE_LIMIT');
    assert.equal(await readFile(pointer, 'utf8'), before);
    const current = f.query({ action: 'threads' });
    assert.equal(current.snapshotRef.snapshotId, prior.snapshotRef.snapshotId);
    assert.equal(current.summary.tokens.total, 5_100);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('快照不持久化正文，分片损坏和路径穿越被拒绝', async () => {
  const f = await fixture();
  try {
    const refreshed = f.refresh(); const snapshotId = refreshed.snapshotRef.snapshotId;
    const dir = path.join(f.data, 'usage-v3', 'generations', snapshotId, 'committed');
    for (const name of await readdir(dir)) {
      assert.ok(!(await readFile(path.join(dir, name), 'utf8')).includes(sentinel), `${name} stored private content`);
    }
    const manifestFile = path.join(dir, 'manifest.json');
    const manifestText = await readFile(manifestFile, 'utf8');
    const manifest = JSON.parse(manifestText);
    const ledgerFile = path.join(dir, manifest.ledger.file);
    const original = await readFile(ledgerFile, 'utf8');
    await writeFile(ledgerFile, original + ' ');
    const corrupt = f.raw({ action: 'usage', snapshotId, scope: allDates });
    assert.equal(corrupt.ok, false); assert.equal(corrupt.code, 'SNAPSHOT_CORRUPT');
    await writeFile(ledgerFile, original);
    manifest.ledger.file = '../outside.json';
    await writeFile(manifestFile, JSON.stringify(manifest));
    assert.equal(f.raw({ action: 'usage', snapshotId, scope: allDates }).code, 'SNAPSHOT_CORRUPT');
    await writeFile(manifestFile, manifestText);
    assert.equal(f.raw({ action: 'usage', snapshotId: '../../outside' }).code, 'INVALID_ARGUMENT');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('v1/v2 快照只读保留金额政策、部分计价和未知状态，不伪造轮次', async () => {
  const f = await fixture();
  try {
    for (const version of [1, 2]) {
      const file = path.join(f.root, `legacy-v${version}.json`);
      const snapshot = {
        schemaVersion: version, snapshotId: `legacy-v${version}`, createdAt: '2026-09-29T03:00:00Z',
        sessions: [{ id: 'legacy-thread', sessionId: 'legacy-thread', cwd: f.workspace }],
        usage: { sections: { session: { rows: [
          { id: 'legacy-priced', session: 'legacy-thread', period: '2026-09-29', totalTokens: 1_000, inputTokens: 800, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0, costUSD: 2.5, pricing: 'priced', pricingCoverage: 'priced' },
          { id: 'legacy-partial', session: 'legacy-thread', period: '2026-09-29', totalTokens: 2_000, inputTokens: 1_800, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0, costUSD: 1.25, pricing: 'unpriced', pricingCoverage: 'partial' },
          { id: 'legacy-unpriced', session: 'legacy-thread', period: '2026-09-29', totalTokens: 300, inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, costUSD: 0, pricing: 'unpriced', pricingCoverage: 'unpriced' },
        ] } } },
      };
      const bytes = JSON.stringify(snapshot); await writeFile(file, bytes);
      const result = f.query({ action: 'threads', snapshotId: file });
      assert.equal(result.summary.tokens.total, 3_300);
      assert.equal(result.summary.price.policy, 'legacy_recorded');
      assert.equal(result.summary.price.cost, null);
      assert.equal(result.summary.price.knownCost, '3.75');
      assert.equal(result.summary.price.status, 'partial');
      assert.equal(result.items[0].threadUsage.tokens.total, 3_300);
      const detail = f.raw({ action: 'turns', snapshotId: file, threadId: 'legacy-thread' });
      assert.equal(detail.ok, false); assert.equal(detail.code, 'DETAIL_UNAVAILABLE');
      assert.equal(await readFile(file, 'utf8'), bytes);
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('此对话全部用量保留无日期计量；未知日期分项能精确关联', async () => {
  const f = await fixture();
  try {
    const undated = measurement('2026-09-29T04:00:00Z', 'thread-a', 'turn-a2', 'response-undated', usage(300, 0, 30), { model: 'gpt-5.4' });
    const { timestamp: _discarded, ...row } = undated;
    await appendFile(f.activeFile, jsonl([row]));
    const refreshed = f.refresh(); const snapshotId = refreshed.snapshotRef.snapshotId;
    const threads = f.query({ action: 'threads', snapshotId, search: '主工程' });
    const thread = threads.items[0];
    assert.equal(thread.threadUsage.tokens.total, 4_930);
    const full = f.query({ action: 'usage', snapshotId, scope: { threadId: thread.id } });
    assert.equal(full.summary.tokens.total, 4_930);
    const unknownDate = full.items.find((item: any) => item.isSubtotal && item.date === null);
    assert.equal(unknownDate.usage.tokens.total, 330);
    const linked = f.query({ action: 'threads', snapshotId, scope: unknownDate.scope });
    assert.equal(linked.items[0].matchedUsage.tokens.total, 330);
    assert.equal(linked.items[0].threadUsage.tokens.total, 4_930);
    const dated = f.query({ action: 'usage', snapshotId, scope: { ...allDates, threadId: thread.id } });
    assert.equal(dated.summary.tokens.total, 4_600);
    assert.equal(f.raw({ action: 'usage', scope: { ...allDates, undated: true } }).code, 'INVALID_ARGUMENT');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('CLI automatic daily, weekly and monthly ranges include older data while explicit dates stay fixed', async () => {
  const f = await fixture();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const day = (offset: number) => new Date(Date.parse(today) - offset * 86400000).toISOString().slice(0, 10);
    const model = 'gpt-5.4-mini';
    const rows: object[] = [envelope(day(400) + 'T00:00:00Z', 'session_meta', { id: 'range-fixture' })];
    for (const [index, ago] of [400, 60, 10, 0].entries()) {
      const stamp = day(ago) + 'T00:00:01Z', factor = [8, 4, 2, 1][index];
      rows.push(envelope(stamp, 'turn_context', { turn_id: `range-${index}`, model }));
      rows.push(measurement(stamp, 'range-fixture', `range-${index}`, `range-response-${index}`, usage(100 * factor, 0, 10 * factor, 0)));
    }
    await writeFile(path.join(f.source, 'sessions', 'report-ranges.jsonl'), jsonl(rows));
    const snapshot = f.refresh().snapshotRef.snapshotId;
    for (const [group, expected] of [['day', 110], ['week', 330], ['month', 770]] as const) {
      const args = ['usage', '--snapshot', snapshot, '--group', group, '--model', model, '--timezone', 'UTC', '--json'];
      const result = f.invokeCli(args);
      assert.equal(result.status, 0);
      assert.equal(result.value.summary.tokens.total, expected);
      assert.equal(result.value.availableRange.since, day(400), 'collection retains data outside the default view');
      const subtotal = result.value.items.filter((item: any) => item.isSubtotal).reduce((sum: number, item: any) => sum + item.usage.tokens.total, 0);
      assert.equal(subtotal, expected);
      const explicit = f.invokeCli([...args, '--since', day(10), '--until', today]);
      assert.equal(explicit.status, 0);
      assert.equal(explicit.value.summary.tokens.total, 220);
      assert.equal(explicit.value.scope.since, day(10));
      assert.equal(explicit.value.scope.until, today);
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
