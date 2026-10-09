import { numberLabel } from '@wombat/client/locale';
import type {PricingResult} from '@wombat/client';
import {t} from '@wombat/client/locale';
import {safeURL} from '../components.js';
/** Current catalog presentation; historical snapshot prices stay in their own results. */
export function PriceCatalog({catalog,tier}:{catalog:PricingResult['catalog'];tier:string}){
 return <section className="panel"><div className="report-table-wrap" tabIndex={0} aria-label={t('webui.prices')}><table className="project-table price-table"><thead><tr><th>{t('webui.model')} / {t('webui.basis')}</th><th>{t('webui.uncached')}</th><th>{t('webui.cacheRead')}</th><th>{t('webui.cacheCreate')}</th><th>{t('webui.output')}</th></tr></thead><tbody>{catalog.models.map(model=>{const rates=tier==='standard'?model.rates:model.longContext?.rates;return <tr key={model.id}><td><details><summary>{model.id}</summary><p className="subtle">{model.aliases.join(' / ')}<br/>{model.longContext?t('webui.longThreshold',{tokens:numberLabel(model.longContext.inputAbove)}):t('webui.noLongTier')}</p>{safeURL(model.source)&&<a target="_blank" rel="noreferrer" href={model.source}>{t('webui.official')}</a>}</details></td>{(['input','cacheRead','cacheCreate','output'] as const).map(category=><td key={category}>{!rates?'—':rates[category]==null?t('webui.notListed'):'$'+rates[category]}</td>)}</tr>;})}</tbody></table></div></section>;
}
