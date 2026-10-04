import type { AllowanceAssessment } from './generated/handoff-response.js';
export type { AllowanceAssessment } from './generated/handoff-response.js';
/** Expiration changes a displayed observation to unknown, never to restored allowance. */
export function allowanceStatus(value: AllowanceAssessment, now = Date.now()): AllowanceAssessment['status'] {
  const checked = Date.parse(value.checkedAt ?? ''), deadline = Date.parse(value.validUntil ?? '');
  return Number.isFinite(checked) && Number.isFinite(deadline) && checked <= now && now < deadline ? value.status : 'unknown';
}
