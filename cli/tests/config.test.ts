import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigArgs } from '../src/config-cli.js';
test('configuration arguments preserve scope and reject ambiguous flags', () => {
  const result = parseConfigArgs(['--root','/one','--root=/two','--project-root','/project','--kind','skill','--json']);
  assert.deepEqual(result.request.roots, ['/one','/two']);
  assert.deepEqual(result.request.projectRoots, ['/project']);
  assert.equal(result.request.kind, 'skill'); assert.equal(result.json, true);
  for (const args of [['--json=true'], ['--limit','0'], ['--limit','201'], ['--offset','1.5'], ['--kind','unknown'], ['--sort','name','--sort','size'], ['--write'], ['--project-root']]) assert.throws(() => parseConfigArgs(args));
});

test('all dates and measured-content sorts have unambiguous CLI contracts', () => {
  assert.equal(parseConfigArgs(['--all-time','--sort','content_tokens']).request.scope?.allTime,true);
  assert.throws(()=>parseConfigArgs(['--all-time','--since','2026-10-01']));
});
test('object review arguments retain versions and expose only narrow actions', async () => {
  const {parseOptimizeArgs}=await import('../src/optimize-cli.js');
  const r=parseOptimizeArgs(['mark-edited','--suggestion','one','--read-view','config:one','--decision-revision','2','--json']);
  assert.equal(r.request.action,'mark_edited');assert.equal(r.request.suggestionId,'one');assert.equal(r.request.decisionRevision,'2');
  assert.equal(parseOptimizeArgs(['history']).request.group,'history');
  for(const args of [['ignore'],['execute'],['list','--shell','anything'],['list','--limit','201'],['list','--json=true']])assert.throws(()=>parseOptimizeArgs(args));
});

test('product reminder overrides cannot change specification thresholds',async()=>{
 const {parseOptimizeArgs}=await import('../src/optimize-cli.js');
 assert.deepEqual(parseOptimizeArgs(['list','--agents-bytes','20000','--description-characters','1024']).request.ruleOverrides,{agentsBytes:20000,descriptionCharacters:1024});
 for(const args of [['--agents-bytes','0'],['--description-characters','1025'],['--description-characters','-1'],['--body-tokens','10000']])assert.throws(()=>parseOptimizeArgs(args));
});
