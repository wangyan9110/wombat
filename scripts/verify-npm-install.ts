/** Serve exact candidate tarballs on loopback and exercise npm's real alias/platform selection. */
import assert from 'node:assert/strict';
import {execFile, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {appendFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs, promisify} from 'node:util';
import {toolCommand} from './run-tool.ts';
import {hashFile, inventory} from './artifact-files.ts';
import type {NpmReleaseSet} from './npm-layout.ts';
const {values} = parseArgs({options:{set:{type:'string'},runtime:{type:'string'}}});
assert(values.set,'--set is required');
const setFile = path.resolve(values.set), set: NpmReleaseSet = JSON.parse(readFileSync(setFile,'utf8'));
assert.equal(set.format,1);assert.equal(set.packages.length,set.targets.length+1);
const target = process.platform+'-'+process.arch;
assert(set.targets.includes(target as NpmReleaseSet['targets'][number]));
const files = new Map(set.packages.map(p=>[p.archive,p]));
for (const item of set.packages) {
  assert.equal(path.basename(item.archive),item.archive); assert.equal(item.name,set.name);
  assert.equal(hashFile(path.join(path.dirname(setFile),item.archive)),item.sha256,'Archive hash mismatch');
}
const scratch = mkdtempSync(path.join(os.tmpdir(),'wombat npm install '));
const downloads: string[] = [];
let origin = '';
const server = createServer((request,response)=>{
  let route: string;
  try {route = decodeURIComponent(new URL(request.url!,origin).pathname);} catch {response.writeHead(400).end();return;}
  if (route === '/'+set.name) {
    const versions = Object.fromEntries(set.packages.map(p=>[p.version,{...p.metadata,dist:{tarball:origin+'/tar/'+p.archive,integrity:'sha512-'+createHash('sha512').update(readFileSync(path.join(path.dirname(setFile),p.archive))).digest('base64')}}]));
    response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({name:set.name,'dist-tags':{latest:set.version},versions})); return;
  }
  const file = route.startsWith('/tar/')?files.get(route.slice(5)):undefined;
  if (!file) {response.writeHead(404).end();return;}
  downloads.push(file.archive); response.writeHead(200,{'Content-Type':'application/octet-stream'});
  const stream = createReadStream(path.join(path.dirname(setFile),file.archive)); stream.on('error',()=>response.destroy());stream.pipe(response);
});
try {
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  origin = 'http://127.0.0.1:'+((server.address() as {port:number}).port);
  const prefix = path.join(scratch,'prefix');
  const env: NodeJS.ProcessEnv = {...process.env,WOMBAT_AUTO_PRICES:'0',WOMBAT_DATA_HOME:path.join(scratch,'data'),CODEX_HOME:path.join(scratch,'source'),NO_COLOR:'1',
    npm_config_userconfig:path.join(scratch,'npmrc'),npm_config_globalconfig:path.join(scratch,'global-npmrc'),npm_config_cache:path.join(scratch,'cache')};
  for (const key of Object.keys(env)) if (/^npm_config_/i.test(key) && !['npm_config_userconfig','npm_config_globalconfig','npm_config_cache'].includes(key)) delete env[key];
  writeFileSync(env.npm_config_userconfig!,'');writeFileSync(env.npm_config_globalconfig!,''); delete env.WOMBAT_CORE_BIN;
  delete env.NODE_OPTIONS; delete env.NODE_PATH;
  const installedAt = performance.now();
  await promisify(execFile)(...toolCommand('npm',['install','--global','--prefix',prefix,'--engine-strict','--ignore-scripts','--no-audit','--no-fund','--fetch-retries=0','--registry',origin,set.name+'@'+set.version]),{cwd:scratch,env,timeout:120000,maxBuffer:8*1024*1024});
  const installMs = Math.round(performance.now()-installedAt);
  const modules = path.join(prefix,process.platform==='win32'?'node_modules':'lib/node_modules');
  const installed = path.join(modules,...set.name.split('/')), cli = path.join(installed,'dist/wombat.js');
  const shim = path.join(prefix,process.platform==='win32'?'wombat.cmd':'bin/wombat');assert(existsSync(shim));
  const runtime = path.resolve(values.runtime ?? process.execPath);
  const appEnv: NodeJS.ProcessEnv = {...env,PATH:''};
  const run = (program: string,args: string[],status=0,runtimeEnv=appEnv) => {
    const r=spawnSync(program,args,{cwd:scratch,env:runtimeEnv,windowsVerbatimArguments:process.platform==='win32'&&program===path.join(process.env.SystemRoot ?? 'C:\\Windows','System32/cmd.exe'),encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
    assert.ifError(r.error);assert.equal(r.status,status,r.stderr+r.stdout);return r.stdout;
  };
  const query=(args:string[],status=0)=>JSON.parse(run(runtime,[cli,...args,'--json'],status));
  assert.equal(query(['--version']).version,set.version);
  assert.equal(query(['usage','--cached'],1).error.code,'NO_SNAPSHOT');
  const sessions=path.join(env.CODEX_HOME!,'sessions');mkdirSync(sessions,{recursive:true});const file=path.join(sessions,'synthetic.jsonl');
  const row=(id:string)=>JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type:'token_usage_record',thread_id:'thread',turn_id:'turn',response_id:id,usage:{input_tokens:100,cached_input_tokens:0,output_tokens:10,total_tokens:110}}})+'\n';
  writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id:'thread'}})+'\n'+JSON.stringify({type:'turn_context',payload:{turn_id:'turn',model:'gpt-5.4',model_provider:'openai'}})+'\n'+row('one'));
  assert.equal(query(['usage','--fresh']).summary.tokens.total,110);const snapshot=query(['refresh']);appendFileSync(file,row('two'));
  assert.equal(query(['usage','--fresh']).summary.tokens.total,220);assert.equal(query(['usage','--snapshot',snapshot.snapshotRef.snapshotId]).summary.tokens.total,110);
  assert.equal(query(['threads','--fresh']).summary.tokens.total,220);
  const selected = set.packages.find(p=>p.target===target)!;
  const platformRoot = path.dirname(createRequire(path.join(installed,'package.json')).resolve(set.name+'-'+target+'/package.json'));
  const core = path.join(platformRoot,'vendor',process.platform==='win32'?'wombat-core.exe':'wombat-core');
  assert(existsSync(core));
  const shimEnv = {...env,PATH:path.dirname(runtime)+path.delimiter+(env.PATH ?? '')};
  if (process.platform !== 'win32') assert.equal(JSON.parse(run(shim,['--version','--json'],0,shimEnv)).version,set.version);
  else {
    const cmd = path.join(process.env.SystemRoot ?? 'C:\\Windows','System32/cmd.exe');
    assert.equal(JSON.parse(run(cmd,['/d','/s','/c','""'+shim+'" --version --json"'],0,shimEnv)).version,set.version);
  }
  const expected = set.packages.filter(p=>p.target==='main'||p.target===target).map(p=>p.archive).sort();
  assert.deepEqual([...new Set(downloads)].sort(),expected,'npm downloaded a foreign platform package');
  run(process.execPath,['--test',fileURLToPath(new URL('../tests/e2e/web.test.ts',import.meta.url))],0,{...appEnv,WOMBAT_WEB_TEST_ENTRY:cli,WOMBAT_WEB_TEST_CORE:core,WOMBAT_WEB_TEST_NODE:runtime});
  const omittedPrefix = path.join(scratch,'omitted optional');
  await promisify(execFile)(...toolCommand('npm',['install','--global','--prefix',omittedPrefix,'--omit=optional','--engine-strict','--ignore-scripts','--no-audit','--no-fund','--fetch-retries=0','--registry',origin,set.name+'@'+set.version]),{cwd:scratch,env,timeout:120000,maxBuffer:8*1024*1024});
  const omittedCli = path.join(omittedPrefix,process.platform==='win32'?'node_modules':'lib/node_modules',...set.name.split('/'),'dist/wombat.js');
  const omittedMetadata = path.join(path.dirname(omittedCli),'../package.json');
  let dependency: string | undefined;
  try {dependency = createRequire(omittedMetadata).resolve(set.name+'-'+target+'/package.json');} catch {}
  // Some global npm versions retain optional packages even with --omit=optional.
  // Simulate actual missing files rather than assume that installer flag removed them.
  if (dependency) {
    const relative = path.relative(realpathSync(omittedPrefix),path.dirname(dependency));
    assert(!relative.startsWith('..') && !path.isAbsolute(relative));
    rmSync(path.dirname(dependency),{recursive:true,force:true});
  }
  const missing = JSON.parse(run(runtime,[omittedCli,'usage','--fresh','--json'],1,{...appEnv,WOMBAT_DATA_HOME:path.join(scratch,'missing data')}));
  assert.equal(missing.error.code,'CORE_UNAVAILABLE');
  assert.match(missing.error.message,/--include=optional/);
  console.log(JSON.stringify({package:set.name,version:set.version,target,runtime:run(runtime,['--version']).trim(),installMs,downloaded:expected,installedBytes:inventory(installed).reduce((n,file)=>n+file.size,0),downloadBytes:expected.reduce((n,f)=>n+readFileSync(path.join(path.dirname(setFile),f)).length,0),globalCommand:true,missingOptional:true,emptyAppPath:true,live:true,append:true,fixedSnapshot:true,web:true,platformVersion:selected.version}));
} finally {
  server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
  rmSync(scratch,{recursive:true,force:true,maxRetries:20,retryDelay:500});
}
