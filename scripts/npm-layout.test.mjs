import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {nativeTargets} from './native-platforms.ts';import {platformPackages,optionalPackages,npmNodeEngine} from './npm-layout.ts';import {builtFiles,sourceIdentity,checkBuild} from './build-identity.ts';
test('five optional aliases pin exact platform versions under the single selected package name',()=>{
 const aliases=platformPackages('@example/wombat','0.3.0',nativeTargets),dependencies=optionalPackages('@example/wombat','0.3.0',nativeTargets);
 assert.equal(Object.keys(aliases).length,5);assert.equal(npmNodeEngine,'>=22.0.0');
 for(const target of nativeTargets){assert.deepEqual(aliases[target],{alias:'@example/wombat-'+target,version:'0.3.0-'+target});assert.equal(dependencies[aliases[target].alias],'npm:@example/wombat@0.3.0-'+target);}
 assert.equal(optionalPackages('@example/wombat','0.3.0-beta.1',['darwin-arm64'])['@example/wombat-darwin-arm64'],'npm:@example/wombat@0.3.0-beta.1-darwin-arm64');
});
test('build reuse rejects changed source and missing or modified output',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'wombat-build-receipt-'));
 try{execFileSync('git',['init','--quiet',root]);writeFileSync(path.join(root,'.gitignore'),'dist/\n');mkdirSync(path.join(root,'scripts'));mkdirSync(path.join(root,'dist'));
 const source=path.join(root,'scripts/source.ts'),output=path.join(root,'dist/wombat.js');writeFileSync(source,'source');writeFileSync(output,'output');
 writeFileSync(path.join(root,'dist/build.json'),JSON.stringify({format:1,target:process.platform+'-'+process.arch,sourceSha256:sourceIdentity(root),files:builtFiles(root)}));checkBuild(root);
 writeFileSync(source,'changed');assert.throws(()=>checkBuild(root),/stale/);writeFileSync(source,'source');writeFileSync(output,'changed');assert.throws(()=>checkBuild(root),/stale/);rmSync(output);assert.throws(()=>checkBuild(root),/stale/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
