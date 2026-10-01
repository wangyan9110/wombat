import { t } from '@wombat/client/locale';
import type { PricingResult } from '@wombat/client';
import type { Choice, Frame, TableCell } from '../components/view-model.js';
import { dateLabel } from './format.js';

type Model = PricingResult['catalog']['models'][number];
export interface PriceViewState { tier: 'standard' | 'long'; cursor: number; expanded?: string; notes?: boolean; }
export const pricePageSize = (width: number) => width < 68 ? 2 : width < 110 ? 5 : 8;
const rate = (value: string | null | undefined) => value == null ? t("tui.screens.prices.not_separately_priced") : '$' + value;
const columns = (width: number, labels: string[], header = false, unavailable = false): TableCell[] => {
 const available = Math.min(width, 120) - 4 - 3 - 4;
 const boundaries = [0, 1.8, 2.8, 3.8, 4.8, 5.8].map(weight => Math.round(available * weight / 5.8));
 return labels.map((text, i) => ({
  text, width: boundaries[i + 1] - boundaries[i], align: i ? 'right' : 'left',
  bold: !header && i === 0, tone: header ? 'muted' : unavailable && i ? 'priceUnavailable' : i ? 'priceNumber' : 'priceModel',
}));
};
function details(model: Model): NonNullable<Choice['priceDetail']> {
  return { lines: [model.aliases.length ? t("tui.screens.prices.explicit_aliases") + model.aliases.join('、') : t("tui.screens.prices.no_listed_aliases"),
    model.longContext ? t("tui.screens.prices.long_context_tier_input_including_cache", { p0: model.longContext.inputAbove.toLocaleString('en-US') }) : t("tui.screens.prices.no_long_context_tier_is_listed"),
  ], source: model.source };
}
export function priceFrame(prices: PricingResult, state: PriceViewState, notice?: string, activeTab: 'usage' | 'threads' = 'usage'): Frame {
  const models = [...prices.catalog.models].sort((a,b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const basis = t('tui.prices.breadcrumb', { revision: prices.catalog.revision, date: dateLabel(prices.catalog.verifiedAt, prices.catalog.verifiedAt + 'T00:00:00Z', 'UTC', false, undefined, true) });
  return { title: t("common.wombat_prices"), intro: [basis],
    context: [{ text: t("tui.screens.prices.value_million_tokens_standard_api_equivalent", { p0: prices.catalog.currency }), summary: true }], tableHeaderBorder: 'top',
    compactIntro: [t('tui.prices.compact_breadcrumb')], compactFooter: t('tui.prices.compact_footer'),
    nav: t("tui.screens.prices.1_usage_2_threads"), activeTab: activeTab === 'usage' ? t("common.1_usage") : t("common.2_threads"), pageNavigation: true, choices: [], footer: '',
    shortcuts: { l: 'language', s: state.tier === 'standard' ? 'sort:1' : 'sort:0', u: 'update-prices', n: 'next', p: 'previous', '1': 'usage-tab', '2': 'threads-tab' },
    controlOptions: [t("common.standard_prices"),t("common.long_context_prices")], activeControl: state.tier === 'standard' ? t("common.standard_prices") : t("common.long_context_prices"),
    actions: t("tui.screens.prices.u_update_prices_online_b_back"),
    disclosureLabel: t('tui.prices.notes'),
    disclosure: state.notes ? [t('tui.app.cost_basis_standard_api_equivalent'), t('tui.app.not_an_account_bill_marks_the'), t('tui.prices.unknown_rates')] : undefined,
    layout: width => {
      const size = pricePageSize(width), cursor = Math.min(state.cursor, Math.max(0, models.length-1)), page = Math.floor(cursor/size);
      const choices: Choice[] = models.slice(page*size,(page+1)*size).map(model => {
        const rates = state.tier === 'standard' ? model.rates : model.longContext?.rates;
        const values = rates ? [rate(rates.input),rate(rates.cacheRead),rate(rates.cacheCreate),rate(rates.output)] : ['—','—','—','—'];
        return { id: 'model:' + model.id, kind: 'price', recordStart: true,
          cells: width >= 68 ? columns(width,[model.id,...values],false,!rates) : undefined,
          lines: width < 68 ? [model.id, ...(rates ? [] : [t("tui.screens.prices.no_long_context_tier")])] : [],
          paint: [{ tone:'priceModel', bold:true },{tone:'priceUnavailable'}],
          pricePairs: width < 68 && rates ? [t("common.input"),t("common.cache_read"),t("common.cache_write"),t("common.output")].map((label,index) => ({label,value:values[index]})) : undefined,
          priceDetail: state.expanded === model.id ? details(model) : undefined,
        };
      });
      return { choices, selected: cursor%size, tableCells: width >= 68 ? columns(width,[t("common.model"),t("common.input"),t("common.cache_read"),t("common.cache_write"),t("common.output")],true) : undefined,
        empty: [t("tui.screens.prices.no_models_in_the_price_catalog"),t("tui.screens.prices.u_update_prices_online")], status: notice,
        totalNote: t('tui.prices.page', { current: page+1, total: Math.max(1,Math.ceil(models.length/size)) }) + (width < 68 ? '\n' + basis : ''),
        footer: t('tui.prices.footer'),
      };
    },
  };
}
