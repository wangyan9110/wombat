import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {installBundledPlugin} from './install-plugin-bootstrap.ts';
import {embedBootstrap, generateInstallers, installerDependencyNotice} from './generate-installers.ts';

function fixture(t: {after: (fn: () => void) => void}, scenario = 'fresh') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-plugin-stage-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const marketplace = path.join(root, '插件 & catalog'), binary = path.join(root, 'native.mjs'), trace = path.join(root, 'calls.jsonl');
  mkdirSync(path.join(marketplace, '.agents/plugins'), {recursive: true});
  writeFileSync(path.join(marketplace, '.agents/plugins/marketplace.json'), JSON.stringify({name: 'wombat-local', plugins: ['wombat', 'wombat-collection'].map(name => ({name, source: {source: 'local', path: name === 'wombat' ? './plugin' : './collection-plugin'}}))}));
  writeFileSync(binary, `import{appendFileSync}from'node:fs';const args=process.argv.slice(2),scenario=process.env.SCENARIO;appendFileSync(process.env.TRACE,JSON.stringify(args)+'\\n');
if(scenario==='timeout')setInterval(()=>{},1000);
else if(scenario==='failure')process.exit(9);
else if(scenario==='large')console.log('x'.repeat(1100000));
else if(scenario==='invalid')console.log('{}');
else if(args[1]==='list')console.log(JSON.stringify({installed:scenario==='collection'||scenario.startsWith('upgrade')?[{enabled:true,pluginId:'wombat-collection@wombat-local'}]:scenario==='conflict'?['wombat','wombat-collection'].map(name=>({enabled:true,pluginId:name+'@wombat-local'})):[]}));
else if(args[1]==='marketplace'&&args[2]==='list')console.log(JSON.stringify({marketplaces:scenario.startsWith('upgrade')?[{name:'wombat-local',marketplaceSource:{sourceType:'local',source:process.env.OLD_SOURCE}}]:scenario==='foreign'?[{name:'wombat-local',marketplaceSource:{sourceType:'remote',source:'https://example.test'}}]:[]}));
else if(scenario==='upgrade-failure'&&args[1]==='add')process.exit(9);
else if(args[1]==='add')console.log(JSON.stringify({pluginId:args[2],installedPath:process.env.INSTALLED}));
else console.log('ok');`);
  return {root, marketplace, binary, trace, env: {...process.env, SCENARIO: scenario, TRACE: trace, INSTALLED: path.join(root, 'installed'), OLD_SOURCE: path.join(root, 'old/lib/skill')}};
}
function calls(file: string): string[][] {return readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));}

test('installer notices use actual license filenames on case-sensitive filesystems', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-installer-notices-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const [index, name] of ['LICENSE', 'license', 'License', 'LICENSE.md', 'license.md', 'LICENSE.txt', 'license.txt'].entries()) {
    const directory = path.join(root, 'case-' + index);
    mkdirSync(directory);
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({name: 'synthetic-dependency', version: '1.0.0', license: 'MIT'}));
    writeFileSync(path.join(directory, name), 'Synthetic license text: ' + name);
    assert.equal(installerDependencyNotice(directory), 'synthetic-dependency@1.0.0\nSynthetic license text: ' + name);
  }
});
test('installer notices reject missing files, directories and unreviewed licenses', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-installer-notices-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'synthetic-dependency', version: '1.0.0', license: 'ISC'}));
  writeFileSync(path.join(root, 'readme.md'), 'This file is not a license.');
  assert.throws(() => installerDependencyNotice(root), /notice missing/);
  mkdirSync(path.join(root, 'LICENSE'));
  assert.throws(() => installerDependencyNotice(root), /notice missing/);
  writeFileSync(path.join(root, 'license.txt'), 'Synthetic ISC license text.');
  assert.match(installerDependencyNotice(root), /Synthetic ISC license text/);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'synthetic-dependency', version: '1.0.0', license: 'unknown'}));
  assert.throws(() => installerDependencyNotice(root), /Review installer dependency license/);
});

