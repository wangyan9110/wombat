import path from 'node:path';
import {CoreError,type MonitorRequest,type UsageClient} from '@wombat/client';
import {createNodeClient} from '@wombat/client/node';
import {t} from '@wombat/client/locale';
import {terminalText} from './display-text.js';
import {setTimeout as delay} from 'node:timers/promises';

export function parseMonitorArgs(argv:string[]):{request?:MonitorRequest;ids?:string[];watch:boolean;roots:string[];interval:number;json:boolean;help:boolean} {
 const action=argv[0]?.startsWith('-')?'list':argv.shift()??'list';
 const values=new Map<string,string>(),flags=new Set<string>(),roots:string[]=[];
 const invalid=():never=>{throw new CoreError('INVALID_ARGUMENT',t('monitor.invalid'));};
 for(let i=0;i<argv.length;i++){
  const [key,inline]=argv[i].split(/=(.*)/s);
  if(['--json','--help','--review','--disabled'].includes(key)){if(inline!==undefined||flags.has(key))invalid();flags.add(key);continue;}
  if(!['--id','--period','--tokens','--warning','--project','--source','--model','--timezone','--snapshot','--interval','--root','--notification'].includes(key)||key!=='--root'&&values.has(key))invalid();
  const value=inline??argv[++i];if(!value||value.startsWith('-'))invalid();
  if(key==='--root')roots.push(path.resolve(value));else values.set(key,value);
 }
 const help=flags.has('--help');if(!['list','set','remove','check','watch','acknowledge'].includes(action))invalid();
 const allowed:Record<string,string[]>={list:[],set:['--id','--period','--tokens','--warning','--project','--source','--model','--timezone'],remove:['--id'],check:['--id','--snapshot','--root'],watch:['--id','--interval','--root'],acknowledge:['--notification']};
 if([...values.keys(),...(roots.length?['--root']:[])].some(k=>!allowed[action].includes(k))||action!=='set'&&(flags.has('--review')||flags.has('--disabled')))invalid();
 const interval=Number(values.get('--interval')??60);if(!Number.isInteger(interval)||interval<5||interval>3600)invalid();
 if(help)return {watch:false,roots,interval,json:flags.has('--json'),help};
 let request:MonitorRequest|undefined;
 const id=values.get('--id');
 if(action==='list')request={action:'list'};
 if(action==='set'){
  const period=values.get('--period')??'week',tokens=values.get('--tokens'),warning=values.get('--warning');
  if(!id||!['day','week','month'].includes(period)||tokens!==undefined&&(!/^\d+$/.test(tokens)||!Number.isSafeInteger(Number(tokens))||Number(tokens)<=0)||warning!==undefined&&(!Number.isFinite(Number(warning))||Number(warning)<=0||Number(warning)>1)||!tokens&&!flags.has('--review'))invalid();
  request={action:'upsert',plan:{id:id!,enabled:!flags.has('--disabled'),period:period as 'day'|'week'|'month',tokenLimit:tokens?Number(tokens):null,warningRatio:warning?Number(warning):null,review:flags.has('--review'),scope:{project:values.has('--project')?path.resolve(values.get('--project')!):undefined,sourceInstanceId:values.get('--source'),model:values.get('--model'),timezone:values.get('--timezone')??Intl.DateTimeFormat().resolvedOptions().timeZone}}};
 }
 if(action==='remove'){if(!id)invalid();request={action:'remove',id:id!};}
 if(action==='acknowledge'){const notificationId=values.get('--notification');if(!notificationId)invalid();request={action:'acknowledge',notificationId:notificationId!};}
 if(action==='check'&&values.has('--snapshot')){if(!id||roots.length)invalid();request={action:'check',ids:[id!],snapshotId:values.get('--snapshot')!};}
 return {request,ids:id?[id]:undefined,watch:action==='watch',roots,interval,json:flags.has('--json'),help};
}
export async function checkMonitor(client:UsageClient,roots:string[],ids:string[]|undefined,signal:AbortSignal) {
 if(!client.monitor||!client.live)throw new CoreError('MONITOR_UNAVAILABLE',t('monitor.unavailable'));
 const settings=await client.monitor({action:'list'},{signal});
 const selected=ids??settings.plans.filter(p=>p.enabled).map(p=>p.id);
 if(selected.some(id=>!settings.plans.some(p=>p.id===id)))throw new CoreError('NOT_FOUND',t('monitor.invalid'));
 if(!selected.length)return {...settings,notifications:[]};
 const live=await client.live({query:{action:'usage',roots,scope:{allTime:true},limit:1,compact:true},mode:'fresh'},{signal});
 if(!['current','fixed'].includes(live.freshness.status)||live.freshness.initialScan)throw new CoreError('SYNC_PENDING',t('monitor.pending'));
 return client.monitor({action:'check',snapshotId:live.result.snapshotRef.snapshotId,ids:selected},{signal});
}
export async function runMonitorCli(argv:string[]):Promise<number> {
 const parsed=parseMonitorArgs([...argv]);
 if(parsed.help){process.stdout.write(t('monitor.help')+'\n');return 0;}
 const client=createNodeClient(),abort=new AbortController(),stop=()=>abort.abort();
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 const print=(result:Awaited<ReturnType<NonNullable<UsageClient['monitor']>>>)=>{
  if(parsed.json)process.stdout.write(JSON.stringify(result)+'\n');
  else {for(const plan of result.plans)process.stdout.write(`${terminalText(plan.id)} · ${plan.period} · ${plan.tokenLimit??'—'} Token · ${t(plan.enabled?'monitor.enabled':'monitor.disabled')}\n`);for(const n of result.notifications)process.stdout.write(`${terminalText(n.planId)} · ${t(`monitor.${n.kind}`)} · ${n.scope.since} — ${n.scope.until} · ${n.summary.tokenAnalysis.totalAnalysis?.subtotal??'—'} Token${n.partial?' · '+t('monitor.partial'):''}\n`);}
 };
 try {
  if(!client.monitor)throw new CoreError('MONITOR_UNAVAILABLE',t('monitor.unavailable'));
  if(parsed.request){const result=await client.monitor(parsed.request,{signal:abort.signal});print(result);return result.notifications.some(n=>n.partial)?2:0;}
  do {
   try {const result=await checkMonitor(client,parsed.roots,parsed.ids,abort.signal);if(!parsed.watch||result.notifications.length)print(result);if(!parsed.watch)return result.notifications.some(n=>n.partial)?2:0;}
   catch(error){if(abort.signal.aborted)break;if(!parsed.watch||!(error instanceof CoreError)||!['SYNC_PENDING','TIMEOUT','VIEW_EXPIRED','TRANSPORT_ERROR','RESOURCE_LIMIT','INDEX_UNAVAILABLE','SOURCE_UNREADABLE'].includes(error.code))throw error;process.stderr.write(JSON.stringify({error:{code:error instanceof CoreError?error.code:'INTERNAL_ERROR',message:t('monitor.checkFailed')}})+'\n');}
   if(!parsed.watch)break;
   await delay(parsed.interval*1000,undefined,{signal:abort.signal});
  }while(!abort.signal.aborted);
  return abort.signal.aborted?130:0;
 } catch(error){if(abort.signal.aborted)return 130;throw error;}
 finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
