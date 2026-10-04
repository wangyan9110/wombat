import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createNodeClient } from '@wombat/client/node';
import { createHttpClient } from '@wombat/client/http';
import { startWebHost } from '@wombat/web';

test('switching to a project discovered from local history reads its configuration without a separate grant', { timeout: 30_000 }, async () => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'wombat-project-switch-')));
  const source = path.join(dir, 'source'), project = path.join(dir, 'project'), added = path.join(dir, 'added'), other = path.join(dir, 'other'), data = path.join(dir, 'data');
  await mkdir(path.join(source, 'sessions'), { recursive: true }); await mkdir(project); await mkdir(added); await mkdir(other);
  await writeFile(path.join(project, 'AGENTS.md'), 'Synthetic project instruction. '.repeat(1_000));
  await writeFile(path.join(added, 'AGENTS.md'), 'New synthetic project instruction. '.repeat(1_000));
  const rows = (id: string, cwd: string, offset: number) => [
    { timestamp: `2026-10-04T00:00:0${offset}Z`, type: 'session_meta', payload: { id, cwd } },
    { timestamp: `2026-10-04T00:00:0${offset + 1}Z`, type: 'turn_context', payload: { turn_id: `${id}-turn`, model: 'gpt-5.4', cwd } },
    { timestamp: `2026-10-04T00:00:0${offset + 2}Z`, type: 'event_msg', payload: { type: 'token_usage_record', thread_id: id, turn_id: `${id}-turn`, response_id: `${id}-response`, usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10, total_tokens: 110 } } },
  ];
  await writeFile(path.join(source, 'sessions/task.jsonl'), rows('task', project, 0).map(row => JSON.stringify(row)).join('\n') + '\n');
  const previous = { WOMBAT_DATA_HOME: process.env.WOMBAT_DATA_HOME, CODEX_HOME: process.env.CODEX_HOME, WOMBAT_AUTO_PRICES: process.env.WOMBAT_AUTO_PRICES };
  Object.assign(process.env, { WOMBAT_DATA_HOME: data, CODEX_HOME: source, WOMBAT_AUTO_PRICES: '0' });
  const binary = path.resolve('dist', process.platform === 'win32' ? 'wombat-core.exe' : 'wombat-core');
  const service = spawn(binary, ['--serve-usage'], { stdio: 'ignore', env: process.env }); await once(service, 'spawn');
  const host = await startWebHost({ client: createNodeClient({ binaryPath: binary, automaticPrices: false }), roots: [source], assets: path.resolve('dist/web'), automaticPrices: false });
  const token = new URLSearchParams(new URL(host.url).hash.slice(1)).get('token')!;
  const browser = createHttpClient({ origin: host.origin, token, fetch: (url, init) => fetch(url, { ...init, headers: { ...init?.headers, Origin: host.origin } }) });
  try {
    // A direct configuration route performs its own bounded source discovery.
    const inventory = await browser.config!({ action: 'list', scope: { allTime: true, project } });
    assert.deepEqual(inventory.authorizedProjects, [project]);
    assert.ok(inventory.items.some(item => item.path === path.join(project, 'AGENTS.md')));
    const optimize = await browser.optimize!({ action: 'list', project });
    assert.ok(optimize.suggestions.some(suggestion => suggestion.item.path === path.join(project, 'AGENTS.md')));

    // Projects first used after the host starts are imported by the same source sync.
    await writeFile(path.join(source, 'sessions/added.jsonl'), rows('added', added, 3).map(row => JSON.stringify(row)).join('\n') + '\n');
    const addedInventory = await browser.config!({ action: 'list', scope: { allTime: true, project: added } });
    assert.deepEqual(addedInventory.authorizedProjects, [added]);
    assert.ok(addedInventory.items.some(item => item.path === path.join(added, 'AGENTS.md')));

    await assert.rejects(browser.config!({ action: 'list', scope: { allTime: true, project: other } }), { code: 'PROJECT_NOT_AUTHORIZED' });
    await assert.rejects(browser.optimize!({ action: 'list', project: other }), { code: 'PROJECT_NOT_AUTHORIZED' });
    await assert.rejects(browser.optimize!({ action: 'list', projectRoots: [other] }), { code: 'INVALID_ARGUMENT' });
  } finally {
    await host.close(); if (service.exitCode === null) { const closed = once(service, 'close'); service.kill(); await closed; }
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
