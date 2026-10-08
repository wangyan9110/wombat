import type {HandoffRequest,HandoffResult,HandoffTransport,QueryOptions} from '../../client.js';
import {CoreError} from '../../errors.js';
import {queryLive} from '../live.js';
import type {CoreProcessOptions} from '../core.js';
import {connectCodex} from './rpc.js';
import {nativeVersion,runCodex,type CodexOptions} from './process.js';
import {LocaleRuntime} from '../../locale/index.js';
import {prepareHandoffSkills} from './handoff-skills.js';
import {discoverWombatSkill} from './skills.js';
import {randomUUID} from 'node:crypto';
import {allowanceStatus,observeAllowance,previewAllowance,unknownAllowance} from './allowance.js';

type Project=HandoffResult['projects'][number];
type Delivery=HandoffResult['deliveries'][number];
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const failure=(error:unknown)=>error instanceof CoreError?error.code:'CODEX_UNAVAILABLE';
async function sendProject(project:Project,request:HandoffRequest,query:QueryOptions,options:CodexOptions & CoreProcessOptions,version:string):Promise<{delivery:Delivery;assessment:HandoffResult['allowanceChecks'][number]['assessment']}>{
  const delivery:Delivery={projectId:project.id,status:'failed',threadId:null,nativeVersion:version,errorCode:null,skillPath:null};
  const rpc=await connectCodex(true,query,options);let sending=false,assessment=unknownAllowance();
  try{
    let skill:import('../../generated/skill-discovery.js').Instance|undefined;
    if(!request.withoutSkill){const discovery=await discoverWombatSkill(project.cwd,query,options,true);const requested=request.skillSelections?.find(s=>s.projectId===project.id);const enabled=discovery.instances.filter(s=>s.enabled);skill=discovery.status==='unavailable'?undefined:requested?enabled.find(s=>s.path===requested.path):enabled.length===1?enabled[0]:undefined;if(!skill)throw new CoreError('SKILL_REQUIRED','Select an enabled Wombat Skill or explicitly continue without it');}
    const started=await rpc.request('thread/start',{cwd:project.cwd,approvalPolicy:'untrusted',sandbox:'workspace-write',ephemeral:false});
    if(!object(started)||!object(started.thread)||typeof started.thread.id!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(started.thread.id)||started.thread.cwd!==project.cwd)throw new CoreError('NATIVE_PROTOCOL_ERROR','Native workspace mismatch');
    if(typeof started.model!=='string'||typeof started.modelProvider!=='string'||started.cwd!==project.cwd)throw new CoreError('NATIVE_PROTOCOL_ERROR','Native task model unavailable');
    delivery.threadId=started.thread.id;
    assessment=await observeAllowance(rpc,started.model,started.modelProvider,version,query,options);
    if(allowanceStatus(assessment)==='blocked'){delivery.errorCode='ALLOWANCE_EXHAUSTED';return {delivery,assessment};}
    // Native reads can take time. Recheck the reviewed selection immediately before queueing.
    await queryLive({handoff:request},query,options);
    const messages=new LocaleRuntime(request.language==='en'?'en':'zh');
    const instructions=(skill?'Use $'+skill.name+'.\n':'')+messages.t('handoff.prompt')+'\n'+messages.t('handoff.answerLanguage');
    const text=instructions+'\n\n'+JSON.stringify({language:request.language??'zh',cwd:project.cwd,selectionVersion:request.selectionVersion,readView:request.readView,decisionRevision:request.decisionRevision,targets:project.targets});
    if(skill){const latest=await discoverWombatSkill(project.cwd,query,options,true);if(latest.status==='unavailable'||!latest.instances.some(s=>s.enabled&&s.name===skill!.name&&s.path===skill!.path))throw new CoreError('SKILL_SELECTION_CHANGED','Skill changed after review');delivery.skillPath=skill.path;}
    sending=true;
    const messageId=randomUUID();
    const response=await rpc.request('thread/queue/add',{threadId:delivery.threadId,clientUserMessageId:messageId,input:[{type:'text',text,text_elements:[]},...(skill?[{type:'skill',name:skill.name,path:skill.path}]:[])]});
    if(!object(response)||!object(response.queuedSubmission)||response.queuedSubmission.clientUserMessageId!==messageId||skill&&(!Array.isArray(response.queuedSubmission.input)||!response.queuedSubmission.input.some(i=>object(i)&&i.type==='skill'&&i.name===skill.name&&i.path===skill.path)))throw new CoreError('HANDOFF_UNKNOWN','Native acceptance cannot be confirmed');
    delivery.status='accepted';return {delivery,assessment};
  }catch(error){delivery.status=(sending&&failure(error)!=='CODEX_REQUEST_REJECTED')||failure(error)==='HANDOFF_UNKNOWN'?'unknown':'failed';delivery.errorCode=delivery.status==='unknown'?'HANDOFF_UNKNOWN':failure(error);return {delivery,assessment};}
  finally{rpc.close();}
}

export function createHandoffTransport(options:CoreProcessOptions & CodexOptions):HandoffTransport {
  let active=false;
  return async(request,query)=>{
    const prepared=await queryLive({handoff:request},query,options) as HandoffResult;
    if((request.action??'preview')==='preview')return prepareHandoffSkills(await previewAllowance(prepared,query,options),request,query,options);
    if(!prepared.projects.length)throw new CoreError('NOT_FOUND','No pending handoff targets');
    if(active)throw new CoreError('HANDOFF_BUSY','Handoff already in progress');
    active=true;
    try{
      const version=await nativeVersion(query,options);
      await runCodex(['app-server','daemon','start'],query,options);
      // Daemon startup may take time; verify the reviewed files again before sending.
      const current=await queryLive({handoff:{...request,readView:prepared.readView,decisionRevision:prepared.decisionRevision}},query,options) as HandoffResult;
      await prepareHandoffSkills(current,request,query,options,true);
      const bound={...request,skillSelections:current.skillChecks?.filter(c=>c.selected).map(c=>({projectId:c.projectId,path:c.selected!.path}))};
      for(const project of current.projects){
        if(!request.withoutSkill&&!current.skillChecks?.find(c=>c.projectId===project.id)?.selected){current.deliveries.push({projectId:project.id,status:'failed',threadId:null,nativeVersion:version,errorCode:'SKILL_REQUIRED',skillPath:null});continue;}
        if(query.signal?.aborted){current.deliveries.push({projectId:project.id,status:'failed',threadId:null,nativeVersion:version,errorCode:'CANCELLED',skillPath:null});continue;}
        try{const outcome=await sendProject(project,{...bound,readView:current.readView,decisionRevision:current.decisionRevision},query,options,version);current.deliveries.push(outcome.delivery);current.allowanceChecks.push({projectId:project.id,assessment:outcome.assessment});}
        catch(error){current.deliveries.push({projectId:project.id,status:'failed',threadId:null,nativeVersion:version,errorCode:failure(error),skillPath:null});}
      }
      return current;
    }finally{active=false;}
  };
}
