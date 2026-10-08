import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,cp} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {manageSkill} from '@wombat/client/node';
import {nativeCodexFixture} from '../../tests/helpers/native-codex.js';

test('standalone installation protects ownership, modified content, links and source integrity',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'wombat-skill-install-'));
  try{
    const native=await nativeCodexFixture(root),directory=path.join(root,'installed/wombat');
    const options={resourcesPath:path.resolve('..','dist/skill'),codexBinaryPath:native.binary};const input={directory,cwd:root};
    const installed=await manageSkill('install',input,{},options);
    assert.equal(installed.status,'installed');assert.equal(installed.dataStatus,'not_requested');assert.equal(installed.discovery.status,'available');
    await assert.rejects(manageSkill('install',input,{},options),{code:'SKILL_INSTALL_CONFLICT'});
    await manageSkill('install',{...input,replace:true},{},options);
    const corrupt=path.join(root,'corrupt');await cp(options.resourcesPath,corrupt,{recursive:true});await writeFile(path.join(corrupt,'wombat/SKILL.md'),'corrupt');
    const before=await readFile(path.join(directory,'SKILL.md'),'utf8');
    await assert.rejects(manageSkill('install',{...input,replace:true},{},{...options,resourcesPath:corrupt}),{code:'SKILL_RESOURCE_CHANGED'});
    assert.equal(await readFile(path.join(directory,'SKILL.md'),'utf8'),before);
    const entry=path.join(directory,'SKILL.md');await writeFile(entry,'user customization');
    assert.equal((await manageSkill('status',input,{},options)).status,'modified');
    for(const action of ['install','uninstall'] as const)await assert.rejects(manageSkill(action,{...input,replace:true},{},options),{code:'SKILL_INSTALL_CONFLICT'});
    assert.equal(await readFile(entry,'utf8'),'user customization');
    await rm(directory,{recursive:true});await manageSkill('install',input,{},options);
    await manageSkill('uninstall',input,{},options);assert.equal((await manageSkill('status',input,{},options)).status,'absent');
    await mkdir(directory);await writeFile(entry,'custom');
    await assert.rejects(manageSkill('uninstall',input,{},options),{code:'SKILL_INSTALL_CONFLICT'});
    await rm(directory,{recursive:true});const target=path.join(root,'target');await mkdir(target);await symlink(target,directory,process.platform==='win32'?'junction':'dir');
    await assert.rejects(manageSkill('install',{...input,replace:true},{},options),{code:'SKILL_INSTALL_CONFLICT'});
    await writeFile(path.join(target,'preserved'),'yes');await assert.rejects(manageSkill('uninstall',input,{},options),{code:'SKILL_INSTALL_CONFLICT'});
    assert.equal(await readFile(path.join(target,'preserved'),'utf8'),'yes');
    await native.waitForExit();
  }finally{await rm(root,{recursive:true,force:true});}
});
