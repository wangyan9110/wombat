import path from 'node:path';
import {CoreError,type DirectoriesRequest} from '@wombat/client';
import {createNodeClient} from '@wombat/client/node';
import {t} from '@wombat/client/locale';
import {terminalText} from './display-text.js';

export function parseDirectoriesArgs(argv:string[]) {
  const request:DirectoriesRequest={action:'list'};let json=false,help=false;
  const invalid=(value:string):never=>{throw new CoreError('INVALID_ARGUMENT',t('cli.config.invalid',{value}));};
  if(argv[0]&&!argv[0].startsWith('-')){if(!['list','authorize','revoke'].includes(argv[0]))invalid(argv[0]);request.action=argv[0] as DirectoriesRequest['action'];argv=argv.slice(1);}
  const seen=new Set<string>();
  for(let i=0;i<argv.length;i++) {
    const [name,inline]=argv[i].split(/=(.*)/s);
    if(seen.has(name))invalid(name);seen.add(name);
    if(name==='--help'||name==='-h'){if(inline!==undefined)invalid(name);help=true;continue;}
    if(name==='--json'){if(inline!==undefined)invalid(name);json=true;continue;}
    if(!['--purpose','--path','--grant'].includes(name))invalid(name);
    const value=inline??argv[++i];if(!value||value.startsWith('--'))invalid(name);
    if(name==='--purpose'){if(!['source','project'].includes(value))invalid(value);request.purpose=value as DirectoriesRequest['purpose'];}
    else if(name==='--path')request.path=path.resolve(value);else request.grantId=value;
  }
  if(!help&&((request.action==='authorize'&&(!request.path||!request.purpose||request.grantId))||(request.action==='revoke'&&(!request.grantId||request.path||request.purpose))||(request.action==='list'&&(request.path||request.purpose||request.grantId))))invalid(request.action!);
  return {request,json,help};
}
export async function runDirectoriesCli(argv:string[]):Promise<number> {
  const {request,json,help}=parseDirectoriesArgs(argv);
  if(help){process.stdout.write(t('directories.cliHelp'));return 0;}
  const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{const result=await createNodeClient().directories!(request,{signal:controller.signal});
    if(json)process.stdout.write(JSON.stringify(result)+'\n');
    else for(const grant of result.grants)process.stdout.write(`${grant.id}\t${t(`directories.${grant.purpose}`)}\t${terminalText(grant.path)}\t${t(grant.status==='authorized'?'directories.authorized':'directories.unavailable')}\n`);
    return result.grants.some(g=>g.status!=='authorized')?2:0;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
