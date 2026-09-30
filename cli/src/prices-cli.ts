import { t, progressText } from '@wombat/client/locale';
import { CoreError, type PricingRequest } from '@wombat/client';
import { createNodeClient } from '@wombat/client/node';

export function pricingHelp(): string { return t("cli.prices-cli.help"); }
export function parsePricingArgs(argv: string[]): { request: PricingRequest; json: boolean; help: boolean } {
  let action: PricingRequest['action'] = 'status', json = false, help = false, explicit = false;
  for (const arg of argv) {
    if (arg === '--json' && !json) json = true;
    else if ((arg === '--help' || arg === '-h') && !help) help = true;
    else if ((arg === 'update' || arg === 'status') && !explicit) { action = arg; explicit = true; }
    else throw new CoreError('INVALID_ARGUMENT', t("cli.prices-cli.invalid_pricing_argument_value", { p0: arg }));
  }
  return { request: { action }, json, help };
}
export async function runPricingCli(argv: string[]): Promise<number> {
  const { request, json, help } = parsePricingArgs(argv);
  if (help) {
    process.stdout.write(json ? JSON.stringify({ outputVersion: 1, help: pricingHelp() }) + '\n' : pricingHelp());
    return 0;
  }
  const result = await createNodeClient().prices(request, { onProgress: stage => process.stderr.write(`Wombat · ${progressText(stage)}\n`) });
  const text = [
    t("cli.prices-cli.wombat_standard_api_prices"),
    result.action === 'update' ? result.updated ? t("common.prices_updated") : t("common.prices_unchanged") : result.origin === 'bundled' ? t("cli.prices-cli.using_bundled_prices") : t("cli.prices-cli.using_downloaded_prices"),
    t("cli.prices-cli.revision_value", { p0: result.catalog.revision }),
    t("cli.prices-cli.verified_value", { p0: result.catalog.verifiedAt }),
    t("cli.prices-cli.value_models_value", { p0: result.catalog.models.length, p1: result.catalog.currency }),
    result.source,
    t("cli.prices-cli.new_prices_apply_on_the_next"),
  ].join('\n');
  process.stdout.write(json ? JSON.stringify(result) + '\n' : text + '\n');
  return 0;
}
