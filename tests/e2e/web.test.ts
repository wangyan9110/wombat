import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

async function stop(child?: ChildProcess) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  child.kill('SIGTERM');
  try { await closed; } finally { clearTimeout(timer); }
}
const entry = path.resolve(process.env.WOMBAT_WEB_TEST_ENTRY ?? 'dist/wombat.js');
test('built Web and CLI share Rust totals, drill-down, fixed versions and lifecycle', { timeout: 40_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wombat-web-e2e-'));
  const root = path.join(dir, "source with ' quote"), data = path.join(dir, 'data');
  await mkdir(path.join(root, 'sessions'), { recursive: true });
  const timestamp = new Date(Date.now() - 86_400_000).toISOString();
  const events = [
    { type: 'session_meta', payload: { id: 'synthetic-thread', cwd: '/synthetic/project', cli_version: '0.1.0' } },
    { type: 'turn_context', payload: { turn_id: 'synthetic-turn', model: 'gpt-5.4', model_provider: 'openai', effort: 'high' } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'synthetic-turn' } },
    { type: 'event_msg', payload: { type: 'token_usage_record', thread_id: 'synthetic-thread', turn_id: 'synthetic-turn', response_id: 'synthetic-response', usage: { input_tokens: 100000, cached_input_tokens: 20000, cache_write_input_tokens: 0, output_tokens: 20000, reasoning_output_tokens: 3000, total_tokens: 120000 } } },
  ];
  await writeFile(path.join(root, 'sessions', 'synthetic.jsonl'), events.map(event => JSON.stringify({ timestamp, ...event })).join('\n') + '\n');
  const env = { ...process.env, CODEX_HOME: path.join(dir, 'empty-default'), WOMBAT_DATA_HOME: data, WOMBAT_AUTO_PRICES: '0', WOMBAT_LANG: 'en' };
  delete (env as NodeJS.ProcessEnv).WOMBAT_CORE_BIN;
  const binary = process.platform === 'win32' ? 'wombat-core.exe' : 'wombat-core';
  const native = path.join(path.dirname(entry), 'native');
  const core = existsSync(native) ? path.join(native, process.platform+'-'+process.arch, binary) : path.join(path.dirname(entry), binary);
  let service: ChildProcess | undefined, child: ChildProcess | undefined;
  let stderr = '';
  try {
    assert(existsSync(core), 'Installed core is missing: ' + core);
    service = spawn(core, ['--serve-usage'], { env, stdio: 'ignore' });
    await once(service, 'spawn');
    await new Promise(resolve => setTimeout(resolve, 150));
    child = spawn(process.execPath, [entry, 'web', '--root', root, '--project-root', root, '--json'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr!.on('data', chunk => { stderr += chunk; });
    const url = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('Web startup timed out: ' + stderr)), 10_000);
      child!.stdout!.on('data', chunk => { buffer += chunk; if (buffer.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(buffer.split('\n')[0]).url); } });
      child!.once('error', error => { clearTimeout(timer); reject(error); }); child!.once('exit', code => { clearTimeout(timer); reject(new Error(`Early exit ${code}: ${stderr}`)); });
    });
    const origin = new URL(url).origin, token = new URLSearchParams(new URL(url).hash.slice(1)).get('token');
    const call = async (method: string, body: unknown) => {
      const response = await fetch(origin + '/api/' + method, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 200);
      const frames = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
      const last = frames.at(-1); assert.equal(last.type, 'result', JSON.stringify(last)); return last.value;
    };
    const authorization = await call('config', {action:'capabilities'});
    assert.deepEqual(authorization.authorizedSourceRoots,[root]);
    assert.deepEqual(authorization.authorizedProjects,[root]);
    if(process.platform !== 'win32') {
      assert.ok(authorization.hostRestartCommand);
      // Execute only the host-generated command for this synthetic fixture.
      const recovered=spawn('/bin/sh',['-c','exec '+authorization.hostRestartCommand+' --json'],{env,stdio:['ignore','pipe','pipe']});
      try {
        const line=await new Promise<string>((resolve,reject)=>{let buf='';const timer=setTimeout(()=>reject(new Error('Restart command timed out')),10000);recovered.stdout!.on('data',c=>{buf+=c;if(buf.includes('\n')){clearTimeout(timer);resolve(buf.split('\n')[0]);}});recovered.once('error',e=>{clearTimeout(timer);reject(e);});});
        const recoveryUrl=new URL(JSON.parse(line).url),recoveryToken=new URLSearchParams(recoveryUrl.hash.slice(1)).get('token');
        const recovery=await fetch(recoveryUrl.origin+'/api/config',{method:'POST',headers:{Origin:recoveryUrl.origin,Authorization:`Bearer ${recoveryToken}`,'Content-Type':'application/json'},body:JSON.stringify({action:'capabilities'})});
        const receipt=(await recovery.text()).trim().split('\n').map(l=>JSON.parse(l)).at(-1).value;
        assert.deepEqual(receipt.authorizedSourceRoots,[root]);assert.deepEqual(receipt.authorizedProjects,[root]);
      } finally {await stop(recovered);}
    }
    const html = await (await fetch(origin)).text();
    assert.match(html, /<title>Wombat/);
    assert.equal((await fetch(origin+'/?page=threads&search=synthetic')).status,200);
    assert.equal((await fetch(origin+'/wombat.png')).status,200);
    const asset = html.match(/src="([^"]+\.js)"/)?.[1]; assert.ok(asset);
    assert.equal((await fetch(origin + asset)).status, 200);
    const live = await call('live', { query: { action: 'usage', group: 'day', presentation: 'distribution' }, mode: 'fresh' });
    assert.equal(live.result.summary.tokens.total, 120000);
    const cli = spawnSync(process.execPath, [entry, 'usage', '--root', root, '--fresh', '--json'], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(cli.status, 0, cli.stderr);
    assert.deepEqual(live.result.summary, JSON.parse(cli.stdout).summary);
    const snapshotId = live.result.snapshotRef.snapshotId;
    const query = async (request: unknown) => (await call('live', { query: request, mode: 'cached' })).result;
    const threads = await query({ action: 'threads', snapshotId });
    assert.equal(threads.items.length, 1);
    const turns = await query({ action: 'turns', snapshotId, threadId: threads.items[0].id });
    assert.equal(turns.items.length, 1);
    const steps = await query({ action: 'steps', snapshotId, threadId: threads.items[0].id, turnId: turns.items[0].id });
    assert.equal(steps.summary.tokens.total, 120000);
    // A restarted core must never restore an expired view using the default source.
    await stop(service);
    service = spawn(core, ['--serve-usage'], { env, stdio: 'ignore' });
    await once(service, 'spawn');
    await new Promise(resolve => setTimeout(resolve, 150));
    const expired = await fetch(origin + '/api/live', { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: { action: 'threads', snapshotId }, mode: 'cached' }) });
    assert.match(await expired.text(), /VIEW_EXPIRED/);
    const refreshed = await call('live', { query: { action: 'usage' }, mode: 'fresh' });
    assert.equal(refreshed.result.summary.tokens.total, 120000);
    await stop(child);
    if (process.platform !== 'win32') assert.equal(child.exitCode, 0, stderr);
    await assert.rejects(fetch(origin));
  } finally {
    await Promise.all([stop(child), stop(service)]);
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('web help and invalid arguments do not start a listener', () => {
  const help = spawnSync(process.execPath, [entry, 'web', '--help', '--lang', 'en'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /--port/);
  for (const args of [['--port', '-1'], ['--port', '65536'], ['--host', '0.0.0.0'], ['--json=true']]) {
    const result = spawnSync(process.execPath, [entry, 'web', ...args, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_ARGUMENT');
  }
});
