import {useState,useSyncExternalStore} from 'react';
import {locale,t} from '@wombat/client/locale';
import {Execution,type ExecutionView} from '../tasks/Execution.js';
import type {Scenario} from './fixtures.js';
export function executionFixture(scenario:Scenario,revision=0):ExecutionView {
 const empty=scenario==='empty',missing=scenario==='missing'||empty,running=scenario==='running';
 const count=empty?0:(scenario==='dense'?53:3)+revision;
 return {observedWindow:!missing,status:empty?'unknown':running?'running':'completed',duration:missing||running?null:'100 s',cutoff:`10:${String(revision+1).padStart(2,'0')}:00`,tracks:empty?[]:[['compaction','0–30 s',0,30],['command-a','30–60 s',30,30],['command-b','50–80 s',50,30],['activity','20–50 s',20,30]].map(([id,range,left,width])=>({id:String(id),label:String(id),range:missing?t('execution.missing'):String(range),left:Number(left),width:Number(width),evidence:t('preview.operationEvidence')})),distribution:missing?null:t('preview.distribution'),uses:empty?[]:[{id:'skill',name:'query-review',count,records:Array.from({length:count},(_,index)=>({id:`read-${index}`,label:t('preview.skillRead',{status:index===1?t('preview.error'):t('preview.complete')})}))},{id:'mcp',name:'project-docs / search',count:1,records:[{id:'call-1',label:t('execution.unknown')}]}],shareText:`Token: ${empty?0:1100}\nSkill: ${count}\n${t('preview.shareScope')}`};
}
export function ExecutionPreview({scenario}:{scenario:Scenario}){
 useSyncExternalStore(locale.subscribe,locale.getSnapshot);
 const [revision,setRevision]=useState(0);
 if(scenario==='loading')return <p role="status">{t('preview.loading')}</p>;
 if(scenario==='error')return <p role="alert">{t('preview.error')}</p>;
 return <main style={{maxWidth:1000,margin:'auto',padding:24}}><Execution view={executionFixture(scenario,revision)} refresh={()=>setRevision(n=>n+1)}/></main>;
}
