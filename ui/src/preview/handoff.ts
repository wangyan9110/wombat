import {CoreError,type HandoffRequest,type HandoffResult,type QueryOptions} from '@wombat/client';
export const handoffScenarios=['handoff-accepted','handoff-partial','handoff-unknown','handoff-failed','handoff-blocked','handoff-unavailable'] as const;
/** Preview selection and delivery are synthetic DTOs, never Codex execution or receipts. */
export function previewHandoff(scenario:string){
 let sequence=0,last:HandoffResult|undefined,lastScope='';
 const scope=(request:HandoffRequest)=>JSON.stringify([request.project??null,request.sourceInstanceId??null,request.roots??[],request.projectRoots??[]]);
 const projects:HandoffResult['projects']=['wombat','reporter'].map((name,index)=>({id:`synthetic-project-${index}`,cwd:`/synthetic/${name}`,targets:[{itemId:index?'preview-other-skill':'preview-skill',suggestionIds:[index?'preview-other-suggestion':'preview-suggestion'],path:`/synthetic/${name}/skills/review/SKILL.md`,contentHash:`synthetic-content-${index}`,expectedExists:true,sharedProjects:[`/synthetic/${name}`],findings:[{identity:{version:1,findingId:`synthetic-finding-${index}`},rule:'bodyTokens',status:'failed',observed:6200,threshold:5000,evidenceCodes:['bodyTokenEstimate'],basis:'agentSkillsRecommendation'}]}]}));
 return async(request:HandoffRequest,options?:QueryOptions):Promise<HandoffResult>=>{
  if(options?.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');
  if(scenario==='handoff-unavailable')throw new CoreError('CODEX_UNAVAILABLE','Synthetic Codex host unavailable');
  const action=request.action??'preview';
  if(action==='preview'){
   if(request.roots?.some(root=>root!=='/synthetic/codex-home')||request.projectRoots?.some(root=>root!=='/synthetic/wombat'&&root!=='/synthetic/reporter')||request.sourceInstanceId&&request.sourceInstanceId!=='preview')throw new CoreError('NOT_FOUND','Synthetic source not found');
   const selected=projects.filter(project=>!request.project||request.project===project.cwd).map(project=>({...project,targets:project.targets.filter(target=>!request.suggestionIds||target.suggestionIds.some(id=>request.suggestionIds!.includes(id)))})).filter(project=>project.targets.length);
   lastScope=scope(request);last={outputVersion:1,action,selectionVersion:`synthetic-selection-${++sequence}`,readView:request.readView??'preview-config',decisionRevision:request.decisionRevision??'preview-1',projects:structuredClone(selected),deliveries:[],allowanceChecks:selected.map(project=>({projectId:project.id,assessment:{status:scenario==='handoff-blocked'?'blocked':'available',checkedAt:'2026-10-04T02:00:00Z',validUntil:'2099-10-11T02:00:00Z',reason:'synthetic_observation'}}))};
   return structuredClone(last);
  }
  if(!last||scope(request)!==lastScope||request.selectionVersion!==last.selectionVersion||request.readView!==last.readView||request.decisionRevision!==last.decisionRevision)throw new CoreError('VIEW_EXPIRED','Synthetic selection changed; review again');
  const selectedIds=last.projects.flatMap(project=>project.targets.flatMap(target=>target.suggestionIds)).sort();
  if(JSON.stringify([...(request.suggestionIds??[])].sort())!==JSON.stringify(selectedIds))throw new CoreError('INVALID_ARGUMENT','Synthetic selection does not match the preview');
  return {...structuredClone(last),action:'send',deliveries:last.projects.map((project,index)=>{
   const status=scenario==='handoff-blocked'||scenario==='handoff-failed'||scenario==='handoff-partial'&&index>0?'failed':scenario==='handoff-unknown'?'unknown':'accepted';
   return {projectId:project.id,status,threadId:status==='accepted'?`synthetic-codex-task-${index}`:null,errorCode:scenario==='handoff-blocked'?'ALLOWANCE_EXHAUSTED':status==='failed'?'CODEX_UNAVAILABLE':status==='unknown'?'HANDOFF_UNKNOWN':null};
  })};
 };
}
