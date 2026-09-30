import type { PricingResult } from '@wombat/client';
import type { Choice, Frame, TableCell } from '../components/view-model.js';

type Model = PricingResult['catalog']['models'][number];
export interface PriceViewState { tier: 'standard' | 'long'; cursor: number; expanded?: string; }
export const pricePageSize = (width: number) => width < 68 ? 2 : width < 110 ? 5 : 8;
const rate = (value: string | null | undefined) => value == null ? '未单列' : '$' + value;
const columns = (labels: string[], header = false, unavailable = false): TableCell[] => labels.map((text, i) => ({
  text, grow: i ? 1 : 1.8, growBasis: 0, minWidth: i ? 9 : 17, align: i ? 'right' : 'left',
  bold: !header && i === 0, tone: header ? 'muted' : unavailable && i ? 'priceUnavailable' : i ? 'priceNumber' : 'priceModel',
}));
function details(model: Model): NonNullable<Choice['priceDetail']> {
  return { lines: [model.aliases.length ? '明确别名 ' + model.aliases.join('、') : '无列出的别名',
    model.longContext ? `长上下文档：请求输入含缓存超过 ${model.longContext.inputAbove.toLocaleString('en-US')} Token；等于此值仍按标准价。` : '此模型未列长上下文档。',
  ], source: model.source };
}
export function priceFrame(prices: PricingResult, state: PriceViewState, notice?: string): Frame {
  const models = [...prices.catalog.models].sort((a,b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return { title: 'Wombat / 价格表', intro: [`${prices.catalog.currency} / 100万 Token · 标准 API 等价单价`],
    compactIntro: [`${prices.catalog.currency} / 100万 Token`], compactFooter:'S 档位 · N/P 翻页 · U 更新 · Esc 返回',
    nav: '1 用量 2 对话', activeTab: '1 用量', pageNavigation: true, choices: [], footer: '',
    shortcuts: { s: state.tier === 'standard' ? 'sort:1' : 'sort:0', u: 'update-prices', n: 'next', p: 'previous', '1': 'usage-tab', '2': 'threads-tab' },
    controlOptions: ['标准价格','长上下文价格'], activeControl: state.tier === 'standard' ? '标准价格' : '长上下文价格',
    actions: 'U 联网更新价表 · B 返回',
    layout: width => {
      const size = pricePageSize(width), cursor = Math.min(state.cursor, Math.max(0, models.length-1)), page = Math.floor(cursor/size);
      const choices: Choice[] = models.slice(page*size,(page+1)*size).map(model => {
        const rates = state.tier === 'standard' ? model.rates : model.longContext?.rates;
        const values = rates ? [rate(rates.input),rate(rates.cacheRead),rate(rates.cacheCreate),rate(rates.output)] : ['—','—','—','—'];
        return { id: 'model:' + model.id, kind: 'price', recordStart: true,
          cells: width >= 68 ? columns([model.id,...values],false,!rates) : undefined,
          lines: width < 68 ? [model.id, ...(rates ? [] : ['无长上下文档'])] : [],
          paint: [{ tone:'priceModel', bold:true },{tone:'priceUnavailable'}],
          pricePairs: width < 68 && rates ? ['输入','缓存读取','缓存创建','输出'].map((label,index) => ({label,value:values[index]})) : undefined,
          priceDetail: state.expanded === model.id ? details(model) : undefined,
        };
      });
      return { choices, selected: cursor%size, tableCells: width >= 68 ? columns(['模型','输入','缓存读取','缓存创建','输出'],true) : undefined,
        empty: ['价表没有模型记录','U 联网更新价表'], status: notice,
        footer: `第 ${page+1} / ${Math.max(1,Math.ceil(models.length/size))} 页 · ${models.length} 个模型\n↑↓ 选择 · Enter 展开 · S 档位 · N/P 翻页 · Esc 返回\n— 无此档 · 未单列不按 $0 计算\n核对 ${prices.catalog.verifiedAt} · 历史快照保留原价格`,
      };
    },
  };
}
