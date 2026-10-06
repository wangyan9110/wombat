import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs/promises';
import {retirePrototype} from './retire-prototype.js';
async function fixture(){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'wombat-retire-')));
 execFileSync('git',['init','-q',root],{timeout:5000,maxBuffer:1024*1024,stdio:'pipe'});
 const source=path.join(root,'wombat-event-upgrade-2026-10-04'),evidence=path.join(root,'evidence');
 await fs.mkdir(source);await fs.writeFile(path.join(source,'wombat-gui.html'),'<h1>Synthetic prototype</h1>');
 await fs.writeFile(path.join(source,'result.json'),'{}\n');await fs.writeFile(path.join(source,'styles.css'),'body{color:black}');
 return {root,source,evidence,close:()=>fs.rm(root,{recursive:true,force:true})};
}
test('retirement preserves historical JSON only, removes the duplicate implementation and resumes idempotently',async()=>{
 const f=await fixture();try{
  assert.equal((await retirePrototype(f)).state,'ready');assert.ok(await fs.stat(f.source));
  const result=await retirePrototype({...f,apply:true});assert.equal(result.state,'retired');assert.equal(result.acceptance,'requires-U19');
  await assert.rejects(fs.stat(f.source),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(f.evidence,'audits/result.json'),'utf8'),'{}\n');
  assert.deepEqual((await fs.readdir(path.join(f.evidence,'audits'))),['result.json']);
  assert.equal((await retirePrototype({...f,apply:true})).state,'already-retired');
  await fs.writeFile(path.join(f.evidence,'audits/result.json'),'changed');
  await assert.rejects(retirePrototype({...f,apply:true}),/Archived evidence differs/);
 }finally{await f.close();}
});
test('retirement rejects tracked files, symlinks and output inside the source without deleting user files',async()=>{
 const f=await fixture();try{
  await assert.rejects(retirePrototype({...f,evidence:path.join(f.source,'archive'),apply:true}),/external/);
  await fs.symlink(path.join(f.root,'outside'),path.join(f.source,'extra.js'));
  await assert.rejects(retirePrototype({...f,apply:true}),/symlinks/);
  await fs.unlink(path.join(f.source,'extra.js'));
  execFileSync('git',['-C',f.root,'add','--',path.relative(f.root,path.join(f.source,'wombat-gui.html'))],{timeout:5000,maxBuffer:1024*1024,stdio:'pipe'});
  await assert.rejects(retirePrototype({...f,apply:true}),/Tracked/);
  assert.equal(await fs.readFile(path.join(f.source,'styles.css'),'utf8'),'body{color:black}');
 }finally{await f.close();}
});
test('interrupted removal only resumes unchanged inventoried files, with current-format audit validation',async()=>{
 const f=await fixture();try{
  await retirePrototype({...f,apply:true});
  const frozen=f.source+'.retiring';await fs.mkdir(frozen);await fs.writeFile(path.join(frozen,'styles.css'),'body{color:black}');
  assert.equal((await retirePrototype(f)).state,'ready-to-resume');
  await fs.writeFile(path.join(frozen,'extra.js'),'new user work');
  await assert.rejects(retirePrototype({...f,apply:true}),/changed files/);assert.ok(await fs.stat(frozen));
  await fs.unlink(path.join(frozen,'extra.js'));assert.equal((await retirePrototype({...f,apply:true})).state,'retired');
  const manifest=JSON.parse(await fs.readFile(path.join(f.evidence,'retirement.json'),'utf8'));manifest.version=2;
  await fs.writeFile(path.join(f.evidence,'retirement.json'),JSON.stringify(manifest));
  await assert.rejects(retirePrototype({...f,apply:true}),/Unsupported/);
 }finally{await f.close();}
});
