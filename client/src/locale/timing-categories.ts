/** Labels describe core interval categories and masks; they never derive duration totals. */
import type { TrackCategory } from '../generated/timing-local-response.js';
import { t } from './index.js';

export const timingCategories = ['command', 'compaction', 'reasoning', 'mcp'] as const satisfies readonly TrackCategory[];
export function timingCategoryText(category: TrackCategory): string {
  return t(`execution.category.${category}`);
}
/** Core mask bits: command 1, compaction 2, reasoning 4, MCP 8. */
export function timingIntersectionText(mask: number): string {
  return timingCategories.filter((_, index) => (mask & (1 << index)) !== 0).map(timingCategoryText).join(' ∩ ');
}
