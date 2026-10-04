import path from 'node:path';
import { CoreError, type OptimizeRequest } from '@wombat/client';
import { createNodeClient } from '@wombat/client/node';
import { t, reviewFindingLabel, reviewFindingNote, reviewFindingCount, reviewPresentation, followUpText } from '@wombat/client/locale';
import { terminalText } from './display-text.js';
export function parseOptimizeArgs(argv: string[]) {
  const request: OptimizeRequest={action:'list'}, roots:string[]=[], projects:string[]=[], seen=new Set<string>();
  let json=false,help=false;
  const fail=(value:string):never=>{throw new CoreError('INVALID_ARGUMENT',t('cli.config.invalid',{value}));};
  if(argv[0]&&!argv[0].startsWith('-')) {
    const command=argv.shift()!;
    if(command==='history')request.group='history';
    else if(['list','detail','keep','not-applicable','redisplay','recheck','capabilities','checks'].includes(command))request.action=command.replace('-','_') as OptimizeRequest['action'];
    else fail(command);
  }
  for(let i=0;i<argv.length;i++) {
    const [name,inline]=argv[i].split(/=(.*)/s);
    if(['--help','-h'].includes(name)){help=true;continue;}
    if(name==='--json'){if(json||inline!==undefined)fail(name);json=true;continue;}
    if(!['--root','--project-root','--project','--source','--suggestion','--item','--reason','--read-view','--decision-revision','--category','--offset','--limit','--agents-bytes','--description-characters'].includes(name))fail(name);
    if(seen.has(name)&&!['--root','--project-root'].includes(name))fail(name);seen.add(name);
    const value=inline??argv[++i];if(!value||value.startsWith('--'))fail(name);
    switch(name){
      case '--root':roots.push(path.resolve(value));break;
      case '--project-root':projects.push(path.resolve(value));break;
      case '--project':request.project=path.resolve(value);break;
      case '--source':request.sourceInstanceId=value;break;
      case '--suggestion':request.suggestionId=value;break;
      case '--item':request.itemId=value;break;
      case '--reason':if(!['necessary','object_changed','incorrect_evidence'].includes(value))fail(value);request.decisionReason=value as OptimizeRequest['decisionReason'];break;
      case '--read-view':request.readView=value;break;
      case '--decision-revision':request.decisionRevision=value;break;
      case '--agents-bytes':case '--description-characters':{const n=Number(value);if(!/^\d+$/.test(value)||!Number.isSafeInteger(n)||(name==='--agents-bytes'?n<1:n>1024))fail(value);request.ruleOverrides??={};request.ruleOverrides[name==='--agents-bytes'?'agentsBytes':'descriptionCharacters']=n;break;}
      case '--category':if(!['repair','trim','organize','space'].includes(value))fail(value);request.category=value as OptimizeRequest['category'];break;
      case '--offset':case '--limit':{const n=Number(value);if(!/^\d+$/.test(value)||!Number.isSafeInteger(n)||(name==='--limit'&&(n<1||n>200)))fail(value);request[name==='--limit'?'limit':'offset']=n;break;}
    }
  }
  if(!help&&['detail','keep','not_applicable','redisplay'].includes(request.action!)&&!request.suggestionId)fail('--suggestion');
  if(!help&&['keep','not_applicable'].includes(request.action!)&&!request.decisionReason)fail('--reason');
  if(roots.length)request.roots=roots;request.projectRoots=projects.length?projects:[process.cwd()];
  return {request,json,help};
}
export async function runOptimizeCli(argv:string[]):Promise<number>{
  const {request,json,help}=parseOptimizeArgs([...argv]);
  if(help){process.stdout.write(t('cli.optimize.help'));return 0;}
  const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const result=await createNodeClient().optimize!(request,{signal:controller.signal});
    if(json)process.stdout.write(JSON.stringify(result)+'\n');
    else{
      process.stdout.write(t('optimize.summaryCount',{pending:result.pending,history:result.history})+'\n');
      for(const s of result.suggestions){
        const presentation=reviewPresentation(s);
        process.stdout.write(`${s.id}\t${terminalText(presentation.title)}\t${t(`optimize.${s.category}`)}\t${terminalText(s.status)}\t${terminalText(s.item.path)}\n`);
        process.stdout.write(`  ${presentation.value}\n  ${presentation.metricText??`${presentation.metric??'—'} ${presentation.label}`}\n`);
        for(const f of s.findings)process.stdout.write(`  ${reviewFindingCount(f)??`${reviewFindingLabel(f.rule)}${f.observed==null?'':` ${f.observed}${f.threshold==null?'':` / ${f.threshold}`}`}`}\n  ${reviewFindingNote(f.rule,s.item.project??undefined)}\n`);
        const followUp=result.followUps.find(o=>o.recordId===s.recordId&&o.suggestionId===s.id);
        if(followUp)process.stdout.write(`  ${t('optimize.awaitingFollowUp')}\n  ${followUpText(followUp)}\n  ${t('optimize.followUp.note')}\n`);
      }
      for(const check of result.checks??[])process.stdout.write(`${reviewFindingLabel(check.rule)}\t${t(`optimize.check.${check.outcome}`)}\n`);
      process.stdout.write(`${result.ruleParameters.version}\n`);
      process.stdout.write(t('config.readVersion',{version:result.readView??'—'})+`\n${result.decisionRevision}\n`);
      process.stdout.write(t('optimize.coverageNote')+'\n');
    }
    return result.resultStatus==='partial'?2:0;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
