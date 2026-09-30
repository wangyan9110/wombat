import { t } from '@wombat/client/locale';
import { CoreError, type UsageClient, type PricingResult } from '@wombat/client';
import type { TerminalUI } from '../components/terminal-ui.js';
import { priceFrame, pricePageSize, type PriceViewState } from '../screens/prices.js';
import { OperationCancelled } from '../components/loading-model.js';

type Exit = 'back' | 'quit' | 'usage-tab' | 'threads-tab';
export async function browsePrices(client: UsageClient, ui: TerminalUI): Promise<Exit> {
  let prices: PricingResult | undefined, notice: string | undefined;
  const state: PriceViewState = { tier: 'standard', cursor: 0 };
  async function read(action: 'status' | 'update') {
    try {
      prices = await ui.task({ kind: 'query', message: action === 'status' ? t("tui.state.prices.loading_prices") : t("tui.state.prices.updating_official_prices") }, options => client.prices({ action }, options));
      notice = action === 'update' ? t("tui.state.prices.value_applies_after_refreshing_usage", { p0: prices.updated ? t("common.prices_updated") : t("common.prices_unchanged") }) : undefined;
    } catch (error) {
      if (ui.signal.aborted || (error instanceof CoreError && error.code === 'CANCELLED')) throw error;
      notice = error instanceof OperationCancelled ? t("common.loading_cancelled") : error instanceof Error ? error.message : String(error);
    }
  }
  await read('status');
  for (;;) {
    if (ui.signal.aborted) return 'quit';
    const frame = prices ? priceFrame(prices,state,notice) : {
      title:t("common.wombat_prices"),intro:[notice ?? t("tui.state.prices.prices_unavailable")],choices:[{id:'update-prices',lines:[t("common.update_prices_online")]},{id:'retry',lines:[t("common.retry")]}],
      footer:t("common.u_update_prices_online_esc_back"),shortcuts:{u:'update-prices'},
    };
    // Empty catalogs still offer the existing explicit recovery action.
    if (prices && !prices.catalog.models.length) frame.choices = [{id:'update-prices',lines:[t("common.update_prices_online")]}];
    if (prices && !prices.catalog.models.length) { frame.layout = undefined; frame.status = notice; frame.footer = t("common.u_update_prices_online_esc_back"); }
    const answer = await ui.choose(frame);
    if (answer.id === 'quit' || answer.id === 'back' || answer.id === 'usage-tab' || answer.id === 'threads-tab') return answer.id;
    if (answer.id === 'tab') return 'threads-tab';
    if (answer.id === 'update-prices' || answer.id === 'retry') { await read(answer.id === 'retry' ? 'status' : 'update'); continue; }
    if (!prices) continue;
    if (answer.id.startsWith('model:')) { const id=answer.id.slice(6); state.cursor=[...prices.catalog.models].sort((a,b)=>a.id.localeCompare(b.id,'en',{numeric:true})).findIndex(model=>model.id===id); state.expanded=state.expanded===id?undefined:id; }
    else if (answer.id.startsWith('sort:')) { state.tier=answer.id==='sort:1'?'long':'standard';state.expanded=undefined; }
    else if (answer.id==='next'||answer.id==='previous'||answer.id.startsWith('cursor:')) {
      const size=pricePageSize(ui.renderer.width), last=Math.max(0,prices.catalog.models.length-1);
      const delta=answer.id==='next'?size:answer.id==='previous'?-size:answer.id==='cursor:down'?1:-1;
      state.cursor=answer.id==='cursor:home'?0:answer.id==='cursor:end'?last:Math.max(0,Math.min(last,state.cursor+delta));
    }
  }
}
