/** Preserve the Rust cutoff's nanoseconds when comparing synthetic time windows. */
export function rfc3339Nanos(time: string): bigint {
  return BigInt(Date.parse(time)) * 1_000_000n
    + BigInt((time.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0').slice(3, 9));
}
