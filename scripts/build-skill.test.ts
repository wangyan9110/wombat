import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {buildSkill} from './build-skill.ts';import {inventory} from './artifact-files.ts';
test('plugin and standalone resources derive from one Skill source with matching inventory and version',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=mkdtempSync(path.join(os.tmpdir(),'wombat-skill-package-'));
  try{
    buildSkill(root,path.join(dir,'skill'));const output=path.join(dir,'skill');
    const metadata=JSON.parse(readFileSync(path.join(output,'manifest.json'),'utf8'));
    assert.deepEqual(metadata.files,inventory(path.join(root,'plugin/skills/wombat')));
    assert.deepEqual(metadata.files,inventory(path.join(output,'wombat')));
    assert.deepEqual(inventory(path.join(output,'wombat')),inventory(path.join(output,'plugin/skills/wombat')));
    const portable=JSON.parse(readFileSync(path.join(output,'plugin/plugin.json'),'utf8')),compat=JSON.parse(readFileSync(path.join(output,'plugin/.codex-plugin/plugin.json'),'utf8'));
    assert.equal(portable.version,JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version);assert.equal(compat.version,portable.version);
    const catalog=JSON.parse(readFileSync(path.join(output,'.agents/plugins/marketplace.json'),'utf8'));
    assert.equal(path.resolve(output,catalog.plugins[0].source.path),path.join(output,'plugin'));
    assert.ok(!JSON.stringify(portable).includes(root));
    assert.equal(portable.extensions['com.openai'].hooks,undefined);
    for(const directory of ['hooks','scripts'])assert.equal(existsSync(path.join(output,'plugin',directory)),false);
    const collected=path.join(output,'collection-plugin');
    const collectionManifest=JSON.parse(readFileSync(path.join(collected,'.codex-plugin/plugin.json'),'utf8'));
    assert.equal(collectionManifest.name,'wombat-collection');
    assert.equal(collectionManifest.hooks,'./hooks/hooks.json');
    assert.equal(existsSync(path.join(collected,'plugin.json')),false);
    assert.deepEqual(inventory(path.join(collected,'skills/wombat')),metadata.files);
    for(const directory of ['hooks','scripts'])assert.deepEqual(inventory(path.join(collected,directory)),inventory(path.join(root,'plugin',directory)));
    const hooks=JSON.parse(readFileSync(path.join(collected,'hooks/hooks.json'),'utf8'));
    assert.equal(Object.keys(hooks.hooks).length,10);
    for(const definitions of Object.values(hooks.hooks))for(const definition of definitions as {hooks:{async:boolean;timeout:number;command:string}[]}[]) {
      assert.equal(definition.hooks[0].async,true);assert.equal(definition.hooks[0].timeout,5);
      assert.equal(definition.hooks[0].command,'sh "${PLUGIN_ROOT}/scripts/collect.sh"');
    }
    assert.equal(catalog.plugins[1].source.path,'./collection-plugin');
    const runtime=JSON.parse(readFileSync(path.join(output,'plugin/wombat-runtime.json'),'utf8'));assert.deepEqual(runtime.requiredCapabilities,metadata.requiredCapabilities);assert.equal(runtime.skillContentHash,metadata.contentHash);assert.equal(runtime.version,portable.version);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
