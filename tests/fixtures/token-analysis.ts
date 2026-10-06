import type { UsageSummary } from '@wombat/client';

type Counts = Partial<Record<'input' | 'cacheRead' | 'cacheCreate' | 'output' | 'reasoning' | 'total' | 'rawInput', number | null>>;
/** Synthetic complete rows only. Partial/conflicting examples explicitly override the relevant field. */
export function syntheticTokenAnalysis(values: Counts, records: number): UsageSummary['tokenAnalysis'] {
 const field = (value: number | null | undefined) => ({observedSubtotal:records > 0 ? value ?? null : null,coveredRecords:value != null ? records : 0,missingRecords:value == null ? records : 0,conflictingRecords:0,invalidRecords:0,indeterminateRecords:0});
 return {methodVersion:1,scope:'selected_canonical_measurements',fields:{input:field(values.input),cacheRead:field(values.cacheRead),cacheCreate:field(values.cacheCreate),output:field(values.output),reasoning:field(values.reasoning),total:field(values.total),rawInput:field(values.rawInput)}};
}
/** Test/preview construction only; production summaries always come from Rust. */
export function withTokenAnalysis<T extends {tokens: Counts;measurementCount: number;inputTotal?:number|null}>(summary:T):T & {tokenAnalysis:UsageSummary['tokenAnalysis']} {
 return {...summary,tokenAnalysis:syntheticTokenAnalysis({...summary.tokens,rawInput:summary.tokens.rawInput ?? summary.inputTotal},summary.measurementCount)};
}
