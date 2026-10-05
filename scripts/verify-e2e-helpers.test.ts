import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acceptanceInputIdentity, assertExternalOutputDir, currentArtifactIdentity, externalFileIdentity, externalPackageIdentity, isWithin, parseVerifyArgs, plannedStages, reusableStage, runBoundedCommand, runFingerprint,
} from './verify-e2e-helpers.ts';

test('verification arguments require an external report directory and preserve browser paths', () => {
  assert.deepEqual(parseVerifyArgs(['--', '--scope', 'browser', '--output-dir', '/tmp/wombat-e2e', '--resume', '--playwright-module', '/opt/playwright/index.mjs', '--browser-executable', '/opt/chromium']), {
    scope: 'browser', outputDir: '/tmp/wombat-e2e', resume: true,
    playwrightModule: '/opt/playwright/index.mjs', browserExecutable: '/opt/chromium',
  });
  assert.equal(parseVerifyArgs(['--output-dir', '/tmp/wombat-e2e'], { WOMBAT_PLAYWRIGHT_MODULE: '/opt/playwright/index.mjs' }).scope, 'all');
  assert.throws(() => parseVerifyArgs([], {}), /--output-dir/);
  assert.throws(() => parseVerifyArgs(['--scope', 'api', '--output-dir', 'relative'], {}), /absolute path/);
  assert.throws(() => parseVerifyArgs(['--scope', 'browser', '--output-dir', '/tmp/wombat-e2e'], {}), /PLAYWRIGHT_MODULE/);
  assert.throws(() => parseVerifyArgs(['--scope', 'all', '--scope', 'api', '--output-dir', '/tmp/out'], {}), /Usage:/);
  assert.equal(isWithin('/repo', '/repo/out'), true);
  assert.equal(isWithin('/repo', '/repo2/out'), false);
  assert.throws(() => assertExternalOutputDir('/repo', '/repo/reports'), /outside the repository/);
});

test('scopes select only their owned acceptance stages', () => {
  assert.deepEqual(plannedStages('api'), ['integration', 'e2e']);
  assert.deepEqual(plannedStages('browser'), ['browser']);
  assert.deepEqual(plannedStages('all'), ['integration', 'e2e', 'browser']);
});

test('resume evidence is invalidated by source, tests, artifacts, scope, or external browser identities', () => {
  const base = { sourceSha256: 'source-a', artifactSha256: 'artifact-a', acceptanceInputsSha256: 'tests-a', scope: 'all' as const,
    playwright: { path: '/tmp/playwright.mjs', sha256: 'pw-a' }, browserExecutable: { path: '/tmp/chromium', sha256: 'browser-a' } };
  const key = runFingerprint(base);
  const prior = { runKey: key, stages: [{ name: 'integration', status: 'passed' }, { name: 'e2e', status: 'failed' }, { name: 'browser', status: 'passed' }] };
  assert.equal(reusableStage(prior, 'integration', key), true);
  assert.equal(reusableStage(prior, 'e2e', key), false);
  assert.equal(reusableStage(prior, 'browser', key), true);
  for (const changed of [
    { ...base, sourceSha256: 'source-b' }, { ...base, acceptanceInputsSha256: 'tests-b' },
    { ...base, artifactSha256: 'artifact-b' }, { ...base, scope: 'api' as const },
    { ...base, playwright: { path: '/tmp/playwright.mjs', sha256: 'pw-b' } },
    { ...base, browserExecutable: { path: '/tmp/chromium', sha256: 'browser-b' } },
  ]) assert.equal(reusableStage(prior, 'integration', runFingerprint(changed)), false);
  assert.equal(reusableStage(undefined, 'integration', key), false);
  const identityDrift = { stages: [{ name: 'integration', status: 'passed' }, { name: 'browser', status: 'passed' }] };
  assert.equal(reusableStage(identityDrift, 'integration', key), false, 'identity-drift reports must clear runKey before persistence');
});

