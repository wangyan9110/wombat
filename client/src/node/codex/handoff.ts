import type {HandoffRequest,HandoffResult,HandoffTransport,QueryOptions} from '../../client.js';
import {CoreError} from '../../errors.js';
import {queryLive} from '../live.js';
import type {CoreProcessOptions} from '../core.js';
import {connectCodex} from './rpc.js';
import {nativeVersion,runCodex,type CodexOptions} from './process.js';
import {LocaleRuntime} from '../../locale/index.js';
import {randomUUID} from 'node:crypto';
import {allowanceStatus,observeAllowance,previewAllowance,unknownAllowance} from './allowance.js';

type Project=HandoffResult['projects'][number];
type Delivery=HandoffResult['deliveries'][number];
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const failure=(error:unknown)=>error instanceof CoreError?error.code:'CODEX_UNAVAILABLE';
async function sendProject(project:Project,request:HandoffRequest,query:QueryOptions,options:CodexOptions & CoreProcessOptions,version:string):Promise<{delivery:Delivery;assessment:HandoffResult['allowanceChecks'][number]['assessment']}>{
  const delivery:Delivery={projectId:project.id,status:'failed',threadId:null,nativeVersion:version,errorCode:null};
  const rpc=await connectCodex(true,query,options);let sending=false,assessment=unknownAllowance();
  try{
    const started=await rpc.request('thread/start',{cwd:project.cwd,approvalPolicy:'untrusted',sandbox:'workspace-write',ephemeral:false});
    if(!object(started)||!object(started.thread)||typeof started.thread.id!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(started.thread.id)||started.thread.cwd!==project.cwd)throw new CoreError('NATIVE_PROTOCOL_ERROR','Native workspace mismatch');
    if(typeof started.model!=='string'||typeof started.modelProvider!=='string'||started.cwd!==project.cwd)throw new CoreError('NATIVE_PROTOCOL_ERROR','Native task model unavailable');
    delivery.threadId=started.thread.id;
    assessment=await observeAllowance(rpc,started.model,started.modelProvider,version,query,options);
    if(allowanceStatus(assessment)==='blocked'){delivery.errorCode='ALLOWANCE_EXHAUSTED';return {delivery,assessment};}
    // Native reads can take time. Recheck the reviewed selection immediately before queueing.
    await queryLive({handoff:request},query,options);
    const instructions=new LocaleRuntime(request.language==='en'?'en':'zh').t('handoff.prompt');
    const text=instructions+'\n\n'+JSON.stringify({cwd:project.cwd,selectionVersion:request.selectionVersion,readView:request.readView,decisionRevision:request.decisionRevision,targets:project.targets});
    sending=true;
    const messageId=randomUUID();
    const response=await rpc.request('thread/queue/add',{threadId:delivery.threadId,clientUserMessageId:messageId,input:[{type:'text',text,text_elements:[]}]});
    if(!object(response)||!object(response.queuedSubmission)||response.queuedSubmission.clientUserMessageId!==messageId)throw new CoreError('HANDOFF_UNKNOWN','Native acceptance cannot be confirmed');
    delivery.status='accepted';return {delivery,assessment};
  }catch(error){delivery.status=(sending&&failure(error)!=='CODEX_REQUEST_REJECTED')||failure(error)==='HANDOFF_UNKNOWN'?'unknown':'failed';delivery.errorCode=delivery.status==='unknown'?'HANDOFF_UNKNOWN':failure(error);return {delivery,assessment};}
  finally{rpc.close();}
}

export function createHandoffTransport(options:CoreProcessOptions & CodexOptions):HandoffTransport {
  let active=false;
  return async(request,query)=>{
    const prepared=await queryLive({handoff:request},query,options) as HandoffResult;
    if((request.action??'preview')==='preview')return previewAllowance(prepared,query,options);
    if(!prepared.projects.length)throw new CoreError('NOT_FOUND','No pending handoff targets');
    if(active)throw new CoreError('HANDOFF_BUSY','Handoff already in progress');
    active=true;
    try{
      const version=await nativeVersion(query,options);
      await runCodex(['app-server','daemon','start'],query,options);
      // Daemon startup may take time; verify the reviewed files again before sending.
      const current=await queryLive({handoff:{...request,readView:prepared.readView,decisionRevision:prepared.decisionRevision}},query,options) as HandoffResult;
      for(const project of current.projects){
        if(query.signal?.aborted){current.deliveries.push({projectId:project.id,status:'failed',threadId:null,nativeVersion:version,errorCode:'CANCELLED'});continue;}
        try{const outcome=await sendProject(project,{...request,readView:current.readView,decisionRevision:current.decisionRevision},query,options,version);current.deliveries.push(outcome.delivery);current.allowanceChecks.push({projectId:project.id,assessment:outcome.assessment});}
        catch(error){current.deliveries.push({projectId:project.id,status:'failed',threadId:null,nativeVersion:version,errorCode:failure(error)});}
      }
      return current;
    }finally{active=false;}
  };
}
