import { numberLabel } from '@wombat/client/locale';
import { useMemo } from 'react';
import type { ConfigItem,ConfigResult,OptimizeSuggestion } from '@wombat/client';
import { t,bytesLabel,reviewPresentation,inventoryRecordState } from '@wombat/client/locale';
import { Token,timestamp } from './components.js';
import { stateLabel } from './config/presentation.js';
import type { Route } from './state.js';
import './inventory.css';

export interface InventoryNode { id:string; name:string; path:string; item?:ConfigItem; children:InventoryNode[]; findingIds:Set<string> }
const parts=(path:string)=>path.replaceAll('\\','/').split('/').filter(Boolean);
const directory=(path:string)=>path.replaceAll('\\','/').replace(/\/[^/]*$/,'');
/** Files already carry authorized membership. Tree shape uses path components, never guesses projects. */
export function instructionTree(items:ConfigItem[],suggestions:Map<string,OptimizeSuggestion[]>):InventoryNode[] {
  const roots=new Map<string,InventoryNode>();
  const directories=new Map<string,InventoryNode>();
  for(const item of items) {
    const root=item.project??directory(item.path),rootParts=parts(root),fileParts=parts(item.path);
    if(!rootParts.every((v,i)=>fileParts[i]===v))continue;
    let found=roots.get(root);
    if(!found){found={id:`directory:${root}`,name:rootParts.at(-1)??root,path:root,children:[],findingIds:new Set()};roots.set(root,found);}
    let node:InventoryNode=found;
    const ancestors=[node];let path=root;
    for(const part of fileParts.slice(rootParts.length,-1)){path+='/'+part;const key=JSON.stringify([root,path]);let child=directories.get(key);if(!child){child={id:`directory:${path}`,name:part,path,children:[],findingIds:new Set()};node.children.push(child);directories.set(key,child);}node=child;ancestors.push(node);}
    const ids=new Set(suggestions.get(item.id)?.map(s=>s.id));
    node.children.push({id:item.id,name:item.name,path:item.path,item,children:[],findingIds:ids});for(const parent of ancestors)for(const id of ids)parent.findingIds.add(id);
  }
  return [...roots.values()];
}
export function pruneInstructions(nodes:InventoryNode[],search:string,onlySuggestions:boolean):InventoryNode[] {
  const query=search.trim().toLocaleLowerCase();
  return nodes.flatMap(node=>{
    const children=pruneInstructions(node.children,search,onlySuggestions);
    const matches=(!query||node.path.toLocaleLowerCase().includes(query))&&(!onlySuggestions||node.findingIds.size>0);
    if(node.item)return matches?[node]:[];
    return children.length?[{...node,children}]:[];
  });
}
function Advice({item,suggestions,open}:{item:ConfigItem;suggestions:Map<string,OptimizeSuggestion[]>;open:(s:OptimizeSuggestion)=>void}) {
  const findings=suggestions.get(item.id)??[];
  return <>{findings.map(s=><button className="inventory-advice" key={s.id} onClick={()=>open(s)}>{reviewPresentation(s).title}</button>)}{!findings.length&&<span className="subtle">{t('config.noSuggestion')}</span>}</>;
}
function RecentRecord({item,coverage,timezone}:{item:ConfigItem;coverage:ConfigResult['coverage'];timezone:string}) {
  const state=inventoryRecordState(item,coverage);
  return <span title={state.hint}>{state.kind==='time'?timestamp(item.lastRecordAt,timezone).split(' · ')[0]:state.text}</span>;
}
export function InstructionInventory({items,coverage,suggestions,route,onlySuggestions,onOpen,onSuggestion,onExpand}:{items:ConfigItem[];coverage:ConfigResult['coverage'];suggestions:Map<string,OptimizeSuggestion[]>;route:Route;onlySuggestions:boolean;onOpen:(item:ConfigItem)=>void;onSuggestion:(s:OptimizeSuggestion)=>void;onExpand:(value:string)=>void}) {
  const expanded=useMemo(()=>new Set<string>(route.instructionExpansion?JSON.parse(route.instructionExpansion):[]),[route.instructionExpansion]);
  const initialized=route.instructionExpansion!==undefined;
  const tree=useMemo(()=>instructionTree(items,suggestions),[items,suggestions]);
  const filtered=useMemo(()=>pruneInstructions(tree,route.instructionSearch??'',onlySuggestions),[tree,route.instructionSearch,onlySuggestions]);
  const forced=!!route.instructionSearch||onlySuggestions;
  const comparator=(a:InventoryNode,b:InventoryNode)=>{
    if(!a.item&&!b.item)return a.path.localeCompare(b.path);
    if(!a.item||!b.item)return a.item?1:-1;
    return a.name.localeCompare(b.name)||a.id.localeCompare(b.id);
  };
  const rows=(nodes:InventoryNode[],depth=0):React.ReactNode=>[...nodes].sort(comparator).map(node=>{
    const open=forced||expanded.has(node.id)||(!initialized&&depth===0);
    const item=node.item;
    return <ReactFragment key={node.id}><tr className={item?'inventory-file':'inventory-folder'}><th scope="row"><button className="inventory-name" data-config-id={item?.id} style={{paddingInlineStart:depth*20}} title={node.path} aria-expanded={item?undefined:open} aria-label={item?undefined:t(open?'config.treeCollapse':'config.treeExpand',{name:node.name})} onClick={()=>{if(item){onOpen(item);return;}const next=new Set(initialized?expanded:tree.map(n=>n.id));if(next.has(node.id))next.delete(node.id);else next.add(node.id);onExpand(JSON.stringify([...next].sort()));}}>{!item&&<span aria-hidden="true">{open?'▾':'▸'}</span>}{node.name}</button></th><td>{item?<Token value={item.contentTokens} estimated/>:'—'}</td><td>{numberLabel(item?.characters)}</td><td>{item?bytesLabel(item.bytes):'—'}</td><td>{item?<RecentRecord item={item} coverage={coverage} timezone={route.timezone}/>:'—'}</td><td>{item?<Advice item={item} suggestions={suggestions} open={onSuggestion}/>:node.findingIds.size?t('config.findingCount',{count:node.findingIds.size}):'—'}</td></tr>{!item&&open&&rows(node.children,depth+1)}</ReactFragment>;
  });
  return <div className="inventory-scroll"><table className="inventory-table instruction-inventory"><thead><tr><th>{t('config.name')}</th><th>{t('config.content_tokens')}</th><th>{t('config.characters')}</th><th>{t('config.size')}</th><th>{t('config.recent')}</th><th>{t('config.relatedSuggestion')}</th></tr></thead><tbody>{rows(filtered)}</tbody></table></div>;
}
import { Fragment as ReactFragment } from 'react';
export function ExtensionInventory({items,coverage,suggestions,route,onOpen,onSuggestion}:{items:ConfigItem[];coverage:ConfigResult['coverage'];suggestions:Map<string,OptimizeSuggestion[]>;route:Route;onOpen:(item:ConfigItem)=>void;onSuggestion:(s:OptimizeSuggestion)=>void}) {
  const columns=['observedUses','size','content_tokens','recent'] as const;
  return <div className="inventory-scroll extension-scroll"><table className="inventory-table extension-inventory"><thead><tr><th>{t('config.name')}</th>{columns.map(c=><th key={c}>{t(`config.${c}`)}</th>)}<th>{t('config.relatedSuggestion')}</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><th scope="row"><button className="inventory-name" data-config-id={item.id} onClick={()=>onOpen(item)}>{item.name}</button><small>{t(`config.${item.kind}`)} · {stateLabel(item)}</small></th><td><span className="inventory-mobile-label">{t('config.observedUses')}</span>{numberLabel(item.usageCount)}{item.kind==='skill'&&item.relatedTasks>0&&<small>{t('config.relatedTaskCount',{count:item.relatedTasks})}</small>}</td><td><span className="inventory-mobile-label">{t('config.size')}</span>{bytesLabel(item.bytes)}</td><td><span className="inventory-mobile-label">{t('config.content_tokens')}</span><Token value={item.contentTokens} estimated/></td><td><span className="inventory-mobile-label">{t('config.recent')}</span>{<RecentRecord item={item} coverage={coverage} timezone={route.timezone}/>}</td><td><Advice item={item} suggestions={suggestions} open={onSuggestion}/></td></tr>)}</tbody></table></div>;
}
