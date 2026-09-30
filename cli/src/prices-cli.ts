import { CoreError, type PricingRequest } from '@wombat/client';
import { createNodeClient } from '@wombat/client/node';

export const pricingHelp = `用法
  wombat prices                 查看当前价表（离线）
  wombat prices update          从 OpenAI 官方更新标准 API 价表
  --json                        输出完整价表 JSON

更新成功后，运行 wombat refresh 使新快照采用新价格；已有快照保留原金额。
`;
export function parsePricingArgs(argv: string[]): { request: PricingRequest; json: boolean; help: boolean } {
  let action: PricingRequest['action'] = 'status', json = false, help = false, explicit = false;
  for (const arg of argv) {
    if (arg === '--json' && !json) json = true;
    else if ((arg === '--help' || arg === '-h') && !help) help = true;
    else if ((arg === 'update' || arg === 'status') && !explicit) { action = arg; explicit = true; }
    else throw new CoreError('INVALID_ARGUMENT', `无效价表参数：${arg}`);
  }
  return { request: { action }, json, help };
}
export async function runPricingCli(argv: string[]): Promise<number> {
  const { request, json, help } = parsePricingArgs(argv);
  if (help) {
    process.stdout.write(json ? JSON.stringify({ outputVersion: 1, help: pricingHelp }) + '\n' : pricingHelp);
    return 0;
  }
  const result = await createNodeClient().prices(request, { onProgress: stage => process.stderr.write(`Wombat · ${stage}\n`) });
  const text = [
    'Wombat · 标准 API 价表',
    result.action === 'update' ? result.updated ? '价表已更新' : '价表内容未变化' : result.origin === 'bundled' ? '正在使用内置价表' : '正在使用已下载价表',
    `版本 ${result.catalog.revision}`,
    `核对时间 ${result.catalog.verifiedAt}`,
    `${result.catalog.models.length} 个模型 · ${result.catalog.currency}`,
    result.source,
    '新价格在下一次 refresh 时生效；已有快照保留原金额。',
  ].join('\n');
  process.stdout.write(json ? JSON.stringify(result) + '\n' : text + '\n');
  return 0;
}
