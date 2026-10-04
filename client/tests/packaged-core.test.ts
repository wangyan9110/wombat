import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {packagedCore} from '../src/node/packaged-core.js';
function fixture(run:(root:string,alias:string,target:string,save:(extra:object)=>void)=>void) {
 const root=realpathSync(mkdtempSync(path.join(os.tmpdir(),'wombat-platform-')));
 try {
  const target=process.platform+'-'+process.arch,alias='@example/wombat-'+target;mkdirSync(path.join(root,'dist'));
  writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@example/wombat',version:'0.3.0',wombat:{source:'same',platformPackages:{[target]:{alias,version:'0.3.0-'+target}}}}));
  const folder=path.join(root,'node_modules',...alias.split('/'));mkdirSync(path.join(folder,'vendor'),{recursive:true});
  const core=path.join(folder,'vendor',process.platform==='win32'?'wombat-core.exe':'wombat-core');writeFileSync(core,'synthetic executable');chmodSync(core,0o755);
  const save=(extra:object)=>writeFileSync(path.join(folder,'package.json'),JSON.stringify({name:'@example/wombat',version:'0.3.0-'+target,wombat:{target,source:'same'},...extra}));save({});run(root,alias,target,save);
 } finally {rmSync(root,{recursive:true,force:true});}
}
test('platform resolution uses only the declared matching npm alias',()=>fixture((root)=>{
 assert.equal(packagedCore(path.join(root,'dist')),path.join(root,'node_modules','@example','wombat-'+process.platform+'-'+process.arch,'vendor',process.platform==='win32'?'wombat-core.exe':'wombat-core'));
}));
test('missing dependencies, mismatched versions and sources fail without developer fallback',()=>fixture((root,alias,target,save)=>{
 for(const extra of [{version:'other'},{name:'other'},{wombat:{target,source:'other'}}]) {save(extra);assert.throws(()=>packagedCore(path.join(root,'dist')),{code:'CORE_UNAVAILABLE'});}
 rmSync(path.join(root,'node_modules'),{recursive:true});assert.throws(()=>packagedCore(path.join(root,'dist')),/include=optional/);
}));
test('unsupported targets fail, while development builds retain native resolution',()=>fixture((root)=>{
 writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@example/wombat',version:'0.3.0',wombat:{platformPackages:{}}}));assert.throws(()=>packagedCore(path.join(root,'dist')),{code:'UNSUPPORTED_PLATFORM'});
 writeFileSync(path.join(root,'package.json'),'{}');assert.equal(packagedCore(path.join(root,'dist')),undefined);
}));