for (const scenario of ['fresh', 'collection', 'upgrade']) test('plugin installer uses native management: ' + scenario, async t => {
  const f = fixture(t, scenario);
  assert.equal(await installBundledPlugin(f.marketplace, f), scenario === 'fresh' ? 'wombat' : 'wombat-collection');
  const trace = calls(f.trace);
  assert.deepEqual(trace[0], ['plugin', 'list', '--marketplace', 'wombat-local', '--json']);
  assert.deepEqual(trace[1], ['plugin', 'marketplace', 'list', '--json']);
  if (scenario === 'upgrade') assert.deepEqual(trace[2], ['plugin', 'marketplace', 'remove', 'wombat-local']);
  assert.deepEqual(trace.at(-2), ['plugin', 'marketplace', 'add', f.marketplace]);
  assert.deepEqual(trace.at(-1), ['plugin', 'add', (scenario === 'fresh' ? 'wombat' : 'wombat-collection') + '@wombat-local', '--json']);
  assert.equal(trace.some(args => args.includes('hooks') || args.includes('trust')), false);
});
for (const [scenario, message] of [['conflict', /Multiple Wombat/], ['foreign', /not local/], ['invalid', /Unrecognized/], ['failure', /Wombat is installed/], ['large', /Wombat is installed/], ['timeout', /Wombat is installed/]] as const) test('plugin installer stops on ' + scenario, async t => {
  const f = fixture(t, scenario);
  await assert.rejects(installBundledPlugin(f.marketplace, {...f, timeoutMs: scenario === 'timeout' ? 500 : 3000}), message);
  assert.equal(calls(f.trace).some(args => args[1] === 'add'), false);
});
test('plugin installer rejects missing Codex and invalid catalogs', async t => {
  const f = fixture(t);
  await assert.rejects(installBundledPlugin(f.marketplace, {binary: path.join(f.root, 'missing')}), /Wombat is installed/);
  writeFileSync(path.join(f.marketplace, '.agents/plugins/marketplace.json'), '{"name":"foreign","plugins":[]}');
  await assert.rejects(installBundledPlugin(f.marketplace, f), /Invalid bundled/);
});
test('installer bootstrap region validation rejects missing, reversed and duplicated regions', () => {
  const begin = '// BEGIN generated Wombat plugin bootstrap', end = '// END generated Wombat plugin bootstrap';
  assert.equal(embedBootstrap('before\n' + begin + '\nold\n' + end + '\nafter', 'new\n'), 'before\n' + begin + '\nnew\n' + end + '\nafter');
  for (const invalid of ['', end + begin, begin + end + begin, begin + end + end]) assert.throws(() => embedBootstrap(invalid, 'new'), /one closed/);
});
test('installer aggregate detects generated drift without modifying files', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-installer-generation-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(path.join(root, 'scripts/install'), {recursive: true});
  writeFileSync(path.join(root, 'scripts/install-plugin-bootstrap.ts'), 'console.log("fixture");');
  for (const name of ['install.sh', 'install.ps1']) writeFileSync(path.join(root, 'scripts/install', name), '// BEGIN generated Wombat plugin bootstrap\nstale\n// END generated Wombat plugin bootstrap\n');
  assert.throws(() => generateInstallers(root, true), /stale/);
  assert.match(readFileSync(path.join(root, 'scripts/install/install.sh'), 'utf8'), /stale/);
  generateInstallers(root, false); generateInstallers(root, true);
  assert.equal(readFileSync(path.join(root, 'scripts/install/install.sh'), 'utf8'), readFileSync(path.join(root, 'scripts/install/install.ps1'), 'utf8'));
});

test('failed upgrade restores the previous marketplace source', async t => {
  const f = fixture(t, 'upgrade-failure');
  await assert.rejects(installBundledPlugin(f.marketplace, f), /Wombat is installed/);
  assert.deepEqual(calls(f.trace).slice(-2), [['plugin', 'marketplace', 'remove', 'wombat-local'], ['plugin', 'marketplace', 'add', f.env.OLD_SOURCE]]);
});
