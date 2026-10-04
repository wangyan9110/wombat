import {CoreError,type DirectoriesRequest,type DirectoriesResult,type QueryOptions} from '@wombat/client';
export const directoryScenarios=['directories-ready','directories-unavailable'] as const;
/** Host-issued choices exist only in memory; paths never access the filesystem. */
export function previewDirectories(scenario:string){
 let sequence=0;const choices=new Map<string,{purpose:'source'|'project';path:string}>(),grants:DirectoriesResult['grants']=[];
 return async(request:DirectoriesRequest,options?:QueryOptions):Promise<DirectoriesResult>=>{
  if(options?.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');
  const action=request.action??'list';
  if(scenario==='directories-unavailable'&&action==='choose')throw new CoreError('DIRECTORY_PICKER_UNAVAILABLE','Synthetic directory picker unavailable');
  let chosenPath:string|undefined,choiceToken:string|undefined;
  if(action==='choose'){
   if(request.purpose!=='source'&&request.purpose!=='project')throw new CoreError('INVALID_ARGUMENT','Choose a directory purpose');
   choices.clear();chosenPath=request.purpose==='source'?'/synthetic/codex-home':'/synthetic/extra-project';choiceToken=`synthetic-choice-${++sequence}`;choices.set(choiceToken,{purpose:request.purpose,path:chosenPath});
  }else if(action==='confirm'){
   const choice=choices.get(request.choiceToken??'');if(!choice)throw new CoreError('INVALID_ARGUMENT','Synthetic choice expired');choices.delete(request.choiceToken!);
   if(!grants.some(grant=>grant.purpose===choice.purpose&&grant.path===choice.path))grants.push({id:`synthetic-grant-${++sequence}`,purpose:choice.purpose,path:choice.path,directoryIdentity:`synthetic-directory-${sequence}`,authorizedAt:'2026-10-04T02:00:00Z',status:'authorized'});
  }else if(action==='revoke'){
   const index=grants.findIndex(grant=>grant.id===request.grantId);if(index<0)throw new CoreError('NOT_FOUND','Synthetic grant not found');grants.splice(index,1);
  }else if(action!=='list')throw new CoreError('INVALID_ARGUMENT','Synthetic browser authorization requires an issued choice');
  return {outputVersion:1,action,grants:structuredClone(grants),chosenPath,choiceToken};
 };
}
