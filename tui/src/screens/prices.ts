import { t } from '@wombat/client/locale';
import type { PricingResult } from '@wombat/client';
import type { Choice, Frame, TableCell } from '../components/view-model.js';

type Model = PricingResult['catalog']['models'][number];
export interface PriceViewState { tier: 'standard' | 'long'; cursor: number; expanded?: string; }
export const pricePageSize = (width: number) => width < 68 ? 2 : width < 110 ? 5 : 8;
const rate = (value: string | null | undefined) => value == null ? t("tui.screens.prices.not_separately_priced") : '$' + value;
const columns = (labels: string[], header = false, unavailable = false): TableCell[] => labels.map((text, i) => ({
  text, grow: i ? 1 : 1.8, growBasis: 0, minWidth: i ? 9 : 17, align: i ? 'right' : 'left',
  bold: !header && i === 0, tone: header ? 'muted' : unavailable && i ? 'priceUnavailable' : i ? 'priceNumber' : 'priceModel',
}));
function details(model: Model): NonNullable<Choice['priceDetail']> {
  return { lines: [model.aliases.length ? t("tui.screens.prices.explicit_aliases") + model.aliases.join('、') : t("tui.screens.prices.no_listed_aliases"),
    model.longContext ? t("tui.screens.prices.long_context_tier_input_including_cache", { p0: model.longContext.inputAbove.toLocaleString('en-US') }) : t("tui.screens.prices.no_long_context_tier_is_listed"),
  ], source: model.source };
}
export function priceFrame(prices: PricingResult, state: PriceViewState, notice?: string): Frame {
  const models = [...prices.catalog.models].sort((a,b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return { title: t("common.wombat_prices"), intro: [t("tui.screens.prices.value_million_tokens_standard_api_equivalent", { p0: prices.catalog.currency })],
    compactIntro: [t("tui.screens.prices.value_million_tokens", { p0: prices.catalog.currency })], compactFooter:t("tui.screens.prices.s_tier_n_p_page_u"),
    nav: t("tui.screens.prices.1_usage_2_threads"), activeTab: t("common.1_usage"), pageNavigation: true, choices: [], footer: '',
    shortcuts: { s: state.tier === 'standard' ? 'sort:1' : 'sort:0', u: 'update-prices', n: 'next', p: 'previous', '1': 'usage-tab', '2': 'threads-tab' },
    controlOptions: [t("common.standard_prices"),t("common.long_context_prices")], activeControl: state.tier === 'standard' ? t("common.standard_prices") : t("common.long_context_prices"),
    actions: t("tui.screens.prices.u_update_prices_online_b_back"),
    layout: width => {
      const size = pricePageSize(width), cursor = Math.min(state.cursor, Math.max(0, models.length-1)), page = Math.floor(cursor/size);
      const choices: Choice[] = models.slice(page*size,(page+1)*size).map(model => {
        const rates = state.tier === 'standard' ? model.rates : model.longContext?.rates;
        const values = rates ? [rate(rates.input),rate(rates.cacheRead),rate(rates.cacheCreate),rate(rates.output)] : ['—','—','—','—'];
        return { id: 'model:' + model.id, kind: 'price', recordStart: true,
          cells: width >= 68 ? columns([model.id,...values],false,!rates) : undefined,
          lines: width < 68 ? [model.id, ...(rates ? [] : [t("tui.screens.prices.no_long_context_tier")])] : [],
          paint: [{ tone:'priceModel', bold:true },{tone:'priceUnavailable'}],
          pricePairs: width < 68 && rates ? [t("common.input"),t("common.cache_read"),t("common.cache_write"),t("common.output")].map((label,index) => ({label,value:values[index]})) : undefined,
          priceDetail: state.expanded === model.id ? details(model) : undefined,
        };
      });
      return { choices, selected: cursor%size, tableCells: width >= 68 ? columns([t("common.model"),t("common.input"),t("common.cache_read"),t("common.cache_write"),t("common.output")],true) : undefined,
        empty: [t("tui.screens.prices.no_models_in_the_price_catalog"),t("tui.screens.prices.u_update_prices_online")], status: notice,
        footer: t("tui.screens.prices.page_value_value_value_models_select", { p0: page+1, p1: Math.max(1,Math.ceil(models.length/size)), p2: models.length, p3: prices.catalog.verifiedAt }),
      };
    },
  };
}
