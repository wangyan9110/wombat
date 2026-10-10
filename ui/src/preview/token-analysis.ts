import type { UsageSummary } from '@wombat/client';

type Counts = Partial<
  Record<
    'input' | 'cacheRead' | 'cacheCreate' | 'output' | 'reasoning' | 'total' | 'rawInput',
    number | null
  >
>;
/** Synthetic complete rows only. Partial/conflicting examples explicitly override the relevant field. */
export function syntheticTokenAnalysis(
  values: Counts,
  records: number,
): UsageSummary['tokenAnalysis'] {
  const field = (value: number | null | undefined) => ({
    observedSubtotal: records > 0 ? (value ?? null) : null,
    coveredRecords: value != null ? records : 0,
    missingRecords: value == null ? records : 0,
    conflictingRecords: 0,
    invalidRecords: 0,
    indeterminateRecords: 0,
  });
  return {
    methodVersion: 1,
    scope: 'selected_canonical_measurements',
    fields: {
      input: field(values.input),
      cacheRead: field(values.cacheRead),
      cacheCreate: field(values.cacheCreate),
      output: field(values.output),
      reasoning: field(values.reasoning),
      total: field(values.total),
      rawInput: field(values.rawInput),
    },
  };
}
/** Test/preview construction only; production summaries always come from Rust. */
export function withTokenAnalysis<
  T extends { tokens: Counts; measurementCount: number; inputTotal?: number | null },
>(summary: T): T & { tokenAnalysis: UsageSummary['tokenAnalysis'] } {
  return {
    ...summary,
    tokenAnalysis: syntheticTokenAnalysis(
      { ...summary.tokens, rawInput: summary.tokens.rawInput ?? summary.inputTotal },
      summary.measurementCount,
    ),
  };
}

/** Explicit synthetic response facts; this fixture never calculates product token totals. */
export function calculatedTokenFixture(
  base: UsageSummary,
  partial: boolean,
): { summary: UsageSummary; measurements: UsageSummary[] } {
  const known: UsageSummary = withTokenAnalysis({
    ...base,
    measurementCount: 1,
    inputTotal: 1000,
    unpricedTokens: 0,
    tokens: {
      rawInput: 1000,
      input: 800,
      cacheRead: 200,
      cacheCreate: 0,
      output: 100,
      reasoning: 30,
      total: null,
    },
  });
  known.tokenAnalysis.totalAnalysis = {
    methodVersion: 1,
    subtotal: 1100,
    coveredRecords: 1,
    recordedRecords: 0,
    calculatedRecords: 1,
    unavailableRecords: 0,
    overflowRecords: 0,
  };
  if (!partial) return { summary: known, measurements: [known] };
  const missing: UsageSummary = withTokenAnalysis({
    ...base,
    measurementCount: 1,
    inputTotal: null,
    unpricedTokens: null,
    tokens: {
      rawInput: null,
      input: null,
      cacheRead: null,
      cacheCreate: null,
      output: null,
      reasoning: null,
      total: null,
    },
    price: {
      ...base.price,
      cost: null,
      knownCost: '0',
      status: 'unknown',
      issues: [
        'inputPriceUnknown',
        'cacheReadPriceUnknown',
        'cacheCreatePriceUnknown',
        'outputPriceUnknown',
      ],
    },
  });
  missing.tokenAnalysis.totalAnalysis = {
    methodVersion: 1,
    subtotal: null,
    coveredRecords: 0,
    recordedRecords: 0,
    calculatedRecords: 0,
    unavailableRecords: 1,
    overflowRecords: 0,
  };
  const fields = Object.fromEntries(
    Object.entries(known.tokenAnalysis.fields).map(([key, field]) => [
      key,
      { ...field, missingRecords: field.missingRecords + 1 },
    ]),
  ) as UsageSummary['tokenAnalysis']['fields'];
  const aggregate: UsageSummary = {
    ...missing,
    measurementCount: 2,
    tokenAnalysis: {
      ...known.tokenAnalysis,
      fields,
      totalAnalysis: {
        methodVersion: 1,
        subtotal: 1100,
        coveredRecords: 1,
        recordedRecords: 0,
        calculatedRecords: 1,
        unavailableRecords: 1,
        overflowRecords: 0,
      },
    },
    price: { ...missing.price, status: 'partial', knownCost: known.price.knownCost },
  };
  return { summary: aggregate, measurements: [known, missing] };
}
