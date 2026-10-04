import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { realpath,stat } from 'node:fs/promises';
import path from 'node:path';
import type { DirectoriesRequest,DirectoriesResult,QueryOptions } from '../client.js';
import { CoreError } from '../errors.js';
import { invokeOperation,type CoreProcessOptions } from './core.js';

/** Only this host-created choice can authorize a browser request. Tokens expire and are single-use. */
export function createDirectoryTransport(config:CoreProcessOptions,picker=chooseDirectory) {
  const choices=new Map<string,{path:string;identity:string;purpose:NonNullable<DirectoriesRequest['purpose']>;expires:number}>();
  let selecting=false;
  const identity=async(directory:string)=>{const info=await stat(directory,{bigint:true});if(!info.isDirectory()||await realpath(directory)!==directory)throw new CoreError('DIRECTORY_CHANGED','Choose the directory again');return `${info.dev}:${info.ino}:${info.birthtimeNs}`;};
  return async(request:DirectoriesRequest,options:QueryOptions):Promise<DirectoriesResult>=>{
    for(const[token,value]of choices)if(value.expires<Date.now())choices.delete(token);
    if(request.action==='choose') {
      if(!request.purpose||request.path||request.choiceToken||choices.size>=8||selecting)throw new CoreError('INVALID_ARGUMENT','Invalid directory selection');
      selecting=true;let selected:string;
      try{selected=await realpath(await picker(options.signal));}finally{selecting=false;}
      const fingerprint=await identity(selected);
      const token=randomBytes(32).toString('hex');choices.set(token,{path:selected,identity:fingerprint,purpose:request.purpose,expires:Date.now()+300000});
      return {outputVersion:1,action:'choose',grants:[],chosenPath:selected,choiceToken:token};
    }
    if(request.action==='confirm') {
      if(request.path||!request.choiceToken)throw new CoreError('INVALID_ARGUMENT','Host choice required');
      const choice=choices.get(request.choiceToken);if(!choice)throw new CoreError('CHOICE_EXPIRED','Choose the directory again');
      choices.delete(request.choiceToken);
      if(await identity(choice.path)!==choice.identity)throw new CoreError('DIRECTORY_CHANGED','Choose the directory again');
      const result=await invokeOperation('directories',{action:'authorize',purpose:choice.purpose,path:choice.path},options,config) as DirectoriesResult;
      return {...result,action:'confirm'};
    }
    return invokeOperation('directories',request,options,config) as Promise<DirectoriesResult>;
  };
}
function program(command:string,args:string[],signal?:AbortSignal):Promise<string> {
  return new Promise((resolve,reject)=>execFile(command,args,{signal,timeout:120000,maxBuffer:65536,windowsHide:false},(error,stdout)=>{
    if(error){reject(new CoreError(signal?.aborted?'CANCELLED':(error as NodeJS.ErrnoException).code==='ENOENT'?'DIRECTORY_PICKER_UNAVAILABLE':'CANCELLED','Directory selection did not complete'));return;}
    const result=stdout.trim();if(!result)reject(new CoreError('CANCELLED','Directory selection cancelled'));else resolve(result);
  }));
}
export async function chooseDirectory(signal?:AbortSignal):Promise<string> {
  if(process.platform==='darwin')return program('/usr/bin/osascript',['-e','POSIX path of (choose folder with prompt "Wombat: select a directory to inspect")'],signal);
  if(process.platform==='win32')return program(path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-STA','-Command','Add-Type -AssemblyName System.Windows.Forms; $wombatPicker = New-Object System.Windows.Forms.FolderBrowserDialog; if ($wombatPicker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($wombatPicker.SelectedPath) }'],signal);
  try{return await program('/usr/bin/zenity',['--file-selection','--directory','--title=Wombat: select a directory to inspect'],signal);}catch(error){if(!(error instanceof CoreError)||error.code!=='DIRECTORY_PICKER_UNAVAILABLE')throw error;return program('/usr/bin/kdialog',['--getexistingdirectory'],signal);}
}
