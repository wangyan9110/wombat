import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { installCodexSkill } from '../../scripts/install-codex-skill.ts';

async function stopService(child: ChildProcess): Promise<void> {
  const stopped = () => child.exitCode !== null || child.signalCode !== null;
  if (stopped()) return;
  const exited = new Promise<void>(resolve => {
    const finished = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { child.off('exit', finished); resolve(); }, 5_000);
    child.once('exit', finished);
  });
  if (process.platform === 'win32' && child.pid) {
    const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
    if (result.error) throw result.error;
  } else child.kill('SIGKILL');
  await exited;
  assert.equal(stopped(), true, 'installed runtime service did not stop');
}

test('skill installation preserves custom skills even with replace', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'wombat-skill-existing-'));
  try {
    const file = path.join(temp, 'wombat/SKILL.md');
    mkdirSync(path.dirname(file)); writeFileSync(file, 'User-owned skill');
    assert.throws(() => installCodexSkill(temp, true), /already exists/);
    assert.equal(readFileSync(file, 'utf8'), 'User-owned skill');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('installed runtime queries synthetic usage, fixed drill-down and configuration outside the repository', { timeout: 45000 }, async () => {
  const temp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'wombat-skill-flow-')));
  let service: ChildProcess | undefined;
  try {
    const skills = path.join(temp, 'skills'), installed = installCodexSkill(skills);
    assert.throws(() => installCodexSkill(skills), /already exists/);
    const marker = JSON.parse(readFileSync(path.join(installed, 'installation.json'), 'utf8')) as { target: string; files: { path: string; executable: boolean }[] };
    assert.equal(marker.target, process.platform + '-' + process.arch);
    for (const file of marker.files.filter(file => file.executable)) accessSync(path.join(installed, file.path), constants.X_OK);
    const source = path.join(temp, 'source'), project = path.join(temp, 'project');
    mkdirSync(path.join(source, 'sessions'), { recursive: true }); mkdirSync(project);
    writeFileSync(path.join(project, 'AGENTS.md'), '# Project\nSynthetic instructions.\n');
    const skill = path.join(project, '.agents/skills/sample/SKILL.md'); mkdirSync(path.dirname(skill), { recursive: true });
    writeFileSync(skill, `---\nname: sample\ndescription: ${'x'.repeat(501)}\n---\nSynthetic skill.\n`);
    writeFileSync(path.join(source, 'AGENTS.md'), 'Synthetic source rules.\n');
    const row = (type: string, payload: object) => ({ timestamp: '2026-10-02T17:00:00Z', type, payload });
    for (const [id, input] of [['high', 200], ['low', 100]] as const) {
      const rows = [row('session_meta', { id, cwd: project }), row('turn_context', { turn_id: id + '-turn', cwd: project, model: 'gpt-5.4' }), row('event_msg', { type: 'task_started', turn_id: id + '-turn' }), row('event_msg', { type: 'token_usage_record', thread_id: id, turn_id: id + '-turn', response_id: id + '-response', usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: input / 10, total_tokens: input + input / 10 } })];
      writeFileSync(path.join(source, 'sessions', id + '.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    }
    const env = { ...process.env, WOMBAT_DATA_HOME: path.join(temp, 'data'), CODEX_HOME: source, WOMBAT_AUTO_PRICES: '0', WOMBAT_CORE_BIN: '' };
    const core = path.join(installed, 'runtime', process.platform === 'win32' ? 'wombat-core.exe' : 'wombat-core');
    service = spawn(core, ['--serve-usage'], { env, windowsHide: true, stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => {
      const ready = () => { service!.off('error', failed); resolve(); };
      const failed = (error: Error) => { service!.off('spawn', ready); reject(error); };
      service!.once('spawn', ready);
      service!.once('error', failed);
    });
    await delay(100);
    assert.equal(service.exitCode, null, 'installed runtime service exited during startup');
    const invoke = (args: string[]): any => {
      const result = spawnSync(process.execPath, [path.join(installed, 'runtime/wombat.js'), ...args, '--json'], {
        cwd: temp, env,
        encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024,
      });
      assert.ok(result.status !== null && [0, 2].includes(result.status), result.stderr + result.stdout);
      const value = JSON.parse(result.stdout); assert.ok(!value.error, result.stdout); return value;
    };
    const fixed = invoke(['refresh']);
    const scope = ['--snapshot', fixed.snapshotRef.snapshotId, '--since', '2026-10-03', '--until', '2026-10-04', '--timezone', 'Asia/Shanghai'];
    assert.equal(invoke(['usage', ...scope]).summary.tokens.total, 330);
    const threads = invoke(['threads', ...scope, '--sort', 'tokens', '--limit', '1']);
    assert.equal(threads.page.total, 2); assert.equal(threads.summary.tokens.total, 330); assert.equal(threads.items[0].matchedUsage.tokens.total, 220);
    const turns = invoke(['turns', ...scope, '--thread', threads.items[0].id, '--matched-only', '--sort', 'tokens']);
    assert.equal(turns.items[0].usage.tokens.total, 220);
    const steps = invoke(['steps', ...scope, '--thread', threads.items[0].id, '--turn', turns.items[0].id]);
    assert.equal(steps.items.filter((item: { kind: string }) => item.kind === 'measurement').length, 1);
    const configArgs = ['--root', source, '--project-root', project];
    const inventory = invoke(['optimize', 'inventory', ...configArgs]);
    assert.ok(inventory.items.some((item: { path: string }) => item.path === skill));
    const suggestions = invoke(['optimize', 'list', ...configArgs, '--read-view', inventory.readView]);
    assert.ok(suggestions.suggestions.some((item: { item: { path: string }; findings: { rule: string }[] }) => item.item.path === skill && item.findings.some(finding => finding.rule === 'descriptionSize')));
    await stopService(service); service = undefined;
    assert.equal(installCodexSkill(skills, true), installed);
    assert.ok(invoke(['--help']).commands.includes('optimize'));
  } finally {
    if (service) await stopService(service);
    rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
