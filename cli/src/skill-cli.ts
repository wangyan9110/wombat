import {CoreError} from '@wombat/client';
import {manageSkill} from '@wombat/client/node';
import {t,type MessageKey} from '@wombat/client/locale';
import {terminalText} from './display-text.js';
type Installation=Awaited<ReturnType<typeof manageSkill>>;
const installationMessages={installed:'skill.installed',absent:'skill.absent',modified:'skill.modified',unmanaged:'skill.unmanaged'} as const satisfies Record<Installation['status'],MessageKey>;
const discoveryMessages={available:'skill.available',ambiguous:'skill.ambiguous',disabled:'skill.disabled',missing:'skill.missing',unavailable:'skill.unavailable',selection_changed:'skill.unavailable'} as const satisfies Record<Installation['discovery']['status'],MessageKey>;
export function parseSkillArgs(argv:string[]){
  let action:'install'|'status'|'uninstall'='status',json=false,help=false,replace=false,directory:string|undefined,cwd:string|undefined;
  const fail=(value:string):never=>{throw new CoreError('INVALID_ARGUMENT',t('cli.config.invalid',{value}));};
  if(argv[0]&&!argv[0].startsWith('-')){const command=argv.shift()!;if(!['install','status','uninstall'].includes(command))fail(command);action=command as 'install'|'status'|'uninstall';}
  const seen=new Set<string>();
  for(let i=0;i<argv.length;i++){const [flag,inline]=argv[i].split(/=(.*)/s);if(seen.has(flag))fail(flag);seen.add(flag);
    if(['--json','--help','-h','--replace'].includes(flag)){if(inline!==undefined)fail(flag);if(flag==='--json')json=true;else if(flag==='--replace')replace=true;else help=true;continue;}
    if(!['--directory','--cwd'].includes(flag))fail(flag);const value=inline??argv[++i];if(!value||value.startsWith('--'))fail(flag);if(flag==='--directory')directory=value;else cwd=value;
  }
  if(replace&&action!=='install')fail('--replace');return {action,json,help,replace,directory,cwd};
}
export async function runSkillCli(argv:string[]):Promise<number>{
  const {action,json,help,...input}=parseSkillArgs([...argv]);if(help){process.stdout.write(t('skill.help')+'\n');return 0;}
  const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{const result=await manageSkill(action,input,{signal:controller.signal});
    if(json)process.stdout.write(JSON.stringify(result)+'\n');
    else{process.stdout.write(t('skill.result',{status:t(installationMessages[result.status]),directory:terminalText(result.directory)})+'\n');process.stdout.write(t('skill.discovery',{status:t(discoveryMessages[result.discovery.status])})+'\n'+t('skill.dataNotRequested')+'\n');for(const instance of result.discovery.instances)process.stdout.write(terminalText(instance.path)+'\n');}
    return result.discovery.status==='available'?0:2;
  }catch(error){if(error instanceof CoreError&&error.code.startsWith('SKILL_'))throw new CoreError(error.code,t('skill.failed',{code:error.code}));throw error;}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
