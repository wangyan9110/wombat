import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { scanEnvironment } from '../../src/environment.js';
import { scanCodexSessions } from '../../src/codex.js';
import { inspectRuleFile } from '../../src/rules.js';
import { safeJson, writeReport } from '../../src/report.js';
import { SCHEMA_VERSION, type ScanSnapshot } from '../../src/contracts.js';

test('环境盘点不把配置密钥写进资源，缺失引用产生可定位建议', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wombat-env-'));
  const workspace = path.join(root, '项目');
  const codex = path.join(root, 'codex'); const claude = path.join(root, 'claude');
  await mkdir(path.join(workspace, '.codex'), { recursive: true });
  await mkdir(path.join(codex, 'skills', 'demo'), { recursive: true });
  await mkdir(claude, { recursive: true });
  await writeFile(path.join(codex, 'skills', 'demo', 'SKILL.md'), 'test skill');
  await writeFile(path.join(codex, 'config.toml'), '[mcp_servers.local]\ncommand = "SYNTHETIC_SECRET_DO_NOT_EXPORT"\n');
  await writeFile(path.join(claude, 'settings.json'), JSON.stringify({ mcpServers: { search: { env: { KEY: 'SYNTHETIC_SECRET_DO_NOT_EXPORT' } } } }));
  const rule = path.join(workspace, 'AGENTS.md');
  await writeFile(rule, 'See [missing](./missing.md).\n\nThis paragraph has deliberately repeated content for a duplicate test.\n\nThis paragraph has deliberately repeated content for a duplicate test.\n');
  const environment = await scanEnvironment(workspace, { codex: [codex], claude: [claude] });
  assert.ok(environment.resources.some(item => item.kind === 'skill' && item.name === 'demo'));
  assert.ok(environment.resources.some(item => item.kind === 'mcp' && item.name === 'local'));
  assert.ok(environment.resources.some(item => item.kind === 'mcp' && item.name === 'search'));
  assert.ok(!JSON.stringify(environment.resources).includes('SYNTHETIC_SECRET_DO_NOT_EXPORT'));
  const findings = await inspectRuleFile(rule, workspace);
  assert.ok(findings.some(item => item.ruleId === 'rules.missing_relative_path' && item.evidence[0].line === 1));
  assert.ok(findings.some(item => item.ruleId === 'rules.exact_duplicate_paragraph'));
});

test('Codex 残缺日志不丢已完成事件，重复读取可回查且不保存正文', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wombat-codex-'));
  const dir = path.join(root, '2026', '09', '27'); await mkdir(dir, { recursive: true });
  const record = (type: string, payload: object, second: number) => JSON.stringify({ timestamp: `2026-09-27T00:00:${String(second).padStart(2, '0')}Z`, type, payload });
  const lines = [
    record('session_meta', { id: 'abc', cwd: '/tmp/project' }, 0),
    record('response_item', { type: 'function_call', name: 'exec_command', call_id: '1', arguments: JSON.stringify({ cmd: 'cat ./README.md' }) }, 1),
    record('response_item', { type: 'function_call_output', call_id: '1', output: 'PRIVATE_SOURCE_BODY' }, 2),
    record('response_item', { type: 'function_call', name: 'exec_command', call_id: '2', arguments: JSON.stringify({ cmd: 'cat ./README.md' }) }, 3),
    record('response_item', { type: 'function_call_output', call_id: '2', output: 'PRIVATE_SOURCE_BODY' }, 4),
    '{broken',
  ];
  await writeFile(path.join(dir, 'rollout.jsonl'), lines.join('\n'));
  const result = await scanCodexSessions('2026-09-27', '2026-09-28', root);
  assert.equal(result.sessions[0].id, 'codex:abc');
  assert.equal(result.status.state, 'partial');
  assert.equal(result.events.length, 4);
  assert.ok(result.findings.some(item => item.ruleId === 'codex.same_read' && item.evidence.length === 2));
  assert.ok(!JSON.stringify(result).includes('PRIVATE_SOURCE_BODY'));
});

test('离线单文件报告会转义脚本片段', async () => {
  assert.ok(!safeJson('</script><script>alert(1)</script>').includes('</script>'));
  const root = await mkdtemp(path.join(tmpdir(), 'wombat-report-'));
  const snapshot: ScanSnapshot = { schemaVersion: SCHEMA_VERSION, snapshotId: 'test', createdAt: new Date().toISOString(),
    scope: { workspace: '</script><script>alert(1)</script>', since: '2026-09-27', until: '2026-09-28', timezone: 'UTC', sourceDirs: {} },
    modules: [], usage: null, resources: [], sessions: [], events: [], findings: [], warnings: [] };
  const output = await writeReport(snapshot, path.join(root, 'report.html'));
  const html = await readFile(output, 'utf8');
  assert.ok(html.includes('Content-Security-Policy'));
  assert.ok(html.includes('window.__WOMBAT_SNAPSHOT__='));
  assert.ok(!html.includes('</script><script>alert(1)'));
  assert.ok(!/<script[^>]+src="\.\/assets\//.test(html));
});
