import {t} from '@wombat/client/locale';
import {directoryName} from './components.js';
/** Only directories observed in source metadata are offered; no inferred scan progress. */
export function StartupDirectories({directories,open,instructions}:{directories:string[];open:(directory:string)=>void;instructions:()=>void}){
 return <section className="startup-directories"><p>{t('startup.explanation')}</p>{directories.length>0&&<><p>{t('startup.directories',{count:directories.length})}</p><ul>{directories.map(directory=><li key={directory}><div><strong>{directoryName(directory)}</strong><small>{directory}</small></div><button className="link" onClick={()=>open(directory)}>{t('startup.open')}</button></li>)}</ul></>}<button className="link" onClick={instructions}>{t('startup.instructions')}</button></section>;
}
