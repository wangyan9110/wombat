import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {CoreError, validateWebViewRequest, type WebViewRequest, type UsageClient, type QueryOptions} from '@wombat/client';

interface Scope {roots:string[];projectRoots:(project?:string|null)=>string[];authorizeProject:(project:string|null|undefined,q:QueryOptions)=>Promise<void>}
export async function prepareWebView(client:UsageClient,raw:WebViewRequest,scope:Scope,q:QueryOptions={}):Promise<WebViewRequest>{
  validateWebViewRequest(raw);
  const view=structuredClone(raw);
  if(['usage','threads'].includes(view.page)){
    const r=view.usage;if(!r||view.configuration||view.optimization||r.roots!=null||!['usage','threads','turns','steps'].includes(r.action)||view.page==='usage'&&r.action!=='usage'||view.page==='threads'&&r.action==='usage')throw new CoreError('INVALID_ARGUMENT','Invalid usage context');
    if(Boolean(r.scope?.since)!==Boolean(r.scope?.until))throw new CoreError('INVALID_ARGUMENT','Web context requires both date boundaries or allTime');
    if(r.action==='steps'&&r.sort!=null&&r.sort!=='time')throw new CoreError('INVALID_ARGUMENT','Web steps use chronological order');
    await scope.authorizeProject(r.scope?.project,q);
    const result=r.snapshotId&&!r.snapshotId.startsWith('live:')?await client.query(r,q):client.live?(await client.live({query:{...r,roots:scope.roots},mode:r.snapshotId?'cached':'auto'},q)).result:await client.query({...r,roots:scope.roots},q);
    // An imported snapshot must prove all source roots belong to this host.
    if(r.snapshotId&&!r.snapshotId.startsWith('live:')){
      const allowed=await Promise.all(scope.roots.map(root=>realpath(root).catch(()=>path.resolve(root))));
      const sources=result.quality.sources;
      if(!sources.length||sources.some(s=>!allowed.includes(path.resolve(s.source.root))))throw new CoreError('WEB_VERSION_UNAVAILABLE','Snapshot source scope cannot be authorized');
    }
    if(r.snapshotId&&r.snapshotId!==result.snapshotRef.snapshotId)throw new CoreError('VIEW_EXPIRED','Requested usage version was not retained');
    r.snapshotId=result.snapshotRef.snapshotId;r.scope=result.scope;
    if(!r.scope.since&&!r.scope.until&&!r.scope.undated)r.scope.allTime=true;
    if(r.locateThreadId)r.threadId=r.locateThreadId;if(r.locateTurnId)r.turnId=r.locateTurnId;
    r.offset=result.page.offset;
  }else if(['instructions','extensions'].includes(view.page)){
    const r=view.configuration;if(!r||view.usage||view.optimization||r.roots!=null||r.projectRoots!=null||r.snapshotId!=null||!['list','detail','evidence','related_scopes'].includes(r.action??'list'))throw new CoreError('INVALID_ARGUMENT','Invalid configuration context');
    if(r.kinds!=null||r.observation!=null||r.sort!=null&&r.sort!==(view.page==='instructions'?'name':'activity'))throw new CoreError('INVALID_ARGUMENT','Configuration filters cannot be represented in Web');
    if(view.page==='instructions'&&r.kind!=null&&r.kind!=='rule'||view.page==='extensions'&&r.kind==='rule')throw new CoreError('INVALID_ARGUMENT','Configuration page does not match kind');
    await scope.authorizeProject(r.scope?.project,q);
    if(!client.config)throw new CoreError('CONFIG_UNAVAILABLE','Configuration unavailable');
    const result=await client.config({...r,roots:scope.roots,projectRoots:scope.projectRoots(r.scope?.project)},q);
    if(!result.readView)throw new CoreError('WEB_VERSION_UNAVAILABLE','Configuration view unavailable');
    if(r.readView&&r.readView!==result.readView)throw new CoreError('VIEW_EXPIRED','Requested configuration version was not retained');
    r.readView=result.readView;r.scope=result.scope;
  }else{
    const r=view.optimization;if(!r||view.usage||view.configuration||r.roots!=null||r.projectRoots!=null||!['list','detail'].includes(r.action??'list'))throw new CoreError('INVALID_ARGUMENT','Invalid optimization context');
    if(r.itemId!=null||r.decisionReason!=null)throw new CoreError('INVALID_ARGUMENT','Optimization context cannot represent this filter');
    await scope.authorizeProject(r.project,q);
    if(!client.optimize)throw new CoreError('OPTIMIZE_UNAVAILABLE','Optimization unavailable');
    const result=await client.optimize({...r,roots:scope.roots,projectRoots:scope.projectRoots(r.project)},q);
    if(!result.readView)throw new CoreError('WEB_VERSION_UNAVAILABLE','Optimization view unavailable');
    r.readView=result.readView;r.decisionRevision=result.decisionRevision;
  }
  return view;
}
