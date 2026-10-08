/**
 * USD amounts as x402 quotes carry them: integer atomic units of a 6-decimal stablecoin (USDC, EURC).
 * Everything is kept in bigint so that a cap is never compared through a float.
 */
export const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);

/** Parses "0.05", "$0.05" or "1" into atomic units; undefined when it is not a plain non-negative amount. */
export function parseUsd(text: string): bigint | undefined {
  const m = /^\$?(\d{1,9})(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) return undefined;
  const whole = BigInt(m[1]!);
  const fraction = BigInt((m[2] ?? "").padEnd(DECIMALS, "0"));
  return whole * UNIT + fraction;
}

/** Formats atomic units as "$0.002", "$0.05", "$1.00": trailing zeros trimmed, at least two decimals. */
export function formatUsd(atomic: bigint): string {
  const whole = atomic / UNIT;
  let fraction = (atomic % UNIT).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  if (fraction.length < 2) fraction = fraction.padEnd(2, "0");
  return `$${whole}.${fraction}`;
}
