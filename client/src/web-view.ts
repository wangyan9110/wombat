import {validate} from './generated/validate-web-view-request.js';
import {CoreError} from './errors.js';
import type {Request as WebViewRequest} from './generated/web-view-request.js';
export type {Request as WebViewRequest} from './generated/web-view-request.js';
export function validateWebViewRequest(value:unknown):asserts value is WebViewRequest {
  if(!validate(value))throw new CoreError('INVALID_ARGUMENT','Invalid Web context');
}
/** Calendar arithmetic, independent of display locale and host timezone. */
export function shiftCalendarDate(date:string,days:number):string{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new CoreError('INVALID_ARGUMENT','Invalid calendar date');
  return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
}
/** Maps a validated, effective public context to browser navigation; no internal Route contract. */
export function webViewSearch(view:WebViewRequest):string{
  const p=new URLSearchParams({page:view.page});
  const put=(key:string,value:unknown)=>{if(value!==undefined&&value!==null&&value!==false&&value!=='')p.set(key,value===true?'1':String(value));};
  const u=view.usage,c=view.configuration,o=view.optimization,s=u?.scope??c?.scope;
  if(s){
    put('project',s.project);put('timezone',s.timezone);put('since',s.since);if(s.until)put('until',shiftCalendarDate(s.until,-1));
    put('agent',s.agentKind);put('source',s.sourceInstanceId);put('allTime',s.allTime);
  }
  if(u?.scope){const scope=u.scope;put('undated',scope.undated);put('model',scope.model);put('modelUnknown',scope.modelUnknown);put('effort',scope.reasoningEffort);put('effortUnknown',scope.effortUnknown);put('unassigned',scope.projectUnknown);}

  if(u){put('snapshot',u.snapshotId);put('scopeThread',u.scope?.threadId);put('thread',u.threadId??u.scope?.threadId);put('turn',u.turnId);put('search',u.search);put('group',u.group);put(u.action==='turns'?'turnSort':u.action==='usage'&&u.presentation!=='projects'&&u.presentation!=='models'?'periodSort':'sort',u.sort);put('dimension',u.presentation==='models'?'models':u.presentation==='projects'?'projects':undefined);put(u.action==='turns'?'turnOffset':u.action==='steps'?'eventsOffset':u.action==='usage'&&u.presentation!=='projects'&&u.presentation!=='models'?'periodOffset':'offset',u.offset);put('turnView',u.matchedOnly?'matching':'all');}
  if(c){put('configView',c.readView);put('configId',c.itemId);put('configThread',c.scope?.threadId);put(c.action==='evidence'?'evidenceOffset':c.action==='related_scopes'?'relatedOffset':'configOffset',c.offset);put(view.page==='instructions'?'instructionSearch':'extensionSearch',c.search);put('extensionKind',c.kind==='rule'?undefined:c.kind);}
  if(o){put('project',o.project);put('source',o.sourceInstanceId);put('optimizeView',o.readView);put('decisionRevision',o.decisionRevision);put('suggestion',o.suggestionId);put('optimizeGroup',o.group);put('optimizeCategory',o.category);put('optimizeOffset',o.offset);put('agentsBytes',o.ruleOverrides?.agentsBytes);put('descriptionCharacters',o.ruleOverrides?.descriptionCharacters);}
  return '?'+p.toString();
}
