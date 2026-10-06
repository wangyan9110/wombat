import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs/promises';
import {parseArgs} from 'node:util';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const name='wombat-event-upgrade-2026-10-04';
const limit=64*1024*1024;
const owners=[
 'ui/src/preview/main.tsx','ui/src/preview/execution.tsx','ui/src/preview/fixtures.ts',
 'ui/src/ThreadsView.tsx','ui/src/tasks/TurnExecution.tsx','ui/src/tasks/Uses.tsx',
 'ui/src/OptimizeView.tsx','ui/src/ConfigView.tsx','ui/src/preview/startup.ts',
 'ui/src/preview/account.ts','ui/src/preview/handoff.ts','ui/src/reference.css',
 'docs/decisions/proposed/architecture/2026-10-04-event-delivery.md',
];
type Entry={file:string;bytes:number;sha256:string};
type Manifest={version:1;source:string;files:Entry[];audits:Entry[];owners:Entry[];acceptance:'requires-U19'};
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const inside=(root:string,target:string)=>{const r=path.relative(root,target);return r===''||!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);};
async function regular(file:string){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('Expected a bounded regular prototype file');return stat;}
async function inventory(root:string):Promise<Entry[]>{
 const entries:Entry[]=[];let bytes=0;
 async function walk(dir:string){
  for(const item of await fs.readdir(dir,{withFileTypes:true})){
   const file=path.join(dir,item.name);
   if(item.isSymbolicLink())throw Error('Prototype symlinks are refused');
   if(item.isDirectory()){await walk(file);continue;}
   if(!/\.(?:html|css|js|ts|cjs|md|png|json)$/.test(item.name))throw Error('Unexpected file in prototype scope');
   await regular(file);const content=await fs.readFile(file);bytes+=content.length;
   if(content.length>8*1024*1024||bytes>limit||entries.length>=256)throw Error('Prototype inventory exceeds its budget');
   entries.push({file:path.relative(root,file),bytes:content.length,sha256:digest(content)});
  }
 }
 await walk(root);return entries.sort((a,b)=>a.file.localeCompare(b.file));
}
async function validateArchive(evidence:string,source:string):Promise<Manifest>{
 await regular(path.join(evidence,'retirement.json'));
 const manifest:unknown=JSON.parse(await fs.readFile(path.join(evidence,'retirement.json'),'utf8'));
 if(!manifest||typeof manifest!=='object'||!('version' in manifest)||manifest.version!==1
  ||!('source' in manifest)||manifest.source!==source||!('files' in manifest)||!Array.isArray(manifest.files)
  ||!('audits' in manifest)||!Array.isArray(manifest.audits)||!('owners' in manifest)||!Array.isArray(manifest.owners)
  ||!('acceptance' in manifest)||manifest.acceptance!=='requires-U19')throw Error('Unsupported retirement evidence');
 const value=manifest as Manifest;
 for(const entry of [...value.files,...value.audits,...value.owners]){
  if(!entry||typeof entry.file!=='string'||path.isAbsolute(entry.file)||entry.file.split(/[\\/]/).includes('..')
   ||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid retirement inventory');
 }
 if(value.files.length>256||value.audits.some(a=>!a.file.endsWith('.json')||!value.files.some(f=>f.file===a.file&&f.sha256===a.sha256&&f.bytes===a.bytes)))throw Error('Invalid audit inventory');
 const actual=await inventory(path.join(evidence,'audits'));
 if(JSON.stringify(actual)!==JSON.stringify(value.audits))throw Error('Archived evidence differs from its inventory');
 return value;
}
async function noSymlinkAncestors(target:string){
 let at=target;
 for(;;){try{if((await fs.lstat(at)).isSymbolicLink())throw Error('Output symlink refused');}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
  const parent=path.dirname(at);if(parent===at)break;at=parent;}
}
export async function retirePrototype(input:{source:string;evidence:string;apply?:boolean}){
 const source=path.resolve(input.source),evidence=path.resolve(input.evidence),frozen=source+'.retiring';
 if(path.basename(source)!==name||inside(repo,source)||inside(source,evidence)||inside(evidence,source)||inside(repo,evidence))throw Error('Retirement requires the authorized external prototype and external evidence directory');
 await noSymlinkAncestors(source);await noSymlinkAncestors(evidence);await noSymlinkAncestors(frozen);
 const targets:Entry[]=[];
 for(const owner of owners){await regular(path.join(repo,owner));const bytes=await fs.readFile(path.join(repo,owner));targets.push({file:owner,bytes:bytes.length,sha256:digest(bytes)});}
 let files:Entry[];
 try{if(!(await fs.lstat(source)).isDirectory())throw Error('Prototype must be a directory');files=await inventory(source);}
 catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;
  const prior=await validateArchive(evidence,source);
  let remaining:Entry[];try{remaining=await inventory(frozen);}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ENOENT')return {state:'already-retired',files:prior.files.length,audits:prior.audits.length,acceptance:prior.acceptance};throw error;}
  if(remaining.some(item=>!prior.files.some(old=>old.file===item.file&&old.bytes===item.bytes&&old.sha256===item.sha256)))throw Error('Interrupted retirement contains changed files');
  if(input.apply)await fs.rm(frozen,{recursive:true});
  return {state:input.apply?'retired':'ready-to-resume',files:prior.files.length,audits:prior.audits.length,acceptance:prior.acceptance};}
 if(!files.some(f=>f.file==='wombat-gui.html'))throw Error('Expected prototype entry is missing');
 const tracked=execFileSync('git',['-C',source,'ls-files','-z','--','.'],{timeout:5000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});
 if(tracked.length)throw Error('Tracked prototype files require separate review');
 const audits=files.filter(entry=>entry.file.endsWith('.json'));
 if(!input.apply)return {state:'ready',files:files.length,audits:audits.length,acceptance:'requires-U19'};
 // Save historical audit data only; never archive a second HTML/CSS/JS implementation.
 let present=false;try{await fs.lstat(evidence);present=true;}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
 if(present){const prior=await validateArchive(evidence,source);if(JSON.stringify(prior.files)!==JSON.stringify(files))throw Error('Prototype changed after the saved inventory');}
 else{
  await fs.mkdir(path.dirname(evidence),{recursive:true});const staging=evidence+'.writing-'+randomUUID();await fs.mkdir(path.join(staging,'audits'),{recursive:true});
  try{for(const entry of audits){const to=path.join(staging,'audits',entry.file);await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(path.join(source,entry.file),to);}
   const manifest:Manifest={version:1,source,files,audits,owners:targets,acceptance:'requires-U19'};
   await fs.writeFile(path.join(staging,'retirement.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
   await validateArchive(staging,source);await fs.rename(staging,evidence);
  }finally{await fs.rm(staging,{recursive:true,force:true});}
 }
 // Freeze and recheck the exact source before removal; changes restore the original path.
 try{await fs.lstat(frozen);throw Error('Another retirement directory already exists');}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
 await fs.rename(source,frozen);
 if(JSON.stringify(await inventory(frozen))!==JSON.stringify(files)){await fs.rename(frozen,source);throw Error('Prototype changed before retirement');}
 await fs.rm(frozen,{recursive:true});
 return {state:'retired',files:files.length,audits:audits.length,acceptance:'requires-U19'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args[0]==='--')args.shift();
 const {values}=parseArgs({args,options:{source:{type:'string'},evidence:{type:'string'},apply:{type:'boolean',default:false}},allowPositionals:false});
 if(!values.source||!values.evidence)throw Error('Provide --source and --evidence; --apply performs retirement');
 console.log(JSON.stringify(await retirePrototype({source:values.source,evidence:values.evidence,apply:values.apply})));
}
