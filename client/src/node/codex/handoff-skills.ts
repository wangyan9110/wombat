import type {HandoffRequest,HandoffResult,QueryOptions} from '../../client.js';
import type {CodexOptions} from './process.js';
import {discoverWombatSkill} from './skills.js';
import {CoreError} from '../../errors.js';
export async function prepareHandoffSkills(result:HandoffResult,request:HandoffRequest,query:QueryOptions,options:CodexOptions,managed=false):Promise<HandoffResult>{
  result.skillChecks=[];
  for(const project of result.projects){
    const discovery=await discoverWombatSkill(project.cwd,query,options,managed);
    const requested=request.skillSelections?.find(s=>s.projectId===project.id);
    const enabled=discovery.instances.filter(s=>s.enabled);
    let selected=discovery.status==='unavailable'?null:requested?enabled.find(s=>s.path===requested.path)??null:enabled.length===1?enabled[0]:null;
    if(requested&&!selected){discovery.status='selection_changed';discovery.errorCode='SKILL_SELECTION_CHANGED';}
    result.skillChecks.push({projectId:project.id,discovery,selected});
  }
  for(const selection of request.skillSelections??[])if(!result.projects.some(p=>p.id===selection.projectId))throw new CoreError('INVALID_ARGUMENT','Skill selection is outside the selected projects');
  if(new Set(request.skillSelections?.map(s=>s.projectId)).size!==(request.skillSelections?.length??0))throw new CoreError('INVALID_ARGUMENT','Duplicate Skill selection');
  return result;
}
