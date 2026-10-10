/** A stable day within the current UTC budget month, shared by logs and routes. */
export function browserFixtureEpoch(now: Date): number {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid browser fixture clock');
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}