test('external module and browser identities include file hashes, not paths alone', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'wombat-e2e-identities-'));
  try {
    const module = path.join(temp, 'playwright.mjs'), browser = path.join(temp, 'chromium');
    writeFileSync(module, 'module-a'); writeFileSync(browser, 'browser-a');
    const firstModule = externalFileIdentity(module), firstBrowser = externalFileIdentity(browser);
    writeFileSync(module, 'module-b'); writeFileSync(browser, 'browser-b');
    assert.equal(externalFileIdentity(module).path, firstModule.path);
    assert.notEqual(externalFileIdentity(module).sha256, firstModule.sha256);
    assert.equal(externalFileIdentity(browser).path, firstBrowser.path);
    assert.notEqual(externalFileIdentity(browser).sha256, firstBrowser.sha256);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('external Playwright package identity binds implementation contents and version', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'wombat-e2e-package-'));
  try {
    writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'playwright-core', version: '1.0.0' }));
    writeFileSync(path.join(temp, 'index.js'), 'implementation-a');
    const first = externalPackageIdentity(temp);
    writeFileSync(path.join(temp, 'index.js'), 'implementation-b');
    const changed = externalPackageIdentity(temp);
    assert.equal(changed.version, first.version);
    assert.notEqual(changed.sha256, first.sha256);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('acceptance fixture identity changes when a test or referenced integration asset changes', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'wombat-e2e-inputs-'));
  try {
    for (const directory of ['tests/integration', 'tests/e2e', 'integrations/codex/skills/wombat']) mkdirSync(path.join(temp, directory), { recursive: true });
    const testFile = path.join(temp, 'tests/e2e/example.test.ts'), fixture = path.join(temp, 'integrations/codex/skills/wombat/SKILL.md');
    writeFileSync(testFile, 'assert.equal(1, 1)'); writeFileSync(fixture, 'fixture-v1');
    const first = acceptanceInputIdentity(temp);
    writeFileSync(testFile, 'assert.equal(1, 2)');
    const changedTest = acceptanceInputIdentity(temp);
    assert.notEqual(changedTest, first);
    writeFileSync(fixture, 'fixture-v2');
    assert.notEqual(acceptanceInputIdentity(temp), changedTest);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('workspace package build outputs participate in the artifact resume identity', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'wombat-e2e-artifacts-'));
  try {
    mkdirSync(path.join(temp, 'dist'), { recursive: true }); writeFileSync(path.join(temp, 'dist/wombat.js'), 'root-cli');
    for (const packageName of ['client', 'cli', 'ui', 'web']) {
      mkdirSync(path.join(temp, packageName, 'dist'), { recursive: true });
      writeFileSync(path.join(temp, packageName, 'dist/index.js'), `${packageName}-v1`);
    }
    const first = currentArtifactIdentity(temp);
    const priorKey = runFingerprint({ sourceSha256: 'source', artifactSha256: first, acceptanceInputsSha256: 'tests', scope: 'api' });
    const prior = { runKey: priorKey, stages: [{ name: 'integration', status: 'passed' }] };
    writeFileSync(path.join(temp, 'client/dist/index.js'), 'client-v2');
    const changed = currentArtifactIdentity(temp);
    assert.notEqual(changed, first);
    assert.equal(reusableStage(prior, 'integration', runFingerprint({ sourceSha256: 'source', artifactSha256: changed, acceptanceInputsSha256: 'tests', scope: 'api' })), false);
    rmSync(path.join(temp, 'web/dist'), { recursive: true, force: true });
    assert.throws(() => currentArtifactIdentity(temp));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('bounded command execution reports success, nonzero exit, timeout, and missing executable', async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'wombat-e2e-process-'));
  const invoke = (name: string, args: string[], timeoutMs = 3000) => runBoundedCommand({ command: [process.execPath, ...args], cwd: temp, env: process.env,
    logFile: path.join(temp, `${name}.log`), timeoutMs, maxBytes: 64 * 1024 });
  try {
    const success = await invoke('success', ['-e', "process.stdout.write('synthetic-ok')"]);
    assert.equal(success.exitCode, 0); assert.equal(success.timedOut, false);
    const failure = await invoke('nonzero', ['-e', 'process.exit(7)']);
    assert.equal(failure.exitCode, 7); assert.equal(failure.timedOut, false);
    const timeout = await invoke('timeout', ['-e', 'setTimeout(()=>{},5000)'], 500);
    assert.equal(timeout.timedOut, true); assert.equal(timeout.closeTimedOut, false);
    const missing = await runBoundedCommand({ command: [path.join(temp, 'does-not-exist')], cwd: temp, env: process.env,
      logFile: path.join(temp, 'missing.log'), timeoutMs: 3000, maxBytes: 64 * 1024 });
    assert.match(missing.spawnError?.message ?? '', /ENOENT/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('timeout kills descendants even after the direct child exits on SIGTERM', async () => {
  if (process.platform === 'win32') return;
  const temp = mkdtempSync(path.join(os.tmpdir(), 'wombat-e2e-descendant-'));
  let descendant: number | undefined;
  const marker = path.join(temp, 'descendant-survived');
  try {
    const code = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e',${JSON.stringify(`process.on('SIGTERM',()=>{});setTimeout(()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'alive');process.exit(0)},3000)`)}],{stdio:'ignore'});console.log('DESCENDANT_PID='+child.pid);process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`;
    const result = await runBoundedCommand({ command: [process.execPath, '-e', code], cwd: temp, env: process.env,
      logFile: path.join(temp, 'tree.log'), timeoutMs: 600, maxBytes: 64 * 1024 });
    assert.equal(result.timedOut, true); assert.equal(result.closeTimedOut, false);
    const log = readFileSync(path.join(temp, 'tree.log'), 'utf8');
    const pid = /DESCENDANT_PID=(\d+)/.exec(log)?.[1]; assert(pid); descendant = Number(pid);
    await new Promise(resolve => setTimeout(resolve, 3200));
    assert.equal(existsSync(marker), false, 'descendant kept running after its parent exited');
  } finally {
    if (descendant && processExists(descendant)) { try { process.kill(descendant, 'SIGKILL'); } catch { /* Already exited. */ } }
    rmSync(temp, { recursive: true, force: true });
  }
});

function processExists(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

test('an output path reached through an existing symlink into the repository is rejected', () => {
  if (process.platform === 'win32') return;
  const temp = mkdtempSync(path.join(os.tmpdir(), 'wombat-e2e-output-'));
  try {
    const repo = path.join(temp, 'repo'), parent = path.join(temp, 'external');
    mkdirSync(repo); mkdirSync(parent);
    const link = path.join(parent, 'repo-link');
    writeFileSync(path.join(repo, 'marker'), 'synthetic');
    symlinkSync(repo, link, 'dir');
    assert.throws(() => assertExternalOutputDir(repo, path.join(link, 'reports')), /resolves inside the repository/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
