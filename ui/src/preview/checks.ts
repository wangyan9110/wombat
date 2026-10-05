import {CoreError,type OptimizeRequest,type OptimizeResult,type QueryOptions} from '@wombat/client';
import {ruleScenarios} from './rule-examples.js';
import {createRuleFixture,type ReviewScenario} from './configuration.js';
import {inventoryFixture} from './inventory.js';
/** Extra parse evidence shares the ordinary assessment renderer; decisions stay in the existing fixture. */
export function previewChecks(empty:boolean,scenario:ReviewScenario,example='complete'){
 const exampleItem=ruleScenarios.some(value=>value===example)?inventoryFixture({action:'detail',itemId:example==='rules-format'?'preview-invalid-skill':example==='rules-hook'?'preview-hook':'preview-rule'}).items[0]:undefined;
 const regular=createRuleFixture(empty,scenario,example,exampleItem);
 return async(request:OptimizeRequest,options?:QueryOptions):Promise<OptimizeResult>=>{
  if(options?.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');
  const result=regular(request);
  if(example!=='rules-format'&&!empty&&request.action==='checks'&&request.itemId==='preview-invalid-skill'){
   const item=inventoryFixture({action:'detail',itemId:request.itemId,readView:request.readView,roots:request.roots,projectRoots:request.projectRoots,scope:{project:request.project,sourceInstanceId:request.sourceInstanceId}}).items[0];
   const base=regular({action:'checks',itemId:'preview-skill'}).checks[0];
   result.checks=[{...base,outcome:'hit',reason:null,rule:'skillFormat',itemId:item.id,contentVersion:item.contentHash,assessmentId:'synthetic-invalid-format-assessment',methodVersions:[{method:'synthetic-skill-metadata-v1',version:1}],findings:[{identity:{version:1,findingId:'synthetic-invalid-format-problem',gap:null},rule:'skillFormat',status:'failed',observed:null,threshold:null,evidenceCodes:['nameTypeInvalid']}],basis:{...base.basis,dependencyRevision:'synthetic-invalid-metadata',measurement:{kind:'skill_metadata',status:'invalid',issues:['nameTypeInvalid']}}}];
  }
  return result;
 };
}
