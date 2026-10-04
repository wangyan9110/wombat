// Prepare the npm launcher and platform-version packages; never publish.
import {spawnSync} from 'node:child_process';
import {chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {npmReadme} from './npm-readme.ts';
import {checkedSourceRevision, currentNativeTarget, inspectNative, nativeBinary, nativeTargets} from './native-platforms.ts';
import {toolCommand} from './run-tool.ts';
import {checkBuild} from './build-identity.ts';
import {hashFile} from './artifact-files.ts';
import {npmNodeEngine, optionalPackages, platformPackages, type NpmReleaseSet} from './npm-layout.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {values} = parseArgs({args: process.argv.slice(2).filter(arg => arg !== '--'), options: {
  name: {type:'string'}, 'public-ref': {type:'string', default:'main'}, 'native-dir': {type:'string'},
  'current-platform': {type:'boolean', default:false}, 'reuse-build': {type:'boolean', default:false},
}});
const name = values.name;
if (!name || name === 'wombat' || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)) throw new Error('Supply --name with an npm name you own');
if (Boolean(values['native-dir']) === values['current-platform']) throw new Error('Choose --native-dir <five-platform-artifacts> or --current-platform (local candidate only)');
const publicRef = values['public-ref']!; npmReadme('', publicRef);
function run(program: string, argv: string[], capture = false, cwd = root): string {
  const result = spawnSync(...toolCommand(program, argv), {cwd, encoding:'utf8', stdio:capture?'pipe':'inherit',timeout:900000,maxBuffer:16*1024*1024});
  if (result.error || result.status !== 0) throw new Error(`${program}: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout ?? '';
}
const source = JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
const revision = run('git',['rev-parse','HEAD'],true).trim();
const targets = values['current-platform'] ? [currentNativeTarget()] : [...nativeTargets];
const nativeDirectory = values['native-dir'] ? path.resolve(values['native-dir']) : undefined;
if (nativeDirectory) {
  checkedSourceRevision();
  for (const target of targets) inspectNative(nativeDirectory,target,source.version,revision);
}
if (!values['reuse-build']) run('corepack',['pnpm','release:check']);
checkBuild(root);
const listing = JSON.parse(run('npm',['pack','--dry-run','--ignore-scripts','--json','--cache',path.join(os.tmpdir(),'wombat-npm-pack-cache')],true));
if (listing.length !== 1) throw new Error('Expected one source package inventory');
const destination = path.join(root,'dist/npm'); mkdirSync(destination,{recursive:true});
const output = mkdtempSync(path.join(destination,`${name.replace(/[^a-z0-9-]/g,'-')}-${source.version}-`));
const set: NpmReleaseSet = {format:1,name,version:source.version,source:revision,candidateOnly:values['current-platform'],targets,packages:[]};
let complete = false;
try {
  const makePackage = (directory: string, metadata: Record<string,unknown>, target: NpmReleaseSet['packages'][number]['target']) => {
    writeFileSync(path.join(directory,'package.json'),JSON.stringify(metadata,null,2)+'\n');
    const packed = JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',output,'--cache',path.join(output,'.npm-cache')],true,directory));
    if (packed.length !== 1) throw new Error('Expected one npm archive');
    set.packages.push({name:metadata.name as string,version:metadata.version as string,target,archive:packed[0].filename,sha256:hashFile(path.join(output,packed[0].filename)),metadata});
  };
  for (const target of targets) {
    const stage = path.join(output,'stage-'+target), vendor = path.join(stage,'vendor'); mkdirSync(path.join(vendor,'licenses'),{recursive:true});
    const core = nativeBinary(target);
    copyFileSync(path.join(nativeDirectory ? path.join(nativeDirectory,target) : path.join(root,'dist'),core),path.join(vendor,core)); chmodSync(path.join(vendor,core),0o755);
    for (const [file,local] of [['node-dependencies.txt','licenses/node-dependencies.txt'],['rust-dependencies.txt','licenses/rust-dependencies.txt'],['inventory.json','docs/dependency-licenses.json']]) {
      const from = nativeDirectory ? path.join(nativeDirectory,target,'licenses',file) : path.join(root,local);
      if (!existsSync(from)) throw new Error('Missing platform notice: '+from);
      copyFileSync(from,path.join(vendor,'licenses',file));
    }
    copyFileSync(path.join(root,'LICENSE'),path.join(stage,'LICENSE'));
    const [osName,cpu] = target.split('-');
    makePackage(stage,{name,version:source.version+'-'+target,description:source.description,license:source.license,repository:source.repository,
      os:[osName],cpu:[cpu],...(osName==='linux'?{libc:['glibc']}:{}),engines:{node:npmNodeEngine},files:['vendor/','LICENSE'],
      wombat:{target,source:revision,coreSha256:hashFile(path.join(vendor,core)),candidateOnly:values['current-platform']}},target);
    rmSync(stage,{recursive:true,force:true});
  }
  const stage = path.join(output,'stage-main'); mkdirSync(stage);
  for (const {path:relative} of listing[0].files) {
    if (relative==='package.json' || /^dist\/(?:native\/|licenses\/|wombat-core(?:\.exe)?$)/.test(relative)) continue;
    const from = path.resolve(root,relative); if (!from.startsWith(root+path.sep)) throw new Error('Unsafe package path');
    const to = path.join(stage,relative); mkdirSync(path.dirname(to),{recursive:true});copyFileSync(from,to);
  }
  chmodSync(path.join(stage,'dist/wombat.js'),0o755);
  for (const file of ['README.md','README.zh-CN.md']) writeFileSync(path.join(stage,file),npmReadme(readFileSync(path.join(stage,file),'utf8'),publicRef));
  makePackage(stage,{name,version:source.version,description:source.description,keywords:source.keywords,repository:source.repository,homepage:source.homepage,bugs:source.bugs,
    type:'module',license:source.license,engines:{node:npmNodeEngine},os:[...new Set(targets.map(t=>t.split('-')[0]))],cpu:[...new Set(targets.map(t=>t.split('-')[1]))],
    bin:{wombat:'./dist/wombat.js'},files:source.files.filter((file:string)=>!['dist/wombat-core','dist/wombat-core.exe','dist/licenses/'].includes(file)),optionalDependencies:optionalPackages(name,source.version,targets),
    publishConfig:{access:'public'},wombat:{targets,source:revision,candidateOnly:values['current-platform'],platformPackages:platformPackages(name,source.version,targets)}},'main');
  rmSync(stage,{recursive:true,force:true}); rmSync(path.join(output,'.npm-cache'),{recursive:true,force:true});
  writeFileSync(path.join(output,'release-set.json'),JSON.stringify(set,null,2)+'\n');
  run(process.execPath,['scripts/verify-npm-install.ts','--set',path.join(output,'release-set.json')]);
  checkBuild(root);
  complete = true;
  console.log(`npm candidate set: ${output}\n${targets.length} platform package(s) + one main package; installation verified. No publication performed.`);
} finally {if (!complete) rmSync(output,{recursive:true,force:true});}
