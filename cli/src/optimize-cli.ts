import {optimizeExitCode} from './exit-codes.js';
import path from 'node:path';
import { CoreError, type OptimizeRequest, type OptimizeResult } from '@wombat/client';
import { createNodeClient } from '@wombat/client/node';
import { t, reviewFindingLabel, reviewFindingNote, reviewFindingCount, reviewPresentation, followUpText, useBasisPresentation, assessmentReason, reviewStatusLabel, activityRuleTitle, activityFindingTitle, activityCheckText, activityAdviceText } from '@wombat/client/locale';
import { terminalText } from './display-text.js';
export function parseOptimizeArgs(argv: string[]) {
  const request: OptimizeRequest={action:'list'}, roots:string[]=[], projects:string[]=[], seen=new Set<string>();
  let json=false,help=false;
  const activity:{snapshotId?:string;threadId?:string;turnId?:string}={};
  const fail=(value:string):never=>{throw new CoreError('INVALID_ARGUMENT',t('cli.config.invalid',{value}));};
  if(argv[0]&&!argv[0].startsWith('-')) {
    const command=argv.shift()!;
    if(command==='history')request.group='history';
    else if(['list','detail','keep','not-applicable','redisplay','recheck','capabilities','checks','activity'].includes(command))request.action=command.replace('-','_') as OptimizeRequest['action'];
    else fail(command);
  }
  for(let i=0;i<argv.length;i++) {
    const [name,inline]=argv[i].split(/=(.*)/s);
    if(['--help','-h'].includes(name)){help=true;continue;}
    if(name==='--json'){if(json||inline!==undefined)fail(name);json=true;continue;}
    if(!['--root','--project-root','--project','--source','--suggestion','--item','--reason','--read-view','--decision-revision','--category','--offset','--limit','--agents-bytes','--description-characters','--snapshot','--thread','--turn'].includes(name))fail(name);
    if(seen.has(name)&&!['--root','--project-root'].includes(name))fail(name);seen.add(name);
    const value=inline??argv[++i];if(!value||value.startsWith('--'))fail(name);
    switch(name){
      case '--snapshot':activity.snapshotId=value;break;
      case '--thread':activity.threadId=value;break;
      case '--turn':activity.turnId=value;break;
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
  if(roots.length)request.roots=roots;
  if(request.action==='activity'){
    if(!help&&(!activity.snapshotId||!activity.threadId||!activity.turnId))fail('--snapshot/--thread/--turn');
    if([...seen].some(name=>!['--root','--source','--snapshot','--thread','--turn'].includes(name)))fail('activity');
    if(activity.snapshotId&&activity.threadId&&activity.turnId)request.activity={snapshotId:activity.snapshotId,threadId:activity.threadId,turnId:activity.turnId};
  }else{
    if(Object.keys(activity).length)fail('activity');
    request.projectRoots=projects.length?projects:[process.cwd()];
  }
  return {request,json,help};
}
export async function runOptimizeCli(argv:string[]):Promise<number>{
  const {request,json,help}=parseOptimizeArgs([...argv]);
  if(help){process.stdout.write(t('cli.optimize.help'));return 0;}
  const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const result=await createNodeClient().optimize!(request,{signal:controller.signal});
    if(json)process.stdout.write(JSON.stringify(result)+'\n');
    else process.stdout.write(formatOptimizeText(result));
    return optimizeExitCode(result);
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}

/** Render recorded decisions and check facts separately; never infer resolution from a decision or item. */
export function formatOptimizeText(result: OptimizeResult): string {
  if(result.action==='activity'&&result.activity){
    const activity=result.activity;
    return [t('activity.title'),...activity.advice.flatMap(rule=>{const check=activity.checks.find(check=>check.rule===rule)!;return [activityFindingTitle(check),activityAdviceText(rule),...(check.partial?[t('activity.partial')]:[])];}),
      t('activity.checks'),...activity.checks.map(check=>`${activityRuleTitle(check.rule)}: ${activityCheckText(check)}`),
      t('activity.note'),`${activity.readView.snapshotId} · ${activity.scope.threadId} · ${activity.scope.turnId}`,
      activity.analysisMethod].map(terminalText).join('\n')+'\n';
  }
  const lines: string[] = [t('optimize.summaryCount', {pending: result.pending, history: result.history})];
  const add = (...values: string[]) => lines.push(...values);
  const checks = (rows: OptimizeResult['checks']) => {
    if (!rows.length) add(`  ${t('optimize.evidenceIncomplete')}`);
    for (const check of rows) {
      add(`  ${reviewFindingLabel(check.rule)}\t${t(`optimize.check.${check.outcome}`)}\t${check.checkedAt}`,
        `  ${t(`optimize.assessment.comparison.${check.comparison.status}`)}`);
      for (const reason of new Set([check.reason, check.comparison.reason, ...check.basis.gaps].filter((value): value is string => !!value))) {
        add(`  ${t('optimize.assessment.reason')}: ${assessmentReason(reason)}`);
      }
      if (check.identityGap || check.findings.some(f => f.identity.gap)) add(`  ${t('optimize.assessment.identityGap')}`);
    }
  };
  for (const s of result.suggestions) {
    const presentation = reviewPresentation(s);
    add(`${s.id}\t${presentation.title}\t${t(`optimize.${s.category}`)}\t${reviewStatusLabel(s.status)}\t${s.item.path}`,
      `  ${presentation.value}`);
    if (presentation.metricText != null || presentation.metric != null) add(`  ${presentation.metricText ?? `${presentation.metric} ${presentation.label}`}`);
    for (const f of s.findings) add(`  ${reviewFindingCount(f) ?? `${reviewFindingLabel(f.rule)}${f.observed == null ? '' : ` ${f.observed}${f.threshold == null ? '' : ` / ${f.threshold}`}`}`}`,
      `  ${reviewFindingNote(f.rule, s.item.project ?? undefined)}`);
    if (s.decision) {
      const decision = s.decision;
      const reason = decision.reason === 'necessary' ? t('optimize.assessment.necessary')
        : decision.reason === 'object_changed' ? t('optimize.reason.objectChanged') : t('optimize.reason.incorrectEvidence');
      add(`  ${t('optimize.assessment.decision')}: ${t(decision.kind === 'keep' ? 'optimize.kept' : 'optimize.inapplicable')} · ${decision.recordedAt}`,
        `  ${t('optimize.decisionReason')}: ${reason}`, `  ${t('optimize.assessment.decisionNote')}`);
      if (decision.binding.gap) add(`  ${t('optimize.assessment.identityGap')}`);
    }
    add(`  ${t('optimize.assessment.latest')}`);
    checks(s.checks);
    add(`  ${t('optimize.assessment.original')}`);
    if (s.reviewBaseline) checks(s.reviewBaseline.assessments);
    else add(`  ${t('optimize.assessment.baselineMissing')}`);
    const followUp = result.followUps.find(o => o.recordId === s.recordId && o.suggestionId === s.id);
    if (followUp) {
      const basis = useBasisPresentation(followUp.useBasis);
      if(followUp.usageComparison){const c=followUp.usageComparison;add(t('optimize.followUp.usageComparison'),`${c.baselineStart} — ${c.changeAt}: ${c.baseline.measuredTasks} · ${c.baseline.meanTokens??'—'} / ${c.baseline.medianTokens??'—'} / ${c.baseline.p90Tokens??'—'}`,`${c.changeAt} — ${c.observedThrough}: ${c.current.measuredTasks} · ${c.current.meanTokens??'—'} / ${c.current.medianTokens??'—'} / ${c.current.p90Tokens??'—'}`,t('optimize.followUp.usageComparisonNote'));}
      add(...[basis.summary, ...basis.notes, ...basis.details].map(line => `  ${line}`),
        `  ${t('optimize.awaitingFollowUp')}`, `  ${followUpText(followUp)}`, `  ${t('optimize.followUp.note')}`);
    }
  }
  if (result.checks.length) {
    add(t('optimize.checks'));
    checks(result.checks);
  }
  add(result.ruleParameters.version, t('config.readVersion', {version: result.readView ?? '—'}), result.decisionRevision, t('optimize.coverageNote'));
  return lines.map(line => terminalText(line)).join('\n') + '\n';
}
