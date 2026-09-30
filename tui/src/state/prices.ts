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
      prices = await ui.task({ kind: 'query', message: action === 'status' ? '正在读取价表…' : '正在更新官方价表…' }, options => client.prices({ action }, options));
      notice = action === 'update' ? `${prices.updated ? '价表已更新' : '价表内容未变化'} · 更新用量后生效` : undefined;
    } catch (error) {
      if (ui.signal.aborted || (error instanceof CoreError && error.code === 'CANCELLED')) throw error;
      notice = error instanceof OperationCancelled ? '读取已取消' : error instanceof Error ? error.message : String(error);
    }
  }
  await read('status');
  for (;;) {
    if (ui.signal.aborted) return 'quit';
    const frame = prices ? priceFrame(prices,state,notice) : {
      title:'Wombat / 价格表',intro:[notice ?? '价表无法读取'],choices:[{id:'update-prices',lines:['联网更新价表']},{id:'retry',lines:['重试']}],
      footer:'U 联网更新价表 · Esc 返回',shortcuts:{u:'update-prices'},
    };
    // Empty catalogs still offer the existing explicit recovery action.
    if (prices && !prices.catalog.models.length) frame.choices = [{id:'update-prices',lines:['联网更新价表']}];
    if (prices && !prices.catalog.models.length) { frame.layout = undefined; frame.status = notice; frame.footer = 'U 联网更新价表 · Esc 返回'; }
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
