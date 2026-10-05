/** Explain pricing facts supplied by Rust without calculating prices or inferring missing counts. */
import { t } from './index.js';

export function pricingIssueText(code: string): string {
  switch (code) {
    case 'inconsistentTokenCounts': return t('usage.priceReason.inconsistentTokenCounts');
    case 'unverifiedModel': return t('usage.priceReason.unverifiedModel');
    case 'modelContextConflict': return t('usage.priceReason.modelContextConflict');
    case 'requestContextUnknown': return t('usage.priceReason.requestContextUnknown');
    case 'catalogPriceMissing': return t('usage.priceReason.catalogPriceMissing');
    case 'inputPriceUnknown': return t('usage.priceReason.input');
    case 'cacheReadPriceUnknown': return t('usage.priceReason.cacheRead');
    case 'cacheCreatePriceUnknown': return t('usage.priceReason.cacheCreate');
    case 'outputPriceUnknown': return t('usage.priceReason.output');
    default: return t('usage.priceReason.other');
  }
}
