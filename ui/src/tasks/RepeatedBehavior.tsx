import type {TimingLocalResult} from '@wombat/client';
import {t,timingMissingValueText,repeatedBehaviorReasonText} from '@wombat/client/locale';
type Repeats=TimingLocalResult['time']['repeatedBehavior'];
type Metric=Repeats['afterFailure']['count'];
const count=(m:Metric)=>m.value==null?timingMissingValueText(m.basis):String(m.value);
const duration=(m:Metric)=>m.value==null?timingMissingValueText(m.basis):`${m.value} ms`;
export function RepeatedBehavior({repeats,onEvidence,blocked}:{repeats:Repeats;onEvidence:(refs:string[])=>void;blocked:boolean}){
 const groups=[['execution.repeats.afterFailure',repeats.afterFailure],['execution.repeats.read',repeats.repeatedRead]] as const;
 return <section className="execution-repeats" aria-label={t('execution.repeats.title')}>
  <h4>{t('execution.repeats.title')}</h4>
  {repeats.coverage.partial&&<p className="compact-note">{t('execution.repeats.partial')}</p>}
  <dl className="facts">{groups.map(([label,m])=><div key={label}><dt>{t(label)}</dt><dd>{count(m.count)} {m.count.evidenceRefs.length>0&&<button className="link" disabled={blocked} onClick={()=>onEvidence(m.count.evidenceRefs)}>{t('execution.evidence')}</button>}<br/><small>{t('execution.repeats.knownSum')}: {duration(m.duration.knownSumMs)}</small></dd></div>)}</dl>
  <p className="compact-note">{t('execution.repeats.layer')}</p>
  <details><summary>{t('execution.repeats.observations')}</summary><dl className="facts"><dt>{t('execution.repeats.sameRequest')}</dt><dd>{count(repeats.sameRequestObservationCount)}</dd><dt>{t('execution.repeats.readRequest')}</dt><dd>{count(repeats.repeatedReadRequestCount)}</dd></dl><p className="compact-note">{t('execution.repeats.observationNote')}</p></details>
  <details><summary>{t('execution.repeats.coverage')}</summary>
   <dl className="facts"><dt>{t('execution.repeats.combined')}</dt><dd>{count(repeats.combinedOperationCount)}</dd><dt>{t('execution.repeats.union')}</dt><dd>{duration(repeats.combinedUnionMs)}</dd><dt>{t('execution.repeats.recovery')}</dt><dd>{duration(repeats.recoverySpanSumMs)}</dd><dt>{t('execution.repeats.missingRecovery')}</dt><dd>{count(repeats.missingRecoverySpanCount)}</dd><dt>{t('execution.repeats.missingIntervals')}</dt><dd>{count(repeats.combinedMissingIntervalCount)}</dd><dt>{t('execution.repeats.candidates')}</dt><dd>{count(repeats.coverage.candidateOperations)}</dd><dt>{t('execution.repeats.eligible')}</dt><dd>{count(repeats.coverage.eligibleCommands)}</dd></dl>
   {groups.map(([label,m])=><div key={label}><h5>{t(label)}</h5><dl className="facts"><dt>{t('execution.repeats.recorded')}</dt><dd>{count(m.duration.recordedCount)}</dd><dt>{t('execution.repeats.calculated')}</dt><dd>{count(m.duration.calculatedCount)}</dd><dt>{t('execution.repeats.missing')}</dt><dd>{count(m.duration.missingCount)}</dd></dl></div>)}
   <p className="compact-note">{t('execution.repeats.note')}</p>
   {repeats.coverage.reasonCodes.length>0&&<ul className="note">{repeats.coverage.reasonCodes.map(reason=><li key={reason}>{repeatedBehaviorReasonText(reason)}</li>)}</ul>}
  </details>
 </section>;
}
